const { supabase } = require('../utils/supabase');

function slugify(value = '') {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'unknown-company';
}

async function getFingerprint(companyName) {
  if (!companyName) {
    return null;
  }
  const slug = slugify(companyName);
  try {
    const { data, error } = await supabase
      .from('company_fingerprints')
      .select('fingerprint')
      .eq('company_slug', slug)
      .single();
    if (error) {
      return null;
    }
    return data?.fingerprint || null;
  } catch (error) {
    return null;
  }
}

async function upsertFingerprint(companyName, fingerprint) {
  if (!companyName || !fingerprint) {
    return null;
  }
  const slug = slugify(companyName);
  const payload = {
    company_slug: slug,
    fingerprint,
    updated_at: new Date().toISOString(),
    version: fingerprint.version || 1
  };
  try {
    const { data, error } = await supabase
      .from('company_fingerprints')
      .upsert(payload, { onConflict: 'company_slug' })
      .select('fingerprint')
      .single();
    if (error) {
      const message = `[ERROR] fingerprintService: Failed to upsert fingerprint for slug "${slug}"`; 
      throw new Error(`${message}: ${error.message || error}`, { cause: error });
    }
    return data?.fingerprint || fingerprint;
  } catch (error) {
    const message = `[ERROR] fingerprintService: Exception during fingerprint upsert for company "${companyName}" (slug: ${slug})`;
    throw new Error(`${message}: ${error?.message || error}`, { cause: error });
  }
}

function deriveFingerprint(analysis) {
  const sections = analysis?.detectedSections || [];
  const tone = analysis?.tone || {};
  const formatting = analysis?.formatting || {};
  const lexicalAnchors = collectAnchors(sections);
  return {
    version: 1,
    sectionOrder: sections.map((section) => section.label).filter(Boolean),
    headingAliases: mapAliases(sections),
    tone,
    formatting,
    lexicalAnchors,
    selectors: sections
      .map((section) => section.selector)
      .filter(Boolean),
    lastSeen: new Date().toISOString()
  };
}

function mapAliases(sections) {
  return sections.reduce((acc, section) => {
    if (!section.label) {
      return acc;
    }
    const key = section.label.toLowerCase();
    const existing = acc[key] || [];
    const variants = new Set(existing);
    if (section.headingText) {
      variants.add(section.headingText.trim());
    }
    if (section.selector) {
      variants.add(section.selector);
    }
    acc[key] = Array.from(variants);
    return acc;
  }, {});
}

function collectAnchors(sections) {
  const anchors = new Set();
  sections.forEach((section) => {
    if (section.headingText) {
      anchors.add(section.headingText.trim());
    }
    if (section.rawText) {
      const matches = section.rawText.match(/[A-Z][A-Za-z0-9& ]{4,}/g) || [];
      matches.forEach((match) => {
        if (match.split(' ').length <= 6) {
          anchors.add(match.trim());
        }
      });
    }
  });
  return Array.from(anchors);
}

function shouldRefreshFingerprint(existing, analysis) {
  if (!existing) {
    return true;
  }
  const newSections = analysis?.detectedSections || [];
  const existingOrder = existing.sectionOrder || [];
  if (!existingOrder.length && newSections.length) {
    return true;
  }
  const overlap = newSections.filter((section) => existingOrder.includes(section.label)).length;
  const similarity = existingOrder.length
    ? overlap / Math.max(existingOrder.length, newSections.length || 1)
    : 0;
  return similarity < 0.6;
}

async function ensureFingerprint(companyName, analysis) {
  const cached = await getFingerprint(companyName);
  if (!analysis) {
    return cached;
  }
  if (!cached || shouldRefreshFingerprint(cached, analysis)) {
    const derived = deriveFingerprint(analysis);
    await upsertFingerprint(companyName || analysis.companyName, derived);
    return derived;
  }
  return cached;
}

module.exports = {
  getFingerprint,
  upsertFingerprint,
  deriveFingerprint,
  ensureFingerprint
};
