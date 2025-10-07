const { callLLM } = require('./llmHelpers');

/**
 * Execute a compact JSON-only LLM prompt with consistent defaults.
 * @param {Object} params
 * @param {string} params.task - Description of what to rate (e.g. "title clarity, buzzwords").
 * @param {Object} params.schema - Keys defining JSON fields (e.g. { title: {}, fluff: {} }).
 * @param {string} params.job_title
 * @param {string} params.job_body
 * @param {string} params.userTag - Identifier for telemetry/user field.
 * @param {number} [params.timeoutMs=60000]
 * @param {number} [params.maxOutputTokens=80]
 * @param {number} [params.seed=1234]
 * @returns {Promise<Object>} Parsed JSON object with score/suggestion pairs.
 */
async function runLLMJsonPrompt({
  task,
  schema,
  job_title,
  job_body,
  userTag,
  timeoutMs = 60000,
  maxOutputTokens = 80,
  seed = 1234
}) {
  if (!task || !schema || typeof schema !== 'object') {
    throw new Error('runLLMJsonPrompt requires task description and schema object');
  }

  const schemaKeys = Object.keys(schema)
    .map(key => `"${key}":{"score":#,"suggestion":""}`)
    .join(',');

  const prompt = `
JSON only.
Rate ${task} (0–10, 10=best). Include short suggestions.

Format:
{${schemaKeys}}

Title: "${job_title || ''}"
Body: "${job_body || ''}"
`;

  const llmPromise = (async () => {
    const response = await callLLM(prompt, null, {
      systemMessage: 'Expert job post auditor. Return one valid JSON object only.',
      response_format: { type: 'json_object' },
      user: userTag,
      seed,
      temperature: 0,
      max_output_tokens: maxOutputTokens
    });
    return JSON.parse(response);
  })();

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('LLM timeout'));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([llmPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    const fallback = {};
    for (const key of Object.keys(schema)) {
      fallback[key] = { score: 5, suggestion: '' };
    }
    console.warn('[runLLMJsonPrompt] Falling back to neutral scores:', error.message);
    return fallback;
  }
}

module.exports = { runLLMJsonPrompt };
