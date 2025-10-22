const { callLLM, extractJsonFromResponse } = require('../utils/llmHelpers');
const cheerio = require('cheerio');

// Function to generate JSON-LD schema.org/JobPosting data
async function generateJsonLd(jobText, analysisData = {}, jobHtml = null) {
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
    
    // Extract structured data from HTML if available
    const existingSchema = jobHtml ? extractExistingSchema(jobHtml) : {};
    const extractedFields = extractStructuredFields(jobText, job_title);
    
    // Merge extracted fields with any existing schema data
    const baseFields = { ...extractedFields, ...existingSchema };
    
    // Use more of the job text for better extraction (6000 chars instead of 3000)
    const truncatedJobText = jobText.substring(0, 6000);
    
    // Create comprehensive prompt for the LLM
    const prompt = `
      Generate a complete and valid JSON-LD schema.org/JobPosting representation for the following job posting.
      Return ONLY the JSON-LD object without any explanation or markdown formatting.
      Ensure the JSON is valid with proper double quotes for keys and string values.
      
      REQUIRED FIELDS (extract from text if present):
      - title: Job title
      - description: Full job description (use the complete text provided)
      - hiringOrganization: {"@type": "Organization", "name": "Company Name"}
      - jobLocation: {"@type": "Place", "address": {"@type": "PostalAddress", "addressLocality": "City", "addressRegion": "State", "addressCountry": "Country"}}
      - datePosted: Date in YYYY-MM-DD format
      - employmentType: "FULL_TIME", "PART_TIME", "CONTRACTOR", "TEMPORARY", "INTERN", etc.
      
      RECOMMENDED FIELDS (include if found in text):
      - baseSalary: {"@type": "MonetaryAmount", "currency": "USD", "value": {"@type": "QuantitativeValue", "minValue": number, "maxValue": number, "unitText": "YEAR"}}
      - validThrough: Expiration date in YYYY-MM-DD format
      - jobLocationType: "TELECOMMUTE" for remote jobs
      - applicantLocationRequirements: {"@type": "Country", "name": "US"} for location restrictions
      - responsibilities: String describing key responsibilities
      - qualifications: String describing required qualifications
      - skills: String listing required skills
      - experienceRequirements: {"@type": "OccupationalExperienceRequirements", "monthsOfExperience": number}
      - educationRequirements: {"@type": "EducationalOccupationalCredential", "credentialCategory": "bachelor degree"}
      
      Job title: ${job_title}
      ${baseFields.hiringOrganization ? `Company: ${baseFields.hiringOrganization}` : ''}
      ${baseFields.jobLocation ? `Location: ${baseFields.jobLocation}` : ''}
      ${baseFields.employmentType ? `Employment Type: ${baseFields.employmentType}` : ''}
      ${baseFields.salary ? `Salary: ${baseFields.salary}` : ''}
      
      Job posting text:
      ${truncatedJobText}
      
      Include the following rating in the JSON-LD output:
      "jobPostScore": {
        "@type": "Rating",
        "ratingValue": ${score},
        "bestRating": 100,
        "worstRating": 0,
        "description": "AI Job Posting Quality Score"
      }
      
      Do not make up information not present in the text. If a field cannot be determined, omit it.
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
        jsonLd.description = truncatedJobText; // Use full truncated text
      }
      
      // Merge in any pre-extracted fields that LLM might have missed
      if (!jsonLd.hiringOrganization && baseFields.hiringOrganization) {
        jsonLd.hiringOrganization = {
          '@type': 'Organization',
          name: baseFields.hiringOrganization
        };
      }
      
      if (!jsonLd.jobLocation && baseFields.jobLocation) {
        jsonLd.jobLocation = baseFields.jobLocation;
      }
      
      if (!jsonLd.employmentType && baseFields.employmentType) {
        jsonLd.employmentType = baseFields.employmentType;
      }
      
      if (!jsonLd.baseSalary && baseFields.salary) {
        jsonLd.baseSalary = baseFields.salary;
      }
      
      if (!jsonLd.datePosted) {
        jsonLd.datePosted = new Date().toISOString().split('T')[0];
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

// Extract existing schema.org data from HTML
function extractExistingSchema(jobHtml) {
  try {
    const $ = cheerio.load(jobHtml);
    const scripts = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      const content = $(el).contents().text();
      try {
        const parsed = JSON.parse(content);
        scripts.push(parsed);
      } catch (error) {
        // Skip invalid JSON
      }
    });
    
    const jobPosting = scripts.find((item) => item['@type'] === 'JobPosting') || {};
    return jobPosting;
  } catch (error) {
    console.warn('[WARN] extractExistingSchema: Failed to parse HTML', error.message);
    return {};
  }
}

// Extract structured fields from job text using patterns
function extractStructuredFields(jobText, jobTitle) {
  const fields = {};
  
  // Extract company name
  const companyPatterns = [
    /(?:at|@)\s+([A-Z][A-Za-z0-9&\s]+?)(?:\s+[-|]|\n|$)/,
    /([A-Z][A-Za-z0-9&\s]+?)\s+is\s+(?:hiring|looking|seeking)/i,
    /Join\s+(?:the\s+)?([A-Z][A-Za-z0-9&\s]+?)\s+team/i
  ];
  
  for (const pattern of companyPatterns) {
    const match = jobText.match(pattern);
    if (match && match[1]) {
      fields.hiringOrganization = match[1].trim();
      break;
    }
  }
  
  // Extract location
  const locationPatterns = [
    /(?:Location|Based in|Office in)[:\s]+([A-Za-z\s,]+?)(?:\n|\||$)/i,
    /(Remote|Hybrid|On-site)/i,
    /([A-Z][a-z]+,\s*[A-Z]{2})/,  // City, ST format
    /([A-Z][a-z]+\s*,\s*[A-Z][a-z]+)/  // City, Country format
  ];
  
  for (const pattern of locationPatterns) {
    const match = jobText.match(pattern);
    if (match && match[1]) {
      const location = match[1].trim();
      if (location.toLowerCase() === 'remote') {
        fields.jobLocationType = 'TELECOMMUTE';
      }
      fields.jobLocation = {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: location
        }
      };
      break;
    }
  }
  
  // Extract employment type
  const employmentPatterns = [
    { pattern: /full[\s-]?time/i, type: 'FULL_TIME' },
    { pattern: /part[\s-]?time/i, type: 'PART_TIME' },
    { pattern: /contract(?:or)?/i, type: 'CONTRACTOR' },
    { pattern: /temporary|temp/i, type: 'TEMPORARY' },
    { pattern: /intern(?:ship)?/i, type: 'INTERN' }
  ];
  
  for (const { pattern, type } of employmentPatterns) {
    if (pattern.test(jobText)) {
      fields.employmentType = type;
      break;
    }
  }
  
  // Extract salary
  const salaryPattern = /\$([0-9,]+)(?:k|,000)?\s*[-–to]+\s*\$?([0-9,]+)(?:k|,000)?(?:\s*\/\s*(year|hour|month))?/i;
  const salaryMatch = jobText.match(salaryPattern);
  
  if (salaryMatch) {
    let minValue = parseInt(salaryMatch[1].replace(/,/g, ''));
    let maxValue = parseInt(salaryMatch[2].replace(/,/g, ''));
    const period = salaryMatch[3] || 'year';
    
    // Handle 'k' notation
    if (salaryMatch[0].includes('k')) {
      minValue *= 1000;
      maxValue *= 1000;
    }
    
    fields.salary = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        minValue: minValue,
        maxValue: maxValue,
        unitText: period.toUpperCase()
      }
    };
  }
  
  return fields;
}

// Helper function to create a minimal valid JSON-LD
function createMinimalJsonLd(title = 'Job Posting', description = '') {
  console.log('[DEBUG] createMinimalJsonLd: Creating minimal fallback JSON-LD');
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: title,
    description: description ? description.substring(0, 6000) : 'No description provided',
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
