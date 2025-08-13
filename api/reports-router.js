const express = require('express');
const router = express.Router();

// Import route handlers
const fetchUserReports = require('./fetch-user-reports');

// Define routes without redundant prefixes
// This will be mounted at /api/v1, so we need /reports path
router.get('/reports', fetchUserReports);

module.exports = router;
