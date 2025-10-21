const OpenAI = require('openai');

function createLLMClient() {
  const provider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();
  //const provider = ('groq').toLowerCase(); // Switched to OpenAI for optimization

  switch (provider) {
    case 'groq': {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error('GROQ_API_KEY is required when LLM_PROVIDER=groq');
      }
      return {
        provider,
        client: new OpenAI({
          apiKey,
          baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'
        }),
        defaultModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
        supportsTemperatureOverride: true,
        useResponsesAPI: false
      };
    }
    case 'openai':
    default: {
      const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY (or VITE_OPENAI) is required when LLM_PROVIDER=openai');
      }
      return {
        provider: 'openai',
        client: new OpenAI({ apiKey }),
        defaultModel: process.env.OPENAI_CHAT_MODEL || 'gpt-5',
        supportsTemperatureOverride: true,
        useResponsesAPI: false
      };
    }
  }
}

const {
  client: llmClient,
  provider: llmProvider,

  defaultModel,
  supportsTemperatureOverride,
  useResponsesAPI
} = createLLMClient();

const GROQ_MODEL_MAP = {
  'gpt-4o-mini': 'llama-3.1-8b-instant',
  'gpt-4o': 'openai/gpt-oss-20b',
  'gpt-4.1-mini': 'llama-3.1-8b-instant',
  'gpt-4.1': 'openai/gpt-oss-20b',
  'gpt-5-mini': 'llama-3.1-8b-instant',
  'gpt-5': 'openai/gpt-oss-20b',
};

/**
 * Call the OpenAI API with a prompt
 * @param {string} prompt - The prompt to send to the API
 * @param {number} temperature - Temperature parameter (0-1)
 * @returns {string} - The generated text response
 */
async function callLLM(prompt, temperature = null, options = {}) {
  const {
    model = defaultModel,
    top_p = 1,
    user = 'utils/llmHelpers',
    response_format,
    systemMessage = 'You are an expert in job posting analysis and improvement.',
    seed,
    messagesOverride = false,
    messages,
    timeout = 20000, // Default 20 second timeout, can be overridden
    max_tokens,
    max_output_tokens,
    stop
  } = options || {};

  const requestedModel = model || defaultModel;
  let effectiveModel = requestedModel;
  if (llmProvider === 'groq') {
    if (GROQ_MODEL_MAP[requestedModel]) {
      effectiveModel = GROQ_MODEL_MAP[requestedModel];
    } else if (/^gpt-/i.test(requestedModel)) {
      console.warn(`[LLM] Provider groq does not support model ${requestedModel}; falling back to ${defaultModel}.`);
      effectiveModel = defaultModel;
    }
  }

  const messageList = messagesOverride && messages ? messages : [
    { role: 'system', content: systemMessage },
    { role: 'user', content: prompt }
  ];

  let params;
  if (useResponsesAPI) {
    const input = messageList.map(({ role, content }) => ({
      role,
      content: Array.isArray(content)
        ? content
        : [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content) }]
    }));
    params = {
      model,
      input
    };
    if (typeof top_p === 'number') params.top_p = top_p;
    params.metadata = { caller: user };
  } else {
    params = {
      model: effectiveModel,
      messages: messageList,
      top_p,
      user
    };
  }
  
  // Only add temperature if it's explicitly provided, not null, and model supports it
  // Note: gpt-5 and gpt-5-mini models don't support custom temperature
  const supportsTemperature = supportsTemperatureOverride && !requestedModel.includes('gpt-5');
  if (temperature !== null && supportsTemperature) {
    params.temperature = temperature;
  }
  if (response_format) params.response_format = response_format;
  if (typeof seed === 'number') params.seed = seed;
  
  // gpt-5 models use max_completion_tokens instead of max_tokens
  const usesCompletionTokens = requestedModel.includes('gpt-5') || requestedModel.includes('o1') || requestedModel.includes('o3');
  if (typeof max_tokens === 'number') {
    if (usesCompletionTokens) {
      params.max_completion_tokens = max_tokens;
    } else {
      params.max_tokens = max_tokens;
    }
  } else if (typeof max_output_tokens === 'number') {
    if (usesCompletionTokens) {
      params.max_completion_tokens = max_output_tokens;
    } else {
      params.max_tokens = max_output_tokens;
    }
  }
  if (stop) params.stop = stop;

  const maxAttempts = 3;
  let lastError;
  
  // Log model usage for performance monitoring (always enabled for optimization tracking)
  console.log(`[LLM] Provider: ${llmProvider} | Model: ${params.model} | Requested: ${requestedModel} | Caller: ${user}`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (useResponsesAPI) {
        const response = await llmClient.responses.create(params, { timeout });
        const output = response?.output_text
          || response?.content?.map(part => part?.text || '').join('').trim();
        if (!output) {
          throw new Error('LLM provider returned an empty response');
        }
        return output;
      }

      const response = await llmClient.chat.completions.create(params, { timeout });
      return response.choices?.[0]?.message?.content;
    } catch (error) {
      lastError = error;
      const status = (error && error.status) || (error && error.code) || 0;
      const message = String((error && error.message) || '');

      // If model doesn't support custom temperature (only default=1), retry once without temperature
      const tempUnsupported = /Unsupported value: 'temperature'|Only the default \(1\) value is supported/i.test(message);
      if (tempUnsupported && params && Object.prototype.hasOwnProperty.call(params, 'temperature')) {
        console.warn('LLM rejected custom temperature; retrying without temperature.');
        const { temperature: _omit, ...safeParams } = params;
        try {
          if (useResponsesAPI) {
            const response = await llmClient.responses.create(safeParams, { timeout });
            const output = response?.output_text
              || response?.content?.map(part => part?.text || '').join('').trim();
            if (!output) {
              throw new Error('LLM provider returned an empty response');
            }
            return output;
          }

          const response = await llmClient.chat.completions.create(safeParams, { timeout });
          return response.choices?.[0]?.message?.content;
        } catch (e2) {
          // If retry without temperature also fails, throw that error
          lastError = e2;
          const e2Message = String((e2 && e2.message) || '');
          throw new Error(`LLM provider API error: ${e2Message}`);
        }
      }

      const retryable = status === 429 || (typeof status === 'number' && status >= 500) || /timeout/i.test(String(error && error.message));
      if (attempt < maxAttempts && retryable) {
        const backoffMs = 300 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
        console.warn(`LLM call failed (attempt ${attempt}/${maxAttempts}). Retrying in ${backoffMs}ms...`, error?.message || error);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      throw new Error(`LLM provider API error: ${error.message}`);
    }
  }
  throw lastError;
}

/**
 * Extract JSON from an LLM response
 * @param {string} response - The response from the LLM
 * @returns {Object} - Parsed JSON object
 */
function extractJsonFromResponse(response) {
  try {
    // Log the raw response for debugging
    console.log('[extractJsonFromResponse] Raw response length:', response?.length || 0);
    console.log('[extractJsonFromResponse] Raw response preview:', response?.substring(0, 200) + '...');
    
    if (!response || typeof response !== 'string') {
      throw new Error('Empty or invalid response from LLM');
    }
    
    // Try to find JSON within the response using regex
    const jsonMatch = response.match(/```json([\s\S]*?)```|({[\s\S]*?})/);
    
    let jsonString = '';
    if (jsonMatch) {
      // If the response contains JSON code blocks or braces
      jsonString = jsonMatch[1] ? jsonMatch[1].trim() : jsonMatch[0];
    } else {
      // Otherwise, try to use the entire response
      jsonString = response.trim();
    }
    
    console.log('[extractJsonFromResponse] Extracted JSON string:', jsonString);
    
    // Parse the JSON
    const parsed = JSON.parse(jsonString);
    console.log('[extractJsonFromResponse] Successfully parsed JSON');
    return parsed;
  } catch (error) {
    console.error('[extractJsonFromResponse] Error extracting JSON from response:', error);
    console.error('[extractJsonFromResponse] Response was:', response);
    throw new Error(`Failed to extract JSON from response: ${error.message}`);
  }
}

module.exports = {
  callLLM,
  extractJsonFromResponse
};
