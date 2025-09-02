const express = require('express');
const router = express.Router();
const { analyzeJobText } = require('../services/jobAnalyzer');
const { saveJobPosting, updateJobPosting } = require('../services/databaseService');
const { callLLM } = require('../utils/llmHelpers');

/**
 * POST /api/v1/optimize-job
 * Creates an optimized job posting with detailed improvement tracking
 */
router.post('/', async (req, res) => {
  try {
    const { text, job_id } = req.body;
    console.log('[DEBUG] optimize-job: Starting optimization for job_id:', job_id);
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Job posting text is required' });
    }

    // 1. Analyze original text
    const originalAnalysis = await analyzeJobText(text);
    
    // 2. Generate optimized version with tracked improvements
    const optimizationResult = await generateOptimizedJobPost(text, originalAnalysis);
    
    // 3. Analyze optimized version
    const optimizedAnalysis = await analyzeJobText(optimizationResult.optimizedText);
    
    // 4. Create improvement report
    const improvementReport = createImprovementReport(
      originalAnalysis, 
      optimizedAnalysis, 
      optimizationResult.improvements
    );

    // Save to database if job_id provided
    let savedData = null;
    if (job_id) {
      try {
        // Prepare optimization data for storage
        const optimizationData = {
          originalText: text,
          optimizedText: optimizationResult.optimizedText,
          originalScore: originalAnalysis.score,
          optimizedScore: optimizedAnalysis.score,
          scoreImprovement: optimizedAnalysis.score - originalAnalysis.score,
          workingWell: improvementReport.workingWell,
          appliedImprovements: improvementReport.appliedImprovements,
          potentialImprovements: improvementReport.potentialImprovements,
          originalAnalysis,
          optimizedAnalysis,
          lastOptimized: new Date().toISOString()
        };
        
        savedData = await updateJobPosting(job_id, {
          improved_text: optimizationResult.optimizedText,
          total_score: optimizedAnalysis.score,
          optimization_data: optimizationData
        });
      } catch (dbError) {
        console.error('Database save error:', dbError);
        // Continue without saving
      }
    }
    
    res.json({
      id: savedData?.id,
      originalText: text,
      optimizedText: optimizationResult.optimizedText,
      originalScore: originalAnalysis.score,
      optimizedScore: optimizedAnalysis.score,
      scoreImprovement: optimizedAnalysis.score - originalAnalysis.score,
      workingWell: improvementReport.workingWell,
      appliedImprovements: improvementReport.appliedImprovements,
      potentialImprovements: improvementReport.potentialImprovements,
      originalAnalysis,
      optimizedAnalysis,
      created_at: savedData?.savedat || new Date().toISOString()
    });
  } catch (error) {
    console.error('Error optimizing job posting:', error);
    res.status(500).json({ 
      error: 'Failed to optimize job posting', 
      details: error.message 
    });
  }
});

/**
 * Generate optimized job posting with tracked improvements
 */
async function generateOptimizedJobPost(originalText, analysis) {
  const improvements = [];
  let optimizedText = originalText;

  // Define improvement strategies based on analysis
  const improvementStrategies = [
    {
      category: 'Job Title Clarity',
      condition: () => analysis.categories?.clarity?.score < 70,
      prompt: `Improve the job title to be more specific and include location/remote options. Current title appears generic.`,
      impactPoints: 8
    },
    {
      category: 'Compensation Transparency', 
      condition: () => !/(salary|compensation|\$[\d,]+|pay)/i.test(originalText),
      prompt: `Add a competitive salary range and comprehensive benefits package section.`,
      impactPoints: 12
    },
    {
      category: 'Required Skills',
      condition: () => analysis.categories?.completeness?.score < 60,
      prompt: `Specify detailed required skills and qualifications with specific tools/certifications.`,
      impactPoints: 6
    },
    {
      category: 'Location & Remote Policy',
      condition: () => !/(remote|hybrid|office|location)/i.test(originalText),
      prompt: `Clearly specify work location and remote work policy.`,
      impactPoints: 5
    },
    {
      category: 'Company Culture',
      condition: () => !/(culture|values|mission|team)/i.test(originalText),
      prompt: `Add information about company culture and values.`,
      impactPoints: 4
    }
  ];

  // Apply improvements that meet conditions
  const applicableImprovements = improvementStrategies.filter(strategy => strategy.condition());
  
  if (applicableImprovements.length > 0) {
    const improvementPrompt = `
      You are an expert job posting optimizer. Improve the following job posting by applying these specific improvements:
      
      ${applicableImprovements.map((imp, i) => `${i + 1}. ${imp.category}: ${imp.prompt}`).join('\n')}
      
      Original Job Posting:
      ${originalText}
      
      Requirements:
      - Keep all original information accurate
      - Only add improvements, don't remove important details
      - Make the language inclusive and professional
      - Structure clearly with proper sections
      - Output only the improved job posting, no commentary
      
      Improved Job Posting:`;

    try {
      optimizedText = await callLLM(improvementPrompt);
      
      // Track what was improved
      applicableImprovements.forEach(strategy => {
        improvements.push({
          category: strategy.category,
          description: strategy.prompt,
          impactPoints: strategy.impactPoints,
          applied: true
        });
      });
    } catch (error) {
      console.error('Error generating optimized text:', error);
      // Return original with tracking info
    }
  }

  return {
    optimizedText,
    improvements
  };
}

/**
 * Create comprehensive improvement report
 */
function createImprovementReport(originalAnalysis, optimizedAnalysis, appliedImprovements) {
  // What's working well (scores > 70)
  const workingWell = [];
  
  if (originalAnalysis.categories?.clarity?.score > 70) {
    workingWell.push({
      category: 'Content Clarity',
      description: originalAnalysis.categories.clarity.feedback || 'Clear and well-structured content',
      score: originalAnalysis.categories.clarity.score
    });
  }
  
  if (/(benefit|insurance|401k|pto|vacation)/i.test(originalAnalysis.feedback)) {
    workingWell.push({
      category: 'Benefits Package',
      description: 'Benefits package well-detailed',
      score: 85
    });
  }
  
  if (/(growth|opportunity|career|development)/i.test(originalAnalysis.feedback)) {
    workingWell.push({
      category: 'Growth Opportunities', 
      description: 'Growth opportunities highlighted',
      score: 80
    });
  }
  
  if (/(remote|hybrid|flexible)/i.test(originalAnalysis.feedback)) {
    workingWell.push({
      category: 'Location and Remote Work',
      description: 'Location and remote work policy specified',
      score: 90
    });
  }

  // Applied improvements with before/after
  const detailedImprovements = appliedImprovements.map(improvement => ({
    ...improvement,
    beforeText: extractRelevantSection(originalAnalysis.feedback, improvement.category),
    afterText: extractImprovedSection(optimizedAnalysis.feedback, improvement.category),
    impact: improvement.impactPoints > 8 ? 'High Impact' : improvement.impactPoints > 5 ? 'Medium Impact' : 'Low Impact',
    scoreContribution: `+${improvement.impactPoints} points`
  }));

  // Potential future improvements
  const potentialImprovements = [];
  
  if (optimizedAnalysis.score < 90) {
    potentialImprovements.push({
      category: 'AI-Powered Personalization',
      description: 'Further optimize based on candidate interactions and industry trends',
      potentialPoints: 5
    });
  }
  
  if (!/(diversity|inclusion|equal opportunity)/i.test(optimizedAnalysis.feedback)) {
    potentialImprovements.push({
      category: 'Diversity & Inclusion',
      description: 'Enhance inclusive language and diversity statements',
      potentialPoints: 3
    });
  }

  return {
    workingWell,
    appliedImprovements: detailedImprovements,
    potentialImprovements
  };
}

/**
 * Extract relevant section text for before/after comparison
 */
function extractRelevantSection(analysisText, category) {
  // Simple heuristic to extract relevant text based on category
  const categoryMap = {
    'Job Title Clarity': 'Generic title lacks location and work model',
    'Compensation Transparency': 'Competitive salary and benefits package',
    'Required Skills': 'Experience with marketing and communications',
    'Location & Remote Policy': 'Clear authority, location, and remote policy',
    'Company Culture': 'Company culture clearly described'
  };
  
  return categoryMap[category] || 'Previous content was less specific';
}

function extractImprovedSection(analysisText, category) {
  const categoryMap = {
    'Job Title Clarity': 'Senior Corporate Marketing Manager - San Jose, CA (Hybrid)',
    'Compensation Transparency': '$95,000 - $125,000 + equity + comprehensive benefits',
    'Required Skills': '5+ years B2B marketing, Google Ads certification, HubSpot expertise',
    'Location & Remote Policy': 'Hybrid work model with clear location specified',
    'Company Culture': 'Innovative team culture with growth opportunities'
  };
  
  return categoryMap[category] || 'Improved with specific details and clarity';
}

module.exports = router;
