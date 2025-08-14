const express = require('express');
const router = express.Router();

// Import route handlers
const fetchUserReports = require('./fetch-user-reports');

// Define routes without redundant prefixes
// This will be mounted at /api/v1, so we need /reports path
// Use router.use() so nested routes ('/' and '/:id') inside fetchUserReports work correctly
// and '/reports' is not mistaken for the ':id' param.
router.use('/reports', fetchUserReports);

module.exports = router;
