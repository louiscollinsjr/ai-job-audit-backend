const { callLLM, extractJsonFromResponse } = require('../utils/llmHelpers');

// Function to generate JSON-LD schema.org/JobPosting data
async function generateJsonLd(jobText, analysisResult) {
  try {
    const prompt = `
      You are an expert in SEO and structured data. Convert the job posting below into a valid JSON-LD 
      object following the schema.org/JobPosting format. Extract as much information as possible from
      the job description, including:
      
      - Job title
      - Company name
      - Location
      - Employment type
      - Job description
      - Required skills and qualifications
      - Benefits and perks
      - Salary range (if mentioned)
      - Application instructions
      - Any other relevant fields from schema.org/JobPosting
      
      Only include fields that can be confidently extracted from the text. Don't guess or make up information.
      
      Return a properly formatted JSON-LD object with appropriate @context and @type fields.
      
      Job posting to convert:
      ${jobText}
    `;
    
    const response = await callLLM(prompt);
    const jsonLd = extractJsonFromResponse(response);
    
    // Ensure we have the basic required structure
    if (!jsonLd || !jsonLd['@context'] || !jsonLd['@type']) {
      throw new Error('Generated JSON-LD is invalid or incomplete');
    }
    
    return jsonLd;
  } catch (error) {
    console.error('Error generating JSON-LD:', error);
    throw new Error(`JSON-LD generation failed: ${error.message}`);
  }
}

module.exports = {
  generateJsonLd
};
