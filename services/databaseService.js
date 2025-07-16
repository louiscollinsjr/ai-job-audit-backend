const { createClient } = require('@supabase/supabase-js');
const { generateJsonLd } = require('./schemaGenerator');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Function to save job posting data to the database
async function saveJobPosting(jobData) {
  try {
    console.log('[DEBUG] saveJobPosting: Starting to save job posting');
    
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
    
    console.log('[DEBUG] saveJobPosting: Extracted data successfully', { 
      hasTitle: !!job_title, 
      hasOriginalText: !!original_text,
      hasProvidedJsonLd: !!providedJsonLd
    });
    
    // Generate JSON-LD if not provided
    let json_ld = providedJsonLd;
    if (!json_ld) {
      try {
        console.log('[DEBUG] saveJobPosting: Generating JSON-LD for:', job_title);
        
        // Use original text if available, otherwise job body
        const textToUse = original_text;
        if (!textToUse) {
          throw new Error('No job text available for JSON-LD generation');
        }
        
        // Prepare complete analysis data
        const analysisData = {
          score: visibilityScore,
          feedback: feedback,
          categories: categories,
          recommendations: recommendations,
          red_flags: red_flags,
          job_title: job_title
        };
        
        console.log('[DEBUG] saveJobPosting: Calling generateJsonLd with text length:', textToUse.length);
        json_ld = await generateJsonLd(textToUse, analysisData);
        
        if (!json_ld) {
          throw new Error('JSON-LD generation returned null');
        }
        
        console.log('[DEBUG] saveJobPosting: JSON-LD generated successfully');
      } catch (err) {
        console.error('[ERROR] saveJobPosting: JSON-LD generation failed:', err);
        
        // Create minimal valid JSON-LD as fallback
        console.log('[DEBUG] saveJobPosting: Creating minimal fallback JSON-LD');
        json_ld = {
          '@context': 'https://schema.org',
          '@type': 'JobPosting',
          description: original_text.substring(0, 500),
          title: job_title
        };
      }
    } else {
      console.log('[DEBUG] saveJobPosting: Using provided JSON-LD');
    }

    console.log('[DEBUG] saveJobPosting: Saving job posting with JSON-LD:', json_ld ? 'exists' : 'null');
    
    // Validate JSON-LD before saving
    if (json_ld) {
      try {
        // If json_ld is a string, try to parse it
        if (typeof json_ld === 'string') {
          try {
            json_ld = JSON.parse(json_ld);
            console.log('[DEBUG] saveJobPosting: Parsed JSON-LD from string');
          } catch (parseErr) {
            console.error('[ERROR] saveJobPosting: Failed to parse JSON-LD string:', parseErr);
            // Keep it as a string if it can't be parsed
          }
        }
        
        // Ensure required properties exist
        if (typeof json_ld === 'object' && !('@context' in json_ld)) {
          console.warn('[WARN] saveJobPosting: JSON-LD missing @context property, adding it');
          json_ld['@context'] = 'https://schema.org';
        }
        if (typeof json_ld === 'object' && !('@type' in json_ld)) {
          console.warn('[WARN] saveJobPosting: JSON-LD missing @type property, adding it');
          json_ld['@type'] = 'JobPosting';
        }
      } catch (validationErr) {
        console.error('[ERROR] saveJobPosting: JSON-LD validation error:', validationErr);
      }
    }

    // Prepare report data for database insertion
    const reportData = {
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
    };
    
    console.log('[DEBUG] saveJobPosting: Inserting data with JSON-LD:', !!json_ld);

    // Insert data into the 'reports' table
    const { data, error } = await supabase
      .from('reports')
      .insert([reportData])
      .select('*')
      .single();

    if (error) {
      console.error('[ERROR] saveJobPosting: Database insert error:', error);
      throw new Error(`Database operation failed: ${error.message}`);
    }
    
    console.log('[DEBUG] saveJobPosting: Job posting saved successfully with ID:', data.id);
    
    // Verify if JSON-LD was saved correctly
    if (data && data.id && json_ld && !data.json_ld) {
      console.warn('[WARN] saveJobPosting: JSON-LD might not have been saved correctly, attempting update');
      try {
        const { error: updateError } = await supabase
          .from('reports')
          .update({ json_ld })
          .eq('id', data.id);
          
        if (updateError) {
          console.error('[ERROR] saveJobPosting: Failed to update JSON-LD:', updateError);
        } else {
          console.log('[DEBUG] saveJobPosting: JSON-LD updated successfully');
          data.json_ld = json_ld; // Update the returned data
        }
      } catch (updateErr) {
        console.error('[ERROR] saveJobPosting: Error updating JSON-LD:', updateErr);
      }
    }
    
    return data;
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
