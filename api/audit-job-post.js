const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const { execSync } = require('child_process');
const { supabase } = require('../utils/supabase');
const { scoreJob7Category } = require('../services/scoringService');
const { scoreJobEnhanced } = require('../services/scoringServiceV2');

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
// Scoring logic extracted to services/scoringService.js for reuse across pipelines.
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
  const { url, text, useV2Pipeline = false } = req.body;
  
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

        // Normalize accidentally escaped query chars from shell (e.g., \?gh_jid\=...)
        let navUrl = url;
        try {
          if (navUrl && navUrl.includes('\\')) {
            const cleaned = navUrl.replace(/\\(?=[?=&])/g, '');
            if (cleaned !== navUrl) {
              console.log('Normalized URL:', cleaned);
              navUrl = cleaned;
            }
          }
        } catch {}

        // Track any Greenhouse network requests while navigating/interaction
        const ghRequests = new Set();
        const ghDomainRegex = /greenhouse\.io|boards\.greenhouse\.io|job-boards\.greenhouse\.io/i;
        page.on('request', (req) => {
          try {
            const u = req.url();
            if (ghDomainRegex.test(u)) ghRequests.add(u);
          } catch {}
        });

        console.log(`Navigating to URL: ${navUrl} - START`);
        await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
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
          // Allow iframes to attach (not necessarily visible)
          await page.waitForSelector('iframe', { timeout: 20000, state: 'attached' }).catch(() => {});

          // Poll for a Greenhouse iframe by URL or DOM handle (reduced timeout)
          console.log('Checking for Greenhouse iframes - START');
          const ghRegex = /greenhouse\.io|boards\.greenhouse\.io|job-boards\.greenhouse\.io/i;
          const deadline = Date.now() + 3000; // Reduced from 25s to 3s
          const ghId = (() => { try { return new URL(navUrl).searchParams.get('gh_jid'); } catch { return null; } })();
          console.log('Greenhouse detection URL param gh_jid:', ghId);
          while (!ghFrame && Date.now() < deadline) {
            // Check existing frames by URL
            const frames = page.frames();
            ghFrame = frames.find(f => ghRegex.test(f.url())) || null;
            if (ghFrame) { console.log('[api] Found Greenhouse frame by URL:', ghFrame.url()); break; }

            // Check DOM for iframe elements and resolve contentFrame
            const ghHandle = await page.$('iframe[src*="greenhouse.io"], iframe[src*="boards.greenhouse.io"], iframe[src*="job-boards.greenhouse.io"]');
            if (ghHandle) {
              const frame = await ghHandle.contentFrame();
              if (frame) { console.log('[api] Found Greenhouse frame via handle:', frame.url()); ghFrame = frame; break; }
            }

            // If URL includes gh_jid, try to click a matching link to trigger embed
            if (ghId) {
              const clicked = await page.evaluate((jid) => {
                try {
                  const anchors = Array.from(document.querySelectorAll('a[href*="gh_jid="]'));
                  const target = anchors.find(a => {
                    try { return new URL(a.getAttribute('href'), location.href).searchParams.get('gh_jid') === jid; } catch { return false; }
                  });
                  if (target) {
                    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return true;
                  }
                } catch {}
                return false;
              }, ghId).catch(() => false);
              if (clicked) { console.log('[api] Clicked link for gh_jid:', ghId); await page.waitForTimeout(1000); }
            }

            await page.waitForTimeout(500);
          }

          if (ghFrame) {
            frameUsed = ghFrame;
            console.log('[api] Using Greenhouse iframe content from:', ghFrame.url());
            await ghFrame.waitForSelector('h1, .app-title, .job-title, main, #content', { timeout: 15000 }).catch(() => {});
          } else {
            // No iframe detected: log frames and try to navigate directly to a GH URL if present
            const allFrames = page.frames();
            console.log(`[api] No Greenhouse iframe found. Frames(${allFrames.length}):`, allFrames.map(f => f.url()).slice(0, 10));
            const ghHref = await page.evaluate(() => {
              const sel = 'a[href*="greenhouse.io"], a[href*="boards.greenhouse.io"], a[href*="job-boards.greenhouse.io"]';
              const a = document.querySelector(sel);
              return a ? a.href : null;
            }).catch(() => null);
            const ghEmbedFor = await page.evaluate(() => {
              const s = document.querySelector('script[src*="boards.greenhouse.io/embed/job_board/js?for="]');
              if (!s) return null;
              try { return new URL(s.src, location.href).searchParams.get('for'); } catch { return null; }
            }).catch(() => null);
            const navigateTo = (ghId && ghEmbedFor)
              ? `https://boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(ghEmbedFor)}&token=${encodeURIComponent(ghId)}`
              : (ghHref || Array.from(ghRequests)[0] || null);
            if (navigateTo) {
              console.log('[api] Navigating directly to Greenhouse URL:', navigateTo);
              const ghPage = await context.newPage();
              await ghPage.goto(navigateTo, { waitUntil: 'domcontentloaded', timeout: 45000 });
              await ghPage.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
              frameUsed = ghPage;
            } else if (ghRequests.size) {
              console.log('[api] Observed GH requests but no navigable link found:', Array.from(ghRequests).slice(0, 3));
            }
          }
        } catch (err) {
          console.warn('[api] Greenhouse iframe extraction failed:', err?.message || err);
        }

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
          console.log('[api] Using top-level document fallback');
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
  console.log('Starting 7-category audit analysis');
  try {
    const jobData = { job_title, job_body, job_html };
    
    let scoringResult;
    if (useV2Pipeline) {
      console.log('Routing request to ENHANCED (V2) scoring pipeline.');
      scoringResult = await scoreJobEnhanced(jobData);
    } else {
      console.log('Routing request to STANDARD (V1) scoring pipeline.');
      scoringResult = await scoreJob7Category(jobData);
    }

    const {
      total_score,
      categories,
      red_flags,
      recommendations,
      feedback
    } = scoringResult;
    console.log('Scoring completed');
    
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