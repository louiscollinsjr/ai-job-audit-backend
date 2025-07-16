const express = require('express');
const router = express.Router();
const { analyzeJobText, extractTextFromUrl, extractTextFromFile } = require('../services/jobAnalyzer');
const { generateJsonLd } = require('../services/schemaGenerator');
const { saveJobPosting } = require('../services/databaseService');
const { callLLM } = require('../utils/llmHelpers');

/**
 * POST /api/analyze-job
 * 
 * Unified endpoint that:
 * 1. Accepts job input (text/url/file)
 * 2. Generates job visibility score and JSON-LD
 * 3. Stores original + score + JSON-LD in the database
 * 4. Returns all data in a single JSON response
 */
router.post('/', async (req, res) => {
  try {
    const { inputType, inputData } = req.body;
    
    if (!inputType || !inputData) {
      return res.status(400).json({ 
        error: 'Missing required parameters', 
        details: 'Both inputType and inputData are required' 
      });
    }
    
    // 1. Extract text based on input type
    let jobText;
    try {
      if (inputType === 'text') {
        jobText = inputData;
      } else if (inputType === 'url') {
        jobText = await extractTextFromUrl(inputData);
      } else if (inputType === 'file') {
        jobText = await extractTextFromFile(inputData);
      } else {
        return res.status(400).json({ error: 'Invalid input type', details: 'Input type must be text, url, or file' });
      }
    } catch (error) {
      console.error('Error extracting job text:', error);
      return res.status(422).json({ error: 'Failed to process job input', details: error.message });
    }
    
    // 2. Generate analysis and visibility score
    let analysisResult;
    try {
      analysisResult = await analyzeJobText(jobText);
    } catch (error) {
      console.error('Error analyzing job text:', error);
      return res.status(500).json({ error: 'Failed to analyze job', details: error.message });
    }
    
    // 3. Generate improved text using feedback
    let improvedText;
    try {
      const prompt = `Improve this job posting based on these recommendations:\n\nOriginal: ${jobText}\n\nRecommendations: ${analysisResult.recommendations.join('\n')}`;
      improvedText = await callLLM(prompt);
    } catch (error) {
      console.error('Error improving job text:', error);
      improvedText = ''; // Continue even if improvement fails
    }
    
    // 4. Generate JSON-LD
    let jsonLd;
    try {
      jsonLd = await generateJsonLd(jobText, analysisResult);
    } catch (error) {
      console.error('Error generating JSON-LD:', error);
      return res.status(500).json({ error: 'Failed to generate JSON-LD', details: error.message });
    }
    
    // 5. Store in database
    let storedJob;
    try {
      storedJob = await saveJobPosting({
        originalText: jobText,
        visibilityScore: analysisResult.score,
        feedback: analysisResult.feedback,
        jsonLd: jsonLd,
        jobTitle: analysisResult.jobTitle || 'Job Posting',
        redflags: analysisResult.redFlags || [],
        recommendations: analysisResult.recommendations || [],
        categories: analysisResult.categories || {},
        improved_text: improvedText
      });
    } catch (error) {
      console.error('Error saving to database:', error);
      return res.status(500).json({ error: 'Failed to save job data', details: error.message });
    }
    
    // 6. Return complete data in single response
    res.json({
      id: storedJob.id,
      originalText: jobText,
      visibilityScore: analysisResult.score,
      breakdown: analysisResult.breakdown,
      feedback: analysisResult.feedback,
      jsonLd: jsonLd,
      improved_text: storedJob.improved_text,
      recommendations: analysisResult.recommendations || [],
      redflags: analysisResult.redFlags || [],
      originalreport: { text: jobText },
      createdAt: storedJob.savedat
    });
  } catch (error) {
    console.error('Error in analyze-job endpoint:', error);
    res.status(500).json({ 
      error: 'An unexpected error occurred', 
      details: error.message 
    });
  }
});

module.exports = router;