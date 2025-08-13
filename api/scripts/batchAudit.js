/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const AUTH_BEARER = process.env.AUTH_BEARER || '';
const urlsFile = process.argv[2] || 'tests/urls.txt';

// Use global fetch if available (Node 18+), else try node-fetch (optional).
async function ensureFetch() {
  if (typeof fetch === 'function') return fetch;
  try {
    const nf = require('node-fetch'); // npm i node-fetch@2
    return nf;
  } catch {
    throw new Error('fetch is not available. Use Node 18+ or: npm i node-fetch@2');
  }
}

async function postAudit(fetchFn, url) {
  const t0 = Date.now();
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_BEARER) headers.Authorization = `Bearer ${AUTH_BEARER}`;

  const res = await fetchFn(`${BASE}/api/audit-job-post`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url }),
  });

  const text = await res.text();
  const elapsedMs = Date.now() - t0;

  let json, err;
  try { json = JSON.parse(text); } catch (e) { err = `Non-JSON: ${text.slice(0, 500)}`; }

  return { url, status: res.status, elapsedMs, json, err };
}

function slugify(s) {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// Extract totalScore and per-category scores, tolerating different shapes.
function extractScores(obj) {
  if (!obj || typeof obj !== 'object') return { totalScore: null, categories: {} };

  const totalScore =
    obj.totalScore ??
    obj.score ??
    (typeof obj.overallScore === 'number' ? obj.overallScore : null);

  // Find category container
  const container =
    obj.categoryScores ||
    obj.categories ||
    obj.breakdown ||
    obj.scores ||
    null;

  const categories = {};
  if (container && typeof container === 'object') {
    for (const [k, v] of Object.entries(container)) {
      if (v && typeof v === 'object' && 'score' in v && typeof v.score === 'number') {
        categories[k] = v.score;
      } else if (typeof v === 'number') {
        categories[k] = v;
      }
    }
  }
  return { totalScore, categories };
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCSV(filePath, rows, dynamicCategoryKeys) {
  const headers = ['url', 'status', 'elapsedMs', 'totalScore', ...dynamicCategoryKeys, 'suggestionsCount', 'error'];
  const lines = [headers.map(csvEscape).join(',')];

  for (const r of rows) {
    const { url, status, elapsedMs, totalScore, categories, suggestionsCount, err } = r;
    const catVals = dynamicCategoryKeys.map(k => (k in categories ? categories[k] : ''));
    const cols = [
      url,
      status,
      elapsedMs,
      totalScore ?? '',
      ...catVals,
      suggestionsCount ?? '',
      err ? String(err).slice(0, 300) : '',
    ].map(csvEscape);
    lines.push(cols.join(','));
  }

  fs.writeFileSync(filePath, lines.join('\n'));
}

async function main() {
  const fetchFn = await ensureFetch();

  const rawDir = path.join('results', 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync('tests', { recursive: true });

  if (!fs.existsSync(urlsFile)) {
    console.error(`Missing ${urlsFile}. Create it with one URL per line.`);
    process.exit(1);
  }

  const urls = fs.readFileSync(urlsFile, 'utf8')
    .split('\n').map(s => s.trim()).filter(Boolean);

  if (!urls.length) {
    console.error('No URLs found to test.');
    process.exit(1);
  }

  console.log(`Running batch audit:
  - Base URL: ${BASE}
  - Concurrency: ${CONCURRENCY}
  - URLs: ${urls.length}
  - Auth: ${AUTH_BEARER ? 'Bearer (env)' : 'none'}
  `);

  const queue = urls.slice();
  const results = [];

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const r = await postAudit(fetchFn, url);
        const { totalScore, categories } = extractScores(r.json);
        const suggestionsCount = Array.isArray(r.json?.suggestions) ? r.json.suggestions.length : '';

        const row = {
          url: r.url,
          status: r.status,
          elapsedMs: r.elapsedMs,
          totalScore,
          categories,
          suggestionsCount,
          err: r.err || (r.status !== 200 ? `HTTP ${r.status}` : ''),
        };
        results.push(row);

        const slug = slugify(url);
        fs.writeFileSync(
          path.join(rawDir, `${results.length}-${slug}.json`),
          JSON.stringify({ meta: row, response: r.json }, null, 2)
        );
        console.log(`[${results.length}/${urls.length}] ${url} -> ${r.status} ${r.elapsedMs}ms total=${totalScore ?? 'n/a'}`);
      } catch (e) {
        const row = { url, status: 0, elapsedMs: 0, totalScore: null, categories: {}, suggestionsCount: '', err: e.message };
        results.push(row);
        const slug = slugify(url);
        fs.writeFileSync(path.join(rawDir, `${results.length}-${slug}.json`), JSON.stringify({ meta: row }, null, 2));
        console.warn(`Error for ${url}: ${e.message}`);
      }
    }
  });

  await Promise.all(workers);

  // Aggregate stats
  const ok = results.filter(r => r.status === 200 && r.totalScore != null);
  const dynamicCategoryKeys = Array.from(
    results.reduce((set, r) => {
      Object.keys(r.categories || {}).forEach(k => set.add(k));
      return set;
    }, new Set())
  ).sort();

  const perCat = {};
  for (const r of ok) {
    for (const [k, v] of Object.entries(r.categories)) {
      if (!perCat[k]) perCat[k] = [];
      if (typeof v === 'number') perCat[k].push(v);
    }
  }

  const perCategoryAvg = Object.fromEntries(
    Object.entries(perCat).map(([k, arr]) => [k, arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null])
  );

  const summary = {
    total: results.length,
    success: ok.length,
    fail: results.length - ok.length,
    avgTotal: ok.length ? +(ok.reduce((a, r) => a + (r.totalScore || 0), 0) / ok.length).toFixed(2) : null,
    perCategoryAvg,
    errors: results.filter(r => r.status !== 200 || r.err).map(r => ({ url: r.url, status: r.status, err: r.err })).slice(0, 50),
  };

  fs.writeFileSync('results/summary.json', JSON.stringify(summary, null, 2));
  writeCSV('results/summary.csv', results, dynamicCategoryKeys);

  console.log('Wrote:', {
    rawDir,
    summaryJson: 'results/summary.json',
    summaryCsv: 'results/summary.csv',
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});