const express = require('express');
const router = express.Router();
const { generateJsonLd } = require('../services/schemaGenerator');
const { getJobById } = require('../utils/supabase');

/**
 * Generate JSON-LD schema.org/JobPosting data for a job posting
 * GET /api/generate-jsonld/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const jobId = req.params.id;
    console.log(`[DEBUG] Received request for job ID: ${jobId}`);
    
    if (!jobId) {
      return res.status(400).json({ error: 'Job ID is required' });
    }
    
    // First, check if JSON-LD already exists in the reports table
    try {
      const { supabase } = require('../utils/supabase');
      const { data, error } = await supabase
        .from('reports')
        .select('json_ld, job_body, job_title, total_score, feedback')
        .eq('id', jobId)
        .single();
        
      if (data?.json_ld) {
        console.log(`[DEBUG] JSON-LD found in database for job ID: ${jobId}`);
        return res.json(data.json_ld);
      }
      
      // If we have the job data but no JSON-LD, generate it on the fly
      if (data && data.job_body) {
        console.log(`[DEBUG] Job data found, but no JSON-LD. Generating it now...`);
        const json_ld = await generateJsonLd(data.job_body, {
          score: data.total_score || 0,
          feedback: data.feedback || '',
          job_title: data.job_title || 'Job Posting'
        });
        
        // Save the generated JSON-LD back to the database
        const { error: updateError } = await supabase
          .from('reports')
          .update({ json_ld })
          .eq('id', jobId);
          
        if (updateError) {
          console.warn(`[WARN] Failed to update report with JSON-LD:`, updateError);
        } else {
          console.log(`[DEBUG] Updated report with generated JSON-LD`);
        }
        
        return res.json(json_ld);
      }
    } catch (dbError) {
      console.warn(`[WARN] Database error:`, dbError);
      // Continue to the fallback approach
    }
    
    // Get job data from database using the utility function
    console.log(`[DEBUG] Attempting to fetch job data from database...`);
    const jobData = await getJobById(jobId);
    
    if (!jobData) {
      console.log(`[DEBUG] Job data not found for ID: ${jobId}`);
      return res.status(404).json({ error: 'Job posting not found' });
    }
    
    console.log(`[DEBUG] Job data retrieved successfully:`, {
      id: jobData.id,
      hasJobText: !!jobData.jobText,
      jobTextLength: jobData.jobText ? jobData.jobText.length : 0,
      hasAnalysisResult: !!jobData.analysisResult
    });
    
    // Check if JSON-LD is already available
    if (jobData.json_ld) {
      console.log(`[DEBUG] JSON-LD found in jobData`);
      return res.json(jobData.json_ld);
    }
    
    // Generate JSON-LD schema using the schemaGenerator service
    console.log(`[DEBUG] Generating JSON-LD schema...`);
    const json_ldData = await generateJsonLd(jobData.jobText, jobData.analysisResult);
    
    console.log(`[DEBUG] JSON-LD generation successful`);
    
    // Return the generated schema
    return res.json(json_ldData);
  } catch (error) {
    console.error('[ERROR] Error generating JSON-LD schema:', error);
    res.status(500).json({ 
      error: 'Failed to generate JSON-LD schema',
      message: error.message 
    });
  }
});

// Add a test endpoint to verify the route is working
router.get('/test', (req, res) => {
  res.json({ message: 'JSON-LD generator endpoint is working!' });
});

module.exports = router;
