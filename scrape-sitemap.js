#!/usr/bin/env node

/**
 * Sitemap-based scraper and backfiller for Pitchfork album reviews.
 *
 * Usage:
 *   node scrape-sitemap.js
 *   node scrape-sitemap.js --limit 200
 *   node scrape-sitemap.js --workers 8 --sitemap-workers 8
 *   node scrape-sitemap.js --out albums-full.json --in albums.json
 *   node scrape-sitemap.js --oldest-first --year-from 2009
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_FILE = path.join(__dirname, 'albums.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PITCHFORK_ORIGIN = 'https://pitchfork.com';
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function stripHtml(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>/g, '').trim();
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseReleaseYear(value) {
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = parseInt(match[0], 10);
  const now = new Date().getFullYear();
  return year >= 1900 && year <= now + 1 ? year : null;
}

function getArgValue(args, flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

function getIntArg(args, flag, fallback) {
  const raw = getArgValue(args, flag, null);
  if (raw === null) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveFileArg(rawPath, fallbackAbsPath) {
  if (!rawPath) return fallbackAbsPath;
  return path.isAbsolute(rawPath) ? rawPath : path.join(__dirname, rawPath);
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function normalizePitchforkPath(input) {
  if (!input) return '';

  let pathOnly = String(input).trim();
  if (!pathOnly) return '';

  if (/^https?:\/\//i.test(pathOnly)) {
    try {
      const u = new URL(pathOnly);
      if (!/pitchfork\.com$/i.test(u.hostname)) return '';
      pathOnly = u.pathname;
    } catch {
      return '';
    }
  }

  if (!pathOnly.startsWith('/')) pathOnly = `/${pathOnly}`;
  pathOnly = pathOnly.replace(/[?#].*$/, '');
  pathOnly = pathOnly.replace(/\/{2,}/g, '/');
  pathOnly = pathOnly.trim();
  if (!pathOnly.endsWith('/')) pathOnly += '/';
  return pathOnly;
}

function parseSitemapDateParts(url) {
  try {
    const u = new URL(url);
    return {
      year: parseInt(u.searchParams.get('year') || '0', 10),
      month: parseInt(u.searchParams.get('month') || '0', 10),
      week: parseInt(u.searchParams.get('week') || '0', 10),
    };
  } catch {
    return { year: 0, month: 0, week: 0 };
  }
}

async function fetchText(url, options = {}) {
  const attempts = options.attempts || 3;
  const retryDelayMs = options.retryDelayMs || 350;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let resp;
    try {
      resp = await fetch(url, { headers: { 'User-Agent': UA } });
    } catch (err) {
      if (attempt === attempts) throw err;
      await sleep(retryDelayMs * attempt);
      continue;
    }

    if (resp.ok) return resp.text();
    if (!RETRYABLE_STATUS.has(resp.status) || attempt === attempts) {
      throw new Error(`HTTP ${resp.status}`);
    }
    await sleep(retryDelayMs * attempt);
  }

  throw new Error('Unknown fetch failure');
}

async function getSitemapIndex() {
  const xml = await fetchText(`${PITCHFORK_ORIGIN}/sitemap.xml`);
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)]
    .map(m => m[1].replace(/&amp;/g, '&'))
    .filter(u => u.includes('/sitemap.xml?'));
}

async function getReviewUrlsFromSitemap(sitemapUrl) {
  const xml = await fetchText(sitemapUrl);
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)]
    .map(m => m[1])
    .filter(u => u.includes('/reviews/albums/') && !u.endsWith('/reviews/albums/'));
}

function toReviewLdObject(maybeLd) {
  if (!maybeLd) return null;

  if (Array.isArray(maybeLd)) {
    for (const entry of maybeLd) {
      const found = toReviewLdObject(entry);
      if (found) return found;
    }
    return null;
  }

  if (typeof maybeLd !== 'object') return null;

  const type = String(maybeLd['@type'] || '').toLowerCase();
  if (type === 'review') return maybeLd;

  if (Array.isArray(maybeLd['@graph'])) {
    const found = toReviewLdObject(maybeLd['@graph']);
    if (found) return found;
  }

  if (maybeLd.review) {
    const found = toReviewLdObject(maybeLd.review);
    if (found) return found;
  }

  return null;
}

function getJsonLdReview(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const review = toReviewLdObject(parsed);
      if (review) return review;
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return null;
}

function parseArtistTitleFromHead(hed) {
  if (!hed) return { artist: '', title: '' };
  const cleaned = String(hed)
    .replace(/\s*\|\s*Pitchfork.*$/i, '')
    .replace(/Album Reviews?:\s*/i, '')
    .trim();

  const parts = cleaned.split(':').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { artist: parts[0], title: parts.slice(1).join(':').trim() };
  }
  return { artist: '', title: cleaned };
}

function parseReviewPage(html) {
  const ldReview = getJsonLdReview(html);
  let transformed = null;
  let review = null;
  let hp = {};

  const preloadedMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (preloadedMatch) {
    try {
      const state = JSON.parse(preloadedMatch[1]);
      transformed = state.transformed || null;
      review = transformed?.review || null;
      hp = review?.headerProps || {};
    } catch {
      // continue with JSON-LD fallback
    }
  }

  const hed = transformed?.['head.social.title'] || transformed?.['head.title'] || '';
  const description = transformed?.['head.social.description'] || transformed?.['head.description'] || ldReview?.description || '';

  let score = asNumber(hp?.musicRating?.score);
  if (!score) score = asNumber(review?.rating);
  if (!score) score = asNumber(ldReview?.reviewRating?.ratingValue || ldReview?.reviewRating?.rating || ldReview?.ratingValue);

  const bnm = !!hp?.musicRating?.isBestNewMusic;
  const bnr = !!hp?.musicRating?.isBestNewReissue;

  let artist = '';
  if (Array.isArray(hp?.artists) && hp.artists.length) {
    artist = hp.artists.map(a => a?.name || '').filter(Boolean).join(', ');
  }

  let title = '';
  if (hp?.dangerousHed) {
    title = stripHtml(hp.dangerousHed);
  }

  const itemReviewedName = ldReview?.itemReviewed?.name || '';
  if ((!artist || !title) && itemReviewedName.includes(':')) {
    const [maybeArtist, ...rest] = itemReviewedName.split(':');
    if (!artist) artist = maybeArtist.trim();
    if (!title) title = rest.join(':').trim();
  }

  if ((!artist || !title) && hed) {
    const fromHead = parseArtistTitleFromHead(hed);
    if (!artist) artist = fromHead.artist;
    if (!title) title = fromHead.title;
  }

  if (!title && ldReview?.headline) title = stripHtml(ldReview.headline);
  if (!artist && Array.isArray(ldReview?.author) && ldReview.itemReviewed?.byArtist) {
    artist = stripHtml(ldReview.itemReviewed.byArtist.name || '');
  }

  if (!artist && !title) return null;
  if (score <= 0 || score > 10) return null;

  const genres = [];
  if (Array.isArray(hp?.artists)) {
    for (const artistItem of hp.artists) {
      const artistGenres = artistItem?.genres || [];
      for (const genre of artistGenres) {
        const name = genre?.node?.name || genre?.name || genre;
        if (typeof name === 'string' && name.trim()) genres.push(name.trim());
      }
    }
  }
  if (!genres.length && hp?.infoSliceFields?.genre) genres.push(String(hp.infoSliceFields.genre));
  if (!genres.length && ldReview?.genre) {
    if (Array.isArray(ldReview.genre)) genres.push(...ldReview.genre.map(String));
    else genres.push(String(ldReview.genre));
  }

  let image = review?.productCardImage?.sources?.sm?.url
    || review?.productCardImage?.sources?.lg?.url
    || '';
  if (!image && ldReview?.image) {
    if (typeof ldReview.image === 'string') image = ldReview.image;
    else if (Array.isArray(ldReview.image) && typeof ldReview.image[0] === 'string') image = ldReview.image[0];
    else if (typeof ldReview.image?.url === 'string') image = ldReview.image.url;
  }

  let reviewer = '';
  const contribs = review?.contributors || hp?.contributors;
  if (contribs?.author?.items?.length) reviewer = contribs.author.items[0]?.name || '';
  if (!reviewer && Array.isArray(ldReview?.author) && ldReview.author.length) {
    reviewer = ldReview.author[0]?.name || '';
  } else if (!reviewer && typeof ldReview?.author?.name === 'string') {
    reviewer = ldReview.author.name;
  }

  let pubDate = ldReview?.datePublished || '';
  if (!pubDate) {
    const publishMatch = html.match(/"publishDate":"([^"]+)"/);
    if (publishMatch) pubDate = publishMatch[1];
  }
  const dateFormatted = hp?.infoSliceFields?.reviewDate || '';
  let releaseYear = parseReleaseYear(hp?.infoSliceFields?.releaseYear);
  if (!releaseYear) {
    const releaseMatch = html.match(/"releaseYear"\s*:\s*"?(19|20)\d{2}"?/);
    releaseYear = parseReleaseYear(releaseMatch?.[0] || '');
  }

  return {
    artist: String(artist || '').trim(),
    title: String(title || '').trim(),
    score,
    bnm,
    bnr,
    genres: [...new Set(genres.map(g => String(g).trim()).filter(Boolean))],
    date: pubDate,
    dateFormatted,
    releaseYear,
    description: stripHtml(description),
    reviewer: String(reviewer || '').trim(),
    image: String(image || '').trim(),
  };
}

function sortAlbums(albums) {
  albums.sort((a, b) => {
    const db = Date.parse(b.date || '') || 0;
    const da = Date.parse(a.date || '') || 0;
    if (db !== da) return db - da;
    const artistCmp = String(a.artist || '').localeCompare(String(b.artist || ''));
    if (artistCmp !== 0) return artistCmp;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

async function main() {
  const args = process.argv.slice(2);
  const limitRaw = getIntArg(args, '--limit', Infinity);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : Infinity;
  const workers = clamp(getIntArg(args, '--workers', 6), 1, 32);
  const sitemapWorkers = clamp(getIntArg(args, '--sitemap-workers', 8), 1, 32);
  const delayMs = Math.max(0, getIntArg(args, '--delay', 0));
  const saveEvery = Math.max(1, getIntArg(args, '--save-every', 100));
  const yearFrom = getIntArg(args, '--year-from', 0);
  const yearTo = getIntArg(args, '--year-to', 0);
  const oldestFirst = args.includes('--oldest-first');

  const inFile = resolveFileArg(getArgValue(args, '--in', null), DEFAULT_DATA_FILE);
  const outFile = resolveFileArg(getArgValue(args, '--out', null), inFile);

  let albums = [];
  const albumsByUrl = new Map();
  const urlLessAlbums = [];
  if (fs.existsSync(inFile)) {
    albums = JSON.parse(fs.readFileSync(inFile, 'utf-8'));
    for (const album of albums) {
      const normalizedPath = normalizePitchforkPath(album.url);
      if (normalizedPath) {
        albumsByUrl.set(normalizedPath, { ...album, url: normalizedPath });
      } else {
        urlLessAlbums.push(album);
      }
    }
  }

  const existingUrls = new Set(albumsByUrl.keys());

  console.log('Pitchfork Sitemap Backfill');
  console.log('=========================');
  console.log(`Input file: ${inFile}`);
  console.log(`Output file: ${outFile}`);
  console.log(`Existing albums: ${albums.length}`);
  console.log(`Workers: scrape=${workers}, sitemap=${sitemapWorkers}\n`);

  const sitemapIndex = await getSitemapIndex();
  let sitemapUrls = [...sitemapIndex];

  if (yearFrom > 0 || yearTo > 0) {
    sitemapUrls = sitemapUrls.filter(url => {
      const parts = parseSitemapDateParts(url);
      if (yearFrom > 0 && parts.year < yearFrom) return false;
      if (yearTo > 0 && parts.year > yearTo) return false;
      return true;
    });
  }

  if (oldestFirst) {
    sitemapUrls.sort((a, b) => {
      const pa = parseSitemapDateParts(a);
      const pb = parseSitemapDateParts(b);
      if (pa.year !== pb.year) return pa.year - pb.year;
      if (pa.month !== pb.month) return pa.month - pb.month;
      return pa.week - pb.week;
    });
  }

  console.log(`Sitemaps to scan: ${sitemapUrls.length}\n`);
  if (!sitemapUrls.length) {
    console.log('No matching sitemaps to scan. Exiting.');
    return;
  }

  const queuedPaths = new Set();
  const missingReviewUrls = [];
  let stopScanning = false;
  let scanIndex = 0;
  let scanned = 0;

  async function sitemapWorker() {
    while (true) {
      if (stopScanning) return;
      const current = scanIndex++;
      if (current >= sitemapUrls.length) return;
      const sitemapUrl = sitemapUrls[current];
      try {
        const urls = await getReviewUrlsFromSitemap(sitemapUrl);
        for (const url of urls) {
          const urlPath = normalizePitchforkPath(url);
          if (!urlPath) continue;
          if (existingUrls.has(urlPath)) continue;
          if (queuedPaths.has(urlPath)) continue;
          queuedPaths.add(urlPath);
          missingReviewUrls.push(`${PITCHFORK_ORIGIN}${urlPath}`);

          if (Number.isFinite(limit) && missingReviewUrls.length >= limit) {
            stopScanning = true;
            break;
          }
        }
      } catch {
        // skip inaccessible sitemap
      } finally {
        scanned++;
        if (scanned % 10 === 0 || scanned === sitemapUrls.length || stopScanning) {
          process.stdout.write(`\rScanned sitemaps: ${scanned}/${sitemapUrls.length} | queued reviews: ${missingReviewUrls.length}`);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: sitemapWorkers }, () => sitemapWorker()));
  process.stdout.write('\n');

  const toScrape = Number.isFinite(limit) ? missingReviewUrls.slice(0, limit) : missingReviewUrls;
  console.log(`Reviews queued for scrape: ${toScrape.length}`);

  if (!toScrape.length) {
    console.log('Nothing new to scrape.');
    if (inFile !== outFile) writeJsonAtomic(outFile, albums);
    return;
  }

  let scrapeIndex = 0;
  let processed = 0;
  let added = 0;
  let updated = 0;
  let failed = 0;
  let savedAt = 0;

  function materializeAlbums() {
    const merged = [...albumsByUrl.values(), ...urlLessAlbums];
    sortAlbums(merged);
    return merged;
  }

  function maybeCheckpoint(force = false) {
    if (!force && processed - savedAt < saveEvery) return;
    const merged = materializeAlbums();
    writeJsonAtomic(outFile, merged);
    savedAt = processed;
  }

  async function scrapeWorker() {
    while (true) {
      const current = scrapeIndex++;
      if (current >= toScrape.length) return;

      const url = toScrape[current];
      const urlPath = normalizePitchforkPath(url);
      try {
        const html = await fetchText(url, { attempts: 3, retryDelayMs: 450 });
        const parsed = parseReviewPage(html);
        if (parsed && urlPath) {
          const prior = albumsByUrl.get(urlPath);
          const next = {
            ...(prior || {}),
            id: prior?.id || `sm_${urlPath.replace(/[^a-z0-9]/gi, '_')}`,
            ...parsed,
            url: urlPath,
          };
          albumsByUrl.set(urlPath, next);
          if (prior) updated++;
          else added++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      } finally {
        processed++;
        if (processed % 25 === 0 || processed === toScrape.length) {
          const pct = ((processed / toScrape.length) * 100).toFixed(1);
          process.stdout.write(
            `\rScraping ${processed}/${toScrape.length} (${pct}%) | added ${added} | updated ${updated} | failed ${failed}`
          );
        }
        maybeCheckpoint(false);
      }

      if (delayMs > 0) await sleep(delayMs);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => scrapeWorker()));
  process.stdout.write('\n');

  maybeCheckpoint(true);

  const finalAlbums = materializeAlbums();
  console.log('\nDone.');
  console.log(`Added: ${added}`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total albums written: ${finalAlbums.length}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
