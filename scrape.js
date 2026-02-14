#!/usr/bin/env node

/**
 * Pitchfork Album Review Scraper
 *
 * Fetches all album reviews from Pitchfork's website.
 * Data is extracted from the server-rendered __PRELOADED_STATE__.
 *
 * Usage:
 *   node scrape.js              # Full scrape (all pages)
 *   node scrape.js --pages 5    # First 5 pages only
 *   node scrape.js --update     # Only fetch new reviews since last scrape
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'albums.json');
const BASE_URL = 'https://pitchfork.com/reviews/albums/';
const DELAY_MS = 800; // polite delay between requests
const ITEMS_PER_PAGE = 96;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function parseItem(item) {
  const rating = item.ratingValue || {};
  const genres = (item.rubric || []).map(r => r.name);
  const imageUrl = item.image?.sources?.sm?.url || item.image?.sources?.lg?.url || '';

  return {
    id: item.id || item.copilotID,
    artist: item.subHed?.name || 'Unknown',
    title: stripHtml(item.dangerousHed || ''),
    score: typeof rating.score === 'number' ? rating.score : parseFloat(rating.score) || 0,
    bnm: !!rating.isBestNewMusic,
    bnr: !!rating.isBestNewReissue,
    genres,
    date: item.pubDate || '',
    dateFormatted: item.date || '',
    url: item.url || '',
    description: item.dangerousDek || '',
    reviewer: item.contributors?.author?.items?.[0]?.name || '',
    image: imageUrl,
  };
}

async function fetchPage(pageNum) {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?page=${pageNum}`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA } });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} on page ${pageNum}`);
  }

  const html = await resp.text();
  const match = html.match(/window\.__PRELOADED_STATE__\s*=\s*({.*?});\s*<\/script>/s);

  if (!match) {
    throw new Error(`No __PRELOADED_STATE__ found on page ${pageNum}`);
  }

  const data = JSON.parse(match[1]);
  const bundle = data.transformed?.bundle;

  if (!bundle) {
    throw new Error(`No bundle data on page ${pageNum}`);
  }

  // The main items container is typically containers[1]
  const container = bundle.containers?.find(c => c.items && c.items.length > 0 && c.totalResults);

  if (!container) {
    throw new Error(`No items container on page ${pageNum}`);
  }

  return {
    items: container.items.map(parseItem),
    totalResults: container.totalResults,
    paginatedPage: bundle.paginatedPage || pageNum,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const maxPagesArg = args.includes('--pages') ? parseInt(args[args.indexOf('--pages') + 1]) : null;
  const isUpdate = args.includes('--update');

  console.log('Pitchfork Album Scraper');
  console.log('======================\n');

  // Load existing data for update mode
  let existing = [];
  let existingIds = new Set();
  if (fs.existsSync(DATA_FILE)) {
    existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    existingIds = new Set(existing.map(a => a.id));
    console.log(`Loaded ${existing.length} existing albums from cache.`);
  }

  // Fetch first page to get total count
  console.log('Fetching page 1...');
  const first = await fetchPage(1);
  const totalResults = first.totalResults;
  const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE);
  const pagesToFetch = maxPagesArg ? Math.min(maxPagesArg, totalPages) : totalPages;

  console.log(`Total reviews available: ${totalResults}`);
  console.log(`Pages to fetch: ${pagesToFetch} of ${totalPages}\n`);

  let allItems = [...first.items];
  let newCount = first.items.filter(i => !existingIds.has(i.id)).length;

  if (isUpdate && newCount === 0) {
    console.log('No new reviews found on page 1. Data is up to date.');
    return;
  }

  // Fetch remaining pages
  for (let page = 2; page <= pagesToFetch; page++) {
    const pct = ((page / pagesToFetch) * 100).toFixed(0);
    process.stdout.write(`\rFetching page ${page}/${pagesToFetch} (${pct}%)...`);

    try {
      const result = await fetchPage(page);
      allItems.push(...result.items);

      if (isUpdate) {
        const pageNewCount = result.items.filter(i => !existingIds.has(i.id)).length;
        if (pageNewCount === 0) {
          console.log(`\nNo new reviews on page ${page}. Stopping update.`);
          break;
        }
      }
    } catch (err) {
      console.error(`\nError on page ${page}: ${err.message}. Continuing...`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n\nFetched ${allItems.length} reviews.`);

  // Merge with existing (dedup by id)
  if (isUpdate && existing.length > 0) {
    const merged = new Map();
    for (const a of existing) merged.set(a.id, a);
    for (const a of allItems) merged.set(a.id, a);
    allItems = [...merged.values()];
    console.log(`Merged to ${allItems.length} total (${allItems.length - existing.length} new).`);
  }

  // Sort by date descending
  allItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Write to file
  fs.writeFileSync(DATA_FILE, JSON.stringify(allItems, null, 2));
  console.log(`\nSaved ${allItems.length} albums to ${DATA_FILE}`);

  // Stats
  const scores = allItems.map(a => a.score).filter(s => s > 0);
  const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
  const bnmCount = allItems.filter(a => a.bnm).length;
  const genres = {};
  allItems.forEach(a => a.genres.forEach(g => { genres[g] = (genres[g] || 0) + 1; }));
  const topGenres = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 10);

  console.log(`\nStats:`);
  console.log(`  Average score: ${avg}`);
  console.log(`  Best New Music: ${bnmCount}`);
  console.log(`  Top genres:`);
  topGenres.forEach(([g, c]) => console.log(`    ${g}: ${c}`));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
