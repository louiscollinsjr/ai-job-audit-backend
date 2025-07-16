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

module.exports = router;
