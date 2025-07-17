const express = require('express');
const router = express.Router();

// Import route handlers
const auditJobPost = require('./audit-job-post');
const analyzeJob = require('./analyze-job');

// Define routes with v1 prefix
router.post('/v1/audit-job', auditJobPost);
router.post('/v1/analyze-job', analyzeJob);

module.exports = router;
