const OpenAI = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI,
});

/**
 * Call the OpenAI API with a prompt
 * @param {string} prompt - The prompt to send to the API
 * @param {number} temperature - Temperature parameter (0-1)
 * @returns {string} - The generated text response
 */
async function callLLM(prompt, temperature = null, options = {}) {
  const {
    model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    top_p = 1,
    user = 'utils/llmHelpers',
    response_format,
    systemMessage = 'You are an expert in job posting analysis and improvement.',
    seed,
    messagesOverride = false,
    messages
  } = options || {};

  const params = {
    model,
    messages: messagesOverride && messages ? messages : [
      { role: 'system', content: systemMessage },
      { role: 'user', content: prompt }
    ],
    top_p,
    user
  };
  
  // Only add temperature if it's explicitly provided and not null
  if (temperature !== null) {
    params.temperature = temperature;
  }
  if (response_format) params.response_format = response_format;
  if (typeof seed === 'number') params.seed = seed;

  const maxAttempts = 3;
  let lastError;
  
  // Log model usage for performance monitoring (always enabled for optimization tracking)
  console.log(`[LLM] Using model: ${params.model} for ${user}`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await openai.chat.completions.create(params, { timeout: 20000 });
      return response.choices[0].message.content;
    } catch (error) {
      lastError = error;
      const status = (error && error.status) || (error && error.code) || 0;
      const message = String((error && error.message) || '');

      // If model doesn't support custom temperature (only default=1), retry once without temperature
      const tempUnsupported = /Unsupported value: 'temperature'|Only the default \(1\) value is supported/i.test(message);
      if (tempUnsupported && params && Object.prototype.hasOwnProperty.call(params, 'temperature')) {
        try {
          console.warn('LLM rejected custom temperature; retrying without temperature.');
          const { temperature: _omit, ...safeParams } = params;
          const response = await openai.chat.completions.create(safeParams, { timeout: 20000 });
          return response.choices[0].message.content;
        } catch (e2) {
          lastError = e2;
          // fall through to normal retry logic below
        }
      }

      const retryable = status === 429 || (typeof status === 'number' && status >= 500) || /timeout/i.test(String(error && error.message));
      if (attempt < maxAttempts && retryable) {
        const backoffMs = 300 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
        console.warn(`LLM call failed (attempt ${attempt}/${maxAttempts}). Retrying in ${backoffMs}ms...`, error?.message || error);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      throw new Error(`OpenAI API error: ${error.message}`);
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
