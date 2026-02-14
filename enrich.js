#!/usr/bin/env node

/**
 * MusicBrainz Enrichment Script
 *
 * Saves country/language data to a separate enrichment.json keyed by album URL.
 * Can run safely while the scraper is also running.
 *
 * Usage:
 *   node enrich.js                                # Enrich only missing keys
 *   node enrich.js --resolve-unknown              # Retry Unknown entries too
 *   node enrich.js --resolve-unknown --workers 6  # Faster full pass
 *   node enrich.js --limit 500                    # Stop early
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'albums.json');
const ENRICH_FILE = path.join(__dirname, 'enrichment.json');
const DEFAULT_DELAY_MS = 350;
const DEFAULT_WORKERS = 4;
const DEFAULT_SAVE_EVERY = 100;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const UA = 'TheFork/1.0 (album-review-browser)';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escQueryTerm(input) {
  return String(input || '').replace(/["\\]/g, ' ').trim();
}

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isUnknownValue(v) {
  if (!v || typeof v !== 'string') return true;
  return v.trim().toLowerCase() === 'unknown';
}

function hasKnownCountryLanguage(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return !isUnknownValue(entry.country) && !isUnknownValue(entry.language);
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

async function fetchJsonWithRetry(url, delayMs, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      });

      if (resp.ok) {
        const json = await resp.json();
        await sleep(delayMs);
        return json;
      }

      if (!RETRYABLE_STATUS.has(resp.status) || attempt === retries) {
        await sleep(delayMs);
        return null;
      }
    } catch (err) {
      if (attempt === retries) return null;
    }

    await sleep(delayMs * attempt);
  }

  return null;
}

function pickBestRelease(releases, artist, title) {
  if (!Array.isArray(releases) || releases.length === 0) return null;

  const targetArtist = normalizeText(artist);
  const targetTitle = normalizeText(title);

  let best = null;
  let bestScore = -1;
  for (const release of releases) {
    const mbScore = parseInt(release.score || '0', 10) || 0;
    const releaseTitle = normalizeText(release.title);
    const releaseArtists = normalizeText(
      (release['artist-credit'] || [])
        .map(a => a?.name || a?.artist?.name || '')
        .join(' ')
    );

    let score = mbScore;
    if (releaseTitle && targetTitle) {
      if (releaseTitle === targetTitle) score += 35;
      else if (releaseTitle.includes(targetTitle) || targetTitle.includes(releaseTitle)) score += 18;
    }

    if (releaseArtists && targetArtist) {
      if (releaseArtists === targetArtist) score += 30;
      else if (releaseArtists.includes(targetArtist) || targetArtist.includes(releaseArtists)) score += 15;
    }

    if (score > bestScore) {
      bestScore = score;
      best = release;
    }
  }

  return best ? { ...best, __combinedScore: bestScore } : null;
}

function extractCountryLanguage(release) {
  if (!release || typeof release !== 'object') {
    return { country: null, language: null };
  }

  const country = release.country
    || release['release-events']?.[0]?.area?.['iso-3166-1-codes']?.[0]
    || null;
  const language = release['text-representation']?.language || null;

  return { country, language };
}

async function searchRelease(query, delayMs, limit = 5) {
  const q = encodeURIComponent(query);
  const url = `https://musicbrainz.org/ws/2/release/?query=${q}&fmt=json&limit=${limit}`;
  const data = await fetchJsonWithRetry(url, delayMs, 3);
  return data?.releases || [];
}

async function fetchReleaseDetails(mbid, delayMs) {
  if (!mbid) return null;
  const url = `https://musicbrainz.org/ws/2/release/${mbid}?fmt=json&inc=release-events+artist-credits`;
  return fetchJsonWithRetry(url, delayMs, 3);
}

async function lookupArtist(artist, delayMs) {
  const artistTerm = escQueryTerm(artist);
  if (!artistTerm) return null;
  const q = encodeURIComponent(`artist:"${artistTerm}"`);
  const url = `https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=3`;
  const data = await fetchJsonWithRetry(url, delayMs, 3);
  if (!data?.artists?.length) return null;

  // Pick best matching artist
  const target = normalizeText(artist);
  let best = data.artists[0];
  for (const a of data.artists) {
    if (normalizeText(a.name) === target) { best = a; break; }
    if (normalizeText(a['sort-name']) === target) { best = a; break; }
  }
  return {
    country: best.country || best.area?.['iso-3166-1-codes']?.[0] || null,
    area: best.area?.name || best['begin-area']?.name || null,
  };
}

async function lookupAlbum(artist, title, delayMs) {
  const artistTerm = escQueryTerm(artist);
  const titleTerm = escQueryTerm(title);
  if (!artistTerm || !titleTerm) return null;

  const queries = [
    `artist:"${artistTerm}" AND release:"${titleTerm}"`,
    `release:"${titleTerm}" AND artist:"${artistTerm}"`,
    `release:"${titleTerm}"`,
  ];

  const candidates = new Map();
  for (const query of queries) {
    const releases = await searchRelease(query, delayMs, 6);
    for (const r of releases) {
      if (r?.id) candidates.set(r.id, r);
    }
    if (candidates.size >= 6) break;
  }

  const best = pickBestRelease([...candidates.values()], artist, title);
  let country = null;
  let language = null;
  let mbid = null;
  let score = 0;

  if (best) {
    ({ country, language } = extractCountryLanguage(best));
    mbid = best.id || null;
    score = best.__combinedScore || 0;

    if ((!country || !language) && best.id) {
      const details = await fetchReleaseDetails(best.id, delayMs);
      if (details) {
        const detailValues = extractCountryLanguage(details);
        country = country || detailValues.country;
        language = language || detailValues.language;
      }
    }
  }

  // Fallback: look up artist directly for country + infer language
  if (!country || country === 'XW' || !language) {
    const artistInfo = await lookupArtist(artist, delayMs);
    if (artistInfo?.country && (!country || country === 'XW')) {
      country = artistInfo.country;
    }
    // Infer language from artist country if still missing
    if (!language && country) {
      const COUNTRY_TO_LANG = {
        US:'eng',GB:'eng',AU:'eng',CA:'eng',NZ:'eng',IE:'eng',JM:'eng',
        FR:'fra',BE:'fra',SN:'fra',CI:'fra',
        DE:'deu',AT:'deu',CH:'deu',
        ES:'spa',MX:'spa',AR:'spa',CO:'spa',CL:'spa',PE:'spa',CU:'spa',PR:'spa',VE:'spa',EC:'spa',DO:'spa',UY:'spa',
        BR:'por',PT:'por',AO:'por',MZ:'por',
        IT:'ita',JP:'jpn',KR:'kor',CN:'zho',TW:'zho',HK:'zho',
        RU:'rus',UA:'ukr',PL:'pol',CZ:'ces',SE:'swe',NO:'nor',DK:'dan',FI:'fin',
        NL:'nld',IS:'isl',GR:'ell',TR:'tur',IL:'heb',RO:'ron',HU:'hun',
        IN:'hin',PK:'urd',BD:'ben',TH:'tha',VN:'vie',ID:'ind',PH:'tgl',
        NG:'eng',GH:'eng',KE:'eng',ZA:'eng',ET:'amh',TZ:'swa',
        EG:'ara',MA:'ara',SA:'ara',IQ:'ara',IR:'fas',
        XW:'eng',XE:'eng',
      };
      language = COUNTRY_TO_LANG[country] || null;
    }
  }

  if (!country && !language && !mbid) return null;

  return {
    country: country || null,
    language: language || null,
    mbid,
    score,
  };
}

function inferUnknownsFromKnownArtists(albums, enrichmentData) {
  const votesByArtist = new Map();

  for (const album of albums) {
    const key = (album.artist || '').trim().toLowerCase();
    if (!key) continue;
    const e = enrichmentData[album.url];
    if (!hasKnownCountryLanguage(e)) continue;

    const pair = `${e.country}__${e.language}`;
    if (!votesByArtist.has(key)) votesByArtist.set(key, new Map());
    const voteMap = votesByArtist.get(key);
    voteMap.set(pair, (voteMap.get(pair) || 0) + 1);
  }

  function topPair(map) {
    let best = null;
    let bestCount = -1;
    for (const [pair, count] of map.entries()) {
      if (count > bestCount) {
        best = pair;
        bestCount = count;
      }
    }
    return best;
  }

  let inferred = 0;
  for (const album of albums) {
    const key = (album.artist || '').trim().toLowerCase();
    if (!key) continue;
    const existing = enrichmentData[album.url];
    if (!existing || !isUnknownValue(existing.country) || !isUnknownValue(existing.language)) continue;
    const voteMap = votesByArtist.get(key);
    if (!voteMap || voteMap.size === 0) continue;

    const pair = topPair(voteMap);
    if (!pair) continue;
    const [country, language] = pair.split('__');
    enrichmentData[album.url] = {
      ...existing,
      country,
      language,
    };
    inferred++;
  }

  return inferred;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : Infinity;
  const resolveUnknown = args.includes('--resolve-unknown');
  const inferFromArtist = args.includes('--infer-from-artist');
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

  // Load existing enrichment data
  let enrichmentData = {};
  if (fs.existsSync(ENRICH_FILE)) {
    try {
      enrichmentData = JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf-8'));
    } catch { enrichmentData = {}; }
  }

  const albums = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  if (inferFromArtist) {
    const inferred = inferUnknownsFromKnownArtists(albums, enrichmentData);
    if (inferred > 0) {
      writeJsonAtomic(ENRICH_FILE, enrichmentData);
      console.log(`Inferred ${inferred} unknown entries from known artist mappings.`);
    }
  }

  const candidates = albums.filter(a => {
    if (!a.url) return false;
    const existing = enrichmentData[a.url];
    if (!existing) return true;
    if (!resolveUnknown) return false;
    return isUnknownValue(existing.country) || isUnknownValue(existing.language);
  });

  console.log(`Total albums: ${albums.length}`);
  console.log(`Already enriched: ${Object.keys(enrichmentData).length}`);
  console.log(`Resolve unknown mode: ${resolveUnknown ? 'ON' : 'OFF'}`);
  console.log(`Workers: ${workers}, Delay per request: ${delayMs}ms`);
  console.log(`To enrich: ${Math.min(candidates.length, limit)}\n`);

  if (candidates.length === 0) {
    console.log('No matching candidates. Exiting.');
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
        const result = await lookupAlbum(album.artist, album.title, delayMs);
        const prior = enrichmentData[album.url] || {};
        const country = result?.country || (!isUnknownValue(prior.country) ? prior.country : null) || 'Unknown';
        const language = result?.language || (!isUnknownValue(prior.language) ? prior.language : null) || 'Unknown';
        enrichmentData[album.url] = {
          ...prior,
          country,
          language,
          mbid: result?.mbid || prior.mbid || null,
        };

        if (country !== 'Unknown' && language !== 'Unknown') resolved++;
        else unresolved++;
      } catch {
        const prior = enrichmentData[album.url] || {};
        enrichmentData[album.url] = {
          ...prior,
          country: prior.country || 'Unknown',
          language: prior.language || 'Unknown',
          mbid: prior.mbid || null,
        };
        unresolved++;
        failed++;
      } finally {
        processed++;
        if (processed % 10 === 0 || processed === total) {
          const pct = ((processed / total) * 100).toFixed(1);
          process.stdout.write(
            `\r[${pct}%] ${processed}/${total} | resolved ${resolved} | unresolved ${unresolved} | failed ${failed} | w${workerId}`
          );
        }
        if (processed % saveEvery === 0) {
          writeJsonAtomic(ENRICH_FILE, enrichmentData);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, (_, i) => workerLoop(i + 1)));

  // Final save
  writeJsonAtomic(ENRICH_FILE, enrichmentData);

  console.log(`\n\nDone! Processed ${processed} albums.`);
  console.log(`Resolved with known country+language: ${resolved}`);
  console.log(`Still unresolved (Unknown in one/both fields): ${unresolved}`);
  console.log(`Lookup failures: ${failed}`);
  console.log(`Saved to ${ENRICH_FILE}`);

  // Country stats
  const countries = {};
  Object.values(enrichmentData).forEach(e => {
    if (e.country) countries[e.country] = (countries[e.country] || 0) + 1;
  });
  const topCountries = Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('\nTop countries:');
  topCountries.forEach(([c, n]) => console.log(`  ${c}: ${n}`));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
