# Coherence Pass Fix: Preventing Section Structure Loss

## Problem Identified

**Prompt Alignment Regression:** 11/15 → 8/15 (-3 points)

### Root Cause
The coherence pass was optimizing for text flow but **destroying section boundaries**:

**Original Breakdown:**
```json
{
  "queryMatch": 7,
  "grouping": 8,      // ✅ Good section grouping
  "structure": 0,
  "detBonus": 2
}
```

**After Coherence Pass:**
```json
{
  "queryMatch": 9,    // +2 ✅ Keywords improved
  "grouping": 0,      // -8 ❌ Section grouping destroyed
  "structure": 0,
  "detBonus": 2
}
```

**Net Result:** +2 (keywords) - 8 (grouping) = **-6 raw points** → -3 final points

---

## What is "Grouping"?

From the LLM prompt in `llmPromptHelper.js`:

```javascript
task: 'query_match, grouping, and structure for alignment and scannability'
```

**Grouping** measures how well content is organized into **clear, distinct sections** like:
- About the Team
- About the Role
- Key Responsibilities
- Requirements
- Benefits
- Compensation

The LLM rates 0-10 based on:
- Presence of clear section headings
- Logical grouping of related information
- Ease of scanning/navigation

---

## Solution Implemented

### 1. **Enhanced Coherence Pass Prompt**

**File:** `services/sections.js` → `buildCoherencePrompt()`

**Added Critical Instructions:**
```javascript
'CRITICAL: Preserve ALL section headings and structure (About the Team, About the Role, Requirements, Benefits, etc.).',
'DO NOT merge sections or remove clear section boundaries. Maintain distinct sections with their original headings.',
'Only improve flow WITHIN sections, not by combining them.',
```

**Before:**
```
Ensure the following job posting sections read as a cohesive, on-brand document.
Fix redundant transitions, align tone, and ensure formatting consistency.
```

**After:**
```
Ensure the following job posting sections read as a cohesive, on-brand document.
Fix redundant transitions, align tone, and ensure formatting consistency.
CRITICAL: Preserve all location details exactly as provided (city, state, remote/hybrid status).
CRITICAL: Preserve ALL section headings and structure (About the Team, About the Role, Requirements, Benefits, etc.).
DO NOT merge sections or remove clear section boundaries. Maintain distinct sections with their original headings.
Only improve flow WITHIN sections, not by combining them.
```

### 2. **Post-Coherence Validation**

**File:** `services/optimizationPipelineV2.js`

**Added Section Count Validation:**
```javascript
// Validate section structure preservation
const originalSectionCount = (assembled.match(/^#{1,3}\s+/gm) || []).length;
const optimizedSectionCount = (coherencePayload.optimized_text.match(/^#{1,3}\s+/gm) || []).length;

if (optimizedSectionCount < originalSectionCount) {
  console.warn('[WARN] Coherence pass reduced section count:', {
    original: originalSectionCount,
    optimized: optimizedSectionCount,
    lost: originalSectionCount - optimizedSectionCount
  });
} else {
  console.log('[DEBUG] Section structure preserved:', {
    original: originalSectionCount,
    optimized: optimizedSectionCount
  });
}
```

**What This Does:**
- Counts markdown headings (`#`, `##`, `###`) before and after coherence pass
- Logs warning if sections were lost
- Provides visibility into structural changes

---

## Expected Results

### Before Fix
- **Coherence pass:** Merges sections for better flow
- **Grouping score:** 8 → 0 (-8 points)
- **Prompt Alignment:** 11 → 8 (-3 points)

### After Fix
- **Coherence pass:** Improves flow WITHIN sections
- **Grouping score:** 8 → 8 or 8 → 9 (preserved or improved)
- **Prompt Alignment:** 11 → 13 (+2 points expected)

### Score Impact
- **Current optimized:** 75/100
- **With fix:** 75 + 3 = **78/100**
- **With compensation fix:** 78 + 7 = **85/100** ✅

---

## Testing Instructions

### 1. Deploy Changes
```bash
fly deploy
```

### 2. Test with OpenAI Job Posting
```
URL: https://openai.com/careers/technical-lead-safety-research-san-francisco/
```

### 3. Check Logs for Validation
Look for:
```
[DEBUG] Section structure preserved: {
  original: 6,
  optimized: 6
}
```

Or warning:
```
[WARN] Coherence pass reduced section count: {
  original: 6,
  optimized: 4,
  lost: 2
}
```

### 4. Verify Prompt Alignment Score
**Expected:**
- Original: 11/15
- Optimized: 11-13/15 (preserved or improved)
- **NOT:** 8/15 (regression)

---

## Additional Context

### Why This Matters

**Prompt Alignment** (20% of total score) measures:
1. **Query Match (33%):** Keyword density for search
2. **Grouping (33%):** Section organization
3. **Structure (33%):** Overall formatting

Losing 8 points in grouping means:
- **Raw impact:** -8/10 in one sub-category
- **Weighted impact:** -2.67/10 in overall prompt alignment
- **Final impact:** -3/20 points (15% of category)

This is a **significant regression** that undermines the optimization's value.

### Why It Happened

The coherence pass model (`openai/gpt-oss-20b`) was given:
- ✅ Instruction to improve flow
- ✅ Instruction to align tone
- ❌ **NO instruction to preserve structure**

Result: LLM optimized for readability by merging sections, not realizing this would hurt the "grouping" score.

---

## Related Issues

### Issue #1: Structured Data Score Unchanged (14→14)
- **Blocker:** Text optimization can't add JSON-LD schema
- **Solution:** Separate schema generation endpoint (future work)

### Issue #2: Compensation Pay Period Missing
- **Status:** Fixed in latest deployment (pending verification)
- **Expected:** 8/15 → 15/15 (+7 points)

### Issue #3: Keyword Targeting Low (11/15)
- **Blocker:** Only 1 skill detected, no employment type
- **Solution:** Enhanced skill extraction + employment type inference (future work)

---

## Deployment Status

✅ **Changes Committed:**
- `services/sections.js` - Enhanced coherence prompt
- `services/optimizationPipelineV2.js` - Added validation logging

⏳ **Pending Deployment:**
```bash
fly deploy
```

🧪 **Testing Required:**
- Re-run OpenAI job posting
- Verify section structure preserved
- Confirm prompt alignment score doesn't regress

---

## Success Criteria

✅ **Section count preserved:** Original sections = Optimized sections  
✅ **Grouping score maintained:** 8/10 → 8-9/10  
✅ **Prompt alignment improved:** 11/15 → 11-13/15  
✅ **No regression warnings:** Clean validation logs  

**Target Score:** 85/100 (with compensation fix)
