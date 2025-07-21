const express = require('express');
const router = express.Router();

// Import route handlers
const fetchUserReports = require('./fetch-user-reports');

// Define routes without redundant prefixes
// This will be mounted at /api/v1, so only need the empty path
router.get('/', fetchUserReports);

module.exports = router;
