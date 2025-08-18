const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
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

// Ensure browser is installed (optional at boot)
try {
  if (process.env.PW_INSTALL_ON_BOOT === '1') {
    console.log('Checking if Playwright browsers are installed...');
    // Do not install system deps at runtime; assume container baked with deps
    execSync('npx playwright install chromium', { stdio: 'inherit' });
    console.log('Playwright browser installation verified');
  }
} catch (error) {
  console.error('Failed to install Playwright browsers:', error.message);
  // In production, fail fast to avoid running without a working browser
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Browser installation failed in production');
  }
}

// --- 7-Category, 100-Point Rubric Implementation ---

// Utility: Call OpenAI with robust error handling
async function callLLM(prompt) {
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-5-mini";
  const params = {
    model,
    messages: [
      { role: "system", content: "You are an expert AI job posting auditor. Output exactly one valid JSON object. No markdown, no backticks, no explanations, no extra text." },
      { role: "user", content: prompt }
    ],
    // Keep responses small and cheap; JSON payload should be compact
    max_tokens: 450,
    temperature: 1,
    top_p: 1,
    // Force the model to return a JSON object
    response_format: { type: "json_object" },
    // Helpful for auditability/rate attribution
    user: "api/audit-job-post",
    seed: 1234
  };

  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await openai.chat.completions.create(params, { timeout: 20000 });
      return response.choices[0].message.content.trim();
    } catch (err) {
      lastError = err;
      const status = (err && err.status) || (err && err.code) || 0;
      const isRetryable = status === 429 || (typeof status === 'number' && status >= 500) || /timeout/i.test(String(err && err.message));
      if (attempt < maxAttempts && isRetryable) {
        const backoffMs = 300 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
        console.warn(`LLM call failed (attempt ${attempt}/${maxAttempts}). Retrying in ${backoffMs}ms...`, err?.message || err);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// 1. Clarity & Readability (20 pts)
async function scoreClarityReadability({ job_title, job_body }) {
  // Deterministic signals
  const sentences = job_body.match(/[^.!?]+[.!?]+/g) || [];
  const words = job_body.split(/\s+/).filter(w => /\w/.test(w));
  const avgLen = sentences.length ? (words.length / sentences.length) : words.length; // avg words per sentence
  const avgWordLen = words.length ? words.reduce((s,w)=>s+w.length,0)/words.length : 0;
  const unique = new Set(words.map(w=>w.toLowerCase())).size;
  const ttr = words.length ? unique / words.length : 0; // type-token ratio

  // Map to 0-10 sub-scores
  const sentenceLenScore = avgLen <= 16 ? 10 : avgLen <= 20 ? 8 : avgLen <= 24 ? 6 : avgLen <= 28 ? 4 : 2;
  const wordLenScore = avgWordLen <= 4.7 ? 10 : avgWordLen <= 5.2 ? 8 : avgWordLen <= 5.7 ? 6 : avgWordLen <= 6.2 ? 4 : 2;
  const ttrScore = Math.max(0, Math.min(10, 10 - Math.abs((ttr || 0) - 0.5) * 20)); // best around ~0.5
  // Title-keyword coverage in first 200 words
  const stop = new Set(['the','a','an','and','or','for','with','to','of','in','on','at','by','from','as','is','are','be','we']);
  const titleTokens = (job_title||'').toLowerCase().split(/[^a-z0-9]+/).filter(t=>t && !stop.has(t));
  const first200 = words.slice(0, 200).map(w=>w.toLowerCase());
  const titleCovered = titleTokens.length ? titleTokens.filter(t=>first200.includes(t)).length / titleTokens.length : 0;
  const titleOverlapScore = Math.round(Math.max(0, Math.min(10, titleCovered * 10)));

  const detAvg = [sentenceLenScore, wordLenScore, ttrScore, titleOverlapScore]
    .filter(n=>Number.isFinite(n))
    .reduce((a,b)=>a+b,0) / 4 || 0;

  // LLM: title clarity, fluff, readability
  const prompt = `Assess this job posting for (a) title clarity, (b) fluff/buzzwords, (c) overall readability.
Return EXACT JSON: {"title":{"score":0-10,"suggestion":"string"},"fluff":{"score":0-10,"suggestion":"string"},"readability":{"score":0-10,"suggestion":"string"}}.
Score strictly, where 10 is best and 0 is worst.
Job Title: ${job_title}\nJob Body: ${job_body}`;
  let llm;
  try { llm = JSON.parse(await callLLM(prompt)); } catch { llm = {title:{score:5},fluff:{score:5},readability:{score:5}}; }

  const llmAvg = (llm.title.score + llm.fluff.score + llm.readability.score) / 3;
  const final0to10 = Math.max(0, Math.min(10, 0.5 * detAvg + 0.5 * llmAvg));
  const total = Math.round(final0to10 * 2);
  const suggestions = [llm.title?.suggestion, llm.fluff?.suggestion, llm.readability?.suggestion]
    .filter(Boolean);
  if (avgLen > 28) suggestions.push('Shorten sentences to improve readability (target < 20 words on average).');
  if (titleCovered < 0.5 && titleTokens.length) suggestions.push('Include key title terms in the opening paragraph.');
  if (ttr < 0.3) suggestions.push('Reduce repetition; vary wording.');
  if (ttr > 0.7) suggestions.push('Avoid excessive jargon; simplify language.');

  return {
    score: Math.min(total, 20), maxScore: 20,
    breakdown: { title: llm.title.score, fluff: llm.fluff.score, readability: llm.readability.score, sentenceLenScore, wordLenScore, ttrScore, titleOverlapScore },
    suggestions
  };
}

// 2. Prompt Alignment (20 pts)
async function scorePromptAlignment({ job_title, job_body }) {
  const prompt = `Evaluate prompt alignment strictly on:
1) Query Match: Would a candidate searching for this role (role + level + location) find this? Consider title specificity and whether key terms appear early in the body.
2) Grouping: Are responsibilities/requirements/benefits clearly grouped under headings and bullet points?
3) Structure: Natural, scannable flow suitable for search.
Return EXACT JSON: {"query_match":{"score":0-10,"suggestion":"string"},"grouping":{"score":0-10,"suggestion":"string"},"structure":{"score":0-10,"suggestion":"string"}}.
Job Title: ${job_title}\nJob Body: ${job_body}`;
  let llm;
  try { llm = JSON.parse(await callLLM(prompt)); } catch { llm = {query_match:{score:5},grouping:{score:5},structure:{score:5}}; }

  // Deterministic nudges
  const hasSections = /(Responsibilities|Requirements|Qualifications|Benefits|Compensation)/i.test(job_body);
  const bodyWords = job_body.split(/\s+/).filter(Boolean);
  const first100 = bodyWords.slice(0, 100).join(' ').toLowerCase();
  const roleInTitle = /(engineer|developer|designer|manager|analyst|lead|director|scientist)/i.test(job_title);
  const locationInTitle = /(remote|hybrid|onsite|[A-Z][a-z]+,?\s?[A-Z]{2})/.test(job_title);
  const earlyPresence = /(remote|hybrid|onsite|responsibilit|requirement|qualification)/i.test(first100);
  let detBonus = 0;
  if (hasSections) detBonus += 1;
  if (roleInTitle && locationInTitle) detBonus += 1;
  if (earlyPresence) detBonus += 1;
  // If completely missing sections, small penalty
  if (!hasSections) detBonus -= 1;
  // Clamp and scale
  const llmAvg = (llm.query_match.score + llm.grouping.score + llm.structure.score) / 3;
  const adjusted = Math.max(0, Math.min(10, llmAvg + Math.max(-2, Math.min(2, detBonus))));
  const total = Math.round(adjusted * 2);
  const suggestions = [llm.query_match.suggestion, llm.grouping.suggestion, llm.structure.suggestion].filter(Boolean);
  if (!hasSections) suggestions.push('Add clear sections (Responsibilities, Requirements, Benefits).');
  if (!(roleInTitle && locationInTitle)) suggestions.push('Include role, level, and location in the title.');
  return {
    score: Math.min(total, 20), maxScore: 20,
    breakdown: { queryMatch: llm.query_match.score, grouping: llm.grouping.score, structure: llm.structure.score, detBonus },
    suggestions
  };
}

// 3. Structured Data Presence (15 pts)
function scoreStructuredDataPresence({ job_html }) {
  let score = 0, suggestions = [];
  try {
    const matches = job_html ? [...job_html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)] : [];
    if (!matches.length) { suggestions.push('No schema.org/JobPosting JSON-LD found.'); return {score, maxScore:15, breakdown:{}, suggestions}; }
    let jobJson = null;
    for (const m of matches) {
      try {
        const obj = JSON.parse(m[1]);
        const candidates = Array.isArray(obj) ? obj : (obj['@graph'] || [obj]);
        const found = candidates.find(x => x['@type'] === 'JobPosting');
        if (found) { jobJson = found; break; }
      } catch {}
    }
    if (!jobJson) { suggestions.push('No JobPosting type found in JSON-LD.'); return {score, maxScore:15, breakdown:{}, suggestions}; }
    const required = ['title','datePosted','description','hiringOrganization','jobLocation'];
    const optional = ['employmentType','baseSalary','validThrough','jobLocationType','applicantLocationRequirements'];
    let foundReq = 0, foundOpt = 0;
    required.forEach(k=>{ if(jobJson[k]) foundReq++; else suggestions.push(`Missing schema property: ${k}`); });
    optional.forEach(k=>{ if(jobJson[k]) foundOpt++; });
    score = Math.round((foundReq/required.length)*12 + Math.min(foundOpt,3)); // up to 15
    if (score<15) suggestions.push('Complete schema.org/JobPosting JSON-LD with required/optional fields.');
    return { score, maxScore:15, breakdown:{ foundRequired: foundReq, foundOptional: foundOpt }, suggestions };
  } catch { suggestions.push('Invalid or unparsable schema.org/JobPosting JSON-LD.'); return {score, maxScore:15, breakdown:{}, suggestions}; }
}

// 4. Recency & Freshness (10 pts)
function scoreRecencyFreshness({ job_html, job_body }) {
  let score = 0, suggestions = [];
  let date = null;
  try {
    const match = job_html && job_html.match(/\"datePosted\"\s*:\s*\"([0-9T:-]+)\"/);
    if (match) date = new Date(match[1]);
    const timeTag = !date && job_html && job_html.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i);
    if (!date && timeTag) date = new Date(timeTag[1]);
  } catch {}
  if (!date) {
    const textMatch = job_body.match(/(\d{4}-\d{2}-\d{2})/);
    if (textMatch) date = new Date(textMatch[1]);
    const rel = !date && job_body.match(/(\d+)\s*(day|week|month)s?\s*ago/i);
    if (!date && rel) {
      const n = parseInt(rel[1],10);
      const unit = rel[2].toLowerCase();
      const days = unit.startsWith('day') ? n : unit.startsWith('week') ? n*7 : n*30;
      date = new Date(Date.now() - days*864e5);
    }
  }
  if (date && !isNaN(date)) {
    const age = (Date.now() - date.getTime())/864e5;
    if (age <= 14) score = 10;
    else if (age <= 30) { score = 8; }
    else if (age <= 60) { score = 6; suggestions.push('Older than 30 days.'); }
    else if (age <= 90) { score = 4; suggestions.push('Older than 60 days.'); }
    else { score = 2; suggestions.push('Older than 90 days.'); }
  } else {
    suggestions.push('No reliable posting date found. Add datePosted or a visible posted date.');
  }
  if (/(hiring\s*now|immediate|start\s*ASAP)/i.test(job_body)) score = Math.min(10, score + 1);
  return { score: Math.min(score,10), maxScore: 10, breakdown: { date }, suggestions };
}

// 5. Keyword Targeting (15 pts)
function scoreKeywordTargeting({ job_title, job_body }) {
  let score = 0, suggestions = [];
  const text = (job_title + ' ' + job_body).toLowerCase();
  const roleRx = /(engineer|developer|designer|manager|analyst|lead|director|scientist)/i;
  const levelRx = /(senior|junior|lead|principal|entry|mid|staff)/i;
  const locRx = /(remote|hybrid|onsite|[A-Z][a-z]+,?\s?[A-Z]{2})/;
  const modalityRx = /(full[-\s]?time|part[-\s]?time|contract|internship|permanent)/i;
  const skillsList = ['python','javascript','react','sql','aws','typescript','java','node','cloud','ml','ai','kubernetes','docker','gcp','azure','postgres','go','rust','c\+\+'];
  // Escape any regex metacharacters in skill tokens (e.g., C++, C#, Node.js)
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const skillsCount = skillsList.reduce((c, s)=> {
    const pattern = `\\b${escapeRegExp(s)}\\b`;
    return c + (new RegExp(pattern, 'i').test(text) ? 1 : 0);
  }, 0);

  const role = roleRx.test(text); const level = levelRx.test(text); const location = locRx.test(text);
  const modality = modalityRx.test(text);
  // Scoring breakdown (max 15)
  score += role ? 3 : 0; if (!role) suggestions.push('Add a clear role keyword (e.g., Engineer, Manager).');
  score += level ? 2 : 0; if (!level) suggestions.push('Specify seniority level (e.g., Senior, Mid).');
  score += location ? 3 : 0; if (!location) suggestions.push('Indicate location or modality (e.g., Remote, NYC).');
  score += modality ? 2 : 0; if (!modality) suggestions.push('Specify employment type (full-time/contract/etc.).');
  score += skillsCount >= 6 ? 5 : skillsCount >= 3 ? 4 : skillsCount >= 1 ? 2 : 0;
  if (skillsCount === 0) suggestions.push('List concrete skills/technologies relevant to the role.');
  // Title specificity bonus
  if (/(senior|junior|lead)/i.test(job_title) && roleRx.test(job_title)) score = Math.min(15, score + 1);
  return { score: Math.min(score,15), maxScore: 15, breakdown: { role, level, location, skillsCount, modality }, suggestions };
}

// 6. Compensation Transparency (10 pts)
function scoreCompensationTransparency({ job_body }) {
  let score = 0, suggestions = [];
  const text = job_body.toLowerCase();
  const currency = /\$|usd|eur|gbp|cad|aud/i.test(job_body);
  const period = /(per\s*(year|yr|annum)|per\s*(hour|hr)|hourly|annual|salary)/i.test(job_body);
  const range = job_body.match(/\$?\s?([0-9]{2,3}[,\d]*)\s*(?:-|to|–|—)\s*\$?\s?([0-9]{2,3}[,\d]*)/);
  const single = job_body.match(/\$\s?([0-9]{2,3}[,\d]*)/);
  if (range && period) {
    score = 10;
  } else if (range) {
    score = 8; if (!period) suggestions.push('Specify pay period (per year/hour).');
  } else if (single && period) {
    score = 8; suggestions.push('Provide a salary range, not a single figure.');
  } else if (/(competitive|market rate|DOE|negotiable|commensurate)/i.test(job_body)) {
    score = 5; suggestions.push('Replace vague terms with a specific range and period.');
  } else {
    score = 0; suggestions.push('Add compensation details with currency and pay period.');
  }
  if (!currency) suggestions.push('Include currency symbol or code (e.g., $, USD).');
  return { score, maxScore: 10, breakdown: { hasRange: !!range, hasPeriod: period }, suggestions };
}

// 7. Page Context & Cleanliness (10 pts)
function scorePageContextCleanliness({ job_html, job_body }) {
  let score = 0, suggestions = [];
  // Heuristic: text-to-html ratio, header/list count
  const textLen = job_body.length;
  const htmlLen = job_html ? job_html.length : textLen;
  const ratio = textLen / (htmlLen || 1);
  // Ratio graded 0-4
  const ratioScore = ratio >= 0.5 ? 4 : ratio >= 0.35 ? 3 : ratio >= 0.2 ? 2 : 0;
  if (ratioScore <= 1) suggestions.push('Increase substantive text or reduce page chrome/clutter.');
  const headers = (job_html && job_html.match(/<h[1-6][^>]*>/g) || []).length;
  const lists = (job_html && job_html.match(/<li[^>]*>/g) || []).length;
  // Headers graded 0-3
  const headerScore = headers >= 3 ? 3 : headers === 2 ? 2 : headers === 1 ? 1 : 0;
  if (headerScore < 2) suggestions.push('Use clear section headers (H2/H3) to structure content.');
  // Lists graded 0-3
  const listScore = lists >= 6 ? 3 : lists >= 3 ? 2 : lists >= 1 ? 1 : 0;
  if (listScore < 2) suggestions.push('Use bullet points for responsibilities and requirements.');
  score = Math.min(10, ratioScore + headerScore + listScore);
  return { score, maxScore: 10, breakdown: { ratio, headers, lists, ratioScore, headerScore, listScore }, suggestions };
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
      const isDebug = process.env.PW_DEBUG === '1';
      const headlessOpt = isDebug ? false : (process.env.PW_HEADLESS ? !/^(0|false)$/i.test(process.env.PW_HEADLESS) : true);
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ];
      console.log('Chromium launch options:', { args: launchArgs, headless: headlessOpt, timeout: 60000 });

      try {
        // Resilient browser launch with fallback install
        let browser;
        try {
          browser = await chromium.launch({ args: launchArgs, headless: headlessOpt, timeout: 60000 });
          console.log('Chromium launched successfully with provided options');
        } catch (err) {
          console.log('First launch attempt failed, trying reinstall:', err.message);
          try {
            // Avoid system deps at runtime; optionally allow reinstall in non-production
            const allowRuntimeInstall = process.env.NODE_ENV !== 'production' && !/^(0|false|off)$/i.test(String(process.env.PW_ALLOW_RUNTIME_INSTALL ?? '0'));
            if (!allowRuntimeInstall) {
              throw new Error('Runtime browser installation is disabled');
            }
            execSync('npx playwright install chromium', { stdio: 'inherit' });
            browser = await chromium.launch({ args: launchArgs, headless: headlessOpt, timeout: 60000 });
            console.log('Chromium launched successfully after reinstall');
          } catch (secondErr) {
            throw new Error(`Browser launch failed after installation attempt: ${secondErr.message}`);
          }
        }

        // Rotate/override user agent and realistic headers
        const uaPool = [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        ];
        function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }
        let uaIndexSeed = Math.floor(Math.random() * 1e6);
        try {
          uaIndexSeed = url ? hashStr(new URL(url).hostname + ':' + new Date().getUTCHours()) : uaIndexSeed;
        } catch {}
        const userAgent = process.env.PLAYWRIGHT_UA || uaPool[uaIndexSeed % uaPool.length];

        console.log('Creating browser context with realistic settings - START');
        const context = await browser.newContext({
          userAgent,
          locale: process.env.PLAYWRIGHT_LOCALE || 'en-US',
          timezoneId: process.env.PLAYWRIGHT_TZ || 'UTC',
          viewport: { width: 1366, height: 900 },
          deviceScaleFactor: 1.25,
          javaScriptEnabled: true,
          colorScheme: 'light',
          extraHTTPHeaders: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
          }
        });
        await context.addInitScript(() => {
          // Mild stealth: make navigator.webdriver undefined
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        console.log('Creating new page - START');
        const page = await context.newPage();
        console.log('Creating new page - END');

        console.log(`Navigating to URL: ${url} - START`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        console.log('Navigation complete');

        console.log('Getting page title - START');
        job_title = await page.title();
        console.log(`Page title: ${job_title}`);

        // Detect anti-bot/CF interstitials by title/body snippet
        const antiBotSignals = [
          /just a moment/i,
          /attention required/i,
          /cloudflare/i,
          /verify you are human/i,
          /checking your browser/i
        ];
        let bodySnippet = '';
        try {
          bodySnippet = await page.evaluate(() => (document.body?.innerText || '').slice(0, 1000));
        } catch {}
        if (antiBotSignals.some(rx => rx.test(job_title || '')) || antiBotSignals.some(rx => rx.test(bodySnippet))) {
          console.log('Anti-bot page detected', { title: job_title });
          try { await context.close(); } catch {}
          try { await browser.close(); } catch {}
          return res.status(403).json({
            error: 'site_protected',
            message: 'The target site appears protected by anti-bot (e.g., Cloudflare). Please paste the job description or upload a file instead.'
          });
        }

        // Try to access Greenhouse iframe if present
        let frameUsed = null;
        let ghFrame = null;
        try {
          await page.waitForSelector('iframe', { timeout: 8000 });
          const frames = page.frames();
          ghFrame = frames.find(f => /greenhouse\.io|boards\.greenhouse\.io|job-boards\.greenhouse\.io/i.test(f.url()));
          if (!ghFrame) {
            const ghHandle = await page.$('iframe[src*="greenhouse.io"], iframe[src*="boards.greenhouse.io"], iframe[src*="job-boards.greenhouse.io"]');
            if (ghHandle) {
              const frame = await ghHandle.contentFrame();
              if (frame) ghFrame = frame;
            }
          }
          if (ghFrame) {
            frameUsed = ghFrame;
            await ghFrame.waitForSelector('h1, .app-title, .job-title, main, #content', { timeout: 15000 }).catch(() => {});
          }
        } catch {}

        console.log('Extracting page content - START');
        if (frameUsed) {
          const results = await Promise.race([
            frameUsed.evaluate(() => ({
              title: (document.querySelector('h1, .app-title, .job-title')?.innerText || document.title || '').trim(),
              text: (document.querySelector('main')?.innerText || document.body?.innerText || '').trim()
            })),
            new Promise((_, rej) => setTimeout(() => rej(new Error('iframe extract timeout')), 20000))
          ]).catch(() => null);
          if (results) {
            job_title = results.title || job_title;
            job_body = results.text;
            job_html = await frameUsed.content();
          }
        }
        // Fallback to top-level page
        if (!job_body || !job_html) {
          job_body = await page.evaluate(() => {
            const main = document.querySelector('main') || document.body;
            return main.innerText;
          });
          job_html = await page.content();
        }
        console.log(`Extracted content length: ${job_body.length} characters`);
        console.log('Page HTML extracted successfully');

        console.log('Closing browser - START');
        await context.close();
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