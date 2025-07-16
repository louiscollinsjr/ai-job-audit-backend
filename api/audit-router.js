const express = require('express');
const router = express.Router();

// Import route handlers
const auditJobPost = require('./audit-job-post');
const analyzeJob = require('./analyze-job');
const rewriteJob = require('./rewrite-job');

// Define routes
router.post('/audit-job', auditJobPost);
router.post('/analyze-job', analyzeJob);
router.post('/rewrite-job', rewriteJob);

module.exports = router;
