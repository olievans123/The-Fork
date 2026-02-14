#!/usr/bin/env node

/**
 * Release Year Enrichment Script
 *
 * Fetches releaseYear from Pitchfork review pages and writes it directly
 * into albums.json. Follows the same concurrent-worker pattern as enrich.js.
 *
 * Usage:
 *   node enrich-years.js                    # Enrich albums missing releaseYear
 *   node enrich-years.js --workers 8        # Faster with more workers
 *   node enrich-years.js --limit 500        # Stop after 500 lookups
 *   node enrich-years.js --force            # Re-fetch even if releaseYear exists
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'albums.json');
const DEFAULT_DELAY_MS = 200;
const DEFAULT_WORKERS = 6;
const DEFAULT_SAVE_EVERY = 50;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const PITCHFORK_ORIGIN = 'https://pitchfork.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseReleaseYear(value) {
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = parseInt(match[0], 10);
  const now = new Date().getFullYear();
  return year >= 1900 && year <= now + 1 ? year : null;
}

function extractReleaseYearFromHtml(html) {
  if (!html) return null;

  // Strategy 1: __PRELOADED_STATE__ → headerProps.infoSliceFields.releaseYear
  const stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1]);
      const year = parseReleaseYear(
        state?.transformed?.review?.headerProps?.infoSliceFields?.releaseYear
      );
      if (year) return year;
    } catch {}
  }

  // Strategy 2: raw JSON field in HTML
  const fallback = html.match(/"releaseYear"\s*:\s*"?(19|20)\d{2}"?/);
  return parseReleaseYear(fallback?.[0] || '');
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

async function fetchWithRetry(url, delayMs, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA },
      });

      if (resp.ok) {
        const text = await resp.text();
        await sleep(delayMs);
        return text;
      }

      if (resp.status === 404) {
        await sleep(delayMs);
        return null;
      }

      if (!RETRYABLE_STATUS.has(resp.status) || attempt === retries) {
        await sleep(delayMs);
        return null;
      }
    } catch {
      if (attempt === retries) return null;
    }

    await sleep(delayMs * attempt);
  }

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit')
    ? parseInt(args[args.indexOf('--limit') + 1], 10) || Infinity
    : Infinity;
  const force = args.includes('--force');
  const workers = args.includes('--workers')
    ? Math.max(1, parseInt(args[args.indexOf('--workers') + 1], 10) || DEFAULT_WORKERS)
    : DEFAULT_WORKERS;
  const delayMs = args.includes('--delay')
    ? Math.max(0, parseInt(args[args.indexOf('--delay') + 1], 10) || DEFAULT_DELAY_MS)
    : DEFAULT_DELAY_MS;
  const saveEvery = args.includes('--save-every')
    ? Math.max(1, parseInt(args[args.indexOf('--save-every') + 1], 10) || DEFAULT_SAVE_EVERY)
    : DEFAULT_SAVE_EVERY;

  if (!fs.existsSync(DATA_FILE)) {
    console.error('albums.json not found. Run scrape.js first.');
    process.exit(1);
  }

  const albums = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  const candidates = albums.filter(a => {
    if (!a.url) return false;
    if (force) return true;
    return !a.releaseYear;
  });

  const alreadyEnriched = albums.length - candidates.length;

  console.log('Pitchfork Release Year Enrichment');
  console.log('==================================');
  console.log(`Total albums: ${albums.length}`);
  console.log(`Already have releaseYear: ${alreadyEnriched}`);
  console.log(`To enrich: ${Math.min(candidates.length, limit)}`);
  console.log(`Workers: ${workers}, Delay: ${delayMs}ms`);
  console.log(`Force mode: ${force ? 'ON' : 'OFF'}\n`);

  if (candidates.length === 0) {
    console.log('All albums already have releaseYear. Nothing to do.');
    return;
  }

  let processed = 0;
  let resolved = 0;
  let unresolved = 0;
  let failed = 0;
  const total = Math.min(candidates.length, limit);
  const queue = candidates.slice(0, limit);
  let cursor = 0;

  async function workerLoop(workerId) {
    while (true) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      const album = queue[idx];

      try {
        const pageUrl = `${PITCHFORK_ORIGIN}${album.url}`;
        const html = await fetchWithRetry(pageUrl, delayMs);
        const year = html ? extractReleaseYearFromHtml(html) : null;

        if (year) {
          album.releaseYear = year;
          resolved++;
        } else {
          unresolved++;
        }
      } catch {
        unresolved++;
        failed++;
      } finally {
        processed++;
        if (processed % 10 === 0 || processed === total) {
          const pct = ((processed / total) * 100).toFixed(1);
          process.stdout.write(
            `\r[${pct}%] ${processed}/${total} | found ${resolved} | missing ${unresolved} | failed ${failed} | w${workerId}`
          );
        }
        if (processed % saveEvery === 0) {
          writeJsonAtomic(DATA_FILE, albums);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, (_, i) => workerLoop(i + 1)));

  // Final save
  writeJsonAtomic(DATA_FILE, albums);

  console.log(`\n\nDone! Processed ${processed} albums.`);
  console.log(`Found releaseYear: ${resolved}`);
  console.log(`No releaseYear found: ${unresolved}`);
  console.log(`Fetch failures: ${failed}`);

  // Decade stats
  const decades = {};
  albums.forEach(a => {
    if (a.releaseYear) {
      const decade = `${Math.floor(a.releaseYear / 10) * 10}s`;
      decades[decade] = (decades[decade] || 0) + 1;
    }
  });
  const sortedDecades = Object.entries(decades).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`\nTotal albums with releaseYear: ${albums.filter(a => a.releaseYear).length}/${albums.length}`);
  console.log('\nDecade distribution:');
  sortedDecades.forEach(([d, n]) => console.log(`  ${d}: ${n}`));

  console.log(`\nSaved to ${DATA_FILE}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
