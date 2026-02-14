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
 *   node enrich-original-years.js --all              # Check ALL albums, not just BNR/keyword
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
const REISSUE_TITLE_PATTERN = /\b(remaster|reissue|re-?issue|anniversary|box set|deluxe|expanded|edition)\b/i;
const MIN_YEAR_GAP = 3; // Only set originalYear if it's 3+ years before releaseYear

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanTitle(title) {
  const cleaned = String(title || '')
    .replace(/&amp;/g, '&')
    .replace(/&#8212;/g, '—').replace(/&#8211;/g, '–').replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, ' ')
    // Strip parenthetical/bracketed groups containing reissue keywords
    .replace(/\s*\([^\)]*?(remaster|reissue|anniversary|deluxe|expanded|edition|box set|bonus)[^\)]*?\)/gi, '')
    .replace(/\s*\[[^\]]*?(remaster|reissue|anniversary|deluxe|expanded|edition|box set|bonus)[^\]]*?\]/gi, '')
    // Strip non-parenthetical suffixes like ": Expanded Edition", " - Deluxe", "— Expanded"
    .replace(/\s*[-–—:]\s*(?:the\s+)?(?:\d+\w*\s+)?(expanded|deluxe|remaster|reissue|anniversary|super|box set).*$/i, '')
    // Strip trailing reissue keywords (e.g. "Purple Rain Deluxe" -> "Purple Rain")
    .replace(/\s+(deluxe|expanded|remastered|remaster|super)\s*$/i, '')
    // Strip "'82" or similar year markers appended to titles (but not if the title IS a number)
    .replace(/(?<=\S\s+)[''\u2019]?\d{2,4}\s*$/g, '')
    // Normalize special chars (E•MO•TION -> EMOTION)
    .replace(/[•·]/g, '')
    .trim();
  // If cleaning removed everything (e.g. title was just "1999"), return original minus HTML entities
  return cleaned || String(title || '').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ').trim();
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
  const artistEsc = String(artist).replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ').replace(/["\\]/g, ' ').trim();
  const titleEsc = String(cleanedTitle).replace(/["\\]/g, ' ').trim();

  // For collab credits like "Prince / The Revolution", also try the primary artist
  const primaryArtist = artistEsc.split(/\s*[\/&]\s*/)[0].trim();

  // For multi-album reviews like "Kill 'Em All/Ride the Lightning", try each part
  const titleParts = titleEsc.includes('/') ? titleEsc.split(/\s*\/\s*/) : [titleEsc];

  const queries = [];
  for (const tp of titleParts) {
    queries.push(`artist:"${artistEsc}" AND releasegroup:"${tp}"`);
    if (primaryArtist !== artistEsc) {
      queries.push(`artist:"${primaryArtist}" AND releasegroup:"${tp}"`);
    }
    queries.push(`artist:"${artistEsc}" AND releasegroup:${tp}`);
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
  const targetPrimary = normalizeText(primaryArtist);
  const targetTitles = titleParts.map(t => normalizeText(t));

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

    // Match against any title part (for multi-album reviews)
    const titleMatch = targetTitles.some(t => rgTitle === t);
    const titlePartial = targetTitles.some(t => rgTitle.includes(t) || t.includes(rgTitle));
    if (titleMatch) score += 40;
    else if (titlePartial) score += 20;

    // Match against full artist or primary artist
    if (rgArtists === targetArtist || rgArtists === targetPrimary) score += 30;
    else if (rgArtists.includes(targetPrimary) || targetPrimary.includes(rgArtists)) score += 15;

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

function isReissueCandidate(album, allMode) {
  if (!album.releaseYear || !album.url) return false;
  // Already has originalYear and we're not forcing
  if (album.originalYear) return false;

  const reviewYear = new Date(album.date).getFullYear();
  const gap = reviewYear - album.releaseYear;

  // If releaseYear is already far from review date, it might already be correct
  if (gap > 5) return false;

  // --all mode: check every album that doesn't already have originalYear
  if (allMode) return true;

  // BNR flag = definite reissue
  if (album.bnr) return true;

  // Title contains reissue keywords
  if (REISSUE_TITLE_PATTERN.test(album.title)) return true;

  // Multi-album reviews (e.g. "Kill 'Em All / Ride the Lightning") are almost always reissues
  if (/\s\/\s/.test(album.title) && !/\s*[,&]\s/.test(album.artist.split('/')[0])) return true;

  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit')
    ? parseInt(args[args.indexOf('--limit') + 1], 10) || Infinity
    : Infinity;
  const force = args.includes('--force');
  const allMode = args.includes('--all');
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
      return (allMode || a.bnr || REISSUE_TITLE_PATTERN.test(a.title)) && a.url;
    }
    return isReissueCandidate(a, allMode);
  });

  const alreadyEnriched = albums.filter(a => a.originalYear).length;

  console.log('Original Year Enrichment (MusicBrainz Release Groups)');
  console.log('======================================================');
  console.log(`Total albums: ${albums.length}`);
  console.log(`Already have originalYear: ${alreadyEnriched}`);
  console.log(`Reissue candidates: ${candidates.length}`);
  console.log(`To look up: ${Math.min(candidates.length, limit)}`);
  console.log(`Workers: ${workers}, Delay: ${delayMs}ms`);
  console.log(`All mode: ${allMode ? 'ON' : 'OFF'}`);
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
