const { callLLM } = require('../utils/llmHelpers');
const {
  scoreClarityReadability,
  scorePromptAlignment,
  scoreStructuredDataPresence,
  scoreRecencyFreshness,
  scoreKeywordTargeting,
  scorePageContextCleanliness
} = require('./scoringService');

const US_STATE_ABBR = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
]);

const CURRENCY_SYMBOLS = {
  '$': 'USD',
  'US$': 'USD',
  'USD': 'USD',
  '£': 'GBP',
  'GBP': 'GBP',
  '€': 'EUR',
  'EUR': 'EUR',
  'CAD': 'CAD',
  'C$': 'CAD',
  'AUD': 'AUD',
  'A$': 'AUD'
};

const PERIOD_KEYWORDS = [
  { regex: /(per\s*(year|yr|annum)|annual(?:ly)?|yearly)/i, value: 'year' },
  { regex: /(per\s*(month|mo)|monthly)/i, value: 'month' },
  { regex: /(per\s*(week|wk)|weekly)/i, value: 'week' },
  { regex: /(per\s*(day)|daily)/i, value: 'day' },
  { regex: /(per\s*(hour|hr)|hourly)/i, value: 'hour' }
];

const VAGUE_COMP_TERMS = /(competitive|commensurate|market rate|depends on experience|DOE|negotiable)/i;

const LOCATION_KEYWORDS = /(location|work location|job location|based in|onsite|on-site|remote|hybrid|headquarters|office)/i;

function normalizeWhitespace(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function extractCityState(line) {
  const match = line.match(/([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s*,?\s*(USA|United States))?/);
  if (!match) return null;
  const city = normalizeWhitespace(match[1]);
  const state = match[2].toUpperCase();
  if (!US_STATE_ABBR.has(state)) return null;
  return { city, state, country: 'United States' };
}

function detectCurrency(text) {
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  return null;
}

function parseAmount(value, hasKSuffix = false) {
  if (!value) return null;
  const numeric = value.replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  let parsed = parseFloat(numeric.replace(/,/g, ''));
  
  // Handle 'k' notation (e.g., "100k" = 100000)
  if (hasKSuffix && parsed < 1000) {
    parsed = parsed * 1000;
  }
  
  return Number.isFinite(parsed) ? parsed : null;
}

function detectPeriod(text) {
  if (!text) return null;
  for (const entry of PERIOD_KEYWORDS) {
    if (entry.regex.test(text)) {
      return entry.value;
    }
  }
  return null;
}

const PAY_TRANSPARENCY_JURISDICTIONS = {
  // States
  CA: 'California',
  CO: 'Colorado',
  HI: 'Hawaii',
  IL: 'Illinois',
  MD: 'Maryland',
  NY: 'New York',
  WA: 'Washington',
  // Cities
  Cincinnati: 'OH',
  'Jersey City': 'NJ',
  'New York City': 'NY'
};

function computeJurisdictions(location) {
  if (!location) return [];
  const matches = new Set();
  if (location.state && PAY_TRANSPARENCY_JURISDICTIONS[location.state]) {
    matches.add(location.state);
  }
  if (location.city) {
    const key = Object.keys(PAY_TRANSPARENCY_JURISDICTIONS).find(k => k.toLowerCase() === location.city.toLowerCase());
    if (key) matches.add(key);
  }
  if (location.jurisdictionMatches) {
    for (const item of location.jurisdictionMatches) matches.add(item);
  }
  return [...matches];
}

async function llmExtractLocation(job_body) {
  try {
    const response = await callLLM(
      'Extract the primary job location from this posting. '
        + 'Return JSON: {"summary":string,"city":string|null,"state":string|null,"country":string|null,'
        + '"remote":boolean,"hybrid":boolean}. If unknown, summary="Unknown".',
      null,
      {
        model: 'gpt-4o-mini', // Use mini for simple extraction (10x faster, maintains accuracy)
        systemMessage: 'You are a data extraction assistant. Output a single JSON object.',
        response_format: { type: 'json_object' },
        user: 'services/scoringServiceV2/location',
        seed: 4321,
        messagesOverride: true,
        // Custom handler: we need to pass both system and user content, so use messagesOverride
        messages: [
          { role: 'system', content: 'You are a data extraction assistant. Output a single JSON object.' },
          {
            role: 'user',
            content: `Extract the primary job location from the following job posting.
Return JSON with keys: summary (string), city (string|null), state (string|null), country (string|null), remote (boolean), hybrid (boolean).
If any field is unknown, use null.
Job posting:
${job_body}`
          }
        ]
      }
    );
    return JSON.parse(response);
  } catch (error) {
    console.warn('[ScoringV2] LLM location extraction failed:', error.message);
    return null;
  }
}

async function extractJobLocation(job_body = '') {
  const lines = job_body.split(/\r?\n/).map(line => normalizeWhitespace(line)).filter(Boolean);
  let candidate = null;
  for (const line of lines) {
    if (LOCATION_KEYWORDS.test(line) || line.match(/\b(Remote|Hybrid|On[-\s]?site)\b/i)) {
      candidate = line;
      break;
    }
  }
  if (!candidate) {
    candidate = lines.find(line => extractCityState(line));
  }

  let location = {
    summary: candidate || null,
    raw: candidate || null,
    city: null,
    state: null,
    country: null,
    remote: false,
    hybrid: false,
    source: 'deterministic'
  };

  if (candidate) {
    const cityState = extractCityState(candidate);
    if (cityState) {
      location = { ...location, ...cityState };
    }
    if (/\bremote\b/i.test(candidate)) {
      location.remote = true;
    }
    if (/\bhybrid\b/i.test(candidate)) {
      location.hybrid = true;
    }
    if (/\b(on[-\s]?site|onsite)\b/i.test(candidate)) {
      location.onsite = true;
    }
    const stateMatch = candidate.match(/\b([A-Z]{2})\b/);
    if (!location.state && stateMatch && US_STATE_ABBR.has(stateMatch[1])) {
      location.state = stateMatch[1];
      location.country = location.country || 'United States';
    }
    if (!location.country && /United States|USA|U\.S\.|U\.S\.A\./i.test(candidate)) {
      location.country = 'United States';
    }
  }

  if (!location.summary) {
    const llmResult = await llmExtractLocation(job_body);
    if (llmResult && llmResult.summary) {
      location = {
        summary: llmResult.summary,
        raw: llmResult.summary,
        city: llmResult.city || null,
        state: llmResult.state ? llmResult.state.toUpperCase() : null,
        country: llmResult.country || null,
        remote: !!llmResult.remote,
        hybrid: !!llmResult.hybrid,
        source: 'llm'
      };
    }
  }

  location.jurisdictions = computeJurisdictions(location);
  return location;
}

function findCompensationLine(job_body) {
  const lines = job_body.split(/\r?\n/).map(l => normalizeWhitespace(l)).filter(Boolean);
  return lines.find(line => /compensation|salary|pay|base pay|base salary/i.test(line));
}

async function llmExtractCompensation(job_body) {
  try {
    const response = await callLLM(
      'Extract salary compensation data as JSON.',
      null,
      {
        model: 'gpt-4o-mini', // Use mini for extraction (10x faster, critical for compensation accuracy)
        systemMessage: 'You are a data extraction assistant. Output a single JSON object.',
        response_format: { type: 'json_object' },
        user: 'services/scoringServiceV2/compensation',
        seed: 8765,
        messagesOverride: true,
        messages: [
          { role: 'system', content: 'You are a data extraction assistant. Output a single JSON object.' },
          {
            role: 'user',
            content: `Extract compensation information from the following job posting.
Return JSON with keys: salaryText (string|null), currency (string|null),
minValue (number|null), maxValue (number|null), payFrequency (string|null),
isRange (boolean), includesEquity (boolean), includesBonus (boolean).
Use null if unknown. Be thorough - check entire posting for salary information.
Job posting:
${job_body}`
          }
        ]
      }
    );
    return JSON.parse(response);
  } catch (error) {
    console.warn('[ScoringV2] LLM compensation extraction failed:', error.message);
    return null;
  }
}

async function extractCompensationData(job_body = '', job_location_string = '') {
  const searchRegion = findCompensationLine(job_body) || job_body;
  
  // Enhanced regex patterns for better deterministic detection
  const rangeRegex = /(?<currency>\$|US\$|USD|£|GBP|€|EUR|C\$|CAD|A\$|AUD)?\s*(?<min>\d{2,3}[\d,]*(?:\.\d{1,2})?)\s*(?:k|K)?\s*(?:-|to|–|—|through)\s*(?<currency2>\$|US\$|USD|£|GBP|€|EUR|C\$|CAD|A\$|AUD)?\s*(?<max>\d{2,3}[\d,]*(?:\.\d{1,2})?)\s*(?:k|K)?/i;
  const singleRegex = /(?<currency>\$|US\$|USD|£|GBP|€|EUR|C\$|CAD|A\$|AUD)\s*(?<amount>\d{2,3}[\d,]*(?:\.\d{1,2})?)\s*(?:k|K)?/i;

  const rangeMatch = searchRegion.match(rangeRegex);
  const singleMatch = !rangeMatch ? searchRegion.match(singleRegex) : null;
  const period = detectPeriod(searchRegion);
  const currency = rangeMatch
    ? CURRENCY_SYMBOLS[rangeMatch.groups.currency || rangeMatch.groups.currency2] || detectCurrency(searchRegion)
    : singleMatch
      ? CURRENCY_SYMBOLS[singleMatch.groups.currency] || detectCurrency(searchRegion)
      : detectCurrency(searchRegion);

  // Check for 'k' suffix in the matched text
  const hasKSuffix = rangeMatch 
    ? /\d+\s*k/i.test(rangeMatch[0])
    : singleMatch 
    ? /\d+\s*k/i.test(singleMatch[0])
    : false;

  const compensation = {
    source: 'deterministic',
    originalText: searchRegion.slice(0, 280),
    currency: currency || null,
    payPeriod: period,
    min: rangeMatch ? parseAmount(rangeMatch.groups.min, hasKSuffix) : null,
    max: rangeMatch ? parseAmount(rangeMatch.groups.max, hasKSuffix) : null,
    amount: singleMatch ? parseAmount(singleMatch.groups.amount, hasKSuffix) : null,
    isRange: !!rangeMatch,
    includesBonus: /bonus/i.test(searchRegion),
    includesEquity: /equity|stock/i.test(searchRegion),
    vagueTerms: VAGUE_COMP_TERMS.test(searchRegion) ? searchRegion.match(VAGUE_COMP_TERMS) : null,
    fallbackUsed: false,
    locationContext: job_location_string
  };

  if (!compensation.min && compensation.amount === null) {
    const llmResult = await llmExtractCompensation(job_body);
    if (llmResult) {
      compensation.source = 'llm';
      compensation.originalText = llmResult.salaryText || compensation.originalText;
      compensation.currency = llmResult.currency || compensation.currency;
      compensation.min = typeof llmResult.minValue === 'number' ? llmResult.minValue : compensation.min;
      compensation.max = typeof llmResult.maxValue === 'number' ? llmResult.maxValue : compensation.max;
      compensation.amount = !llmResult.isRange && typeof llmResult.minValue === 'number' ? llmResult.minValue : compensation.amount;
      compensation.isRange = !!llmResult.isRange && (compensation.min !== null || compensation.max !== null);
      compensation.payPeriod = llmResult.payFrequency || compensation.payPeriod;
      compensation.includesEquity = !!llmResult.includesEquity;
      compensation.includesBonus = !!llmResult.includesBonus;
      compensation.fallbackUsed = true;
    }
  }

  return compensation;
}

async function scoreCompensationAndCompliance(jobData) {
  const suggestions = [];
  try {
    const jobLocation = jobData.job_location || {};
    const locationSummary = jobLocation.summary || jobLocation.raw || '';
    const compensation = await extractCompensationData(jobData.job_body || '', locationSummary);

    const jurisdictions = Array.isArray(jobLocation.jurisdictions)
      ? jobLocation.jurisdictions
      : computeJurisdictions(jobLocation);
    const requiresDisclosure = jurisdictions.length > 0 || (!!jobLocation.remote && jobLocation.country === 'United States');

    let score = 0;
    let status = 'missing';

    if (compensation.isRange && compensation.currency && compensation.payPeriod) {
      score = 15;
      status = 'range_full';
    } else if (compensation.isRange && compensation.currency) {
      score = 13;
      status = 'range_missing_period';
      suggestions.push('Specify the pay period (e.g., per year or per hour) for the salary range.');
    } else if (compensation.isRange) {
      score = 12;
      status = 'range_missing_currency_period';
      suggestions.push('Include currency (USD, GBP, etc.) and pay period for the salary range.');
    } else if (compensation.amount !== null && compensation.currency && compensation.payPeriod) {
      score = 11;
      status = 'single_full';
      suggestions.push('Provide a salary range instead of a single value to improve transparency.');
    } else if (compensation.amount !== null && compensation.currency) {
      score = 9;
      status = 'single_missing_period';
      suggestions.push('Specify the pay period (e.g., per year, per hour) for the listed salary.');
    } else if (compensation.amount !== null) {
      score = 7;
      status = 'single_missing_currency_period';
      suggestions.push('Add currency and pay period for the listed salary.');
    } else if (compensation.vagueTerms) {
      score = 5;
      status = 'vague_terms';
      suggestions.push('Replace vague compensation language with a specific salary range.');
    } else {
      score = 0;
      status = 'missing';
      suggestions.push('Add compensation details with currency, range, and pay period.');
    }

    if (requiresDisclosure) {
      if (status === 'missing') {
        score = 0;
        suggestions.unshift('This jurisdiction requires pay transparency. Publish a specific salary range.');
      } else if (status !== 'range_full') {
        score = Math.min(score, 8);
        suggestions.unshift('Pay transparency law in the listed jurisdiction expects a full salary range with currency and period.');
      }
    }

    const breakdown = {
      status,
      requiresDisclosure,
      jurisdictions,
      locationSource: jobLocation.source || null,
      compensation
    };

    return {
      score,
      maxScore: 15,
      breakdown,
      suggestions
    };
  } catch (error) {
    console.error('[ScoringV2] Compensation compliance scoring failed:', error);
    return {
      score: 0,
      maxScore: 15,
      breakdown: { error: error.message },
      suggestions: ['Failed to analyze compensation details. Provide salary information manually.']
    };
  }
}

async function scoreJobEnhanced(jobData) {
  console.log('[ScoringV2] Starting enhanced job analysis pipeline.');

  const job_location = await extractJobLocation(jobData.job_body);
  const enhancedJobData = { ...jobData, job_location };
  const locationLabel = job_location?.summary || job_location?.raw || 'Unknown';
  console.log(`[ScoringV2] Extracted job location: ${locationLabel}`);

  const [
    clarity,
    promptAlignment,
    structuredData,
    recency,
    keywordTargeting,
    pageContext,
    compensation
  ] = await Promise.all([
    scoreClarityReadability(enhancedJobData),
    scorePromptAlignment(enhancedJobData),
    scoreStructuredDataPresence(enhancedJobData),
    scoreRecencyFreshness(enhancedJobData),
    scoreKeywordTargeting(enhancedJobData),
    scorePageContextCleanliness(enhancedJobData),
    scoreCompensationAndCompliance(enhancedJobData)
  ]);

  console.log('[ScoringV2] All scoring categories completed.');

  const newWeights = {
    clarity: 15,
    promptAlignment: 15,
    structuredData: 15,
    recency: 10,
    keywordTargeting: 15,
    compensation: 15,
    pageContext: 15
  };

  function reweight(categoryKey, result) {
    const weight = newWeights[categoryKey];
    const scaledScore = Math.round(
      (result.score / (result.maxScore || 1)) * weight
    );
    return {
      ...result,
      score: Math.min(weight, Math.max(0, scaledScore)),
      maxScore: weight
    };
  }

  const categories = {
    clarity: reweight('clarity', clarity),
    promptAlignment: reweight('promptAlignment', promptAlignment),
    structuredData: reweight('structuredData', structuredData),
    recency: reweight('recency', recency),
    keywordTargeting: reweight('keywordTargeting', keywordTargeting),
    compensation: reweight('compensation', compensation),
    pageContext: reweight('pageContext', pageContext)
  };

  const total_score = Object.values(categories)
    .reduce((sum, cat) => sum + (cat.score || 0), 0);
  const recommendations = Object.values(categories)
    .flatMap(cat => Array.isArray(cat.suggestions) ? cat.suggestions : [])
    .filter(Boolean);
  const red_flags = Object.entries(categories)
    .filter(([_, v]) => v.score < v.maxScore * 0.5)
    .map(([k]) => k);
  const feedback = `This job posting scored ${total_score}/100 based on our enhanced analysis. `
    + `Key areas for improvement: ${recommendations.slice(0, 3).join('; ')}.`;

  return {
    total_score,
    feedback,
    recommendations,
    red_flags,
    categories,
    job_location: job_location || null
  };
}

module.exports = {
  PAY_TRANSPARENCY_JURISDICTIONS,
  extractJobLocation,
  extractCompensationData,
  scoreCompensationAndCompliance,
  scoreJobEnhanced
};
