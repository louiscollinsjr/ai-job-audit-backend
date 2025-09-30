const express = require('express');
const router = express.Router();
const { scoreJob7Category } = require('../services/scoringService');
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
    
    // 3. Re-score optimized version using 7-category scoring
    console.log('[DEBUG] optimize-job: Scoring optimized text');
    const optimizedAnalysis = await scoreJob7Category(optimizationResult.optimizedText, '');
    const optimizedScore = optimizedAnalysis.totalScore;

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
    const { data: savedOptimization, error: saveError } = await supabase
      .from('optimizations')
      .insert([{
        report_id: jobId,
        version_number: nextVersion,
        original_text_snapshot: jobText,
        optimized_text: optimizationResult.optimizedText,
        original_score: originalScore,
        optimized_score: optimizedScore,
        change_log: optimizationResult.changeLog,
        unaddressed_items: optimizationResult.unaddressedItems,
        created_at: new Date().toISOString()
      }])
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
  const prompt = `You are an expert job posting optimizer. Analyze and improve the following job posting to maximize its score across these categories:

1. **Clarity & Readability** (20 points): Use clear language, short sentences, avoid jargon
2. **Prompt Alignment** (20 points): Well-structured with clear sections (Responsibilities, Requirements, Benefits)
3. **Structured Data** (15 points): Include all key details that can be structured (title, location, employment type, etc.)
4. **Recency** (10 points): Add urgency indicators if appropriate
5. **Keyword Targeting** (15 points): Include role keywords, level, location, employment type, and relevant skills
6. **Compensation Transparency** (10 points): Provide clear salary range and benefits
7. **Page Context** (10 points): Use proper formatting with headers and bullet lists

Current Score: ${originalScore}/100

Original Job Posting:
${originalText}

Provide your response in the following JSON format:
{
  "optimized_text": "The improved job posting text here",
  "change_log": [
    "Specific improvement 1",
    "Specific improvement 2"
  ],
  "unaddressed_items": [
    "Issue that couldn't be addressed without more information"
  ]
}

Focus on high-impact improvements. Be specific in the change_log about what was improved.`;

  try {
    const response = await callLLM(prompt, 'services/optimize-job', 0.7);
    
    // Parse JSON response
    let parsed;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || response.match(/```\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[DEBUG] optimize-job: Failed to parse LLM response as JSON:', parseError);
      // Fallback: return original with minimal improvements
      return {
        optimizedText: originalText,
        changeLog: ['Unable to generate optimizations - please try again'],
        unaddressedItems: []
      };
    }

    return {
      optimizedText: parsed.optimized_text || originalText,
      changeLog: parsed.change_log || [],
      unaddressedItems: parsed.unaddressed_items || []
    };
  } catch (error) {
    console.error('[DEBUG] optimize-job: Error generating optimized text:', error);
    throw error;
  }
}

module.exports = router;
