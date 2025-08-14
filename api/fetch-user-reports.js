const express = require('express');
const router = express.Router();
const { supabase } = require('../utils/supabase');

/**
 * Handler to fetch reports for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    console.log('Fetching reports for authenticated user');
    
    // Get the auth token from headers
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      // Decode JWT to get user ID
      const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const userId = tokenPayload.sub;
      
      if (!userId) {
        return res.status(401).json({ error: 'Invalid authentication token' });
      }
      
      console.log(`Fetching reports for user ID: ${userId}`);
      
      // Query the Supabase database for reports belonging to this user
      console.log('Querying reports for user:', userId);
      
      // First verify the userId is a valid UUID
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(userId)) {
        throw new Error(`Invalid user ID format: ${userId}`);
      }
      
      // Build query with explicit column selection matching schema
      const { data: reports, error } = await supabase
        .from('reports')
        .select('*')
        .eq('userid', userId)
        .order('savedat', { ascending: false });
        
      if (error) {
        console.error('Supabase query error:', {
          message: error.message,
          code: error.code,
          details: error.details
        });
        return res.status(500).json({ 
          error: 'Database error',
          details: error.message 
        });
      }
      
      if (!reports) {
        console.warn('No reports found for user', userId);
        return res.status(200).json([]);
      }
      
      // Transform the database results to match the expected frontend format
      const formattedReports = reports.map(report => ({
        id: report.id,
        title: report.job_title || 'Untitled Job Post',
        company: report.company_name || 'Unknown Company',
        date: report.savedat ? new Date(report.savedat).toISOString().split('T')[0] : '',
        score: report.total_score || calculateOverallScore(report),
        status: 'Saved'
      }));
      
      console.log(`Found ${formattedReports.length} reports for user ID ${userId}`);
      return res.status(200).json(formattedReports);
    } catch (dbError) {
      console.error('Database error when fetching user reports:', dbError);
      return res.status(500).json({ error: 'Error fetching reports from database' });
    }
  } catch (error) {
    console.error('Error fetching user reports:', error);
    return res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

/**
 * Handler to fetch a single report by ID for the authenticated user
 */
router.get('/:id', async (req, res) => {
  try {
    const reportId = req.params.id;
    console.log(`Fetching report ${reportId} for authenticated user`);

    // Get the auth token from headers
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
      // Decode JWT to get user ID
      const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const userId = tokenPayload.sub;

      if (!userId) {
        return res.status(401).json({ error: 'Invalid authentication token' });
      }

      console.log(`Fetching report ${reportId} for user ID: ${userId}`);

      // Query the Supabase database for the report by ID and user ID
      const { data: report, error } = await supabase
        .from('reports')
        .select('*')
        .eq('id', reportId)
        .eq('userid', userId)
        .single();

      if (error) {
        console.error('Error fetching report from Supabase:', error);
        return res.status(500).json({ error: 'Database error when fetching report' });
      }

      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }

      // Format the report similarly to how we format in the list
      const formattedReport = {
        id: report.id,
        title: report.job_title || 'Untitled Job Post',
        company: report.company_name || 'Unknown Company',
        date: report.savedat ? new Date(report.savedat).toISOString().split('T')[0] : '',
        score: report.total_score || calculateOverallScore(report),
        status: 'Saved',
        // We might need to return the full report data? The frontend might expect more.
        // The rewrite page expects the full report with job_body and categories?
        ...report
      };

      return res.status(200).json(formattedReport);
    } catch (dbError) {
      console.error('Database error when fetching report:', dbError);
      return res.status(500).json({ error: 'Error fetching report from database' });
    }
  } catch (error) {
    console.error('Error fetching report:', error);
    return res.status(500).json({ error: 'Failed to fetch report' });
  }
});

/**
 * Helper function to calculate overall score from report data
 * Similar to the one in the frontend
 */
function calculateOverallScore(report) {
  if (report.overall_score) return report.overall_score;
  
  // If no overall score, calculate from categories if available
  if (report.categories && Array.isArray(report.categories)) {
    const scores = report.categories.map(cat => cat.score || 0);
    if (scores.length > 0) {
      return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    }
  }
  
  return 0; // Default score if no data available
}

module.exports = router;
