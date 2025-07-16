const { createClient } = require('@supabase/supabase-js');
const { generateJsonLd } = require('./schemaGenerator');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Function to save job posting data to the database
async function saveJobPosting(jobData) {
  try {
    // Verify Supabase client is initialized
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }
    
    const { 
      original_text, 
      visibilityScore, 
      feedback, 
      json_ld: providedJsonLd, 
      userId, 
      job_title = 'Job Posting',
      red_flags = [],
      recommendations = [],
      improved_text = null,
      categories = {}
    } = jobData;
    
    // Generate JSON-LD if not provided
    let json_ld = providedJsonLd;
    if (!json_ld) {
      try {
        console.log('Generating JSON-LD for:', job_title);
        
        // Prepare complete analysis data
        const analysisData = {
          score: visibilityScore,
          feedback: feedback,
          categories: categories,
          recommendations: recommendations,
          red_flags: red_flags,
          job_title: job_title
        };
        
        json_ld = await generateJsonLd(original_text, analysisData);
        
        if (!json_ld) {
          throw new Error('JSON-LD generation returned null');
        }
        
        console.log('JSON-LD generated successfully');
      } catch (err) {
        console.error('JSON-LD generation failed:', err);
        // Create minimal valid JSON-LD as fallback
        json_ld = {
          '@context': 'https://schema.org',
          '@type': 'JobPosting',
          description: original_text.substring(0, 500),
          title: job_title
        };
      }
    }

    console.log('Saving job posting with JSON-LD:', json_ld ? 'exists' : 'null');
    
    // Insert job data into the reports table
    const { data, error } = await supabase
      .from('reports')
      .insert({
        userid: userId,
        job_title: job_title,
        job_body: original_text,
        original_text: original_text,
        feedback: feedback,
        total_score: visibilityScore,
        categories: categories,
        json_ld: json_ld,
        recommendations: recommendations,
        red_flags: red_flags,
        original_report: original_text,
        savedat: new Date().toISOString()
      })
      .select('*')
      .single();
      
    if (error) {
      console.error('Supabase error details:', error);
      throw new Error(`Database operation failed: ${error.message}`);
    }
    
    console.log('Successfully saved job posting with ID:', data.id);
    
    return {
      id: data.id,
      job_title: data.job_title,
      job_body: data.job_body,
      original_text: data.original_text,
      feedback: data.feedback,
      total_score: data.total_score,
      categories: data.categories,
      json_ld: data.json_ld,
      recommendations: data.recommendations,
      red_flags: data.red_flags,
      original_report: data.original_report,
      savedat: data.savedat
    }
  } catch (error) {
    console.error('Error in saveJobPosting:', {
      error: error.message,
      stack: error.stack,
      jobData: jobData
    });
    throw new Error(`Failed to save job posting: ${error.message}`);
  }
}

// Function to fetch job posting by ID
async function getJobPostingById(id) {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();
      
    if (error) throw new Error(`Database error: ${error.message}`);
    if (!data) throw new Error(`Job posting with ID ${id} not found`);
    
    return {
      id: data.id,
      job_title: data.job_title,
      job_body: data.job_body,
      original_text: data.original_text,
      feedback: data.feedback,
      total_score: data.total_score,
      categories: data.categories,
      json_ld: data.json_ld,
      recommendations: data.recommendations,
      red_flags: data.red_flags,
      original_report: data.original_report,
      savedat: data.savedat
    };
  } catch (error) {
    console.error('Error fetching job posting:', error);
    throw new Error(`Failed to fetch job posting: ${error.message}`);
  }
}

// Function to update job posting with improved text
async function updateJobPosting(id, updates) {
  try {
    const { error } = await supabase
      .from('reports')
      .update(updates)
      .eq('id', id);
      
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error updating job:', error);
    throw new Error(`Failed to update job posting: ${error.message}`);
  }
}

module.exports = {
  saveJobPosting,
  getJobPostingById,
  updateJobPosting
};
