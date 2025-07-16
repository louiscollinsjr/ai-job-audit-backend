const { chromium } = require('playwright');
const OpenAI = require('openai');
const { execSync } = require('child_process');
const { supabase } = require('../utils/supabase'); // Import the supabase service client

// Initialize OpenAI
let openai;
try {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI;
  if (!apiKey) {
    throw new Error('OpenAI API key is missing in environment variables');
  }
  openai = new OpenAI({ apiKey });
  console.log('OpenAI client initialized successfully');
} catch (error) {
  console.error('Failed to initialize OpenAI client:', error.message);
  throw error;
}

// Ensure browser is installed
try {
  console.log('Checking if Playwright browsers are installed...');
  execSync('npx playwright install chromium --with-deps', { stdio: 'inherit' });
  console.log('Playwright browser installation verified');
} catch (error) {
  console.error('Failed to install Playwright browsers:', error.message);
}

// --- 7-Category, 100-Point Rubric Implementation ---

// Utility: Call OpenAI with robust error handling
async function callLLM(prompt, temperature = 0.2) {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-2025-04-14",
    messages: [
      { role: "system", content: "You are an expert AI job posting auditor. Respond ONLY in valid JSON." },
      { role: "user", content: prompt }
    ],
    max_tokens: 800,
    temperature,
  });
  return response.choices[0].message.content.trim();
}

// 1. Clarity & Readability (20 pts)
async function scoreClarityReadability({ job_title, job_body }) {
  // Deterministic: avg sentence length
  const sentences = job_body.match(/[^.!?]+[.!?]+/g) || [];
  const avgLen = sentences.length ? job_body.length / sentences.length : job_body.length;
  let sentenceScore = avgLen < 22 ? 7 : avgLen < 28 ? 4 : 1;

  // LLM: title clarity, fluff
  const prompt = `Assess the following job posting for (a) title clarity, (b) fluff/buzzwords, (c) overall readability. Give each a score 0-10 and a suggestion if <8. Respond as JSON: {"title": {"score": n, "suggestion": "..."}, "fluff": {"score": n, "suggestion": "..."}, "readability": {"score": n, "suggestion": "..."}}\nJob Title: ${job_title}\nJob Body: ${job_body}`;
  let llm;
  try { llm = JSON.parse(await callLLM(prompt)); } catch { llm = {title:{score:5},fluff:{score:5},readability:{score:5}}; }
  const total = Math.round((llm.title.score + llm.fluff.score + llm.readability.score + sentenceScore) / 4 * 2);
  return {
    score: Math.min(total, 20), maxScore: 20,
    breakdown: { title: llm.title.score, fluff: llm.fluff.score, readability: llm.readability.score, sentenceScore },
    suggestions: [llm.title.suggestion, llm.fluff.suggestion, llm.readability.suggestion].filter(Boolean)
  };
}

// 2. Prompt Alignment (20 pts)
async function scorePromptAlignment({ job_title, job_body }) {
  const prompt = `Evaluate if this job posting matches how a user would phrase a search (prompt alignment), logical grouping of skills/role/location, and natural query structure. Score each 0-10, suggestion if <8. Respond as JSON: {"query_match":{"score":n,"suggestion":"..."},"grouping":{"score":n,"suggestion":"..."},"structure":{"score":n,"suggestion":"..."}}\nJob Title: ${job_title}\nJob Body: ${job_body}`;
  let llm;
  try { llm = JSON.parse(await callLLM(prompt)); } catch { llm = {query_match:{score:5},grouping:{score:5},structure:{score:5}}; }
  const total = Math.round((llm.query_match.score + llm.grouping.score + llm.structure.score) / 3 * 2);
  return {
    score: Math.min(total, 20), maxScore: 20,
    breakdown: { queryMatch: llm.query_match.score, grouping: llm.grouping.score, structure: llm.structure.score },
    suggestions: [llm.query_match.suggestion, llm.grouping.suggestion, llm.structure.suggestion].filter(Boolean)
  };
}

// 3. Structured Data Presence (15 pts)
function scoreStructuredDataPresence({ job_html }) {
  let score = 0, suggestions = [];
  try {
    const schemaMatch = job_html && job_html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/);
    if (!schemaMatch) { suggestions.push('No schema.org/JobPosting JSON-LD found.'); return {score, maxScore:15, breakdown:{}, suggestions}; }
    const json = JSON.parse(schemaMatch[1]);
    const required = ['job_title','datePosted','description','hiringOrganization','jobLocation'];
    let found = 0;
    required.forEach(k=>{ if(json[k]) found++; else suggestions.push(`Missing schema property: ${k}`); });
    score = Math.round((found/required.length)*15);
    if (score<15) suggestions.push('Make schema.org/JobPosting JSON-LD complete.');
    return { score, maxScore:15, breakdown:{found}, suggestions };
  } catch { suggestions.push('Invalid or unparsable schema.org/JobPosting JSON-LD.'); return {score, maxScore:15, breakdown:{}, suggestions}; }
}

// 4. Recency & Freshness (10 pts)
function scoreRecencyFreshness({ job_html, job_body }) {
  let score = 0, suggestions = [];
  let date = null;
  try {
    const match = job_html && job_html.match(/"datePosted"\s*:\s*"([0-9T:-]+)"/);
    if (match) date = new Date(match[1]);
  } catch {}
  if (!date) {
    const textMatch = job_body.match(/(\d{4}-\d{2}-\d{2})/);
    if (textMatch) date = new Date(textMatch[1]);
  }
  if (date) {
    const age = (Date.now() - date.getTime())/864e5;
    if (age < 30) score = 10;
    else if (age < 90) { score = 7; suggestions.push('Older than 30 days.'); }
    else { score = 4; suggestions.push('Older than 90 days.'); }
  } else {
    suggestions.push('No posting date found.');
    score = 3;
  }
  if (/(hiring\s*now|immediate|start\s*ASAP|\b2025\b|\bJune\b)/i.test(job_body)) score += 1;
  return { score: Math.min(score,10), maxScore: 10, breakdown: { date }, suggestions };
}

// 5. Keyword Targeting (15 pts)
function scoreKeywordTargeting({ job_title, job_body }) {
  let score = 0, suggestions = [];
  // Simple deterministic: check for role, level, location, skills, modality
  const role = /(engineer|developer|designer|manager|analyst|lead|director|scientist)/i.test(job_title+job_body);
  const level = /(senior|junior|lead|principal|entry|mid|staff)/i.test(job_title+job_body);
  const location = /(remote|hybrid|onsite|[A-Z][a-z]+,?\s?[A-Z]{2})/i.test(job_title+job_body);
  const skills = /(python|javascript|react|sql|aws|typescript|java|node|cloud|ml|ai)/i.test(job_title+job_body);
  const modality = /(full[-\s]?time|part[-\s]?time|contract|internship|permanent)/i.test(job_title+job_body);
  if (role) score += 3; else suggestions.push('No clear role keyword.');
  if (level) score += 3; else suggestions.push('No level keyword.');
  if (location) score += 3; else suggestions.push('No location keyword.');
  if (skills) score += 3; else suggestions.push('No skills keyword.');
  if (modality) score += 3; else suggestions.push('No modality keyword.');
  return { score, maxScore: 15, breakdown: { role, level, location, skills, modality }, suggestions };
}

// 6. Compensation Transparency (10 pts)
function scoreCompensationTransparency({ job_body }) {
  let score = 0, suggestions = [];
  if (/\$\d{2,3}[,\d]*\b/.test(job_body)) score = 10;
  else if (/(competitive|market rate|DOE|negotiable|commensurate)/i.test(job_body)) { score = 6; suggestions.push('Vague compensation term. Specify a range.'); }
  else suggestions.push('No compensation info found.');
  return { score, maxScore: 10, breakdown: {}, suggestions };
}

// 7. Page Context & Cleanliness (10 pts)
function scorePageContextCleanliness({ job_html, job_body }) {
  let score = 0, suggestions = [];
  // Heuristic: text-to-html ratio, header/list count
  const textLen = job_body.length;
  const htmlLen = job_html ? job_html.length : textLen;
  const ratio = textLen/htmlLen;
  if (ratio > 0.35) score += 4;
  else suggestions.push('Page may have excessive HTML/clutter.');
  const headers = (job_html && job_html.match(/<h[1-6][^>]*>/g) || []).length;
  const lists = (job_html && job_html.match(/<li[^>]*>/g) || []).length;
  if (headers > 1) score += 3; else suggestions.push('Add more headers for readability.');
  if (lists > 2) score += 3; else suggestions.push('Add more bullet points/lists.');
  return { score: Math.min(score,10), maxScore: 10, breakdown: { ratio, headers, lists }, suggestions };
}

// --- END 7-Category, 100-Point Rubric Implementation ---


// Express handler
module.exports = async function(req, res) {
  // --- CORS logic ---
  // --- CORS logic: allow all origins for dev ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  // --- END CORS logic ---
  // --- END CORS logic ---

  console.log('Received request to /api/audit-job-post');
  console.log('Environment variables status:', {
    hasOpenAI: !!process.env.OPENAI_API_KEY || !!process.env.VITE_OPENAI
  });

  // Your existing handler logic but with standard Playwright
  const { url, text } = req.body;
  
  if (!url && !text) {
    return res.status(400).json({
      error: 'Missing input',
      message: 'Please provide either url or text in the request body'
    });
  }

  let job_title = null;
  let job_body = null;
  let job_html = null;

  if (url) {
    try {
      console.log('Launching Chromium for URL scraping - START');
      console.log('Chromium launch options:', { args: ['--no-sandbox'], headless: true, timeout: 60000 });
      
      try {
        // More resilient browser launch with multiple fallback options
        let browser;
        try {
          browser = await chromium.launch({
            args: ['--no-sandbox'],
            headless: true, 
            timeout: 60000
          });
          console.log('Chromium launched successfully with default options');
        } catch (err) {
          console.log('First launch attempt failed, trying with explicit download:', err.message);
          // Try to install browser again if first launch fails
          try {
            execSync('npx playwright install chromium --with-deps', { stdio: 'inherit' });
            browser = await chromium.launch({
              args: ['--no-sandbox'], 
              headless: true,
              timeout: 60000
            });
            console.log('Chromium launched successfully after explicit installation');
          } catch (secondErr) {
            throw new Error(`Browser launch failed after installation attempt: ${secondErr.message}`);
          }
        }
        
        console.log('Firefox launch successful');
        
        console.log('Creating new page - START');
        const page = await browser.newPage();
        console.log('Creating new page - END');
        
        console.log(`Navigating to URL: ${url} - START`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log('Navigation complete');
        
        console.log('Getting page title - START');
        job_title = await page.title();
        console.log(`Page title: ${job_title}`);
        
        console.log('Extracting page content - START');
        job_body = await page.evaluate(() => {
          const main = document.querySelector('main') || document.body;
          return main.innerText;
        });
        console.log(`Extracted content length: ${job_body.length} characters`);
        
        console.log('Getting page HTML - START');
        job_html = await page.content();
        console.log('Page HTML extracted successfully');
        
        console.log('Closing browser - START');
        await browser.close();
        console.log('Browser closed successfully');
      } catch (error) {
        console.error('Browser error:', error);
        return res.status(500).json({ error: 'Failed to scrape URL', details: error.message });
      }
    } catch (error) {
      console.error('Browser error:', error);
      return res.status(500).json({ error: 'Failed to scrape URL', details: error.message });
    }
  } else if (text) {
    try {
      console.log('Starting text analysis');
      job_body = text;
      job_title = "Job Posting Text Analysis";
      
      console.log('Text analysis completed');
    } catch (error) {
      console.error('Text analysis error:', error);
      return res.status(500).json({ error: 'Failed to analyze text', details: error.message });
    }
  }

  // --- 7-Category Audit ---
  try {
    const jobData = { job_title, job_body, job_html };
    const [clarity, promptAlignment] = await Promise.all([
      scoreClarityReadability(jobData),
      scorePromptAlignment(jobData)
    ]);
    const structuredData = scoreStructuredDataPresence(jobData);
    const recency = scoreRecencyFreshness(jobData);
    const keywordTargeting = scoreKeywordTargeting(jobData);
    const compensation = scoreCompensationTransparency(jobData);
    const pageContext = scorePageContextCleanliness(jobData);
    const total_score =
      clarity.score + promptAlignment.score + structuredData.score +
      recency.score + keywordTargeting.score + compensation.score + pageContext.score;
    const categories = {
      clarity,
      promptAlignment,
      structuredData,
      recency,
      keywordTargeting,
      compensation,
      pageContext
    };
    const red_flags = Object.entries(categories)
      .filter(([k, v]) => v.score < v.maxScore * 0.5)
      .map(([k]) => k);
    const recommendations = Object.values(categories).flatMap(c => c.suggestions).filter(Boolean);
    // Compose a feedback string for the frontend (simple summary)
    const feedback = `This job posting scored ${total_score}/100. Key areas for improvement: ${recommendations.length ? recommendations.join('; ') : 'none'}.`;
    // Ensure all categories have a suggestions array
    for (const cat of Object.values(categories)) {
      if (!Array.isArray(cat.suggestions)) cat.suggestions = [];
    }
    
    // Save to database - use service role key to bypass RLS
    let reportId = null;
    let userId = null;
    
    // Check if we have an auth header with a user token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const { data: userData, error: authError } = await supabase.auth.getUser(token);
        if (!authError && userData && userData.user) {
          userId = userData.user.id;
          console.log('Authenticated user ID:', userId);
        }
      } catch (authErr) {
        console.error('Error checking auth token:', authErr);
      }
    }
    
    // Create database record
    try {
      const reportData = {
        userid: userId || null, // Explicitly set to null for anonymous users
        job_title,
        job_body,
        feedback,
        total_score,
        categories,
        recommendations,
        red_flags,
        savedat: new Date().toISOString(),
        source: 'api',
        original_text: job_body,
        original_report: JSON.stringify(jobData)
      };
      
      console.log('Saving report to database with service role key...');
      const { data: savedReport, error: reportError } = await supabase
        .from('reports')
        .insert([reportData])
        .select('id')
        .single();
      
      if (reportError) {
        console.error('Error saving report to database:', reportError);
      } else {
        console.log('Report saved successfully with ID:', savedReport.id);
        reportId = savedReport.id;
      }
    } catch (dbError) {
      console.error('Exception saving report to database:', dbError);
    }
    
    // Return response with ID if available
    const response = {
      id: reportId, // Include the database ID
      total_score,
      categories,
      red_flags,
      recommendations,
      job_title,
      job_body,
      feedback,
      saved_at: new Date().toISOString(),
      original_report: {}
    };
    res.json(response);
  } catch (error) {
    console.error('Audit error:', error);
    res.status(500).json({ error: 'Failed to audit job posting', details: error.message });
  }
};