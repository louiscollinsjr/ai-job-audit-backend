const { createClient } = require('@supabase/supabase-js');

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
      originalText, 
      visibilityScore, 
      feedback, 
      jsonLd, 
      userId, 
      jobTitle = 'Job Posting',
      redflags = [],
      recommendations = [],
      improved_text = null,
      categories = {}
    } = jobData;
    
    console.log('Saving job posting to reports table');
    
    // Insert job data into the reports table
    const { data, error } = await supabase
      .from('reports')
      .insert({
        userid: userId || '14e7afdf-429f-499d-86ff-37dde8b92b53',
        jobtitle: jobTitle,
        jobbody: originalText,
        original_text: originalText,
        feedback: feedback,
        totalscore: visibilityScore,
        categories: categories,
        json_ld: jsonLd,
        improved_text: improved_text,
        recommendations: recommendations,
        redflags: redflags,
        originalreport: { text: originalText },
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
      jobtitle: data.jobtitle,
      jobbody: data.jobbody,
      original_text: data.original_text,
      feedback: data.feedback,
      totalscore: data.totalscore,
      categories: data.categories,
      json_ld: data.json_ld,
      improved_text: data.improved_text,
      recommendations: data.recommendations,
      redflags: data.redflags,
      originalreport: data.originalreport,
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
      jobtitle: data.jobtitle,
      jobbody: data.jobbody,
      original_text: data.original_text,
      feedback: data.feedback,
      totalscore: data.totalscore,
      categories: data.categories,
      json_ld: data.json_ld,
      improved_text: data.improved_text,
      recommendations: data.recommendations,
      redflags: data.redflags,
      originalreport: data.originalreport,
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
