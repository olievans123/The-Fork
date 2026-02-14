#!/usr/bin/env node

/**
 * Original Year Enrichment Script
 *
 * Looks up reissue albums on MusicBrainz to find their original release year
 * via release groups (which link all versions of an album back to the first release).
 *
 * Writes `originalYear` into albums.json for any album where the original year
 * differs significantly from the current releaseYear.
 *
 * Usage:
 *   node enrich-original-years.js                    # Enrich reissues missing originalYear
 *   node enrich-original-years.js --workers 6        # Faster with more workers
 *   node enrich-original-years.js --limit 50         # Stop after 50 lookups
 *   node enrich-original-years.js --dry-run          # Preview without saving
 *   node enrich-original-years.js --force            # Re-fetch even if originalYear exists
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'albums.json');
const UA = 'TheFork/1.0 (album-review-browser)';
const DEFAULT_DELAY_MS = 350;
const DEFAULT_WORKERS = 4;
const DEFAULT_SAVE_EVERY = 50;
const REISSUE_TITLE_PATTERN = /\b(remaster|reissue|re-?issue|anniversary|box set)\b/i;
const MIN_YEAR_GAP = 3; // Only set originalYear if it's 3+ years before releaseYear

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanTitle(title) {
  return String(title || '')
    .replace(/&amp;/g, '&')
    // Strip parenthetical/bracketed groups containing reissue keywords
    .replace(/\s*\([^\)]*?(remaster|reissue|anniversary|deluxe|expanded|edition|box set|bonus)[^\)]*?\)/gi, '')
    .replace(/\s*\[[^\]]*?(remaster|reissue|anniversary|deluxe|expanded|edition|box set|bonus)[^\]]*?\]/gi, '')
    // Strip non-parenthetical suffixes like ": Expanded Edition", " - Deluxe"
    .replace(/\s*[-–:]\s*(expanded|deluxe|remaster|reissue|anniversary).*$/i, '')
    // Strip "'82" or similar year markers appended to titles
    .replace(/\s*[''\u2019]?\d{2,4}\s*$/g, '')
    // Normalize special chars (E•MO•TION -> EMOTION)
    .replace(/[•·]/g, '')
    .trim();
}

function normalizeText(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

async function fetchJson(url, delayMs) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        await sleep(delayMs);
        return data;
      }
      if (resp.status === 429 || resp.status >= 500) {
        await sleep(delayMs * (attempt + 2));
        continue;
      }
      await sleep(delayMs);
      return null;
    } catch {
      await sleep(delayMs * (attempt + 1));
    }
  }
  return null;
}

async function lookupOriginalYear(artist, title, delayMs) {
  const cleanedTitle = cleanTitle(title);
  const artistEsc = String(artist).replace(/&amp;/g, '&').replace(/["\\]/g, ' ').trim();
  const titleEsc = String(cleanedTitle).replace(/["\\]/g, ' ').trim();

  // Prepare a raw version (strips edition suffix but keeps special chars like •)
  const rawTitleEsc = String(title || '')
    .replace(/&amp;/g, '&')
    .replace(/\s*\([^\)]*?(remaster|reissue|anniversary|deluxe|expanded|edition|box set|bonus)[^\)]*?\)/gi, '')
    .replace(/\s*\[[^\]]*?(remaster|reissue|anniversary|deluxe|expanded|edition|box set|bonus)[^\]]*?\]/gi, '')
    .replace(/\s*[-–:]\s*(expanded|deluxe|remaster|reissue|anniversary).*$/i, '')
    .replace(/["\\]/g, ' ')
    .trim();

  const queries = [
    `artist:"${artistEsc}" AND releasegroup:"${titleEsc}"`,
    `artist:"${artistEsc}" AND releasegroup:${titleEsc}`,
  ];
  if (rawTitleEsc !== titleEsc) {
    queries.push(`artist:"${artistEsc}" AND releasegroup:"${rawTitleEsc}"`);
  }

  const candidates = new Map();
  for (const query of queries) {
    const q = encodeURIComponent(query);
    const url = `https://musicbrainz.org/ws/2/release-group/?query=${q}&fmt=json&limit=10`;
    const data = await fetchJson(url, delayMs);
    if (data) {
      for (const rg of (data['release-groups'] || [])) {
        if (rg?.id) candidates.set(rg.id, rg);
      }
    }
    if (candidates.size >= 5) break;
  }

  const groups = [...candidates.values()];
  const targetArtist = normalizeText(artist);
  const targetTitle = normalizeText(cleanedTitle);

  let best = null;
  let bestScore = -1;

  for (const rg of groups) {
    const type = rg['primary-type'];
    if (type && type !== 'Album') continue;

    let score = parseInt(rg.score || '0', 10);
    const rgTitle = normalizeText(rg.title);
    const rgArtists = normalizeText(
      (rg['artist-credit'] || []).map(a => a?.name || a?.artist?.name || '').join(' ')
    );

    if (rgTitle === targetTitle) score += 40;
    else if (rgTitle.includes(targetTitle) || targetTitle.includes(rgTitle)) score += 20;

    if (rgArtists === targetArtist) score += 30;
    else if (rgArtists.includes(targetArtist) || targetArtist.includes(rgArtists)) score += 15;

    if (score > bestScore) { bestScore = score; best = rg; }
  }

  if (!best || bestScore < 80) return null;

  const firstDate = best['first-release-date'];
  if (!firstDate) return null;

  const yearMatch = firstDate.match(/^(\d{4})/);
  if (!yearMatch) return null;

  const year = parseInt(yearMatch[1], 10);
  if (year < 1900 || year > new Date().getFullYear() + 1) return null;

  return { originalYear: year, matchedTitle: best.title };
}

function isReissueCandidate(album) {
  if (!album.releaseYear || !album.url) return false;
  // Already has originalYear and we're not forcing
  if (album.originalYear) return false;

  const reviewYear = new Date(album.date).getFullYear();
  const gap = reviewYear - album.releaseYear;

  // If releaseYear is already far from review date, it might already be correct
  if (gap > 5) return false;

  // BNR flag = definite reissue
  if (album.bnr) return true;

  // Title contains reissue keywords
  if (REISSUE_TITLE_PATTERN.test(album.title)) return true;

  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit')
    ? parseInt(args[args.indexOf('--limit') + 1], 10) || Infinity
    : Infinity;
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const workers = args.includes('--workers')
    ? Math.max(1, parseInt(args[args.indexOf('--workers') + 1], 10) || DEFAULT_WORKERS)
    : DEFAULT_WORKERS;
  const delayMs = args.includes('--delay')
    ? Math.max(100, parseInt(args[args.indexOf('--delay') + 1], 10) || DEFAULT_DELAY_MS)
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
    if (force) {
      return (a.bnr || REISSUE_TITLE_PATTERN.test(a.title)) && a.url;
    }
    return isReissueCandidate(a);
  });

  const alreadyEnriched = albums.filter(a => a.originalYear).length;

  console.log('Original Year Enrichment (MusicBrainz Release Groups)');
  console.log('======================================================');
  console.log(`Total albums: ${albums.length}`);
  console.log(`Already have originalYear: ${alreadyEnriched}`);
  console.log(`Reissue candidates: ${candidates.length}`);
  console.log(`To look up: ${Math.min(candidates.length, limit)}`);
  console.log(`Workers: ${workers}, Delay: ${delayMs}ms`);
  console.log(`Dry run: ${dryRun ? 'ON' : 'OFF'}`);
  console.log(`Force mode: ${force ? 'ON' : 'OFF'}\n`);

  if (candidates.length === 0) {
    console.log('No candidates. Nothing to do.');
    return;
  }

  let processed = 0;
  let corrected = 0;
  let sameYear = 0;
  let missed = 0;
  const total = Math.min(candidates.length, limit);
  const queue = candidates.slice(0, limit);
  let cursor = 0;

  async function workerLoop(workerId) {
    while (true) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      const album = queue[idx];

      try {
        const result = await lookupOriginalYear(album.artist, album.title, delayMs);

        if (result) {
          const gap = album.releaseYear - result.originalYear;
          if (gap >= MIN_YEAR_GAP) {
            if (!dryRun) {
              album.originalYear = result.originalYear;
            }
            corrected++;
            if (processed < 20 || corrected % 10 === 0) {
              console.log(`  [FIXED] ${album.artist} - ${album.title}: ${album.releaseYear} -> ${result.originalYear}`);
            }
          } else {
            sameYear++;
          }
        } else {
          missed++;
        }
      } catch {
        missed++;
      } finally {
        processed++;
        if (processed % 10 === 0 || processed === total) {
          const pct = ((processed / total) * 100).toFixed(1);
          process.stdout.write(
            `\r[${pct}%] ${processed}/${total} | corrected ${corrected} | same ${sameYear} | missed ${missed} | w${workerId}`
          );
        }
        if (!dryRun && processed % saveEvery === 0) {
          writeJsonAtomic(DATA_FILE, albums);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, (_, i) => workerLoop(i + 1)));

  if (!dryRun && corrected > 0) {
    writeJsonAtomic(DATA_FILE, albums);
  }

  console.log(`\n\nDone! Processed ${processed} reissue candidates.`);
  console.log(`Corrected with original year: ${corrected}`);
  console.log(`Same/recent year (no change needed): ${sameYear}`);
  console.log(`Not found on MusicBrainz: ${missed}`);

  if (corrected > 0 && !dryRun) {
    // Show decade distribution of corrected albums
    const decades = {};
    albums.filter(a => a.originalYear).forEach(a => {
      const decade = `${Math.floor(a.originalYear / 10) * 10}s`;
      decades[decade] = (decades[decade] || 0) + 1;
    });
    console.log('\nOriginal year decade distribution:');
    Object.entries(decades).sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([d, n]) => console.log(`  ${d}: ${n}`));
  }

  console.log(`\nTotal albums with originalYear: ${albums.filter(a => a.originalYear).length}`);
  if (dryRun) console.log('\n(Dry run — no changes saved)');
  else if (corrected > 0) console.log(`\nSaved to ${DATA_FILE}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
