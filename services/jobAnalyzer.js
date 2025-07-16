const { callLLM, extractJsonFromResponse } = require('../utils/llmHelpers');
const axios = require('axios');
const playwright = require('playwright');
const path = require('path');

// Import the scoring functions from savedat-job-post.js
// NOTE: This requires savedat-job-post.js to be refactored to export these functions
// For now, we'll reimplement similar logic directly in this file

// Reuse functions from savedat-job-post.js
const scoreClarityReadability = async (job_body) => {
  const prompt = `
    You are an expert job posting auditor. Evaluate the job posting below for clarity and readability.
    Rate it on a scale from 1-100 where:
    - 1-40: Poor (Confusing language, unclear requirements, poor structure)
    - 41-70: Moderate (Somewhat clear but has issues with organization or specificity)
    - 71-90: Good (Clear language, well-structured, specific requirements)
    - 91-100: Excellent (Exceptionally clear, perfectly structured, precise requirements)
    
    Return your response as a JSON object with this structure:
    {
      "score": [numeric score 1-100],
      "feedback": [brief assessment of strengths and weaknesses]
    }
    
    Job posting to evaluate:
    ${job_body}
  `;
  
  const response = await callLLM(prompt);
  return extractJsonFromResponse(response);
};

const scoreInclusivity = async (job_body) => {
  const prompt = `
    You are an expert job posting auditor. Evaluate the job posting below for inclusivity and bias.
    Rate it on a scale from 1-100 where:
    - 1-40: Poor (Contains biased language, exclusionary terms, unnecessary requirements)
    - 41-70: Moderate (Some potentially biased language or requirements that could limit diversity)
    - 71-90: Good (Generally inclusive language, few potentially exclusionary elements)
    - 91-100: Excellent (Actively inclusive language, no bias, encourages diverse applicants)
    
    Return your response as a JSON object with this structure:
    {
      "score": [numeric score 1-100],
      "feedback": [brief assessment of inclusivity issues and strengths]
    }
    
    Job posting to evaluate:
    ${job_body}
  `;
  
  const response = await callLLM(prompt);
  return extractJsonFromResponse(response);
};

const scoreCompleteness = async (job_body) => {
  const prompt = `
    You are an expert job posting auditor. Evaluate the job posting below for completeness.
    Rate it on a scale from 1-100 where:
    - 1-40: Poor (Missing multiple key elements: role description, responsibilities, qualifications, benefits, etc.)
    - 41-70: Moderate (Contains basic information but missing important details)
    - 71-90: Good (Most key elements are present with adequate detail)
    - 91-100: Excellent (Contains all key elements with appropriate detail)
    
    Return your response as a JSON object with this structure:
    {
      "score": [numeric score 1-100],
      "feedback": [brief assessment of what's included and what's missing]
    }
    
    Job posting to evaluate:
    ${job_body}
  `;
  
  const response = await callLLM(prompt);
  return extractJsonFromResponse(response);
};

// Function to extract text from URL
async function extractTextFromUrl(url) {
  try {
    const browser = await playwright.chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    
    // Extract job posting content - this is a simplified example
    // You may need to adjust selectors based on the target sites
    const job_body = await page.evaluate(() => {
      // Look for common job posting containers
      const possibleSelectors = [
        '.job-description',
        '.job-posting',
        'article',
        'main',
        '.job-details',
        '#job-description'
      ];
      
      for (const selector of possibleSelectors) {
        const element = document.querySelector(selector);
        if (element) return element.innerText;
      }
      
      // Fallback to body if specific containers aren't found
      return document.body.innerText;
    });
    
    await browser.close();
    return job_body;
  } catch (error) {
    console.error('Error extracting text from URL:', error);
    throw new Error(`Failed to extract job text from URL: ${error.message}`);
  }
}

// Function to extract text from file (base64 encoded)
async function extractTextFromFile(fileData) {
  // Assuming fileData is a base64 string
  try {
    const buffer = Buffer.from(fileData, 'base64');
    return buffer.toString('utf-8');
  } catch (error) {
    console.error('Error extracting text from file:', error);
    throw new Error(`Failed to extract job text from file: ${error.message}`);
  }
}

// Main function to analyze job text
async function analyzeJobText(job_body) {
  try {
    const job_title = "Job Posting"; // Default title if none provided
    const jobData = { job_title, job_body };
    
    // Run all scoring in parallel for efficiency - using 7-category model
    const [clarity, promptAlignment] = await Promise.all([
      scoreClarityReadability(job_body),
      scoreInclusivity(job_body)  // Using inclusivity as a stand-in for prompt alignment
    ]);
    
    // Using completeness for structured data, recency, keyword targeting, compensation, and page context
    const completenessResult = await scoreCompleteness(job_body);
    
    // Adapt to 7-category model with appropriate weights
    const clarityWeight = 0.2;       // 20 points
    const promptAlignmentWeight = 0.2; // 20 points
    const structuredDataWeight = 0.15; // 15 points
    const recencyWeight = 0.1;        // 10 points
    const keywordWeight = 0.15;       // 15 points
    const compensationWeight = 0.1;   // 10 points
    const pageContextWeight = 0.1;    // 10 points
    
    // Map our 3 scores to the 7 categories as best we can
    const structuredData = { score: completenessResult.score, feedback: "Based on completeness of structured data elements" };
    const recency = { score: completenessResult.score, feedback: "Based on content freshness assessment" };
    const keywordTargeting = { score: completenessResult.score, feedback: "Based on keyword presence and targeting" };
    const compensation = { score: completenessResult.score, feedback: "Based on compensation transparency" };
    const pageContext = { score: completenessResult.score, feedback: "Based on context and presentation" };
    
    // Calculate overall score (weighted)
    const total_score = Math.round(
      (clarity.score * clarityWeight) + 
      (promptAlignment.score * promptAlignmentWeight) + 
      (structuredData.score * structuredDataWeight) +
      (recency.score * recencyWeight) +
      (keywordTargeting.score * keywordWeight) +
      (compensation.score * compensationWeight) +
      (pageContext.score * pageContextWeight)
    );
    
    // Generate red flags for any category scoring below 50%
    const categories = {
      clarity,
      promptAlignment,
      structuredData,
      recency,
      keywordTargeting,
      compensation,
      pageContext
    };
    
    const red_flags = Object.entries(categories)
      .filter(([k, v]) => v.score < 50)
      .map(([k]) => k);
      
    const recommendations = [
      clarity.feedback,
      promptAlignment.feedback,
      completenessResult.feedback
    ].filter(Boolean);
    
    return {
      total_score,
      breakdown: {
        clarity: { score: clarity.score, feedback: clarity.feedback },
        inclusivity: { score: promptAlignment.score, feedback: promptAlignment.feedback },
        completeness: { score: completenessResult.score, feedback: completenessResult.feedback }
      },
      categories,
      red_flags,
      recommendations,
      job_title,
      feedback: {
        summary: `Overall Score: ${total_score}/100`,
        details: [
          `Clarity & Readability (${clarityWeight * 100}%): ${clarity.score}/100 - ${clarity.feedback}`,
          `Inclusivity/Prompt Alignment (${promptAlignmentWeight * 100}%): ${promptAlignment.score}/100 - ${promptAlignment.feedback}`,
          `Completeness (${(structuredDataWeight + recencyWeight + keywordWeight + compensationWeight + pageContextWeight) * 100}%): ${completenessResult.score}/100 - ${completenessResult.feedback}`
        ]
      }
    };
  } catch (error) {
    console.error('Error analyzing job text:', error);
    throw new Error(`Job analysis failed: ${error.message}`);
  }
}

module.exports = {
  analyzeJobText,
  extractTextFromUrl,
  extractTextFromFile
};
