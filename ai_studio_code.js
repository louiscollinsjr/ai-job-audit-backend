// services/scoringServiceV2.js

const OpenAI = require('openai');
const { callLLM } = require('../utils/llmHelpers'); // Assuming llmHelpers is accessible

// Reuse the existing, stable scoring functions from the original service
const {
  scoreClarityReadability,
  scorePromptAlignment,
  scoreStructuredDataPresence,
  scoreRecencyFreshness,
  scoreKeywordTargeting,
  scorePageContextCleanliness
} = require('./scoringService'); // Or wherever they are defined

// --- All New Helper Functions Live Here ---

const PAY_TRANSPARENCY_JURISDICTIONS = {
  // States
  'CA': 'California', 'CO': 'Colorado', 'HI': 'Hawaii', 'IL': 'Illinois', 
  'MD': 'Maryland', 'NY': 'New York', 'WA': 'Washington',
  // Cities
  'Cincinnati': 'OH', 'Jersey City': 'NJ', 'New York City': 'NY'
};

let openai;
try {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI;
  openai = new OpenAI({ apiKey });
} catch (error) {
  console.error('Failed to initialize OpenAI client for V2 scorer:', error.message);
}

async function extractJobLocation(job_body) {
    // ... (copy the extractJobLocation function from the previous response here) ...
}

async function extractCompensationData(job_body, job_location_string) {
    // ... (copy the extractCompensationData function from the previous response here) ...
}

// --- New Core Compensation Scoring Function ---
async function scoreCompensationAndCompliance({ job_html, job_body, job_location }) {
    // ... (copy the scoreCompensationAndCompliance function from the previous response here) ...
}


// --- The Main Orchestrator for the V2 Pipeline ---

async function scoreJobEnhanced(jobData) {
  console.log('[ScoringV2] Starting enhanced job analysis pipeline.');

  // 1. Pre-computation Step: Extract location first, as it's a dependency.
  const job_location = await extractJobLocation(jobData.job_body);
  const enhancedJobData = { ...jobData, job_location };
  console.log(`[ScoringV2] Extracted job location: ${job_location}`);

  // 2. Parallel Scoring: Run all independent scorers simultaneously.
  const [
    clarity,
    promptAlignment,
    structuredData,
    recency,
    keywordTargeting,
    pageContext,
    compensation // This new one now runs in parallel too
  ] = await Promise.all([
    scoreClarityReadability(enhancedJobData),
    scorePromptAlignment(enhancedJobData),
    scoreStructuredDataPresence(enhancedJobData),
    scoreRecencyFreshness(enhancedJobData),
    scoreKeywordTargeting(enhancedJobData),
    scorePageContextCleanliness(enhancedJobData),
    scoreCompensationAndCompliance(enhancedJobData) // The new, async scorer
  ]);

  console.log('[ScoringV2] All scoring categories completed.');

  // 3. Aggregation Step: Apply new weights and assemble the final report.
  const newWeights = {
    clarity: 15,
    promptAlignment: 15,
    structuredData: 15,
    recency: 10,
    keywordTargeting: 15,
    compensation: 15,
    pageContext: 15
  };

  const categories = {
    clarity: { ...clarity, score: Math.round(clarity.score * (newWeights.clarity / clarity.maxScore)), maxScore: newWeights.clarity },
    promptAlignment: { ...promptAlignment, score: Math.round(promptAlignment.score * (newWeights.promptAlignment / promptAlignment.maxScore)), maxScore: newWeights.promptAlignment },
    structuredData: { ...structuredData, score: Math.round(structuredData.score * (newWeights.structuredData / structuredData.maxScore)), maxScore: newWeights.structuredData },
    recency: { ...recency, score: Math.round(recency.score * (newWeights.recency / recency.maxScore)), maxScore: newWeights.recency },
    keywordTargeting: { ...keywordTargeting, score: Math.round(keywordTargeting.score * (newWeights.keywordTargeting / keywordTargeting.maxScore)), maxScore: newWeights.keywordTargeting },
    compensation: { ...compensation, score: Math.round(compensation.score * (newWeights.compensation / compensation.maxScore)), maxScore: newWeights.compensation },
    pageContext: { ...pageContext, score: Math.round(pageContext.score * (newWeights.pageContext / pageContext.maxScore)), maxScore: newWeights.pageContext }
  };

  const total_score = Object.values(categories).reduce((sum, cat) => sum + cat.score, 0);
  const recommendations = Object.values(categories).flatMap(c => c.suggestions).filter(Boolean);
  const red_flags = Object.entries(categories)
      .filter(([_, v]) => v.score < v.maxScore * 0.5)
      .map(([k]) => k);
  const feedback = `This job posting scored ${total_score}/100 based on our enhanced analysis. Key areas for improvement: ${recommendations.slice(0, 3).join('; ')}.`;

  return {
    total_score,
    feedback,
    recommendations,
    red_flags,
    categories
  };
}

module.exports = { scoreJobEnhanced };