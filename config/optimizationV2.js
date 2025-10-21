const parseList = (value) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []);

module.exports = {
  featureFlag: String(process.env.OPTIMIZATION_PIPELINE_V2 ?? 'true').toLowerCase() === 'true',
  tokenBudget: {
    targetTotal: Number(process.env.OPTIMIZATION_TOKEN_TARGET || 8000),
    fallbackTotal: Number(process.env.OPTIMIZATION_TOKEN_FALLBACK || 6000),
    minOutput: Number(process.env.OPTIMIZATION_MIN_OUTPUT || 1500)
  },
  models: {
    sectionModel: process.env.OPTIMIZATION_SECTION_MODEL || 'gpt-5-mini',
    coherenceModel: process.env.OPTIMIZATION_COHERENCE_MODEL || 'gpt-5-mini',
    sectionTemperature: Number(process.env.OPTIMIZATION_SECTION_TEMPERATURE ?? 0.4),
    coherenceTemperature: Number(process.env.OPTIMIZATION_COHERENCE_TEMPERATURE ?? 0.3)
  },
  preservation: {
    // Brand keywords that should never be removed or altered
    brandKeywords: parseList(process.env.OPTIMIZATION_BRAND_KEYWORDS || 'OpenAI,ChatGPT,GPT,AGI,Claude,Anthropic,Google,Microsoft,Meta,Amazon,Apple'),
    // Preserve exact job titles
    preserveTitle: String(process.env.OPTIMIZATION_PRESERVE_TITLE ?? 'true').toLowerCase() === 'true'
  },
  retries: {
    maxAttempts: Number(process.env.OPTIMIZATION_MAX_ATTEMPTS ?? 3),
    backoffMs: parseList(process.env.OPTIMIZATION_RETRY_BACKOFF || '0,1000,4000').map((value) => Number(value) || 0)
  },
  segmentation: {
    maxCharsPerSection: Number(process.env.OPTIMIZATION_MAX_SECTION_CHARS ?? 4500),
    maxTokensPerSection: Number(process.env.OPTIMIZATION_MAX_SECTION_TOKENS ?? 1200)
  },
  logging: {
    enabled: String(process.env.OPTIMIZATION_VERBOSE_LOGS || '').toLowerCase() === 'true'
  }
};
