const express = require('express');
const router = express.Router();
const { supabase } = require('../utils/supabase');

// GET all versions for a job
router.get('/:id/versions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rewrite_versions')
      .select('*')
      .eq('job_id', req.params.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

// GET all unique job_ids that have at least one rewrite version
router.get('/with-rewrites', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rewrite_versions')
      .select('job_id')
      .not('job_id', 'is', null); // Properly filter out null values

    console.log('Supabase data:', data, 'error:', error);
    
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Data is not an array');
    // Extract unique job_ids
    const uniqueIds = [...new Set(data.map(row => row.job_id))];
    res.json(uniqueIds);
  } catch (error) {
    console.error('Error fetching job_ids with rewrites:', error);
    res.status(500).json({ 
      error: 'Failed to fetch job_ids with rewrites',
      details: error.message 
    });
  }
});

module.exports = router;
