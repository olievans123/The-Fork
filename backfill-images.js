#!/usr/bin/env node

/**
 * Backfills missing album artwork by scraping each Pitchfork review page.
 *
 * Usage:
 *   node backfill-images.js
 *   node backfill-images.js --workers 4
 *   node backfill-images.js --limit 50
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'albums.full.json');
const FALLBACK_FILE = path.join(__dirname, 'albums.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_WORKERS = 4;
const DELAY_MS = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? parseInt(args[i + 1]) || def : def;
  };
  return {
    workers: get('--workers', DEFAULT_WORKERS),
    limit: get('--limit', Infinity),
  };
}

function extractImageFromHtml(html) {
  if (!html) return null;

  // Try preloaded state first
  const stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1]);
      const img = state?.transformed?.review?.headerProps?.infoSliceFields?.thumbnail?.url
        || state?.transformed?.review?.headerProps?.thumbnail?.url;
      if (img && img.startsWith('http')) return img;
    } catch {}
  }

  // Try og:image meta tag
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogMatch && ogMatch[1].startsWith('http')) return ogMatch[1];

  // Try any large image in the review header area
  const imgMatch = html.match(/https:\/\/media\.pitchfork\.com\/photos\/[^\s"']+/);
  if (imgMatch) return imgMatch[0];

  return null;
}

async function fetchImage(urlPath) {
  try {
    const resp = await fetch(`https://pitchfork.com${urlPath}`, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    return extractImageFromHtml(html);
  } catch {
    return null;
  }
}

function writeAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

async function main() {
  const { workers, limit } = parseArgs();

  const dataFile = fs.existsSync(DATA_FILE) ? DATA_FILE : FALLBACK_FILE;
  const albums = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

  const missing = albums.filter(a => !a.image || !a.image.trim());
  const toFetch = missing.slice(0, limit);

  console.log(`Total albums: ${albums.length}`);
  console.log(`Missing images: ${missing.length}`);
  console.log(`Will fetch: ${toFetch.length}`);
  console.log(`Workers: ${workers}\n`);

  if (toFetch.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let cursor = 0;
  let found = 0;
  let failed = 0;
  let processed = 0;
  const total = toFetch.length;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      const album = toFetch[idx];

      if (!album.url) {
        failed++;
        processed++;
        continue;
      }

      const image = await fetchImage(album.url);
      if (image) {
        album.image = image;
        found++;
      } else {
        failed++;
      }

      processed++;
      if (processed % 10 === 0 || processed === total) {
        process.stdout.write(
          `\r[${((processed / total) * 100).toFixed(1)}%] ${processed}/${total} | found ${found} | failed ${failed}`
        );
      }

      if (processed % 50 === 0) {
        writeAtomic(dataFile, albums);
      }

      await sleep(DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  writeAtomic(dataFile, albums);

  // Also update albums.json if we modified albums.full.json
  if (dataFile === DATA_FILE && fs.existsSync(FALLBACK_FILE)) {
    const fallback = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf-8'));
    const urlToImage = new Map();
    albums.forEach(a => { if (a.image && a.url) urlToImage.set(a.url, a.image); });
    let synced = 0;
    fallback.forEach(a => {
      if ((!a.image || !a.image.trim()) && a.url && urlToImage.has(a.url)) {
        a.image = urlToImage.get(a.url);
        synced++;
      }
    });
    if (synced > 0) {
      writeAtomic(FALLBACK_FILE, fallback);
      console.log(`\nSynced ${synced} images to albums.json`);
    }
  }

  console.log(`\n\nDone: ${found} images found, ${failed} failed.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
