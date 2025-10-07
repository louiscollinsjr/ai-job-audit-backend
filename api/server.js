const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const app = express();
const port = process.env.PORT || 3000;

// Trust proxy headers (e.g., X-Forwarded-For) when behind a proxy/load balancer
app.set('trust proxy', 1);

// Import your API handlers
const auditJobPost = require('./audit-job-post');
const analyzeJob = require('./analyze-job');
const rewriteJob = require('./rewrite-job');
const generateJsonLd = require('./generate-jsonld');
const test = require('./test');
const jobVersionsRouter = require('./job-versions');
const analyzeTextRouter = require('./analyze-text');
const optimizeJobRouter = require('./optimize-job');
const getOptimizationRoute = require('./get-optimization');

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

// Lightweight, configurable rate limiting for expensive endpoints
const RL_ENABLED = !/^(0|false|off)$/i.test(String(process.env.RATE_LIMIT_ENABLED ?? '1').trim());
const RL_WINDOW_MS = (() => {
  const v = (process.env.RATE_LIMIT_WINDOW_MS ?? '60000').trim();
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 60000;
})();
const RL_MAX_USER = (() => {
  const v = (process.env.RATE_LIMIT_MAX_USER ?? '10').trim();
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();
const RL_MAX_IP = (() => {
  const v = (process.env.RATE_LIMIT_MAX_IP ?? '30').trim();
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 30;
})();

const expensiveRouteLimiter = rateLimit({
  windowMs: RL_WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !RL_ENABLED,
  keyGenerator: (req, res) => {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      return crypto.createHash('sha256').update(token).digest('hex');
    }
    // Fallback to IP
    return req.ip;
  },
  max: (req, res) => {
    const hasAuth = typeof req.headers['authorization'] === 'string' && req.headers['authorization'].startsWith('Bearer ');
    return hasAuth ? RL_MAX_USER : RL_MAX_IP;
  }
});

// Timeout middleware for expensive operations
const timeoutMiddleware = (timeoutMs) => (req, res, next) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error(`Request timeout after ${timeoutMs}ms for ${req.path}`);
      res.status(408).json({ 
        error: 'Request timeout', 
        message: 'The request took too long to process. Please try again.' 
      });
    }
  }, timeoutMs);
  
  res.on('finish', () => clearTimeout(timeout));
  res.on('close', () => clearTimeout(timeout));
  next();
};

// Set up routes
app.post('/api/audit-job-post', timeoutMiddleware(210000), expensiveRouteLimiter, auditJobPost);
// Apply limiter before file upload to prevent unnecessary file processing
app.post('/api/audit-job-file', expensiveRouteLimiter, upload.single('file'), auditJobPost);
app.use('/api/analyze-job', analyzeJob);
// JSON-LD generator routes (keep unversioned for backward compat; also mount under v1)
app.use('/api/generate-jsonld', generateJsonLd);
app.get('/api/test', test);

// Mount routers
const auditRouter = require('./audit-router');
const rewriteRouter = require('./rewrite-job');
const reportsRouter = require('./reports-router');
app.use('/api/v1', auditRouter);
app.use('/api/v1', reportsRouter); // Mount reports router at /api/v1 path
app.use('/api/v1/rewrite-job', rewriteRouter);
app.use('/api/v1/generate-jsonld', generateJsonLd);
app.use('/api/v1/job', jobVersionsRouter);
app.use('/api/v1/analyze-text', analyzeTextRouter);
app.use('/api/v1/optimize-job', optimizeJobRouter);
app.get('/api/v1/optimize-job/:id', getOptimizationRoute);

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