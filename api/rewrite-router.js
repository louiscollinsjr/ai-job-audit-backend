const express = require('express');
const router = express.Router();
const rewriteJob = require('./rewrite-job');

// Debug middleware
router.use((req, res, next) => {
  console.log(`Incoming request to: ${req.method} ${req.originalUrl}`);
  next();
});

// Define routes - these will be mounted under /api/v1
router.post('/:id', (req, res, next) => {
  console.log('Routing to rewrite-job handler');
  rewriteJob(req, res, next);
});

router.use('/job', require('./job-versions'));

module.exports = router;
