const { callLLM } = require('../utils/llmHelpers');
const { 
  scoreStructuredDataPresence: scoreStructuredDataPresenceOriginal,
  scoreRecencyFreshness: scoreRecencyFreshnessOriginal
} = require('./scoringService');

/**
 * Enhanced Structured Data Presence (15 pts)
 * Hybrid: Try JSON-LD first, fallback to LLM assessment
 */
async function scoreStructuredDataPresence({ job_html, job_body }) {
  const safeBody = typeof job_body === 'string' ? job_body : '';
  const jsonLdResult = scoreStructuredDataPresenceOriginal({ job_html });
  
  if (jsonLdResult.score > 0) {
    console.log('[Enhanced] JSON-LD found, score:', jsonLdResult.score);
    return { ...jsonLdResult, breakdown: { ...jsonLdResult.breakdown, source: 'json-ld' } };
  }
  
  console.log('[Enhanced] No JSON-LD, using LLM for structured info assessment');
  
  try {
    const response = await callLLM(
      'Assess information completeness',
      null,
      {
        model: 'gpt-5-mini',
        systemMessage: 'You are a job posting analyst. Output a single JSON object.',
        response_format: { type: 'json_object' },
        user: 'services/scoringEnhanced/structured_info',
        seed: 5555,
        messagesOverride: true,
        messages: [
          { role: 'system', content: 'You are a job posting analyst. Output a single JSON object.' },
          {
            role: 'user',
            content: `Assess if this job posting contains well-structured, complete information.

Score 0-15 based on:
- Clear sections (Responsibilities, Requirements, Benefits) = 5 pts
- Complete role details (title, level, location, type) = 4 pts  
- Organized presentation (headers, bullets, flow) = 3 pts
- Essential info (what, who, why) = 3 pts

Return JSON: {"score": 0-15, "suggestion": "string"}

Job posting:
${safeBody.slice(0, 3500)}`
          }
        ]
      }
    );
    
    const result = JSON.parse(response);
    return {
      score: Math.min(15, Math.max(0, result.score || 0)),
      maxScore: 15,
      breakdown: { source: 'llm-assessment' },
      suggestions: [result.suggestion || 'Add clear sections and complete role information.']
    };
  } catch (error) {
    console.error('[Enhanced] LLM structured info failed:', error.message);
    return {
      score: 7,
      maxScore: 15,
      breakdown: { source: 'fallback' },
      suggestions: ['Add clear sections with responsibilities, requirements, and benefits.']
    };
  }
}

/**
 * Enhanced Recency & Freshness (10 pts)
 * Hybrid: Try date extraction first, fallback to LLM freshness signals
 */
async function scoreRecencyFreshness({ job_html, job_body }) {
  const safeBody = typeof job_body === 'string' ? job_body : '';
  const dateResult = scoreRecencyFreshnessOriginal({ job_html, job_body: safeBody });
  
  if (dateResult.breakdown && dateResult.breakdown.date) {
    console.log('[Enhanced] Date found, score:', dateResult.score);
    return { ...dateResult, breakdown: { ...dateResult.breakdown, source: 'date-found' } };
  }
  
  console.log('[Enhanced] No date found, using LLM for freshness assessment');
  
  try {
    const response = await callLLM(
      'Analyze freshness signals',
      null,
      {
        model: 'gpt-5-mini',
        systemMessage: 'You are a job posting analyst. Output a single JSON object.',
        response_format: { type: 'json_object' },
        user: 'services/scoringEnhanced/recency_signals',
        seed: 6666,
        messagesOverride: true,
        messages: [
          { role: 'system', content: 'You are a job posting analyst. Output a single JSON object.' },
          {
            role: 'user',
            content: `Analyze this job posting for freshness/recency signals.

Look for:
- Urgency language ("hiring now", "immediate", "ASAP")
- Active recruiting tone (vs archived feel)
- Current/future tense (vs past tense)
- Modern technology stack

Score 0-10:
- 10 = Strong urgency, active recruiting, modern
- 7 = Neutral, appears current
- 4 = Some stale indicators
- 0 = Archived feel, outdated

Return JSON: {"score": 0-10, "suggestion": "string"}

Job posting:
${safeBody.slice(0, 3500)}`
          }
        ]
      }
    );
    
    const result = JSON.parse(response);
    return {
      score: Math.min(10, Math.max(0, result.score || 7)),
      maxScore: 10,
      breakdown: { source: 'llm-signals' },
      suggestions: [result.suggestion || 'Add posting date or urgency language for better visibility.']
    };
  } catch (error) {
    console.error('[Enhanced] LLM recency failed:', error.message);
    return {
      score: 7,
      maxScore: 10,
      breakdown: { source: 'fallback-neutral' },
      suggestions: ['Add a visible posting date or urgency language.']
    };
  }
}

/**
 * Enhanced Page Context & Cleanliness (10 pts)
 * LLM-based: Assess content quality and focus
 */
async function scorePageContextCleanliness({ job_body }) {
  console.log('[Enhanced] Using LLM for content quality assessment');
  const safeBody = typeof job_body === 'string' ? job_body : '';
  
  try {
    const response = await callLLM(
      'Assess content quality',
      null,
      {
        model: 'gpt-5',
        systemMessage: 'You are a job posting quality analyst. Output a single JSON object.',
        response_format: { type: 'json_object' },
        user: 'services/scoringEnhanced/content_quality',
        seed: 7777,
        messagesOverride: true,
        messages: [
          { role: 'system', content: 'You are a job posting quality analyst. Output a single JSON object.' },
          {
            role: 'user',
            content: `Assess the content quality and focus of this job posting.

Score 0-10 based on:
- Content focus (3 pts): Primarily about the job, not diluted with marketing
- Clarity (3 pts): Clear and direct, not vague or generic
- Completeness (4 pts): Covers role, responsibilities, requirements, benefits

Deduct for:
- Excessive boilerplate or legal disclaimers
- Vague descriptions ("rockstar", "ninja", "wear many hats")
- Missing key information
- Unprofessional tone

Return JSON: {"score": 0-10, "suggestion": "string"}

Job posting:
${safeBody.slice(0, 3500)}`
          }
        ]
      }
    );
    
    const result = JSON.parse(response);
    return {
      score: Math.min(10, Math.max(0, result.score || 0)),
      maxScore: 10,
      breakdown: { source: 'llm-quality' },
      suggestions: [result.suggestion || 'Improve content focus and reduce boilerplate.']
    };
  } catch (error) {
    console.error('[Enhanced] LLM content quality failed:', error.message);
    return {
      score: 5,
      maxScore: 10,
      breakdown: { source: 'fallback' },
      suggestions: ['Focus content on the job role and reduce boilerplate.']
    };
  }
}

module.exports = {
  scoreStructuredDataPresence,
  scoreRecencyFreshness,
  scorePageContextCleanliness
};
