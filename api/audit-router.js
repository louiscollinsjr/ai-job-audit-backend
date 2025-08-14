const express = require('express');
const router = express.Router();

// Import route handlers
const auditJobPost = require('./audit-job-post');
const analyzeJob = require('./analyze-job');

// Define routes without embedding '/v1' since this router is mounted at '/api/v1'
router.post('/audit-job', auditJobPost);
router.post('/analyze-job', analyzeJob);

module.exports = router;
