const express = require('express');
const router = express.Router();

// Import route handlers
const auditJobPost = require('./audit-job-post');
const analyzeJob = require('./analyze-job');

// Define routes without embedding the mount path since it's applied when the router is mounted
router.post('/audit-job', auditJobPost);
router.post('/analyze-job', analyzeJob);

module.exports = router;
