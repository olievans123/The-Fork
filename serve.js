#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DIR = __dirname;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function normalizePitchforkPath(input) {
  if (!input) return '';
  let pathOnly = String(input).trim();
  if (!pathOnly) return '';

  if (/^https?:\/\//i.test(pathOnly)) {
    try {
      const url = new URL(pathOnly);
      if (!/pitchfork\.com$/i.test(url.hostname)) return '';
      pathOnly = url.pathname;
    } catch {
      return '';
    }
  }

  if (!pathOnly.startsWith('/')) pathOnly = `/${pathOnly}`;
  pathOnly = pathOnly.replace(/[?#].*$/, '').replace(/\/{2,}/g, '/');
  if (!pathOnly.endsWith('/')) pathOnly += '/';
  return pathOnly;
}

function parseReleaseYear(value) {
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = parseInt(match[0], 10);
  const now = new Date().getFullYear();
  return year >= 1900 && year <= now + 1 ? year : null;
}

function extractReleaseYearFromHtml(html) {
  if (!html) return null;

  const stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1]);
      const releaseYear = parseReleaseYear(state?.transformed?.review?.headerProps?.infoSliceFields?.releaseYear);
      if (releaseYear) return releaseYear;
    } catch {}
  }

  const fallback = html.match(/"releaseYear"\s*:\s*"?(19|20)\d{2}"?/);
  return parseReleaseYear(fallback?.[0] || '');
}

async function handleReleaseYearApi(reqUrl, res) {
  const raw = reqUrl.searchParams.get('url') || '';
  const urlPath = normalizePitchforkPath(raw);
  if (!urlPath || !urlPath.startsWith('/reviews/albums/')) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ error: 'Invalid url parameter' }));
    return;
  }

  try {
    const resp = await fetch(`https://pitchfork.com${urlPath}`, {
      headers: { 'User-Agent': UA },
    });
    if (!resp.ok) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ error: `Upstream HTTP ${resp.status}` }));
      return;
    }
    const html = await resp.text();
    const releaseYear = extractReleaseYearFromHtml(html);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ releaseYear }));
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ error: 'Failed to fetch release year' }));
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);

  if (reqUrl.pathname === '/api/release-year') {
    await handleReleaseYearApi(reqUrl, res);
    return;
  }

  let filePath = path.join(DIR, reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname);

  // Security: prevent directory traversal
  if (!filePath.startsWith(DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  The Fork is running at http://localhost:${PORT}\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
