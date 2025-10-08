const { getJobPostingById } = require('../services/databaseService');
const { supabase } = require('../utils/supabase');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('[getOptimization] Failed to parse stringified array:', error.message);
      return [];
    }
  }
  return [value].filter(Boolean);
}

/**
 * GET /api/v1/optimize-job/:id
 * Retrieve cached optimization results for a specific report
 */
async function getOptimization(req, res) {
  try {
    const { id } = req.params;
    console.log('[DEBUG] getOptimization: Fetching cached optimization for report ID:', id);

    if (!id) {
      return res.status(400).json({ error: 'Report ID is required' });
    }

    let report;
    try {
      report = await getJobPostingById(id);
    } catch (error) {
      console.warn('[DEBUG] getOptimization: Report lookup failed:', error.message);
      return res.status(404).json({ error: 'Report not found' });
    }

    const { data, error } = await supabase
      .from('optimizations')
      .select('id, report_id, version_number, original_text_snapshot, optimized_text, original_score, optimized_score, change_log, unaddressed_items, created_at')
      .eq('report_id', id)
      .order('version_number', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[ERROR] getOptimization: Failed to query optimizations:', error);
      return res.status(500).json({ error: 'Failed to retrieve optimization data' });
    }

    if (!data || data.length === 0) {
      console.log('[DEBUG] getOptimization: No optimizations found for report', id);
      return res.status(404).json({ error: 'No optimization data found for this report' });
    }

    const optimization = data[0];
    const changeLog = ensureArray(optimization.change_log);
    const unaddressedItems = ensureArray(optimization.unaddressed_items);

    const originalScore = typeof optimization.original_score === 'number'
      ? optimization.original_score
      : report.total_score ?? 0;
    const optimizedScore = typeof optimization.optimized_score === 'number'
      ? optimization.optimized_score
      : originalScore;

    const payload = {
      id: optimization.id,
      report_id: optimization.report_id,
      version_number: optimization.version_number,
      originalText: optimization.original_text_snapshot || report.job_body || report.original_text || '',
      optimizedText: optimization.optimized_text || '',
      originalScore,
      optimizedScore,
      scoreImprovement: optimizedScore - originalScore,
      change_log: changeLog,
      unaddressed_items: unaddressedItems,
      appliedImprovements: changeLog,
      potentialImprovements: unaddressedItems,
      workingWell: [],
      created_at: optimization.created_at,
      lastOptimized: optimization.created_at
    };

    res.json(payload);
  } catch (error) {
    console.error('Error retrieving optimization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = getOptimization;
