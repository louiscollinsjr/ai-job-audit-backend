const express = require('express');
const router = express.Router();
const { callLLM } = require('../utils/llmHelpers');
const { getJobPostingById, updateJobPosting } = require('../services/databaseService');
const { supabase } = require('../utils/supabase'); // Assuming supabase is initialized here

/**
 * GET /api/rewrite-job/:id
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
    
    // Get recommendations from either direct array or feedback details
    let recommendations = [];
    if (job.recommendations && Array.isArray(job.recommendations)) {
      recommendations = job.recommendations;
    } else if (job.feedback?.details) {
      recommendations = job.feedback.details.map(d => 
        typeof d === 'string' ? d : JSON.stringify(d)
      );
    }
    
    // Return existing job data
    res.json({
      original_text: job.original_text,
      improvedText: job.improved_text || '',
      recommendations,
      score: job.totalscore
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
 * POST /api/rewrite-job/:id
 * 
 * Endpoint that:
 * 1. Fetches the job from the database by ID
 * 2. Uses the stored score feedback to improve the job text
 * 3. Returns the rewritten job posting
 * 4. Optionally saves it back to the database
 */
router.post('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { saveToDatabase = true } = req.body; // Default to saving
    
    // 1. Fetch job from database
    const job = await getJobPostingById(id);
    if (!job) {
      return res.status(404).json({ error: 'Job posting not found' });
    }
    
    // Log complete job structure for debugging
    console.log('Job data structure:', JSON.stringify(job, null, 2));
    
    // Validate required fields
    if (!job.original_text) {
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
    const prompt = `Rewrite this job posting to address these specific issues:\n\n` +
      `Original Posting: ${job.original_text}\n\n` +
      `Areas Needing Improvement:\n${recommendations.join('\n')}\n\n` +
      `Improved Version:`;
    
    // Generate improved text
    const improvedText = await callLLM(prompt);
    
    // Save if requested
    if (saveToDatabase) {
      // First create version entry
      const { error: versionError } = await supabase
        .from('rewrite_versions')
        .insert({
          job_id: id,
          improved_text: improvedText,
          created_at: new Date().toISOString()
        });
      
      if (versionError) throw versionError;
      
      // Then update main improved_text
      await updateJobPosting(id, { improved_text: improvedText });
    }
    
    res.json({
      original_text: job.original_text,
      improvedText,
      recommendations,
      score: job.totalscore
    });
  } catch (error) {
    console.error('Error in rewrite-job endpoint:', error);
    res.status(500).json({ 
      error: 'An unexpected error occurred', 
      details: error.message 
    });
  }
});

module.exports = router;