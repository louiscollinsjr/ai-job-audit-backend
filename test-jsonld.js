// Simple test script to verify the JSON-LD generation endpoint
require('dotenv').config();
const fetch = require('node-fetch');

// Sample job ID to test with - replace with an actual ID from your database
const testJobId = 'test-job-id'; // Replace this with a real job ID

async function testJsonLdEndpoint() {
  try {
    console.log(`Testing JSON-LD generation for job ID: ${testJobId}`);
    
    // Call the local endpoint
    const response = await fetch(`http://localhost:3000/api/generate-jsonld/${testJobId}`);
    
    if (!response.ok) {
      throw new Error(`API request failed with status: ${response.status} - ${response.statusText}`);
    }
    
    const json_ldData = await response.json();
    console.log('JSON-LD generation successful:');
    console.log(JSON.stringify(json_ldData, null, 2));
    
    return json_ldData;
  } catch (error) {
    console.error('Error testing JSON-LD endpoint:', error.message);
  }
}

// Run the test
testJsonLdEndpoint();
