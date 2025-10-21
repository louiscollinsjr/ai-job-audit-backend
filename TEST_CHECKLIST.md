# Test Checklist: Coherence Pass Fix + Compensation Fix

## Deployment Status
✅ **Deployed:** Both fixes live on Fly.io

## Changes Deployed

### 1. Coherence Pass Structure Preservation
- **File:** `services/sections.js`
- **Change:** Added explicit instructions to preserve section headings
- **Expected:** Grouping score maintained (8→8 or 8→9), not destroyed (8→0)

### 2. Enhanced Pay Period Detection
- **File:** `services/scoringServiceV2.js`
- **Change:** Added heuristic inference for large salaries (>$200k = annual)
- **Expected:** `payPeriod: 'year'` detected, score 12→15 (+3 points)

### 3. Comprehensive Compensation Logging
- **Files:** `services/scoringServiceV2.js`, `api/optimize-job.js`
- **Change:** Added verbose compensation scoring logs
- **Expected:** See compensation scores in optimization logs

---

## Test Case: OpenAI Job Posting

**URL:** `https://openai.com/careers/technical-lead-safety-research-san-francisco/`

**Compensation:** `$460K – $555K`

---

## Expected Results

### Original Audit Score
| Category | Expected | Notes |
|----------|----------|-------|
| Clarity | 7/15 | Baseline |
| Prompt Alignment | 11/15 | grouping: 8, queryMatch: 7 |
| Structured Data | 14/15 | LLM assessment |
| Recency | 8/10 | No date found |
| Keyword Targeting | 11/15 | Only 1 skill |
| **Compensation** | **15/15** | ✅ **Should be 15 now (was 8)** |
| Page Context | 12/10 | Maxed |
| **Total** | **78/100** | **+7 from compensation fix** |

### Optimized Score
| Category | Expected | Notes |
|----------|----------|-------|
| Clarity | 11-13/15 | +4 to +6 improvement |
| **Prompt Alignment** | **11-13/15** | ✅ **Should NOT drop to 8** |
| Structured Data | 14/15 | Can't improve (no schema) |
| Recency | 8/10 | Can't improve (no date) |
| Keyword Targeting | 11-13/15 | May improve slightly |
| **Compensation** | **15/15** | ✅ **Should maintain 15** |
| Page Context | 10/10 | May improve |
| **Total** | **85-90/100** | **Target: Good band** |

---

## Logs to Verify

### 1. Compensation Detection (Original)
```
[DEBUG] Compensation detection: {
  confidence: '0.80',
  source: 'deterministic',
  min: 460000,
  max: 555000,
  currency: 'USD',
  payPeriod: 'year',  ← ✅ Should be 'year' (was null)
  originalText: 'Compensation $460K – $555K'
}
```

### 2. Compensation Scoring (Original)
```
[DEBUG] Compensation scoring result: {
  score: '15/15',     ← ✅ Should be 15 (was 8)
  status: 'range_full',
  hasRange: true,
  hasCurrency: true,
  hasPeriod: true,    ← ✅ Should be true (was false)
  min: 460000,
  max: 555000,
  requiresDisclosure: true,
  jurisdictions: 'California'
}
```

### 3. Section Structure Preservation
```
[DEBUG] Section structure preserved: {
  original: 6,
  optimized: 6        ← ✅ Should match (not decrease)
}
```

### 4. Prompt Alignment (Optimized)
```
"promptAlignment": {
  "score": 11-13,     ← ✅ Should be 11+ (NOT 8)
  "breakdown": {
    "queryMatch": 9,
    "grouping": 8-9,  ← ✅ Should be 8+ (NOT 0)
    "structure": 0,
    "detBonus": 2
  }
}
```

### 5. Compensation Comparison
```
[DEBUG] optimize-job: Original compensation: 15/15
[DEBUG] optimize-job: Optimized compensation: 15/15 (+0)
```

---

## Red Flags to Watch For

### ❌ Regression: Compensation Still Missing Period
```
payPeriod: null  ← BAD: Fix didn't work
```

### ❌ Regression: Grouping Score Destroyed
```
"grouping": 0    ← BAD: Coherence pass still merging sections
```

### ❌ Regression: Section Count Reduced
```
[WARN] Coherence pass reduced section count: {
  original: 6,
  optimized: 4,
  lost: 2
}
```

### ❌ Missing Logs
```
(No compensation scoring logs appear)
```
**Fix:** Check `OPTIMIZATION_VERBOSE_LOGS=true` is set

---

## Success Criteria

✅ **Compensation pay period detected:** `payPeriod: 'year'`  
✅ **Compensation score improved:** 8/15 → 15/15 (+7 points)  
✅ **Section structure preserved:** Original sections = Optimized sections  
✅ **Grouping score maintained:** 8/10 → 8-9/10 (NOT 0)  
✅ **Prompt alignment maintained:** 11/15 → 11-13/15 (NOT 8)  
✅ **Overall score improved:** 71 → 85-90 (+14-19 points)  

---

## Manual Test Steps

### Step 1: Run Audit
1. Go to frontend
2. Enter URL: `https://openai.com/careers/technical-lead-safety-research-san-francisco/`
3. Click "Audit"
4. **Check:** Original score should be ~78/100 (up from 71)

### Step 2: Run Optimization
1. Click "Optimize" button
2. Wait for optimization to complete
3. **Check:** Optimized score should be 85-90/100

### Step 3: Review Logs
```bash
fly logs -a ai-audit-api -n 500 > test_logs.txt
```

Search for:
- `[DEBUG] Compensation detection`
- `[DEBUG] Compensation scoring result`
- `[DEBUG] Section structure preserved`
- `[DEBUG] optimize-job: Original compensation`
- `[DEBUG] optimize-job: Optimized compensation`

### Step 4: Compare Scores
**Original:**
- Compensation: Should be 15/15 (was 8/15)
- Total: Should be ~78/100 (was 71/100)

**Optimized:**
- Prompt Alignment: Should be 11-13/15 (was 8/15)
- Compensation: Should be 15/15 (maintained)
- Total: Should be 85-90/100 (was 75/100)

---

## If Tests Fail

### Compensation Still 8/15
**Possible causes:**
1. Pay period heuristic not triggering
2. Regex not matching format
3. Scoring logic not updated

**Debug:**
```javascript
// Check detectPeriod() in scoringServiceV2.js
// Verify hasLargeNumber regex matches "$460K"
```

### Grouping Still 0/10
**Possible causes:**
1. Coherence pass ignoring instructions
2. LLM model not following prompt
3. Section headings removed during merge

**Debug:**
```javascript
// Check buildCoherencePrompt() in sections.js
// Verify CRITICAL instructions are present
// Check section count validation logs
```

### Logs Missing
**Possible causes:**
1. `OPTIMIZATION_VERBOSE_LOGS` not set
2. Logging code not reached
3. Error before logging

**Fix:**
```bash
fly secrets set OPTIMIZATION_VERBOSE_LOGS=true
```

---

## Next Steps After Verification

### If Successful ✅
1. Update memories with new scoring baseline
2. Document expected score ranges
3. Add regression tests
4. Consider adding more fixes:
   - Employment type detection (+2 points)
   - Enhanced skill extraction (+2 points)
   - JSON-LD schema generation (+1 point)

### If Failed ❌
1. Review logs for error messages
2. Check which specific fix failed
3. Debug and iterate
4. Re-deploy and re-test

---

## Target Score Progression

| Stage | Score | Notes |
|-------|-------|-------|
| **Original (Before Fixes)** | 71/100 | Baseline |
| **Original (After Comp Fix)** | 78/100 | +7 from pay period |
| **Optimized (Before Fixes)** | 75/100 | Regression from grouping |
| **Optimized (After Fixes)** | 85-90/100 | +10-15 from both fixes |

**Goal:** Reach "Good" band (80-89) consistently
