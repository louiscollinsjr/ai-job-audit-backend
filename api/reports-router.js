const express = require('express');
const router = express.Router();

// Import route handlers
const fetchUserReports = require('./fetch-user-reports');

// Define routes without redundant v1 prefix
router.get('/reports', fetchUserReports);

module.exports = router;
