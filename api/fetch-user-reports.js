/**
 * Handler to fetch reports for the authenticated user
 */
// Import the Supabase client from the existing utils
const { supabase } = require('../utils/supabase');

const fetchUserReports = async (req, res) => {
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
      const { data: reports, error } = await supabase
        .from('reports')
        .select('*')
        .eq('userid', userId)
        .order('savedat', { ascending: false });
        
      if (error) {
        console.error('Error fetching reports from Supabase:', error);
        return res.status(500).json({ error: 'Database error when fetching reports' });
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
};

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

module.exports = fetchUserReports;
