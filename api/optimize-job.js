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

    // 1. Get original report to extract score
    const originalReport = await getJobPostingById(jobId);
    if (!originalReport) {
      return res.status(404).json({ error: 'Report not found' });
    }
    const originalScore = originalReport.total_score || 0;

    // 2. Generate optimized version with LLM
    console.log('[DEBUG] optimize-job: Generating optimized text with LLM');
    const optimizationResult = await generateOptimizedJobPost(jobText, originalScore);
    
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
 * Generate optimized job posting with tracked improvements
 */
async function generateOptimizedJobPost(originalText, originalScore) {
  const prompt = `You are an **expert job posting optimizer and copy editor**. Your objective is to rewrite the job posting so it can achieve a **100/100 score** across clarity, structure, data completeness, keyword coverage, compensation transparency, and formatting.

### Output expectations
- Deliver a **complete rewritten job posting**, never a summary.
- Preserve roughly the same length as the original (longer if key details are missing).
- Use **Markdown formatting** throughout:
  - \`##\` section headings (Responsibilities, Requirements, Benefits, etc.)
  - Bullet lists where appropriate
  - Bold important terms, job title, and compensation details
- Maintain a professional, inclusive tone while keeping all factual information accurate.

### Return format (JSON only)
{
  "optimized_text": "Full improved posting in Markdown",
  "change_log": ["Specific, measurable improvements"],
  "unaddressed_items": ["Clarifications still needed"]
}

### Example snippet for optimized_text
"optimized_text": "## About the Role\\nJoin our **Senior Data Engineer** team...\\n\\n## Responsibilities\\n- Build scalable data pipelines..."

---

Current Score: ${originalScore}/100

Original Job Posting:
${originalText}

Think through the improvements silently, then output **only the final JSON object**.`;

  try {
    // Note: gpt-5 models don't support custom temperature, so we don't pass it
    // Optimization requires longer timeout due to complex analysis
    let response;
    try {
      response = await callLLM(prompt, null, { 
        user: 'services/optimize-job',
        systemMessage: 'Professional job posting optimizer. Respond with one JSON object containing the Markdown rewrite and supporting arrays.',
        response_format: { type: 'json_object' },
        model: 'groq/compound',
        temperature: 0.6,
        top_p: 0.7,
        max_output_tokens: 900,
        timeout: 90000 // 90 second timeout for optimization
      });
    } catch (jsonError) {
      console.warn('[optimize-job] JSON response_format failed, retrying without constraint:', jsonError?.message);
      response = await callLLM(prompt, null, { 
        user: 'services/optimize-job',
        systemMessage: 'Professional job posting optimizer. Respond with one JSON object containing the Markdown rewrite and supporting arrays.',
        model: 'groq/compound',
        temperature: 0.6,
        top_p: 0.7,
        max_output_tokens: 900,
        timeout: 90000
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
