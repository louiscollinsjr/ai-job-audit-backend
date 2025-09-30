# Enhanced Scoring Implementation Guide

## Overview
Add LLM fallbacks for 3 categories that currently fail for most job postings:
1. Structured Data (no JSON-LD)
2. Recency (no date found)
3. Page Context (HTML ratio meaningless)

## Implementation Steps

### Step 1: Update scoringServiceV2.js

Replace the imports at the top of the file to use enhanced versions:

```javascript
// BEFORE:
const {
  scoreClarityReadability,
  scorePromptAlignment,
  scoreStructuredDataPresence,
  scoreRecencyFreshness,
  scoreKeywordTargeting,
  scorePageContextCleanliness
} = require('./scoringService');

// AFTER:
const {
  scoreClarityReadability,
  scorePromptAlignment,
  scoreKeywordTargeting
} = require('./scoringService');

// Import enhanced versions
const {
  scoreStructuredDataPresence,
  scoreRecencyFreshness,
  scorePageContextCleanliness
} = require('./scoringServiceEnhanced');
```

### Step 2: Create scoringServiceEnhanced.js

Create a new file: `/backend/services/scoringServiceEnhanced.js`

Copy the entire content from the code block below.

---

## Complete scoringServiceEnhanced.js Code

```javascript
const { callLLM } = require('../utils/llmHelpers');
const { 
  scoreStructuredDataPresence: scoreStructuredDataPresenceOriginal,
  scoreRecencyFreshness: scoreRecencyFreshnessOriginal,
  scorePageContextCleanliness: scorePageContextCleanlinessOriginal
} = require('./scoringService');

/**
 * Enhanced Structured Data Presence (15 pts)
 * Hybrid: Try JSON-LD first, fallback to LLM assessment
 */
async function scoreStructuredDataPresence({ job_html, job_body }) {
  // Try deterministic JSON-LD parsing first
  const jsonLdResult = scoreStructuredDataPresenceOriginal({ job_html });
  
  // If JSON-LD found and scored > 0, use it
  if (jsonLdResult.score > 0) {
    console.log('[Enhanced] JSON-LD found, score:', jsonLdResult.score);
    return { ...jsonLdResult, breakdown: { ...jsonLdResult.breakdown, source: 'json-ld' } };
  }
  
  // No JSON-LD - use LLM to assess information completeness
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
${job_body.slice(0, 3500)}`
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
  // Try deterministic date extraction first
  const dateResult = scoreRecencyFreshnessOriginal({ job_html, job_body });
  
  // If date found, use it
  if (dateResult.breakdown && dateResult.breakdown.date) {
    console.log('[Enhanced] Date found, score:', dateResult.score);
    return { ...dateResult, breakdown: { ...dateResult.breakdown, source: 'date-found' } };
  }
  
  // No date - use LLM to assess freshness signals
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
${job_body.slice(0, 3500)}`
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
  
  try {
    const response = await callLLM(
      'Assess content quality',
      null,
      {
        model: 'gpt-5',  // Use full model for quality assessment
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
${job_body.slice(0, 3500)}`
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
```

---

## Step 3: Update scoringServiceV2.js imports

At the top of `scoringServiceV2.js`, change line 2-9 from:

```javascript
const {
  scoreClarityReadability,
  scorePromptAlignment,
  scoreStructuredDataPresence,
  scoreRecencyFreshness,
  scoreKeywordTargeting,
  scorePageContextCleanliness
} = require('./scoringService');
```

To:

```javascript
const {
  scoreClarityReadability,
  scorePromptAlignment,
  scoreKeywordTargeting
} = require('./scoringService');

const {
  scoreStructuredDataPresence,
  scoreRecencyFreshness,
  scorePageContextCleanliness
} = require('./scoringServiceEnhanced');
```

---

## Expected Results

After deployment:

### LLM Calls
- **Before**: 2-3 calls (Clarity, Prompt Alignment, sometimes Compensation)
- **After**: 5-6 calls (+ Structured Data, Recency, Page Context)

### Performance
- All run in parallel via `Promise.all()`
- Total time = max(slowest call) ≈ 30-35s (same as before)
- No significant slowdown

### Cost
- **Before**: ~$0.03 per analysis
- **After**: ~$0.05 per analysis (+$0.02)
- 3 new gpt-5-mini calls are cheap

### Accuracy
- ✅ No more false negatives for missing JSON-LD
- ✅ No more zero scores for missing dates
- ✅ Real content quality assessment vs HTML ratio

---

## Testing

After deployment, check logs for:

```
[Enhanced] No JSON-LD, using LLM for structured info assessment
[LLM] Using model: gpt-5-mini for services/scoringEnhanced/structured_info
[Enhanced] No date found, using LLM for freshness assessment
[LLM] Using model: gpt-5-mini for services/scoringEnhanced/recency_signals
[Enhanced] Using LLM for content quality assessment
[LLM] Using model: gpt-5 for services/scoringEnhanced/content_quality
```

Test with a job posting that has:
- ❌ No JSON-LD (most postings)
- ❌ No visible date
- ✅ Good content

Should now get reasonable scores instead of zeros.

---

## Rollback

If issues arise:

1. Revert `scoringServiceV2.js` imports back to original
2. Delete `scoringServiceEnhanced.js`
3. Redeploy

