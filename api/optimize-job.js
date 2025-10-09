const express = require('express');
const router = express.Router();
const { scoreJob7Category } = require('../services/scoringService');
const { scoreJobEnhanced } = require('../services/scoringServiceV2');
const { getJobPostingById } = require('../services/databaseService');
const { callLLM } = require('../utils/llmHelpers');
const { supabase } = require('../utils/supabase');

/**
 * POST /api/v1/optimize-job
 * Creates an optimized job posting with detailed improvement tracking
 */
router.post('/', async (req, res) => {
  try {
    const { text, job_id, report_id } = req.body;
    const jobId = report_id || job_id; // Support both field names
    console.log('[DEBUG] optimize-job: Starting optimization for report_id:', jobId);
    
    if (!text && !jobId) {
      return res.status(400).json({ error: 'Either job posting text or report_id is required' });
    }

    // Fetch report data if only report_id is provided
    let jobText = text;
    if (!jobText && jobId) {
      console.log('[DEBUG] optimize-job: Fetching report data for ID:', jobId);
      const report = await getJobPostingById(jobId);
      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }
      jobText = report.job_body || report.text;
      if (!jobText) {
        return res.status(400).json({ error: 'Report does not contain job posting text' });
      }
      console.log('[DEBUG] optimize-job: Retrieved job text, length:', jobText.length);
    }

    // 1. Get original report and score breakdown
    const originalReport = await getJobPostingById(jobId);
    if (!originalReport) {
      return res.status(404).json({ error: 'Report not found' });
    }
    const originalScore = originalReport.total_score || 0;

    // 1b. Score the original text to extract category-level insights
    console.log('[DEBUG] optimize-job: Scoring original text to capture category deltas');
    const originalJobData = {
      job_title: originalReport.job_title || 'Job Posting',
      job_body: jobText,
      job_html: originalReport.job_html || ''
    };
    const originalAnalysis = await scoreJobEnhanced(originalJobData);
    const originalCategories = originalAnalysis?.categories || {};
    console.log('[DEBUG] optimize-job: Original category scores:', JSON.stringify(originalCategories, null, 2));

    // 2. Generate optimized version with LLM (using category insights)
    console.log('[DEBUG] optimize-job: Generating optimized text with LLM');
    const optimizationResult = await generateOptimizedJobPost(jobText, originalScore, originalCategories);
    
    // 3. Re-score optimized version using ENHANCED (V2) scoring - same as audit endpoint
    console.log('[DEBUG] optimize-job: Scoring optimized text with V2 Enhanced scoring');
    const optimizedJobData = {
      job_title: originalReport.job_title || 'Job Posting',
      job_body: optimizationResult.optimizedText,
      job_html: '' // Optimized text is plain text, no HTML
    };
    const optimizedAnalysis = await scoreJobEnhanced(optimizedJobData);
    console.log('[DEBUG] optimize-job: Full optimizedAnalysis object:', JSON.stringify(optimizedAnalysis, null, 2));
    const optimizedScore = optimizedAnalysis.total_score; // Note: property is total_score, not totalScore
    
    console.log('[DEBUG] optimize-job: Optimized score calculated:', optimizedScore);
    console.log('[DEBUG] optimize-job: Type of optimizedScore:', typeof optimizedScore);
    
    if (optimizedScore === undefined || optimizedScore === null) {
      console.error('[ERROR] optimize-job: optimizedScore is undefined/null! Full analysis:', optimizedAnalysis);
      throw new Error('Failed to calculate optimized score - score is undefined');
    }

    // 3b. Guardrail: ensure optimization improves the score before saving
    if (optimizedScore <= originalScore) {
      console.warn('[WARN] optimize-job: Optimized score did not improve', {
        original: originalScore,
        optimized: optimizedScore,
        delta: optimizedScore - originalScore
      });
      return res.status(200).json({
        error: 'Optimization did not improve score',
        message: 'The optimized version scored the same or lower than the original. Please try again or edit manually.',
        original_score: originalScore,
        optimized_score: optimizedScore,
        improvement: false
      });
    }

    console.log('[SUCCESS] optimize-job: Score improved from', originalScore, 'to', optimizedScore, '(+' + (optimizedScore - originalScore) + ')');

    // 4. Get latest version number for this report
    const { data: existingVersions, error: versionError } = await supabase
      .from('optimizations')
      .select('version_number')
      .eq('report_id', jobId)
      .order('version_number', { ascending: false })
      .limit(1);
    
    if (versionError) {
      console.error('[DEBUG] optimize-job: Error fetching versions:', versionError);
    }

    const nextVersion = (existingVersions && existingVersions.length > 0) 
      ? existingVersions[0].version_number + 1 
      : 1;

    // 5. Save to optimizations table
    console.log('[DEBUG] optimize-job: Saving to optimizations table, version:', nextVersion);
    const optimizationRecord = {
      report_id: jobId,
      version_number: nextVersion,
      original_text_snapshot: jobText,
      optimized_text: optimizationResult.optimizedText,
      original_score: originalScore,
      optimized_score: optimizedScore,
      change_log: optimizationResult.changeLog,
      unaddressed_items: optimizationResult.unaddressedItems,
      created_at: new Date().toISOString()
    };
    
    console.log('[DEBUG] optimize-job: Record to save:', JSON.stringify({
      report_id: jobId,
      version_number: nextVersion,
      original_score: originalScore,
      optimized_score: optimizedScore,
      optimized_text_length: optimizationResult.optimizedText.length
    }));
    
    const { data: savedOptimization, error: saveError } = await supabase
      .from('optimizations')
      .insert([optimizationRecord])
      .select()
      .single();

    if (saveError) {
      console.error('[DEBUG] optimize-job: Error saving optimization:', saveError);
      throw saveError;
    }

    console.log('[DEBUG] optimize-job: Optimization saved successfully');
    
    // Return response in format expected by frontend
    res.json({
      id: savedOptimization.id,
      report_id: jobId,
      version_number: nextVersion,
      rewritten_text: optimizationResult.optimizedText,
      new_score: optimizedScore,
      optimized_score: optimizedScore,
      original_score: originalScore,
      change_log: optimizationResult.changeLog,
      unaddressed_items: optimizationResult.unaddressedItems,
      created_at: savedOptimization.created_at
    });
  } catch (error) {
    console.error('Error optimizing job posting:', error);
    res.status(500).json({ 
      error: 'Failed to optimize job posting', 
      details: error.message 
    });
  }
});

/**
 * Build category-specific guidance for the optimization prompt
 */
function buildCategoryGuidance(categories = {}) {
  const lines = [];

  const addSection = (label, emoji, score, maxScore, suggestions = []) => {
    const safeScore = score ?? 0;
    const safeMax = maxScore ?? 1;
    const pct = Math.round((safeScore / safeMax) * 100);

    if (pct >= 85) {
      return;
    }

    const severity = pct < 70 ? '🔴' : emoji;
    lines.push(`**${severity} ${label}: ${safeScore}/${safeMax} (${pct}%)**`);

    suggestions.slice(0, 3).forEach((suggestion) => {
      lines.push(`  - ${suggestion}`);
    });
  };

  if (categories.clarity) {
    addSection(
      'Clarity & Readability',
      '🟡',
      categories.clarity.score,
      categories.clarity.maxScore,
      categories.clarity.suggestions || [
        'Use shorter sentences and reduce jargon.',
        'Remove buzzwords and keep language specific.'
      ]
    );
  }

  if (categories.promptAlignment) {
    addSection(
      'Structure & Prompt Alignment',
      '🟡',
      categories.promptAlignment.score,
      categories.promptAlignment.maxScore,
      categories.promptAlignment.suggestions || [
        'Add clear section headings such as Responsibilities, Requirements, Benefits.',
        'Lead with the role and location in the opening paragraph.'
      ]
    );
  }

  if (categories.keywordTargeting) {
    addSection(
      'Keyword Coverage',
      '🟡',
      categories.keywordTargeting.score,
      categories.keywordTargeting.maxScore,
      categories.keywordTargeting.suggestions || [
        'Include seniority, role keywords, and critical skills explicitly.',
        'State employment type and work modality (remote, hybrid, on-site).'
      ]
    );
  }

  if (categories.compensation) {
    addSection(
      'Compensation Transparency',
      '🟡',
      categories.compensation.score,
      categories.compensation.maxScore,
      categories.compensation.suggestions || [
        '**CRITICAL:** Add a transparent salary or rate range with currency and pay period.',
        'List headline benefits (health, retirement, PTO, bonus, equity).'        
      ]
    );
  }

  if (categories.structuredData) {
    addSection(
      'Role & Data Completeness',
      '🟡',
      categories.structuredData.score,
      categories.structuredData.maxScore,
      categories.structuredData.suggestions || [
        'Include role seniority, department/team context, and application instructions.'
      ]
    );
  }

  if (categories.pageContext) {
    addSection(
      'Formatting & Page Context',
      '🟡',
      categories.pageContext.score,
      categories.pageContext.maxScore,
      categories.pageContext.suggestions || [
        'Break up dense paragraphs with headings and bullet lists.'
      ]
    );
  }

  if (!lines.length) {
    lines.push('**✅ Strong Performance:** Build on the solid foundation and polish details to reach 100/100.');
  }

  return lines.join('\n');
}

/**
 * Generate optimized job posting with tracked improvements
 */
async function generateOptimizedJobPost(originalText, originalScore, categories = {}) {
  const categoryGuidance = buildCategoryGuidance(categories);

  const prompt = `You are an **expert job posting optimizer and copy editor**. Rewrite the job posting below so it reaches a **100/100 score** across clarity, structure, data completeness, keyword coverage, compensation transparency, and formatting.

### Current Performance Snapshot
**Overall Score:** ${originalScore}/100
${categoryGuidance}

### Mission
- Build upon the existing content; do **not** summarize or shorten drastically.
- Maintain or expand the original length with richer detail.
- Preserve accurate facts, requirements, and context.
- Ensure compensation transparency with concrete ranges and benefits whenever possible.

### Output Requirements
- Produce the **full rewritten post** using Markdown:
  - \`##\` headings for sections (About the Role, Responsibilities, Requirements, Benefits, Compensation, How to Apply, etc.)
  - Bullet lists using \`-\` for clarity
  - **Bold** key items (job title, compensation figures, critical skills)
- Keep language inclusive, clear, and free of fluff.

### Return JSON Only
{
  "optimized_text": "Complete Markdown rewrite",
  "change_log": ["Specific improvements with measurable impact"],
  "unaddressed_items": ["Items requiring hiring manager input"]
}

### Style Reference
"optimized_text": "## About the Role\\nJoin our **Senior Data Engineer** team...\\n\\n## Responsibilities\\n- Build scalable pipelines...\\n- Partner with cross-functional teams...\\n\\n## Requirements\\n- 5+ years with Python and SQL\\n- Experience with AWS or GCP\\n\\n## Compensation\\n**Salary Range:** $140,000 - $175,000 per year\\n**Benefits:** Medical, dental, vision, 401(k) match, 20 days PTO"

---

**Original Job Posting:**
${originalText}

Think through improvements, then output **only the JSON object** containing the final rewrite.`;

  try {
    const callOptions = {
      user: 'services/optimize-job',
      systemMessage: 'Professional job posting optimizer. Respond with one JSON object containing the Markdown rewrite and supporting arrays.',
      response_format: { type: 'json_object' },
      model: 'groq/compound'
    };

    // Groq models benefit from explicit creativity/length controls.
    // If this ever runs against GPT-5 (which ignores temperature/top_p), the fields are harmless.
    const groqTunedOptions = {
      ...callOptions,
      temperature: 0.7,
      top_p: 0.85,
      max_output_tokens: 1500,
      timeout: 120000
    };

    let response;
    try {
      response = await callLLM(prompt, null, groqTunedOptions);
    } catch (jsonError) {
      console.warn('[optimize-job] JSON response_format failed, retrying without constraint:', jsonError?.message);
      response = await callLLM(prompt, null, {
        ...callOptions,
        temperature: 0.7,
        top_p: 0.85,
        max_output_tokens: 1500,
        timeout: 120000
      });
    }
    
    // Parse JSON response
    let parsed;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || response.match(/```\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[DEBUG] optimize-job: Failed to parse LLM response as JSON:', parseError);
      console.error('[DEBUG] optimize-job: Raw LLM response snippet:', response?.slice?.(0, 400));
      // Fallback: surface original text so downstream scoring still works
      return {
        optimizedText: originalText,
        changeLog: ['Unable to generate optimizations - please try again'],
        unaddressedItems: []
      };
    }

    const normalizeText = value => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) {
        return value
          .map(item => normalizeText(item))
          .filter(Boolean)
          .join('\n\n');
      }
      if (typeof value === 'object') {
        if (typeof value.text === 'string') return value.text;
        if (typeof value.content === 'string') return value.content;
        return Object.values(value)
          .map(item => normalizeText(item))
          .filter(Boolean)
          .join('\n\n');
      }
      return String(value);
    };

    const optimizedText = (() => {
      if (!parsed) return originalText;
      const raw = parsed.optimized_text;
      const normalized = normalizeText(raw);
      const trimmed = normalized.trim();
      return trimmed.length ? trimmed : originalText;
    })();

    // Ensure change_log and unaddressed_items are arrays
    const changeLog = Array.isArray(parsed.change_log) 
      ? parsed.change_log 
      : (parsed.change_log ? [parsed.change_log] : []);
    
    const unaddressedItems = Array.isArray(parsed.unaddressed_items)
      ? parsed.unaddressed_items
      : (parsed.unaddressed_items ? [parsed.unaddressed_items] : []);
    
    console.log('[DEBUG] optimize-job: Parsed change_log:', changeLog);
    console.log('[DEBUG] optimize-job: Parsed unaddressed_items:', unaddressedItems);
    
    return {
      optimizedText,
      changeLog: changeLog
        .map(item => normalizeText(item).trim())
        .filter(Boolean),
      unaddressedItems: unaddressedItems
        .map(item => normalizeText(item).trim())
        .filter(Boolean)
    };
  } catch (error) {
    console.error('[DEBUG] optimize-job: Error generating optimized text:', error);
    throw error;
  }
}

module.exports = router;
