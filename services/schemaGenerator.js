const { callLLM, extractJsonFromResponse } = require('../utils/llmHelpers');

// Function to generate JSON-LD schema.org/JobPosting data
async function generateJsonLd(jobText, analysisResult) {
  try {
    if (!jobText) {
      throw new Error('Job text is required');
    }

    console.log('Generating JSON-LD for job with score:', analysisResult?.score || 'N/A');
    
    // Basic validation of analysis result
    if (!analysisResult || typeof analysisResult !== 'object') {
      analysisResult = { score: 0 };
    }

    // Prepare the prompt for the LLM
    const prompt = `Convert this job posting into valid schema.org/JobPosting JSON-LD format:

${jobText}

Include these analysis results:
Score: ${analysisResult.score || 0}
Feedback: ${analysisResult.feedback || ''}`;

    console.log('Calling LLM with prompt:', prompt.substring(0, 100) + '...');
    
    const response = await callLLM(prompt);
    
    // Extract JSON from the response
    let json_ld = extractJsonFromResponse(response);
    
    // Basic validation
    if (!json_ld || typeof json_ld !== 'object') {
      throw new Error('Invalid JSON-LD generated');
    }

    // Ensure required fields
    json_ld['@context'] = 'https://schema.org';
    json_ld['@type'] = 'JobPosting';
    
    // Add jobPostScore if we have analysis results
    if (analysisResult.score !== undefined) {
      json_ld.jobPostScore = {
        '@type': 'Rating',
        ratingValue: analysisResult.score,
        bestRating: 100,
        worstRating: 0,
        ratingExplanation: 'Job posting visibility and quality score'
      };
    }

    console.log('Successfully generated JSON-LD:', json_ld);
    return json_ld;
  } catch (error) {
    console.error('Error generating JSON-LD:', error);
    
    // Return a minimal valid JSON-LD if generation fails
    return {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      description: jobText.substring(0, 500),
      jobPostScore: {
        '@type': 'Rating',
        ratingValue: analysisResult?.score || 0,
        bestRating: 100,
        worstRating: 0
      }
    };
  }
}

module.exports = {
  generateJsonLd
};
