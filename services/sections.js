const cheerio = require('cheerio');
const { callLLM } = require('../utils/llmHelpers');
const { estimatePromptTokens, computeMaxOutputTokens, shouldSegment } = require('../utils/tokenBudget');
const { ensureJsonSafeOutput } = require('../utils/jsonGuards');
const config = require('../config/optimizationV2');

function segmentIfNeeded({ jobHtml, jobText, fingerprint }) {
  const segments = [];
  if (jobHtml) {
    const $ = cheerio.load(jobHtml);
    fingerprint?.sectionOrder?.forEach((label) => {
      const aliases = fingerprint?.headingAliases?.[label.toLowerCase()] || [];
      const selectorAlias = aliases.find((alias) => typeof alias === 'string' && /^h[1-6]$/i.test(alias));
      let heading = null;
      if (selectorAlias) {
        const candidate = $(selectorAlias);
        if (candidate && candidate.length > 0) {
          heading = candidate.first();
        }
      }
      if (!heading || !heading.length) {
        heading = findHeadingByLabel($, label);
      }
      if (!heading || !heading.length) {
        return;
      }
      const block = collectHtmlSection($, heading);
      if (block) {
        segments.push(block);
      }
    });
    if (segments.length) {
      return enforceSegmentLimits(segments);
    }
  }
  const fallback = splitTextSections(jobText, fingerprint);
  return enforceSegmentLimits(fallback);
}

async function generateOptimizedSection({ section, fingerprint, globalContext }) {
  const prompt = buildSectionPrompt({ section, fingerprint, globalContext });
  const promptTokens = estimatePromptTokens({
    textLength: prompt.length,
    htmlLength: section.originalHtml?.length || 0,
    sectionCount: 1
  });
  const maxOutputTokens = computeMaxOutputTokens(
    promptTokens,
    config.tokenBudget.targetTotal,
    config.tokenBudget.minOutput,
    config.tokenBudget.fallbackTotal
  );
  const llmOptions = {
    model: config.models.sectionModel,
    response_format: { type: 'json_object' },
    max_output_tokens: maxOutputTokens,
    timeout: 60000, // 60s timeout for slower gpt-5 models
    user: 'services/sections.generateOptimizedSection'
  };
  const response = await callLLM(prompt, config.models.sectionTemperature, llmOptions);
  const parsed = await ensureJsonSafeOutput(response);
  return {
    label: section.label,
    optimizedText: parsed.optimized_text || '',
    changeLog: parsed.change_log || [],
    unaddressedItems: parsed.unaddressed_items || []
  };
}

function mergeSections(sections, fingerprint) {
  const order = fingerprint?.sectionOrder || [];
  const ordered = order
    .map((label) => sections.find((section) => section.label === label))
    .filter(Boolean);
  const remaining = sections.filter((section) => !order.includes(section.label));
  return [...ordered, ...remaining].map((section) => section.optimizedText).join('\n\n');
}

async function runCoherencePass({ draft, globalContext, schemaSnapshot }) {
  try {
    const prompt = buildCoherencePrompt({ draft, globalContext, schemaSnapshot });
    const promptTokens = estimatePromptTokens({ textLength: prompt.length, sectionCount: 1 });
    const maxOutputTokens = computeMaxOutputTokens(
      promptTokens,
      config.tokenBudget.targetTotal,
      config.tokenBudget.minOutput,
      config.tokenBudget.fallbackTotal
    );
    const llmOptions = {
      model: config.models.coherenceModel,
      response_format: { type: 'json_object' },
      timeout: 60000, // 60s timeout for slower gpt-5 models
      user: 'services/sections.runCoherencePass',
      max_output_tokens: maxOutputTokens
    };
    const response = await callLLM(prompt, config.models.coherenceTemperature, llmOptions);
    
    // Handle empty response gracefully
    if (!response || !response.trim()) {
      console.warn('[WARN] Coherence pass returned empty response, using draft as-is');
      return {
        optimized_text: draft,
        change_log: ['Coherence pass skipped due to empty LLM response'],
        unaddressed_items: []
      };
    }
    
    const parsed = await ensureJsonSafeOutput(response);
    return {
      optimized_text: parsed.optimized_text || draft,
      change_log: parsed.change_log || [],
      unaddressed_items: parsed.unaddressed_items || []
    };
  } catch (error) {
    console.error('[ERROR] Coherence pass failed:', error.message);
    console.warn('[WARN] Falling back to draft without coherence pass');
    return {
      optimized_text: draft,
      change_log: [`Coherence pass failed: ${error.message}`],
      unaddressed_items: []
    };
  }
}

function enforceSegmentLimits(segments) {
  return segments.flatMap((segment) => {
    if (!shouldSegment({
      textLength: segment.rawText.length,
      maxCharsPerSection: config.segmentation.maxCharsPerSection
    })) {
      return segment;
    }
    return chunkText(segment, config.segmentation.maxCharsPerSection);
  });
}

function findHeadingByLabel($, label) {
  const candidates = [];
  $('h1, h2, h3, h4').each((_, el) => {
    const text = $(el).text().trim();
    if (normalize(text) === normalize(label)) {
      candidates.push($(el));
    }
  });
  return candidates[0];
}

function collectHtmlSection($, heading) {
  const label = heading.text().trim();
  const nodes = [];
  let pointer = heading.next();
  while (pointer && pointer.length && !/^h[1-4]$/i.test(pointer[0].name)) {
    nodes.push(pointer.html() || pointer.text() || '');
    pointer = pointer.next();
  }
  const rawText = nodes.join('\n').trim();
  if (!rawText) {
    return null;
  }
  return {
    label: normalize(label),
    headingText: label,
    rawText,
    originalHtml: nodes.join('\n'),
    fingerprintSource: 'html'
  };
}

function splitTextSections(jobText = '', fingerprint) {
  const sections = [];
  let current = null;
  jobText.split(/\r?\n/).forEach((line) => {
    const headingMatch = line.match(/^\s*#{2,3}\s*(.+)$/);
    if (headingMatch) {
      if (current) {
        sections.push(current);
      }
      current = {
        label: normalize(headingMatch[1]),
        headingText: headingMatch[1].trim(),
        rawText: ''
      };
      return;
    }
    if (!current) {
      return;
    }
    const trimmed = line.trim();
    if (trimmed) {
      current.rawText += `${trimmed}\n`;
    }
  });
  if (current) {
    sections.push(current);
  }
  if (!sections.length) {
    const fallbackLabel = fingerprint?.sectionOrder?.[0] || 'Full Text';
    return jobText
      ? [{ label: normalize(fallbackLabel), headingText: fallbackLabel, rawText: jobText }]
      : [];
  }
  return sections;
}

function chunkText(section, maxChars) {
  const chunks = [];
  for (let i = 0; i < section.rawText.length; i += maxChars) {
    chunks.push({
      label: section.label,
      headingText: section.headingText,
      rawText: section.rawText.slice(i, i + maxChars),
      fingerprintSource: section.fingerprintSource || 'chunked'
    });
  }
  return chunks;
}

function buildSectionPrompt({ section, fingerprint, globalContext = {} }) {
  const heading = section.headingText || section.label;
  const tone = fingerprint?.tone || {};
  const formatting = fingerprint?.formatting || {};
  const config = require('../config/optimizationV2');
  
  const contextLines = [
    `Company: ${globalContext.companyName || 'Unknown'}`,
    `Role: ${globalContext.title || globalContext.role || 'Unknown Role'}`,
    `Desired Tone: ${tone.voice || 'professional'}${tone.missionDriven ? ', mission-driven' : ''}`,
    `Formatting: ${formatting.usesHtml ? 'HTML' : 'Markdown'} with bullet style ${formatting.bulletStyle || 'default'}`
  ];
  
  // Preserve location information
  const locationInfo = globalContext.location || globalContext.job_location;
  if (locationInfo?.summary || locationInfo?.raw) {
    contextLines.push(`Location: ${locationInfo.summary || locationInfo.raw}`);
  }
  
  const lexicalAnchors = fingerprint?.lexicalAnchors?.slice(0, 5) || [];
  const anchorLine = lexicalAnchors.length ? `Preserve branded phrases: ${lexicalAnchors.join(', ')}` : '';
  
  // Check if this is a title section
  const isTitle = /title/i.test(heading) || /title/i.test(section.label);
  const preserveTitle = config.preservation?.preserveTitle !== false;
  
  // Brand keyword preservation
  const brandKeywords = config.preservation?.brandKeywords || [];
  const brandLine = brandKeywords.length ? `CRITICAL: Preserve these brand terms exactly: ${brandKeywords.join(', ')}` : '';
  
  const instructions = [
    'You are optimizing a single section of a job posting.',
    'Stay faithful to the company fingerprint while improving clarity, inclusivity, and completeness.',
    'IMPORTANT: If location information is mentioned, preserve it exactly (city, state, remote/hybrid status).',
    brandLine,
    isTitle && preserveTitle ? 'CRITICAL: This is the job title. Preserve it EXACTLY as provided. Do not remove company name or any specifics. Only fix typos.' : null,
    contextLines.filter(Boolean).join('\n'),
    anchorLine,
    'Return JSON with keys optimized_text, change_log (array), unaddressed_items (array).',
    `### Section Heading: ${heading}`,
    '### Original Section Content:',
    section.rawText,
    '---'
  ].filter(Boolean).join('\n\n');
  
  return instructions;
}

function buildCoherencePrompt({ draft, globalContext, schemaSnapshot }) {
  const config = require('../config/optimizationV2');
  const contextLines = [
    `Company: ${globalContext.companyName || 'Unknown'}`,
    `Role: ${globalContext.title || 'Unknown Role'}`,
    `Tone: ${globalContext.tone?.voice || 'professional'}`
  ];
  
  // Preserve location information
  const locationInfo = globalContext.location || globalContext.job_location;
  if (locationInfo?.summary || locationInfo?.raw) {
    contextLines.push(`Location: ${locationInfo.summary || locationInfo.raw}`);
  }
  
  // Brand keyword preservation
  const brandKeywords = config.preservation?.brandKeywords || [];
  const brandLine = brandKeywords.length ? `Preserve these brand terms exactly: ${brandKeywords.join(', ')}` : '';
  
  const schemaHints = schemaSnapshot
    ? Object.entries(schemaSnapshot)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
    : [];
  return [
    'Polish the following job posting for cohesion and tone consistency.',
    'Preserve all section headings, location details, and structural elements.',
    brandLine,
    'Improve flow and transitions while maintaining the existing organization.',
    contextLines.join('\n'),
    schemaHints.length ? `Schema context:\n${schemaHints.join('\n')}` : '',
    '',
    'Return valid JSON with these exact keys:',
    '{"optimized_text": "full polished document", "change_log": ["change 1", "change 2"], "unaddressed_items": []}',
    '',
    '--- Document to Polish ---',
    draft
  ].filter(Boolean).join('\n\n');
}

function normalize(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim();
}

module.exports = {
  segmentIfNeeded,
  generateOptimizedSection,
  mergeSections,
  runCoherencePass
};
