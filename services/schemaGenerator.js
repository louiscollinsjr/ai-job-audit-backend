const { callLLM, extractJsonFromResponse } = require('../utils/llmHelpers');

// Function to generate JSON-LD schema.org/JobPosting data
async function generateJsonLd(jobText, analysisData = {}) {
  try {
    console.log('[DEBUG] generateJsonLd: Starting JSON-LD generation');
    
    if (!jobText) {
      console.error('[ERROR] generateJsonLd: No job text provided for JSON-LD generation');
      return createMinimalJsonLd(analysisData?.job_title);
    }

    const {
      score = 0,
      feedback = '',
      job_title = 'Job Posting',
      categories = {},
      recommendations = [],
      red_flags = []
    } = analysisData || {};
    
    // Truncate job text to avoid token limit issues
    const truncatedJobText = jobText.substring(0, 3000); // Limit to 3000 characters
    
    // Create prompt for the LLM
    const prompt = `
      Generate a valid JSON-LD schema.org/JobPosting representation for the following job posting text.
      Return ONLY the JSON-LD object without any explanation or markdown formatting.
      Ensure the JSON is valid with proper double quotes for keys and string values.
      Include as many relevant JobPosting properties as possible from the text.
      Do not make up information not present in the text.

      Job title: ${job_title}
      Job posting text: ${truncatedJobText}
      
      Include the following rating in the JSON-LD output:
      "jobPostScore": {
        "@type": "Rating",
        "ratingValue": ${score},
        "bestRating": 100,
        "worstRating": 0,
        "description": "AI Job Posting Quality Score"
      }
    `;
    
    // Call the LLM helper
    console.log('[DEBUG] generateJsonLd: Calling LLM for generation');
    const response = await callLLM(prompt);
    
    if (!response) {
      console.error('[ERROR] generateJsonLd: Empty response from LLM');
      return createMinimalJsonLd(job_title, truncatedJobText);
    }
    
    console.log('[DEBUG] generateJsonLd: LLM response received, processing...');
    
    // Process the response to extract the JSON-LD object
    let jsonLdString = response;
    
    // Try to extract JSON from the response if it's not already pure JSON
    if (jsonLdString.includes('```json')) {
      jsonLdString = jsonLdString.split('```json')[1].split('```')[0].trim();
      console.log('[DEBUG] generateJsonLd: Extracted JSON from markdown code block');
    } else if (jsonLdString.includes('```')) {
      jsonLdString = jsonLdString.split('```')[1].split('```')[0].trim();
      console.log('[DEBUG] generateJsonLd: Extracted from generic code block');
    }
    
    try {
      // Parse the JSON string into an object
      const jsonLd = JSON.parse(jsonLdString);
      
      // Validate that it's a proper JobPosting schema
      if (!jsonLd['@context']) {
        console.warn('[WARN] generateJsonLd: Missing @context, adding it');
        jsonLd['@context'] = 'https://schema.org';
      }
      
      if (!jsonLd['@type']) {
        console.warn('[WARN] generateJsonLd: Missing @type, adding it');
        jsonLd['@type'] = 'JobPosting';
      } else if (jsonLd['@type'] !== 'JobPosting') {
        console.warn(`[WARN] generateJsonLd: Incorrect @type (${jsonLd['@type']}), fixing it`);
        jsonLd['@type'] = 'JobPosting';
      }
      
      // Ensure we have at minimum a title and description
      if (!jsonLd.title && job_title) {
        jsonLd.title = job_title;
      }
      
      if (!jsonLd.description && truncatedJobText) {
        jsonLd.description = truncatedJobText.substring(0, 1000); // Limit description length
      }
      
      console.log('[DEBUG] generateJsonLd: JSON-LD generated successfully');
      return jsonLd;
    } catch (parseError) {
      console.error('[ERROR] generateJsonLd: Failed to parse JSON:', parseError);
      
      // Attempt to fix common JSON syntax issues
      try {
        // Replace single quotes with double quotes
        const fixedJsonString = jsonLdString
          .replace(/'/g, '"')
          .replace(/([\w]+):/g, '"$1":'); // Ensure property names have quotes
          
        const jsonLd = JSON.parse(fixedJsonString);
        console.log('[DEBUG] generateJsonLd: Successfully fixed and parsed JSON');
        return jsonLd;
      } catch (fixError) {
        console.error('[ERROR] generateJsonLd: Failed to fix JSON:', fixError);
        return createMinimalJsonLd(job_title, truncatedJobText);
      }
    }
  } catch (error) {
    console.error('[ERROR] generateJsonLd:', error);
    return createMinimalJsonLd(analysisData?.job_title, jobText);
  }
};

// Helper function to create a minimal valid JSON-LD
function createMinimalJsonLd(title = 'Job Posting', description = '') {
  console.log('[DEBUG] createMinimalJsonLd: Creating minimal fallback JSON-LD');
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: title,
    description: description ? description.substring(0, 1000) : 'No description provided',
    datePosted: new Date().toISOString().split('T')[0],
    jobPostScore: {
      '@type': 'Rating',
      'ratingValue': 0,
      'bestRating': 100,
      'worstRating': 0,
      'description': 'AI Job Posting Quality Score'
    }
  };
}

module.exports = {
  generateJsonLd
};
