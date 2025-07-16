const OpenAI = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI,
});

/**
 * Call the OpenAI API with a prompt
 * @param {string} prompt - The prompt to send to the API
 * @param {number} temperature - Temperature parameter (0-1)
 * @returns {string} - The generated text response
 */
async function callLLM(prompt, temperature = 0.2) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-2025-04-14",
      messages: [
        { role: "system", content: "You are an expert in job posting analysis and improvement." },
        { role: "user", content: prompt }
      ],
      temperature: temperature,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

/**
 * Extract JSON from an LLM response
 * @param {string} response - The response from the LLM
 * @returns {Object} - Parsed JSON object
 */
function extractJsonFromResponse(response) {
  try {
    // Try to find JSON within the response using regex
    const jsonMatch = response.match(/```json([\s\S]*?)```|({[\s\S]*?})/);
    
    let jsonString = '';
    if (jsonMatch) {
      // If the response contains JSON code blocks or braces
      jsonString = jsonMatch[1] ? jsonMatch[1].trim() : jsonMatch[0];
    } else {
      // Otherwise, try to use the entire response
      jsonString = response;
    }
    
    // Parse the JSON
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error extracting JSON from response:', error);
    throw new Error(`Failed to extract JSON from response: ${error.message}`);
  }
}

module.exports = {
  callLLM,
  extractJsonFromResponse
};
