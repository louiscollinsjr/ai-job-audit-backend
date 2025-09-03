const express = require('express');
const router = express.Router();
const { callLLM } = require('../utils/llmHelpers');
const { getJobPostingById, updateJobPosting } = require('../services/databaseService');
const { supabase } = require('../utils/supabase'); // Assuming supabase is initialized here

/**
 * GET /api/v1/rewrite-job/:id
 *
 * Retrieves the job posting and its improvement data without creating a new rewrite
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch job from database
    const job = await getJobPostingById(id);
    if (!job) {
      return res.status(404).json({ error: 'Job posting not found' });
    }
    
    // Get latest rewrite version if it exists (handle gracefully if table doesn't exist)
    let latestVersion = null;
    try {
      const { data, error } = await supabase
        .from('rewrite_versions')
        .select('*')
        .eq('job_id', id)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (!error) {
        latestVersion = data;
      } else {
        console.warn('Could not query rewrite_versions table:', error.message);
      }
    } catch (err) {
      console.warn('rewrite_versions table may not exist or have RLS issues:', err.message);
    }
    
    // Get recommendations from either direct array or feedback details
    let recommendations = [];
    if (job.recommendations && Array.isArray(job.recommendations)) {
      recommendations = job.recommendations;
    } else if (job.feedback?.details) {
      recommendations = job.feedback.details.map(d => 
        typeof d === 'string' ? d : JSON.stringify(d)
      );
    }
    
    // Return existing job data with latest version if available
    res.json({
      original_text: job.job_body || job.original_text,
      improvedText: latestVersion?.improved_text || job.improved_text || '',
      recommendations,
      score: job.total_score || job.totalscore,
      hasRewrite: !!latestVersion || !!job.improved_text,
      versionNumber: latestVersion?.version_number || 1
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
 * 
 * Endpoint that:
 * 1. Fetches the job from the database by ID
 * 2. Uses the stored score feedback to improve the job text
 * 3. Returns the rewritten job posting
 * 4. Saves to both rewrite_versions and reports tables
 */
router.post('/:id', async (req, res) => {
  try {
    console.log('Entering rewrite-job handler');
    const { id } = req.params;
    const { saveToDatabase = true } = req.body;
    
    // Fetch job from database
    const job = await getJobPostingById(id);
    if (!job) {
      console.log('Job not found');
      return res.status(404).json({ error: 'Job posting not found' });
    }
    
    console.log('Job data:', JSON.stringify(job, null, 2));
    
    // Get original text from job_body or original_text
    const originalText = job.job_body || job.original_text;
    if (!originalText) {
      console.log('Missing original text');
      return res.status(400).json({ 
        error: 'Invalid job data', 
        details: 'Job is missing original text'
      });
    }
    
    // Get recommendations from either direct array or feedback details
    let recommendations = [];
    if (job.recommendations && Array.isArray(job.recommendations)) {
      recommendations = job.recommendations;
    } else if (job.feedback?.details) {
      recommendations = job.feedback.details.map(d => 
        typeof d === 'string' ? d : JSON.stringify(d)
      );
    }
    
    // Create improvement prompt
    // const prompt = `Rewrite this job posting to address these specific issues:\n\n` +
    //   `Original Posting: ${job.original_text}\n\n` +
    //   `Areas Needing Improvement:\n${recommendations.join('\n')}\n\n` +
    //   `Improved Version:`;
    
    const prompt = `You are to output only the improved job posting text with no extra commentary, preamble, or explanation.\n\n` +
    `Rewrite this job posting to address the following issues.\n\n` +
    `Original Posting:\n${originalText}\n\n` +
    `Areas Needing Improvement:\n${recommendations.join('\n')}\n\n` +
    `Improved Version (output only the rewritten posting, nothing else):`;
    
    // Generate improved text
    const improvedText = await callLLM(prompt);
    
    // Save if requested
    if (saveToDatabase) {
      // Try to save to rewrite_versions table if it exists
      let versionSaved = false;
      try {
        // Get next version number
        const { count } = await supabase
          .from('rewrite_versions')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', id);
        
        const nextVersion = (count || 0) + 1;
        
        // Create version entry
        const { error: versionError } = await supabase
          .from('rewrite_versions')
          .insert({
            job_id: id,
            improved_text: improvedText,
            created_at: new Date().toISOString(),
            version_number: nextVersion
          });
        
        if (versionError) {
          console.warn('Could not save to rewrite_versions table:', versionError.message);
        } else {
          versionSaved = true;
        }
      } catch (err) {
        console.warn('rewrite_versions table may not exist, skipping version tracking:', err.message);
      }
      
      // Always update main reports table
      const updateData = { 
        improved_text: improvedText
      };
      
      if (!job.original_text && originalText) {
        updateData.original_text = originalText;
      }
      
      await updateJobPosting(id, updateData);
      
      if (!versionSaved) {
        console.log('Note: Rewrite saved to reports table but version tracking unavailable');
      }
    }
    
    console.log('Handler completed successfully');
    return res.json({
      original_text: originalText,
      improvedText,
      recommendations,
      score: job.total_score || job.totalscore,
      versionNumber: saveToDatabase ? ((await supabase.from('rewrite_versions').select('version_number', { count: 'exact' }).eq('job_id', id)).count || 0) + 1 : 1
    });
    
  } catch (error) {
    console.error('Error in rewrite-job handler:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

module.exports = router;