// Test script for the schemaGenerator.js functionality
require('dotenv').config();
const { generateJsonLd } = require('./services/schemaGenerator');

// Sample job text for testing
const sampleJobText = `
Software Engineer - Full Stack
XYZ Tech Company - San Francisco, CA (Remote option available)

About the Role:
We're looking for a talented Full Stack Software Engineer to join our growing team. You'll be working on our core product, building new features and improving existing ones.

Responsibilities:
- Design, develop, and maintain web applications using React, Node.js, and PostgreSQL
- Collaborate with product managers and designers to implement new features
- Write clean, maintainable, and efficient code
- Participate in code reviews and mentor junior developers
- Troubleshoot and debug issues in production

Requirements:
- 3+ years of experience in full-stack development
- Strong proficiency in JavaScript/TypeScript, React, and Node.js
- Experience with SQL databases, preferably PostgreSQL
- Knowledge of modern web development practices and patterns
- Bachelor's degree in Computer Science or equivalent experience

Benefits:
- Competitive salary: $120,000 - $160,000 based on experience
- Health, dental, and vision insurance
- 401(k) matching
- Flexible work hours and remote work options
- Professional development budget

To apply, please send your resume to careers@xyztechcompany.com
`;

// Sample analysis result
const sampleAnalysisResult = {
  score: 85,
  feedback: ["Good job description with clear responsibilities", "Salary range is provided which is excellent"],
  recommendations: ["Add more specific information about the tech stack", "Include information about the interview process"],
  red_flags: ["No mention of company culture"],
  categories: {
    clarity: 18,
    compensation: 9,
    keywordTargeting: 12
  }
};

async function testSchemaGenerator() {
  try {
    console.log('Testing JSON-LD generation with sample job data...');
    
    const json_ld = await generateJsonLd(sampleJobText, sampleAnalysisResult);
    
    console.log('JSON-LD generation successful:');
    console.log(JSON.stringify(json_ld, null, 2));
    
    // Verify the structure
    if (json_ld && json_ld['@context'] === 'https://schema.org' && json_ld['@type'] === 'JobPosting') {
      console.log('\n✅ Test passed: JSON-LD has correct basic structure');
    } else {
      console.log('\n❌ Test failed: JSON-LD is missing required fields');
    }
    
    // Check if our JobPostScore was added
    if (json_ld.jobPostScore && json_ld.jobPostScore['@type'] === 'Rating') {
      console.log('✅ Test passed: JobPostScore rating was added');
    } else {
      console.log('❌ Test failed: JobPostScore rating is missing');
    }
    
    return json_ld;
  } catch (error) {
    console.error('Error testing schema generator:', error.message);
  }
}

// Run the test
testSchemaGenerator();
