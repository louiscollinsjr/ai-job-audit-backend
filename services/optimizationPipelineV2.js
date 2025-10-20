const { analyzeJobStructure, extractJobSchemaSections } = require('./jobAnalysis');
const { ensureFingerprint } = require('./fingerprintService');
const { segmentIfNeeded, generateOptimizedSection, mergeSections, runCoherencePass } = require('./sections');
const { ensureJsonSafeOutput } = require('../utils/jsonGuards');
async function generateOptimizedJobPostV2({ jobText, jobHtml, originalScore, categories, reportMetadata = {} }) {
  const analysis = analyzeJobStructure({ jobHtml, jobText });
  const fingerprint = await ensureFingerprint(reportMetadata.companyName || analysis.companyName, analysis);
  const schemaSnapshot = extractJobSchemaSections({ jobHtml, jobText });

  const globalContext = {
    title: reportMetadata.title || schemaSnapshot.title || analysis.detectedSections?.[0]?.headingText,
    companyName: reportMetadata.companyName || analysis.companyName,
    tone: fingerprint?.tone,
    formatting: fingerprint?.formatting,
    originalScore,
    categories
  };

  const segments = segmentIfNeeded({ jobHtml, jobText, fingerprint });
  let optimizedSections;
  try {
    optimizedSections = await Promise.all(
      segments.map((segment) =>
        generateOptimizedSection({ section: segment, fingerprint, globalContext })
      )
    );
  } catch (error) {
    console.error('[ERROR] optimizationPipelineV2: Failed to optimize sections in parallel', {
      segmentCount: segments.length,
      message: error?.message || error
    });
    throw error;
  }

  const assembled = mergeSections(optimizedSections, fingerprint);
  const coherencePayload = await runCoherencePass({
    draft: assembled,
    globalContext,
    schemaSnapshot
  });

  const safeOutput = await ensureJsonSafeOutput(JSON.stringify({
    optimized_text: coherencePayload.optimized_text,
    change_log: [].concat(
      ...optimizedSections.map((section) => section.changeLog || []),
      coherencePayload.change_log || []
    ),
    unaddressed_items: [].concat(
      ...optimizedSections.map((section) => section.unaddressedItems || []),
      coherencePayload.unaddressed_items || []
    )
  }));

  return {
    optimizedText: safeOutput.optimized_text,
    changeLog: safeOutput.change_log,
    unaddressedItems: safeOutput.unaddressed_items,
    fingerprint,
    schemaSnapshot
  };
}

module.exports = {
  generateOptimizedJobPostV2
};
