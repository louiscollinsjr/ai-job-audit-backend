const cheerio = require('cheerio');

function analyzeJobStructure({ jobHtml, jobText }) {
  const $ = jobHtml ? cheerio.load(jobHtml) : null;
  const sections = $ ? extractSectionsFromHtml($, jobText) : extractSectionsFromText(jobText);
  const tone = deriveToneProfile({ $, jobText });
  const formatting = detectFormatting({ $, jobText });
  const companyName = detectCompanyName({ $, jobText });

  return {
    companyName,
    detectedSections: sections,
    tone,
    formatting,
    rawHtml: jobHtml || null
  };
}

function extractJobSchemaSections({ jobHtml, jobText }) {
  const schemaFromHtml = jobHtml ? parseJsonLd(jobHtml) : {};
  const textMapping = mapTextToSchema(jobText || '');
  return { ...schemaFromHtml, ...textMapping };
}

function extractSectionsFromHtml($, jobText = '') {
  const results = [];
  $('h1, h2, h3, h4').each((index, el) => {
    const heading = $(el);
    const label = normalizeHeading(heading.text());
    if (!label) {
      return;
    }
    const selector = buildSelector(el);
    const block = collectSectionContent($, el);
    results.push({
      label,
      headingText: heading.text().trim(),
      order: index,
      selector,
      bulletCount: block.bulletCount,
      paragraphCount: block.paragraphCount,
      rawText: block.rawText
    });
  });
  if (results.length) {
    return results;
  }
  const fallbackText = jobText || $.root().text();
  return extractSectionsFromText(fallbackText);
}

function extractSectionsFromText(jobText = '') {
  const lines = jobText.split(/\r?\n/);
  const sections = [];
  let current = null;
  lines.forEach((line, index) => {
    const headingMatch = line.match(/^\s*#{2,3}\s*(.+)$/);
    if (headingMatch) {
      if (current) {
        sections.push(current);
      }
      current = {
        label: normalizeHeading(headingMatch[1]),
        headingText: headingMatch[1].trim(),
        order: sections.length,
        selector: null,
        bulletCount: 0,
        paragraphCount: 0,
        rawText: ''
      };
      return;
    }
    if (!current) {
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    current.rawText += `${trimmed}\n`;
    if (/^[-*+]/.test(trimmed)) {
      current.bulletCount += 1;
    } else {
      current.paragraphCount += 1;
    }
  });
  if (current) {
    sections.push(current);
  }
  return sections;
}

function deriveToneProfile({ $, jobText }) {
  const text = $ ? $.text() : jobText || '';
  const sentenceLengths = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/).length);
  const avgSentenceLength = sentenceLengths.length
    ? sentenceLengths.reduce((sum, len) => sum + len, 0) / sentenceLengths.length
    : 0;
  const missionDriven = /mission|impact|purpose/i.test(text);
  const formality = avgSentenceLength > 18 ? 'formal' : 'conversational';
  return {
    formality,
    missionDriven,
    avgSentenceLength,
    voice: missionDriven ? 'mission-driven' : 'professional'
  };
}

function detectFormatting({ $, jobText }) {
  if ($) {
    const bullets = $('ul li, ol li').length;
    const emphasis = $('strong, b').length;
    return {
      usesHtml: true,
      bulletStyle: bullets ? 'list' : 'none',
      emphasisCount: emphasis,
      prefersTables: $('table').length > 0
    };
  }
  const lines = jobText ? jobText.split(/\r?\n/) : [];
  const markdownBullets = lines.filter((line) => /^\s*[-*+]/.test(line)).length;
  const emphasis = (jobText || '').match(/\*\*[^*]+\*\*/g) || [];
  return {
    usesHtml: false,
    bulletStyle: markdownBullets ? 'markdown' : 'none',
    emphasisCount: emphasis.length,
    prefersTables: /\|.+\|/.test(jobText || '')
  };
}

function detectCompanyName({ $, jobText }) {
  // Try HTML-based extraction first
  if ($) {
    // Check meta tags
    const metaOg = $('meta[property="og:site_name"]').attr('content');
    if (metaOg && metaOg.trim().length > 0) {
      return metaOg.trim();
    }
    
    // Check for JSON-LD schema
    const jsonLdCompany = extractCompanyFromJsonLd($);
    if (jsonLdCompany) {
      return jsonLdCompany;
    }
    
    // Check common brand elements
    const headerBrand = $('[class*="logo"], [class*="brand"], header h1').first().text();
    if (headerBrand && headerBrand.trim().length > 2) {
      return headerBrand.trim();
    }
  }
  
  // Text-based extraction with multiple patterns
  const text = jobText || '';
  
  const patterns = [
    // "at Company" or "@ Company"
    /(?:at|@)\s+([A-Z][A-Za-z0-9&\s]+?)(?:\s+[-|]|\n|is\s|$)/,
    // "Company is hiring/looking/seeking"
    /([A-Z][A-Za-z0-9&\s]+?)\s+is\s+(?:hiring|looking|seeking)/i,
    // "Join Company" or "Join the Company team"
    /Join\s+(?:the\s+)?([A-Z][A-Za-z0-9&\s]+?)\s+team/i,
    // "Company - Job Title" format (common in titles)
    /^([A-Z][A-Za-z0-9&\s]+?)\s+[-–]\s+/,
    // "About Company" section
    /About\s+([A-Z][A-Za-z0-9&\s]+?)(?:\n|:)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const company = match[1].trim();
      // Filter out common false positives
      if (company.length > 2 && 
          !company.match(/^(The|Our|This|Your|Job|Position|Role|Team|Company)$/i)) {
        return company;
      }
    }
  }
  
  return null;
}

function extractCompanyFromJsonLd($) {
  try {
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
    
    const jobPosting = scripts.find((item) => item['@type'] === 'JobPosting');
    if (jobPosting?.hiringOrganization?.name) {
      return jobPosting.hiringOrganization.name;
    }
  } catch (error) {
    // Ignore errors
  }
  return null;
}

function parseJsonLd(jobHtml) {
  const $ = cheerio.load(jobHtml);
  const scripts = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).contents().text();
    try {
      const parsed = JSON.parse(content);
      scripts.push(parsed);
    } catch (error) {
      return;
    }
  });
  const jobPosting = scripts.find((item) => item['@type'] === 'JobPosting') || {};
  return normalizeSchema(jobPosting);
}

function mapTextToSchema(jobText) {
  if (!jobText) {
    return {};
  }
  const compensationMatch = jobText.match(/\$[0-9,.]+\s*(-|to)\s*\$[0-9,.]+/i);
  return {
    description: jobText,
    compensationRange: compensationMatch ? compensationMatch[0] : null
  };
}

function normalizeSchema(raw = {}) {
  const baseSalary = raw.baseSalary || raw.salary || {};
  return {
    title: raw.title || null,
    description: raw.description || null,
    hiringOrganization: raw.hiringOrganization?.name || null,
    compensation: {
      currency: baseSalary.currency || baseSalary?.currencyCode || null,
      min: baseSalary.value?.minValue || null,
      max: baseSalary.value?.maxValue || null,
      period: baseSalary.value?.unitText || null
    },
    jobLocation: raw.jobLocation || raw.jobLocationType || null,
    employmentType: raw.employmentType || null,
    datePosted: raw.datePosted || null
  };
}

function normalizeHeading(value = '') {
  return value.replace(/[^A-Za-z0-9 ]+/g, ' ').trim();
}

function buildSelector(element) {
  const segments = [];
  let current = element;
  while (current && current.name && segments.length < 3) {
    const name = current.name.toLowerCase();
    const classAttr = (current.attribs && current.attribs.class) || '';
    const className = classAttr.split(/\s+/).filter(Boolean)[0];
    segments.unshift(className ? `${name}.${className}` : name);
    current = current.parent;
  }
  return segments.join(' > ');
}

function collectSectionContent($, headingEl) {
  let node = headingEl.next;
  const lines = [];
  let bulletCount = 0;
  let paragraphCount = 0;
  while (node) {
    if (node.type === 'tag' && /^h[1-4]$/i.test(node.name)) {
      break;
    }
    if (node.type === 'tag') {
      const text = $(node).text().trim();
      if (text) {
        lines.push(text);
        if (node.name === 'ul' || node.name === 'ol') {
          bulletCount += $(node).find('li').length;
        } else {
          paragraphCount += 1;
        }
      }
    }
    if (node.type === 'text') {
      const text = node.data.trim();
      if (text) {
        lines.push(text);
        paragraphCount += 1;
      }
    }
    node = node.next;
  }
  return {
    rawText: lines.join('\n'),
    bulletCount,
    paragraphCount
  };
}

module.exports = {
  analyzeJobStructure,
  extractJobSchemaSections
};
