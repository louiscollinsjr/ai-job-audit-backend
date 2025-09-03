const express = require('express');
const router = express.Router();
const { supabase } = require('../utils/supabase');

// This file is deprecated - optimization functionality moved to optimize-job.js
// Keeping minimal compatibility endpoints for existing frontend calls

/**
 * GET /api/v1/rewrite-job/:id
 * Legacy endpoint - redirects to new optimization system
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch report from database
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();
    
    if (reportError || !report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    // Get latest optimization if it exists
    const { data: latestOptimization } = await supabase
      .from('optimizations')
      .select('*')
      .eq('report_id', id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    // Get recommendations from report
    let recommendations = [];
    if (report.recommendations && Array.isArray(report.recommendations)) {
      recommendations = report.recommendations;
    }
    
    // Return data in expected legacy format
    res.json({
      original_text: report.job_body || report.original_text,
      improvedText: latestOptimization?.optimized_text || report.improved_text || '',
      recommendations,
      score: report.total_score || report.totalscore,
      hasRewrite: !!latestOptimization || !!report.improved_text,
      versionNumber: latestOptimization?.version_number || 1
    });
  } catch (error) {
    console.error('Error retrieving job posting:', error);
    res.status(500).json({ 
      error: 'An unexpected error occurred', 
      details: error.message 
    });
  }
});

/**
 * POST /api/v1/rewrite-job/:id
 * Legacy endpoint - redirects to new optimization system
 */
router.post('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Redirect to new optimization endpoint with report_id
    return res.status(400).json({ 
      error: 'Legacy endpoint deprecated', 
      message: 'Please use POST /api/v1/optimize-job with report_id instead',
      migration_guide: {
        old: 'POST /api/v1/rewrite-job/:id',
        new: 'POST /api/v1/optimize-job',
        body: { report_id: id }
      }
    });
  } catch (error) {
    console.error('Error in legacy rewrite-job handler:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

module.exports = router;