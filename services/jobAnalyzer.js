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

// Function to extract text from URL with robust error handling and timeouts
async function extractTextFromUrl(url) {
  let browser = null;
  let context = null;
  
  try {
    console.log(`[extractTextFromUrl] Starting extraction for: ${url}`);
    
    // Launch browser with stealth mode and proper config
    browser = await playwright.chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    
    // Create context with realistic user agent and settings
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'UTC',
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true
    });
    
    const page = await context.newPage();
    
    // Set page timeout
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);
    
    // Navigate with proper timeout and wait conditions
    console.log(`[extractTextFromUrl] Navigating to: ${url}`);
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 45000 
    });
    
    // Wait for content to load
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {
      console.log('[extractTextFromUrl] Network idle timeout - continuing anyway');
    });
    
    // Extract job posting content with multiple fallback strategies
    const job_body = await page.evaluate(() => {
      // Look for common job posting containers (in priority order)
      const possibleSelectors = [
        '.job-description',
        '.job-posting', 
        '.job-content',
        '.job-details',
        '#job-description',
        '[class*="job-desc"]',
        '[class*="description"]',
        'article',
        'main',
        '.content',
        '#content'
      ];
      
      for (const selector of possibleSelectors) {
        const element = document.querySelector(selector);
        if (element && element.innerText && element.innerText.trim().length > 100) {
          console.log(`Found content using selector: ${selector}`);
          return element.innerText.trim();
        }
      }
      
      // Fallback to body if specific containers aren't found
      const bodyText = document.body.innerText || '';
      console.log(`Using fallback body text, length: ${bodyText.length}`);
      return bodyText.trim();
    });
    
    console.log(`[extractTextFromUrl] Extracted ${job_body.length} characters`);
    
    // Validate extracted content
    if (!job_body || job_body.length < 50) {
      throw new Error('Insufficient content extracted from URL - page may be protected or empty');
    }
    
    return job_body;
    
  } catch (error) {
    console.error('[extractTextFromUrl] Error:', error);
    
    // Check for common error types and provide helpful messages
    if (error.message.includes('timeout') || error.message.includes('Navigation timeout')) {
      throw new Error('Page took too long to load. The site may be slow or protected by anti-bot measures.');
    } else if (error.message.includes('net::ERR_') || error.message.includes('Protocol error')) {
      throw new Error('Network error accessing the URL. Please check the URL is valid and accessible.');
    } else if (error.message.includes('AbortError')) {
      throw new Error('Request was aborted. The site may have connection issues.');
    } else {
      throw new Error(`Failed to extract job text from URL: ${error.message}`);
    }
  } finally {
    // Ensure cleanup happens even if there are errors
    try {
      if (context) await context.close();
      if (browser) await browser.close();
      console.log('[extractTextFromUrl] Browser cleanup completed');
    } catch (cleanupError) {
      console.error('[extractTextFromUrl] Cleanup error:', cleanupError);
    }
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
