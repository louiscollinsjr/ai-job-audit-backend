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
    categories,
    job_location: reportMetadata.job_location
  };

  const segments = segmentIfNeeded({ jobHtml, jobText, fingerprint });
  console.log('[PERF] Section optimization started:', { segmentCount: segments.length, timestamp: new Date().toISOString() });
  const sectionStartTime = Date.now();
  
  let optimizedSections;
  try {
    optimizedSections = await Promise.all(
      segments.map((segment) =>
        generateOptimizedSection({ section: segment, fingerprint, globalContext })
      )
    );
    const sectionDuration = Date.now() - sectionStartTime;
    console.log('[PERF] Section optimization completed:', { 
      segmentCount: segments.length, 
      duration: `${sectionDuration}ms`,
      avgPerSection: `${Math.round(sectionDuration / segments.length)}ms`
    });
  } catch (error) {
    console.error('[ERROR] optimizationPipelineV2: Failed to optimize sections in parallel', {
      segmentCount: segments.length,
      message: error?.message || error
    });
    throw error;
  }

  const assembled = mergeSections(optimizedSections, fingerprint);
  console.log('[PERF] Coherence pass started:', { draftLength: assembled.length, timestamp: new Date().toISOString() });
  const coherenceStartTime = Date.now();
  
  const coherencePayload = await runCoherencePass({
    draft: assembled,
    globalContext,
    schemaSnapshot
  });
  
  const coherenceDuration = Date.now() - coherenceStartTime;
  console.log('[PERF] Coherence pass completed:', { duration: `${coherenceDuration}ms` });
  
  // Validate section structure preservation
  const originalSectionCount = (assembled.match(/^#{1,3}\s+/gm) || []).length;
  const optimizedSectionCount = (coherencePayload.optimized_text.match(/^#{1,3}\s+/gm) || []).length;
  if (optimizedSectionCount < originalSectionCount) {
    console.warn('[WARN] Coherence pass reduced section count:', {
      original: originalSectionCount,
      optimized: optimizedSectionCount,
      lost: originalSectionCount - optimizedSectionCount
    });
  } else {
    console.log('[DEBUG] Section structure preserved:', {
      original: originalSectionCount,
      optimized: optimizedSectionCount
    });
  }

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
