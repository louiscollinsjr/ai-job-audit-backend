/**
 * API Test Script
 * 
 * This script tests the backend API endpoints:
 * - /api/analyze-job
 * - /api/rewrite-job/:id
 * 
 * It verifies functionality, handles errors, and validates responses.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const API_BASE_URL = 'https://ai-audit-api.fly.dev';
const SUCCESS_COLOR = '\x1b[32m'; // Green
const ERROR_COLOR = '\x1b[31m';   // Red
const INFO_COLOR = '\x1b[36m';    // Cyan
const RESET_COLOR = '\x1b[0m';    // Reset

// Test data
const testJobText = `
Job Title: Senior Full Stack Developer

About Us:
We are a fast-growing tech company building cutting-edge software solutions for the healthcare industry.

Key Responsibilities:
- Lead development of new features
- Work with the team to solve complex problems
- Maintain existing codebase
- Participate in code reviews

Requirements:
- 5+ years of experience with JavaScript
- Strong background in React and Node.js
- Bachelor's degree in Computer Science or related field
- Experience with database design and optimization
- Good communication skills

Benefits:
- Competitive salary
- Health insurance
- Flexible work hours
- Unlimited vacation days
`;

/**
 * Print colored message to console
 */
function log(message, color = INFO_COLOR) {
  console.log(`${color}${message}${RESET_COLOR}`);
}

/**
 * Test the analyze-job endpoint with text input
 */
async function testAnalyzeJobText() {
  log('\n=== Testing /api/analyze-job endpoint with text input ===');
  
  try {
    log('Sending job text to API...', INFO_COLOR);
    
    const response = await axios.post(`${API_BASE_URL}/api/analyze-job`, {
      inputType: 'text',
      inputData: testJobText
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}: ${response.statusText}`);
    }
    
    const data = response.data;
    
    // Validate response structure
    validateAnalyzeResponse(data);
    
    log('Test PASSED ✅', SUCCESS_COLOR);
    return data; // Return for use in rewrite test
  } catch (error) {
    log(`Test FAILED ❌: ${error.message}`, ERROR_COLOR);
    throw error;
  }
}

/**
 * Test the rewrite-job endpoint
 */
async function testRewriteJob(jobId) {
  log('\n=== Testing /api/rewrite-job/:id endpoint ===');
  
  try {
    log(`Requesting rewrite for job ID: ${jobId}...`, INFO_COLOR);
    
    const response = await axios.post(`${API_BASE_URL}/api/rewrite-job/${jobId}`, {
      saveToDatabase: true
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}: ${response.statusText}`);
    }
    
    const data = response.data;
    
    // Validate response structure
    validateRewriteResponse(data);
    
    log('Test PASSED ✅', SUCCESS_COLOR);
    return data;
  } catch (error) {
    log(`Test FAILED ❌: ${error.message}`, ERROR_COLOR);
    throw error;
  }
}

/**
 * Validate analyze-job response structure
 */
function validateAnalyzeResponse(data) {
  const requiredFields = ['id', 'original_text', 'visibilityScore', 'feedback', 'json_ld'];
  
  for (const field of requiredFields) {
    if (!data[field]) {
      throw new Error(`Response missing required field: ${field}`);
    }
  }
  
  // Validate score is a number between 0-100
  if (typeof data.visibilityScore !== 'number' || 
      data.visibilityScore < 0 || 
      data.visibilityScore > 100) {
    throw new Error(`Invalid visibility score: ${data.visibilityScore}`);
  }
  
  // Validate JSON-LD structure
  if (typeof data.json_ld !== 'object' || 
      !data.json_ld['@context'] || 
      !data.json_ld['@type'] || 
      data.json_ld['@type'] !== 'JobPosting') {
    throw new Error('Invalid JSON-LD structure');
  }
  
  log('Response validation PASSED', SUCCESS_COLOR);
  log(`Job ID: ${data.id}`, INFO_COLOR);
  log(`Visibility Score: ${data.visibilityScore}`, INFO_COLOR);
  log(`JSON-LD type: ${data.json_ld['@type']}`, INFO_COLOR);
}

/**
 * Validate rewrite-job response structure
 */
function validateRewriteResponse(data) {
  const requiredFields = ['id', 'original_text', 'improvedText', 'visibilityScore'];
  
  for (const field of requiredFields) {
    if (!data[field]) {
      throw new Error(`Response missing required field: ${field}`);
    }
  }
  
  // Text should be different
  if (data.original_text === data.improvedText) {
    throw new Error('Improved text is identical to original text');
  }
  
  log('Response validation PASSED', SUCCESS_COLOR);
  log(`Job ID: ${data.id}`, INFO_COLOR);
  log(`Original text length: ${data.original_text.length} chars`, INFO_COLOR);
  log(`Improved text length: ${data.improvedText.length} chars`, INFO_COLOR);
}

/**
 * Run all tests
 */
async function runTests() {
  log('=== Starting API Tests ===\n');
  
  try {
    // Test analyze-job endpoint
    const analyzeResult = await testAnalyzeJobText();
    
    // Test rewrite-job endpoint with the ID from analyze-job
    if (analyzeResult && analyzeResult.id) {
      await testRewriteJob(analyzeResult.id);
    }
    
    log('\n=== All tests PASSED ✅ ===', SUCCESS_COLOR);
  } catch (error) {
    log('\n=== Tests FAILED ❌ ===', ERROR_COLOR);
    log(`Error: ${error.message}`, ERROR_COLOR);
    process.exit(1);
  }
}

// Run the tests
runTests();
