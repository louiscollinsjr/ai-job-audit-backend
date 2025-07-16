const express = require('express');
const router = express.Router();

// Import route handlers
const rewriteJob = require('./rewrite-job');
const jobVersionsRouter = require('./job-versions');

// Define routes
router.post('/rewrite-job/:id', rewriteJob);
router.use('/job', jobVersionsRouter);

module.exports = router;
