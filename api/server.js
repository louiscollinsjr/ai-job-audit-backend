const express = require('express');
const cors = require('cors');
const multer = require('multer');
const app = express();
const port = process.env.PORT || 3000;

// Import your API handlers
const auditJobPost = require('./audit-job-post');
const analyzeJob = require('./analyze-job');
const rewriteJob = require('./rewrite-job');
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
app.use('/api/rewrite-job', rewriteJob);
app.get('/api/test', test);

// Mount routers
const auditRouter = require('./audit-router');
const rewriteRouter = require('./rewrite-router');
app.use('/api', auditRouter);
app.use('/api', rewriteRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});