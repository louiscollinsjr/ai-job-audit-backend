/*
  Usage:
    node api/scripts/greenhouse-example.js "https://page-with-greenhouse-iframe.example"

  Env (optional):
    PW_DEBUG=1          # show browser
    PW_HEADLESS=0       # disable headless explicitly
    PLAYWRIGHT_UA=...   # override user agent
    PLAYWRIGHT_LOCALE=en-US
    PLAYWRIGHT_TZ=UTC
*/

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('Please provide a URL to a page that embeds a Greenhouse job board iframe.');
    process.exit(1);
  }

  const isDebug = process.env.PW_DEBUG === '1';
  const headlessOpt = isDebug ? false : (process.env.PW_HEADLESS ? !/^(0|false)$/i.test(process.env.PW_HEADLESS) : true);
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled'
  ];

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

  let browser;
  try {
    browser = await chromium.launch({ args: launchArgs, headless: headlessOpt, timeout: 60000 });
  } catch (err) {
    console.error('First launch attempt failed:', err.message);
    console.log('Trying to reinstall Chromium...');
    const { execSync } = require('child_process');
    try {
      const allowRuntimeInstall = process.env.NODE_ENV !== 'production' && !/^(0|false|off)$/i.test(String(process.env.PW_ALLOW_RUNTIME_INSTALL ?? '0'));
      if (!allowRuntimeInstall) {
        throw new Error('Runtime browser installation is disabled. Enable with PW_ALLOW_RUNTIME_INSTALL=1 in non-production or install at build time.');
      }
      // Avoid installing system deps at runtime; assume container has OS deps
      execSync('npx playwright install chromium', { stdio: 'inherit' });
      browser = await chromium.launch({ args: launchArgs, headless: headlessOpt, timeout: 60000 });
    } catch (e2) {
      console.error('Launch failed after reinstall:', e2.message);
      process.exit(1);
    }
  }

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
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  console.log('[example] Navigating to:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  let jobTitle = await page.title();
  let jobText = '';
  let jobHtml = '';

  // Try Greenhouse iframe(s)
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
      await ghFrame.waitForSelector('h1, .app-title, .job-title, main, #content', { timeout: 15000 }).catch(() => {});
      const results = await Promise.race([
        ghFrame.evaluate(() => ({
          title: (document.querySelector('h1, .app-title, .job-title')?.innerText || document.title || '').trim(),
          text: (document.querySelector('main')?.innerText || document.body?.innerText || '').trim()
        })),
        new Promise((_, rej) => setTimeout(() => rej(new Error('iframe extract timeout')), 20000))
      ]).catch(() => null);
      if (results) {
        jobTitle = results.title || jobTitle;
        jobText = results.text;
        jobHtml = await ghFrame.content();
      }
    }
  } catch (err) {
    console.warn('[example] Greenhouse iframe extraction failed:', err?.message || err);
  }

  // Fallback to top-level document
  if (!jobText || !jobHtml) {
    jobText = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      return main.innerText;
    });
    jobHtml = await page.content();
  }

  console.log('[example] Title:', jobTitle);
  console.log('[example] Text length:', jobText.length);
  console.log('[example] HTML length:', jobHtml.length);

  await context.close();
  await browser.close();
  console.log('[example] Done');
})().catch(err => {
  console.error('[example] Error:', err);
  process.exit(1);
});
