const express = require('express');
const router = express.Router();

/**
 * POST /api/v1/analyze-text
 * Advanced job posting analysis endpoint
 */
router.post('/', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ 
        error: 'Text is required and must be a string' 
      });
    }

    const analysis = analyzeJobPostText(text);
    
    res.json(analysis);
  } catch (error) {
    console.error('Error analyzing text:', error);
    res.status(500).json({ 
      error: 'Failed to analyze text', 
      details: error.message 
    });
  }
});

/**
 * Enhanced server-side job post analysis
 * @param {string} text - The job posting text to analyze
 * @returns {Object} Comprehensive analysis results
 */
function analyzeJobPostText(text) {
  const readability = analyzeReadability(text);
  const inclusivity = analyzeInclusivity(text);
  const seo = analyzeSEO(text);
  const structure = analyzeStructure(text);
  const compliance = analyzeCompliance(text);

  // Weighted scoring
  const overallScore = Math.round(
    (readability.score * 0.25) + 
    (inclusivity.score * 0.30) + 
    (seo.score * 0.20) + 
    (structure.score * 0.15) +
    (compliance.score * 0.10)
  );

  return {
    overallScore,
    readability,
    inclusivity,
    seo,
    structure,
    compliance,
    metadata: {
      wordCount: text.trim().split(/\s+/).length,
      characterCount: text.length,
      paragraphCount: text.split(/\n\s*\n/).length,
      analysisDate: new Date().toISOString(),
      version: '1.0'
    }
  };
}

function analyzeReadability(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.trim().split(/\s+/);
  const syllables = countSyllables(text);
  
  const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);
  const avgSyllablesPerWord = syllables / Math.max(words.length, 1);
  
  // Flesch Reading Ease
  const fleschScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
  const gradeLevel = Math.max(1, Math.min(16, Math.round(0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59)));
  
  let score = 85;
  const feedback = [];
  
  if (avgWordsPerSentence > 25) {
    score -= 15;
    feedback.push('Break down sentences longer than 25 words for better readability');
  }
  
  if (gradeLevel > 12) {
    score -= 10;
    feedback.push('Consider simplifying language - current grade level is too high');
  }
  
  if (words.length < 150) {
    score -= 15;
    feedback.push('Job posting needs more detail - aim for 150+ words');
  }
  
  if (words.length > 800) {
    score -= 10;
    feedback.push('Job posting is quite long - consider condensing to 400-600 words');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    gradeLevel,
    fleschScore: Math.round(fleschScore),
    avgWordsPerSentence: Math.round(avgWordsPerSentence),
    feedback: feedback.length ? feedback : ['Good readability and clarity']
  };
}

function analyzeInclusivity(text) {
  const lowerText = text.toLowerCase();
  let score = 95;
  const issuesFound = [];
  const recommendations = [];

  // Comprehensive gendered language detection
  const genderedPatterns = [
    { pattern: /\b(he|him|his)\b/g, replacement: 'they/them/their', severity: 'high' },
    { pattern: /\b(she|her|hers)\b/g, replacement: 'they/them/their', severity: 'high' },
    { pattern: /\bmankind\b/g, replacement: 'humanity', severity: 'medium' },
    { pattern: /\bmanpower\b/g, replacement: 'workforce', severity: 'medium' },
    { pattern: /\bguys?\b/g, replacement: 'team members', severity: 'low' }
  ];

  genderedPatterns.forEach(({ pattern, replacement, severity }) => {
    const matches = text.match(pattern);
    if (matches) {
      const points = severity === 'high' ? 15 : severity === 'medium' ? 10 : 5;
      score -= Math.min(points, points * matches.length);
      
      issuesFound.push({
        type: 'gendered_language',
        term: matches[0],
        replacement,
        severity,
        count: matches.length
      });
      
      recommendations.push(`Replace "${matches[0]}" with "${replacement}" for inclusive language`);
    }
  });

  // Age-related bias
  const ageTerms = ['young', 'energetic', 'fresh graduate', 'recent grad'];
  ageTerms.forEach(term => {
    if (lowerText.includes(term)) {
      score -= 8;
      recommendations.push(`Avoid age-related terms like "${term}"`);
    }
  });

  // Exclusionary terms
  const exclusionaryTerms = [
    'ninja', 'rockstar', 'guru', 'wizard', 'superstar', 'legend'
  ];
  
  exclusionaryTerms.forEach(term => {
    if (lowerText.includes(term)) {
      score -= 5;
      recommendations.push(`Replace informal term "${term}" with professional descriptors`);
    }
  });

  return {
    score: Math.max(0, score),
    issuesFound,
    recommendations: recommendations.length ? recommendations : ['Excellent inclusive language usage']
  };
}

function analyzeSEO(text) {
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);
  let score = 70;
  const keywords = [];
  const missingKeywords = [];
  const feedback = [];

  // Industry keywords
  const industryKeywords = [
    'remote', 'hybrid', 'benefits', 'salary', 'compensation', 'experience', 
    'skills', 'team', 'growth', 'opportunity', 'company', 'culture',
    'flexible', 'work-life', 'professional', 'career', 'development'
  ];

  // Check keyword density
  industryKeywords.forEach(keyword => {
    if (words.includes(keyword) || words.includes(keyword + 's')) {
      keywords.push(keyword);
      score += 2;
    } else {
      missingKeywords.push(keyword);
    }
  });

  // Location mentions
  if (/(remote|hybrid|office|location|city|state|worldwide|global)/i.test(text)) {
    score += 10;
  } else {
    feedback.push('Specify work location or remote options for better discoverability');
  }

  // Benefits and compensation
  if (/(benefit|insurance|401k|pto|vacation|salary|compensation)/i.test(text)) {
    score += 8;
  } else {
    feedback.push('Mention compensation and benefits to attract qualified candidates');
  }

  // Job level indicators
  if (/(junior|senior|lead|principal|manager|director)/i.test(text)) {
    score += 5;
  } else {
    feedback.push('Include experience level indicators (junior, senior, etc.)');
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    keywords: keywords.slice(0, 10),
    missingKeywords: missingKeywords.slice(0, 8),
    feedback: feedback.length ? feedback : ['Good SEO optimization']
  };
}

function analyzeStructure(text) {
  let score = 80;
  const feedback = [];
  const foundSections = [];

  // Essential sections
  const sections = {
    'Job Overview': /(job description|about the role|role overview|position summary)/i,
    'Requirements': /(requirements|qualifications|you should have|must have|preferred)/i,
    'Responsibilities': /(responsibilities|you will|duties|what you'll do|key tasks)/i,
    'Benefits': /(benefits|perks|what we offer|compensation|salary)/i,
    'Company Info': /(about us|company|our team|who we are|our mission)/i,
    'Application Process': /(apply|application|how to apply|next steps)/i
  };

  Object.entries(sections).forEach(([section, regex]) => {
    if (regex.test(text)) {
      foundSections.push(section);
      score += 3;
    } else {
      feedback.push(`Consider adding a ${section} section`);
    }
  });

  // Structure indicators
  if (/[•\-\*]|\d+\./.test(text)) {
    score += 10;
  } else {
    score -= 15;
    feedback.push('Use bullet points or numbered lists to improve structure');
  }

  // Paragraph structure
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  if (paragraphs.length < 3) {
    score -= 10;
    feedback.push('Break content into more paragraphs for better readability');
  }

  return {
    score: Math.max(0, score),
    foundSections,
    feedback: feedback.length ? feedback : ['Well-structured job posting']
  };
}

function analyzeCompliance(text) {
  let score = 90;
  const issues = [];
  const recommendations = [];

  // Discriminatory language patterns
  const discriminatoryPatterns = [
    { pattern: /\b(young|old|age)\b/gi, issue: 'Age discrimination' },
    { pattern: /\b(native speaker|fluent english)\b/gi, issue: 'Language discrimination' },
    { pattern: /\b(cultural fit|good fit)\b/gi, issue: 'Potentially exclusionary' }
  ];

  discriminatoryPatterns.forEach(({ pattern, issue }) => {
    const matches = text.match(pattern);
    if (matches) {
      score -= 10;
      issues.push(issue);
      recommendations.push(`Avoid potentially discriminatory language: "${matches[0]}"`);
    }
  });

  // Salary transparency
  if (!/\$([\d,]+)|\bsalary\b|\bcompensation\b|\bpay\b/i.test(text)) {
    score -= 5;
    recommendations.push('Consider including salary range for transparency');
  }

  return {
    score: Math.max(0, score),
    issues,
    recommendations: recommendations.length ? recommendations : ['Good compliance with hiring best practices']
  };
}

function countSyllables(text) {
  const words = text.toLowerCase().split(/\s+/);
  let totalSyllables = 0;

  words.forEach(word => {
    word = word.replace(/[^a-z]/g, '');
    if (word.length === 0) return;

    const vowelGroups = word.match(/[aeiouy]+/g);
    let syllables = vowelGroups ? vowelGroups.length : 1;

    if (word.endsWith('e')) syllables--;
    if (word.endsWith('le') && word.length > 2) syllables++;
    
    syllables = Math.max(1, syllables);
    totalSyllables += syllables;
  });

  return totalSyllables;
}

module.exports = router;
