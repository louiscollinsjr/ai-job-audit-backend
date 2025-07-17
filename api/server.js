const express = require('express');
const cors = require('cors');
const multer = require('multer');
const app = express();
const port = process.env.PORT || 3000;

// Import your API handlers
const auditJobPost = require('./audit-job-post');
const analyzeJob = require('./analyze-job');
const rewriteJob = require('./rewrite-job');
const generateJsonLd = require('./generate-jsonld');
const test = require('./test');
const jobVersionsRouter = require('./job-versions');

// Configure file upload
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and DOCX files are allowed'), false);
    }
  }
});

app.use(express.json());
app.use(cors({
  origin: '*', // Allow all origins for dev. For prod, use your frontend domain.
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Set up routes
app.post('/api/audit-job-post', auditJobPost);
app.post('/api/audit-job-file', upload.single('file'), auditJobPost);
app.use('/api/analyze-job', analyzeJob);
// Removed the duplicate route - now handled by rewriteRouter
app.use('/api/generate-jsonld', generateJsonLd);
app.get('/api/test', test);

// Mount routers
const auditRouter = require('./audit-router');
const rewriteRouter = require('./rewrite-job');
const reportsRouter = require('./reports-router');
app.use('/api/v1', auditRouter);
app.use('/api/v1', reportsRouter); // Mount reports router at /api/v1 path
app.use('/api/v1/rewrite-job', rewriteRouter);

// Debug all registered routes
const routes = [];
app._router.stack.forEach((middleware) => {
  if (middleware.route) {
    routes.push(`${Object.keys(middleware.route.methods).join(', ')} -> ${middleware.route.path}`);
  } else if (middleware.name === 'router') {
    middleware.handle.stack.forEach((handler) => {
      if (handler.route) {
        routes.push(`${Object.keys(handler.route.methods).join(', ')} -> ${middleware.regexp.source}${handler.route.path}`);
      }
    });
  }
});

console.log('Registered routes:', routes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});