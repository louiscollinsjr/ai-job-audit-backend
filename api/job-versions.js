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
    res.status(500).json({ error: 'Failed to fetch versions', details: error.message });
  }
});

// POST create a new rewrite version for a job
router.post('/:id/versions', async (req, res) => {
  try {
    const jobId = req.params.id;
    const { improved_text } = req.body || {};

    if (!jobId) {
      return res.status(400).json({ error: 'job_id is required' });
    }
    if (!improved_text || typeof improved_text !== 'string') {
      return res.status(400).json({ error: 'improved_text is required and must be a string' });
    }

    // Determine the next version_number per job
    const { data: latest, error: latestErr } = await supabase
      .from('rewrite_versions')
      .select('version_number')
      .eq('job_id', jobId)
      .order('version_number', { ascending: false })
      .limit(1);
    if (latestErr) throw latestErr;

    const nextVersion = Array.isArray(latest) && latest.length > 0 && typeof latest[0]?.version_number === 'number'
      ? latest[0].version_number + 1
      : 1;

    const insertRow = {
      job_id: jobId,
      improved_text,
      version_number: nextVersion,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('rewrite_versions')
      .insert([insertRow])
      .select('*')
      .single();

    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) {
    console.error('Error creating rewrite version:', error);
    return res.status(500).json({ error: 'Failed to save version', details: error.message });
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
