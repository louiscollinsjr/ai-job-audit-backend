const crypto = require('crypto');
const { callLLM } = require('../utils/llmHelpers');
const { runLLMJsonPrompt } = require('../utils/llmPromptHelper');
const { scoreKeywordTargeting } = require('./scoringService');

const {
  scoreStructuredDataPresence,
  scoreRecencyFreshness,
  scorePageContextCleanliness
} = require('./scoringServiceEnhanced');

// Simple in-memory cache for scoring results (LRU with max 100 entries)
const scoringCache = new Map();
const MAX_CACHE_SIZE = 100;
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

function getCacheKey(jobData) {
  const content = JSON.stringify({
    body: jobData.job_body,
    html: jobData.job_html,
    title: jobData.job_title
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getFromCache(key) {
  const cached = scoringCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    scoringCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCache(key, data) {
  // Simple LRU: if cache is full, remove oldest entry
  if (scoringCache.size >= MAX_CACHE_SIZE) {
    const firstKey = scoringCache.keys().next().value;
    scoringCache.delete(firstKey);
  }
  scoringCache.set(key, { data, timestamp: Date.now() });
}


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

async function scoreClarityReadability({ job_title, job_body }) {
  const sentences = job_body.match(/[^.!?]+[.!?]+/g) || [];
  const words = job_body.split(/\s+/).filter(w => /\w/.test(w));
  const avgLen = sentences.length ? (words.length / sentences.length) : words.length;
  const avgWordLen = words.length ? words.reduce((s, w) => s + w.length, 0) / words.length : 0;
  const unique = new Set(words.map(w => w.toLowerCase())).size;
  const ttr = words.length ? unique / words.length : 0;

  const sentenceLenScore = avgLen <= 16 ? 10 : avgLen <= 20 ? 8 : avgLen <= 24 ? 6 : avgLen <= 28 ? 4 : 2;
  const wordLenScore = avgWordLen <= 4.7 ? 10 : avgWordLen <= 5.2 ? 8 : avgWordLen <= 5.7 ? 6 : avgWordLen <= 6.2 ? 4 : 2;
  const ttrScore = Math.max(0, Math.min(10, 10 - Math.abs((ttr || 0) - 0.5) * 20));

  const stop = new Set(['the','a','an','and','or','for','with','to','of','in','on','at','by','from','as','is','are','be','we']);
  const titleTokens = (job_title || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !stop.has(t));
  const first200 = words.slice(0, 200).map(w => w.toLowerCase());
  const titleCovered = titleTokens.length ? titleTokens.filter(t => first200.includes(t)).length / titleTokens.length : 0;
  const titleOverlapScore = Math.round(Math.max(0, Math.min(10, titleCovered * 10)));

  const detAvg = [sentenceLenScore, wordLenScore, ttrScore, titleOverlapScore]
    .filter(Number.isFinite)
    .reduce((a, b) => a + b, 0) / 4 || 0;

  const llm = await runLLMJsonPrompt({
    task: 'title clarity, buzzwords/fluff, and readability',
    schema: { title: {}, fluff: {}, readability: {} },
    job_title,
    job_body,
    userTag: 'services/scoringServiceV2/clarity',
    maxOutputTokens: 80,
    seed: 1234
  }) || {};

  const safeScore = section => (section && Number.isFinite(section.score)) ? section.score : 0;
  const titleScore = safeScore(llm.title);
  const fluffScore = safeScore(llm.fluff);
  const readabilityScore = safeScore(llm.readability);

  const llmAvg = (titleScore + fluffScore + readabilityScore) / 3;
  const final0to10 = Math.max(0, Math.min(10, 0.5 * detAvg + 0.5 * llmAvg));
  const total = Math.round(final0to10 * 2);

  const suggestions = [llm.title?.suggestion, llm.fluff?.suggestion, llm.readability?.suggestion]
    .filter(Boolean);
  if (avgLen > 28) suggestions.push('Shorten sentences to improve readability (target < 20 words avg).');
  if (titleCovered < 0.5 && titleTokens.length) suggestions.push('Include key title terms in the opening paragraph.');
  if (ttr < 0.3) suggestions.push('Reduce repetition; vary wording.');
  if (ttr > 0.7) suggestions.push('Avoid excessive jargon; simplify language.');

  return {
    score: Math.min(total, 20),
    maxScore: 20,
    breakdown: { title: titleScore, fluff: fluffScore, readability: readabilityScore, sentenceLenScore, wordLenScore, ttrScore, titleOverlapScore },
    suggestions
  };
}

async function scorePromptAlignment({ job_title, job_body }) {
  const llm = await runLLMJsonPrompt({
    task: 'query_match, grouping, and structure for alignment and scannability',
    schema: { query_match: {}, grouping: {}, structure: {} },
    job_title,
    job_body,
    userTag: 'services/scoringServiceV2/prompt_alignment',
    maxOutputTokens: 80,
    seed: 1234
  });

  const hasSections = /(Responsibilities|Requirements|Qualifications|Benefits|Compensation)/i.test(job_body);
  const bodyWords = job_body.split(/\s+/).filter(Boolean);
  const first100 = bodyWords.slice(0, 100).join(' ').toLowerCase();
  const roleInTitle = /(engineer|developer|designer|manager|analyst|lead|director|scientist)/i.test(job_title);
  const locationInTitle = /(remote|hybrid|onsite|[A-Z][a-z]+,?\s?[A-Z]{2})/.test(job_title);
  const earlyPresence = /(remote|hybrid|onsite|responsibilit|requirement|qualification)/i.test(first100);
  let detBonus = 0;
  if (hasSections) detBonus += 1;
  if (roleInTitle && locationInTitle) detBonus += 1;
  if (earlyPresence) detBonus += 1;
  if (!hasSections) detBonus -= 1;

  const llmAvg = (llm.query_match.score + llm.grouping.score + llm.structure.score) / 3;
  const adjusted = Math.max(0, Math.min(10, llmAvg + Math.max(-2, Math.min(2, detBonus))));
  const total = Math.round(adjusted * 2);

  const suggestions = [llm.query_match?.suggestion, llm.grouping?.suggestion, llm.structure?.suggestion].filter(Boolean);
  if (!hasSections) suggestions.push('Add clear sections (Responsibilities, Requirements, Benefits).');
  if (!(roleInTitle && locationInTitle)) suggestions.push('Include role, level, and location in the title.');

  return {
    score: Math.min(total, 20),
    maxScore: 20,
    breakdown: { queryMatch: llm.query_match.score, grouping: llm.grouping.score, structure: llm.structure.score, detBonus },
    suggestions
  };
}

async function llmExtractLocation(job_body) {
  try {
    const raw = await runLLMJsonPrompt({
      task: 'job location summary with city, state, country, remote, hybrid flags',
      schema: {
        summary: {},
        city: {},
        state: {},
        country: {},
        remote: {},
        hybrid: {}
      },
      job_title: '',
      job_body,
      userTag: 'services/scoringServiceV2/location',
      maxOutputTokens: 60,
      seed: 4321
    });
    if (!raw || typeof raw !== 'object') return null;

    const normalizeText = value => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
      }
      if (typeof value === 'number') {
        const text = String(value).trim();
        return text.length ? text : null;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          const normalized = normalizeText(item);
          if (normalized) return normalized;
        }
        return null;
      }
      if (typeof value === 'object') {
        if (typeof value.text === 'string') return normalizeText(value.text);
        if (typeof value.value === 'string') return normalizeText(value.value);
      }
      return null;
    };

    const normalizeBoolean = value => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return false;
        return ['true', 'yes', 'remote', 'hybrid', 'onsite', 'on-site', 'on site', '1'].includes(normalized);
      }
      return false;
    };

    const result = {
      summary: normalizeText(raw.summary),
      city: normalizeText(raw.city),
      state: normalizeText(raw.state),
      country: normalizeText(raw.country),
      remote: normalizeBoolean(raw.remote),
      hybrid: normalizeBoolean(raw.hybrid)
    };

    if (result.state) result.state = result.state.toUpperCase();

    const hasData = result.summary || result.city || result.state || result.country || result.remote || result.hybrid;
    return hasData ? result : null;
  } catch (error) {
    console.warn('[ScoringV2] LLM location extraction failed:', error.message);
    return null;
  }
}

function calculateLocationConfidence(location, candidate) {
  let confidence = 0;
  
  // City + State match is strong signal
  if (location.city && location.state) confidence += 0.4;
  // State abbreviation alone
  else if (location.state) confidence += 0.2;
  
  // Modality flags
  if (location.remote || location.hybrid || location.onsite) confidence += 0.2;
  
  // Country detected
  if (location.country) confidence += 0.1;
  
  // Has candidate line
  if (candidate) confidence += 0.1;
  
  // Jurisdiction match (pay transparency states)
  if (location.jurisdictions && location.jurisdictions.length > 0) confidence += 0.2;
  
  return Math.min(1.0, confidence);
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
    source: 'deterministic',
    confidence: 0
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

  // Calculate preliminary jurisdictions for confidence scoring
  const prelimJurisdictions = computeJurisdictions(location);
  location.jurisdictions = prelimJurisdictions;
  
  // Calculate confidence score
  location.confidence = calculateLocationConfidence(location, candidate);
  
  // Only call LLM if confidence is below threshold (0.5)
  if (location.confidence < 0.5 && !location.summary) {
    console.log('[ScoringV2] Location confidence low, invoking LLM fallback');
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
        source: 'llm',
        confidence: 0.6 // Base LLM confidence
      };
      location.jurisdictions = computeJurisdictions(location);
      // Boost confidence if LLM provided complete data
      if (location.city && location.state) location.confidence = 0.8;
    }
  } else if (location.confidence >= 0.5) {
    console.log(`[ScoringV2] Location confidence high (${location.confidence.toFixed(2)}), skipping LLM`);
  }

  return location;
}

function findCompensationLine(job_body) {
  const rawLines = job_body.split(/\r?\n/);
  const currencyPattern = /(\$|US\$|USD|£|GBP|€|EUR|C\$|CAD|A\$|AUD)\s*\d/;
  const rangePattern = /\d[\d,]*(?:\.\d{1,2})?\s*(?:k|K)?\s*(?:-|to|–|—)\s*\d/;
  const headingBreakPattern = /^(Responsibilities|Requirements|Qualifications|Benefits|Perks|About|Overview|Summary)[:]?$/i;

  for (let i = 0; i < rawLines.length; i++) {
    const line = normalizeWhitespace(rawLines[i] || '');
    if (!line) continue;

    const hasKeyword = /compensation|salary|pay|base pay|base salary/i.test(line);
    const hasCurrency = currencyPattern.test(line);
    const hasRange = rangePattern.test(line);

    if (!hasKeyword && !hasCurrency && !hasRange) {
      continue;
    }

    const snippet = [line];
    let lookahead = 1;
    while (lookahead <= 3 && (i + lookahead) < rawLines.length) {
      const nextRaw = normalizeWhitespace(rawLines[i + lookahead] || '');
      if (!nextRaw) break;
      if (headingBreakPattern.test(nextRaw)) break;

      snippet.push(nextRaw);

      if (currencyPattern.test(nextRaw) || rangePattern.test(nextRaw)) {
        break;
      }
      lookahead++;
    }

    return snippet.join(' ');
  }

  return null;
}

async function llmExtractCompensation(job_body) {
  try {
    return await runLLMJsonPrompt({
      task: 'compensation details with salary text, currency, min/max, frequency, range and perks',
      schema: {
        salaryText: {},
        currency: {},
        minValue: {},
        maxValue: {},
        payFrequency: {},
        isRange: {},
        includesEquity: {},
        includesBonus: {}
      },
      job_title: '',
      job_body,
      userTag: 'services/scoringServiceV2/compensation',
      maxOutputTokens: 80,
      seed: 8765
    });
  } catch (error) {
    console.warn('[ScoringV2] LLM compensation extraction failed:', error.message);
    return null;
  }
}

function calculateCompensationConfidence(compensation) {
  let confidence = 0;
  
  // Range with both bounds is strongest signal
  if (compensation.isRange && compensation.min && compensation.max) {
    confidence += 0.4;
    // Sanity check: max should be greater than min
    if (compensation.max <= compensation.min) confidence -= 0.2;
  } else if (compensation.amount !== null) {
    confidence += 0.3;
  }
  
  // Currency detected
  if (compensation.currency) confidence += 0.2;
  
  // Pay period specified
  if (compensation.payPeriod) confidence += 0.2;
  
  // No vague terms is good
  if (!compensation.vagueTerms) confidence += 0.2;
  else confidence -= 0.1;
  
  return Math.max(0, Math.min(1.0, confidence));
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
    locationContext: job_location_string,
    confidence: 0
  };

  // Calculate confidence
  compensation.confidence = calculateCompensationConfidence(compensation);

  // Only call LLM if confidence is below threshold (0.5) and no amount found
  if (compensation.confidence < 0.5 && !compensation.min && compensation.amount === null) {
    console.log('[ScoringV2] Compensation confidence low, invoking LLM fallback');
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
      // Recalculate confidence with LLM data
      compensation.confidence = calculateCompensationConfidence(compensation);
      if (compensation.confidence > 0) compensation.confidence = Math.max(0.6, compensation.confidence);
    }
  } else if (compensation.confidence >= 0.5) {
    console.log(`[ScoringV2] Compensation confidence high (${compensation.confidence.toFixed(2)}), skipping LLM`);
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

  // Check cache first
  const cacheKey = getCacheKey(jobData);
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log('[ScoringV2] Returning cached scoring result');
    return cached;
  }

  const job_location = await extractJobLocation(jobData.job_body);
  const enhancedJobData = { ...jobData, job_location };
  const locationLabel = job_location?.summary || job_location?.raw || 'Unknown';
  console.log(`[ScoringV2] Extracted job location: ${locationLabel} (confidence: ${job_location.confidence?.toFixed(2) || 'N/A'})`);

  // Run deterministic scorers first (fast, no LLM calls)
  console.log('[ScoringV2] Running deterministic scorers...');
  const [structuredData, recency, keywordTargeting, pageContext] = await Promise.all([
    scoreStructuredDataPresence(enhancedJobData),
    scoreRecencyFreshness(enhancedJobData),
    scoreKeywordTargeting(enhancedJobData),
    scorePageContextCleanliness(enhancedJobData)
  ]);

  // Run LLM-dependent scorers sequentially to avoid rate limits
  console.log('[ScoringV2] Running LLM-dependent scorers...');
  const clarity = await scoreClarityReadability(enhancedJobData);
  const promptAlignment = await scorePromptAlignment(enhancedJobData);
  const compensation = await scoreCompensationAndCompliance(enhancedJobData);

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

  const result = {
    total_score,
    feedback,
    recommendations,
    red_flags,
    categories,
    job_location: job_location || null
  };

  // Cache the result
  setCache(cacheKey, result);
  console.log('[ScoringV2] Result cached for future use');

  return result;
}

module.exports = {
  PAY_TRANSPARENCY_JURISDICTIONS,
  extractJobLocation,
  extractCompensationData,
  scoreCompensationAndCompliance,
  scoreJobEnhanced
};
