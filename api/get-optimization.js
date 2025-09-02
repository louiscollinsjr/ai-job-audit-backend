const { getJobPostingById } = require('../services/databaseService');

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

    // Get the report from database
    const report = await getJobPostingById(id);
    console.log('[DEBUG] getOptimization: Report found:', !!report, 'Has optimization_data:', !!report?.optimization_data);
    
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Check if optimization data exists
    if (!report.optimization_data) {
      console.log('[DEBUG] getOptimization: No cached optimization data found for report', id);
      return res.status(404).json({ error: 'No optimization data found for this report' });
    }

    // Parse optimization data if it's stored as JSON string
    let optimizationData = report.optimization_data;
    if (typeof optimizationData === 'string') {
      try {
        optimizationData = JSON.parse(optimizationData);
      } catch (err) {
        console.error('Error parsing optimization data:', err);
        return res.status(500).json({ error: 'Invalid optimization data format' });
      }
    }

    res.json({
      id: report.id,
      originalText: report.original_text,
      optimizedText: optimizationData.optimizedText,
      originalScore: optimizationData.originalScore,
      optimizedScore: optimizationData.optimizedScore,
      scoreImprovement: optimizationData.scoreImprovement,
      workingWell: optimizationData.workingWell,
      appliedImprovements: optimizationData.appliedImprovements,
      potentialImprovements: optimizationData.potentialImprovements,
      lastOptimized: report.updated_at
    });
    
  } catch (error) {
    console.error('Error retrieving optimization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = getOptimization;
