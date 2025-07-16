const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
// For server-side operations that need to bypass RLS, use service role key
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// For client-like operations where RLS should apply
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase URL and Service Role Key must be set in environment variables');
}

// Create a client with the service role key for backend operations
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Create a client with anon key for operations where RLS should apply
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Get job data by ID from the database
 * @param {string} id - The job ID to retrieve
 * @returns {Promise<Object|null>} - The job data or null if not found
 */
async function getJobById(id) {
  try {
    // First try the reports table (main table with the updated snake_case fields)
    let { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();
    
    // If not found in reports, try the job_postings table
    if (error || !data) {
      const result = await supabase
        .from('job_postings')
        .select('*')
        .eq('id', id)
        .single();
        
      data = result.data;
      error = result.error;
      
      // If still not found, try the jobs table as a last resort
      if (error || !data) {
        const jobsResult = await supabase
          .from('jobs')
          .select('*')
          .eq('id', id)
          .single();
          
        data = jobsResult.data;
        error = jobsResult.error;
      }
    }
    
    if (error) throw error;
    
    // Make sure we have the required fields for JSON-LD generation
    if (data) {
      // Map different possible field names to expected properties
      return {
        id: data.id,
        jobText: data.job_body || data.original_text || data.job_text || data.text || '',
        json_ld: data.json_ld || null, // Check if JSON-LD is already available
        analysisResult: {
          score: data.total_score || data.visibilityScore || data.score || 0,
          feedback: data.feedback || '',
          recommendations: data.recommendations || [],
          red_flags: data.red_flags || data.redflags || [],
          categories: data.categories || {}
        }
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching job by ID:', error);
    return null;
  }
}

module.exports = {
  supabase,
  supabaseClient,
  getJobById
};
