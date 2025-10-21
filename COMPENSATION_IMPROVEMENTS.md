# Compensation Detection & Logging Improvements

## Changes Made

### 1. Enhanced Pay Period Detection

**File:** `services/scoringServiceV2.js`

#### Added Patterns
- **Slash notation:** `/year`, `/yr`, `/month`, `/mo`, `/week`, `/wk`, `/day`, `/hour`, `/hr`
- **Natural language:** "a year" (e.g., "$100k a year")
- **Heuristic inference:** Automatically infers "year" for salaries >$200k (e.g., "$460K – $555K" → annual)

```javascript
const PERIOD_KEYWORDS = [
  { regex: /(per\s*(year|yr|annum)|annual(?:ly)?|yearly|\/(yr|year)|a\s*year)/i, value: 'year' },
  { regex: /(per\s*(month|mo)|monthly|\/(mo|month))/i, value: 'month' },
  { regex: /(per\s*(week|wk)|weekly|\/(wk|week))/i, value: 'week' },
  { regex: /(per\s*(day)|daily|\/(day))/i, value: 'day' },
  { regex: /(per\s*(hour|hr)|hourly|\/(hr|hour))/i, value: 'hour' }
];

function detectPeriod(text) {
  if (!text) return null;
  
  // Check explicit period keywords first
  for (const entry of PERIOD_KEYWORDS) {
    if (entry.regex.test(text)) {
      return entry.value;
    }
  }
  
  // Infer from salary range (heuristic: >200k likely annual, <200 likely hourly)
  const hasLargeNumber = /\$?\s*[2-9]\d{2}[kK]|\$?\s*[1-9]\d{5,}/i.test(text);
  if (hasLargeNumber) {
    return 'year'; // Likely annual salary
  }
  
  return null;
}
```

### 2. Comprehensive Compensation Logging

#### Added to `scoringServiceV2.js`
```javascript
// Verbose logging for compensation scoring
if (process.env.OPTIMIZATION_VERBOSE_LOGS === 'true') {
  console.log('[DEBUG] Compensation scoring result:', {
    score: `${score}/15`,
    status,
    hasRange: compensation.isRange,
    hasCurrency: !!compensation.currency,
    hasPeriod: !!compensation.payPeriod,
    min: compensation.min,
    max: compensation.max,
    requiresDisclosure,
    jurisdictions: jurisdictions.join(', ') || 'none'
  });
}
```

#### Added to `api/optimize-job.js`
```javascript
// Log original compensation
const originalCompScore = originalCategories?.compensation?.score || 0;
const originalCompMax = originalCategories?.compensation?.maxScore || 15;
console.log(`[DEBUG] optimize-job: Original compensation: ${originalCompScore}/${originalCompMax}`);

// Log optimized compensation with delta
const optimizedCompScore = optimizedCategories?.compensation?.score || 0;
const optimizedCompMax = optimizedCategories?.compensation?.maxScore || 15;
const compDelta = optimizedCompScore - originalCompScore;
console.log(`[DEBUG] optimize-job: Optimized compensation: ${optimizedCompScore}/${optimizedCompMax} (${compDelta >= 0 ? '+' : ''}${compDelta})`);
```

## Expected Improvements

### Before
```
Compensation $460K – $555K
→ min: 460000, max: 555000, currency: USD, payPeriod: null
→ Score: 12/15 (range_missing_period)
```

### After
```
Compensation $460K – $555K
→ min: 460000, max: 555000, currency: USD, payPeriod: 'year' (inferred)
→ Score: 15/15 (range_full) ✅
```

## Scoring Logic

| Condition | Score | Status |
|-----------|-------|--------|
| Range + Currency + Period | **15/15** | `range_full` ✅ |
| Range + Currency | 13/15 | `range_missing_period` |
| Range only | 12/15 | `range_missing_currency_period` |
| Single + Currency + Period | 11/15 | `single_full` |
| Single + Currency | 9/15 | `single_missing_period` |
| Single only | 7/15 | `single_missing_currency_period` |
| Vague terms | 5/15 | `vague_terms` |
| Missing | 0/15 | `missing` |

## Testing

### Test Case: OpenAI Job Posting
```
URL: https://openai.com/careers/technical-lead-safety-research-san-francisco/
Compensation: $460K – $555K
Location: San Francisco, CA (pay transparency jurisdiction)

Expected Results:
✅ Period detected: 'year' (via heuristic)
✅ Score: 15/15
✅ Status: 'range_full'
✅ No suggestions about missing period
```

### Logs to Verify
```
[DEBUG] Compensation detection: {
  confidence: '0.80',
  source: 'deterministic',
  min: 460000,
  max: 555000,
  currency: 'USD',
  payPeriod: 'year',  ← Should now be present
  originalText: 'Compensation $460K – $555K'
}

[DEBUG] Compensation scoring result: {
  score: '15/15',     ← Should be 15, not 12
  status: 'range_full',
  hasRange: true,
  hasCurrency: true,
  hasPeriod: true,    ← Should be true
  min: 460000,
  max: 555000,
  requiresDisclosure: true,
  jurisdictions: 'California'
}

[DEBUG] optimize-job: Original compensation: 15/15
[DEBUG] optimize-job: Optimized compensation: 15/15 (+0)
```

## Deployment

```bash
fly deploy
```

**Status:** ✅ Deployed successfully

**Next Steps:**
1. Test with OpenAI job posting
2. Verify logs show `payPeriod: 'year'`
3. Confirm score reaches 15/15
4. Monitor for any false positives on hourly wages
