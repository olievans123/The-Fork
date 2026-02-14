#!/usr/bin/env node

/**
 * Artist-based enrichment: looks up each unique artist ONCE on MusicBrainz,
 * then applies country + inferred language to all their albums.
 *
 * Much faster and higher hit rate than per-release lookups.
 *
 * Usage:
 *   node enrich-artists.js
 *   node enrich-artists.js --workers 6
 *   node enrich-artists.js --refresh-missing-country
 *   node enrich-artists.js --refresh-missing
 *   node enrich-artists.js --artist "Ja Rule"
 *   node enrich-artists.js --artists-file unknown-artists.txt
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'albums.json');
const ENRICH_FILE = path.join(__dirname, 'enrichment.json');
const ARTIST_CACHE = path.join(__dirname, 'artist-cache.json');
const UA = 'TheFork/1.0 (album-review-browser)';
const DEFAULT_DELAY = 300;
const DEFAULT_WORKERS = 4;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isKnown(v) {
  return typeof v === 'string' && v.trim() && v.trim() !== 'Unknown';
}

function getArgValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
}

function readArtistList(filePath) {
  if (!filePath) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(v => String(v || '').trim()).filter(Boolean);
    }
    return raw.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const COUNTRY_TO_LANG = {
  US:'eng',GB:'eng',AU:'eng',CA:'eng',NZ:'eng',IE:'eng',JM:'eng',TT:'eng',BB:'eng',
  BS:'eng',GY:'eng',BZ:'eng',ZA:'eng',NG:'eng',GH:'eng',KE:'eng',UG:'eng',SL:'eng',
  FR:'fra',BE:'fra',SN:'fra',CI:'fra',ML:'fra',BF:'fra',NE:'fra',TD:'fra',CM:'fra',
  MG:'fra',HT:'fra',LU:'fra',MC:'fra',
  DE:'deu',AT:'deu',CH:'deu',LI:'deu',
  ES:'spa',MX:'spa',AR:'spa',CO:'spa',CL:'spa',PE:'spa',CU:'spa',PR:'spa',VE:'spa',
  EC:'spa',DO:'spa',UY:'spa',GT:'spa',HN:'spa',SV:'spa',NI:'spa',CR:'spa',PA:'spa',
  BO:'spa',PY:'spa',GQ:'spa',
  BR:'por',PT:'por',AO:'por',MZ:'por',CV:'por',
  IT:'ita',SM:'ita',
  JP:'jpn',KR:'kor',CN:'zho',TW:'zho',HK:'zho',MO:'zho',
  RU:'rus',BY:'rus',
  UA:'ukr',PL:'pol',CZ:'ces',SK:'slk',
  SE:'swe',NO:'nor',DK:'dan',FI:'fin',IS:'isl',
  NL:'nld',GR:'ell',TR:'tur',IL:'heb',RO:'ron',HU:'hun',BG:'bul',
  HR:'hrv',RS:'srp',BA:'srp',SI:'slv',MK:'mkd',AL:'sqi',ME:'srp',
  IN:'hin',PK:'urd',BD:'ben',LK:'sin',NP:'nep',
  TH:'tha',VN:'vie',ID:'ind',MY:'msa',PH:'tgl',MM:'mya',KH:'khm',LA:'lao',
  EG:'ara',MA:'ara',DZ:'ara',TN:'ara',LY:'ara',SA:'ara',IQ:'ara',SY:'ara',
  JO:'ara',LB:'ara',YE:'ara',OM:'ara',AE:'ara',QA:'ara',BH:'ara',KW:'ara',
  IR:'fas',AF:'pus',
  ET:'amh',TZ:'swa',RW:'kin',BI:'run',
  XW:'eng',XE:'eng',XU:null,
};

function normalizeText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
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

async function fetchArtistDetails(artistId, delayMs) {
  if (!artistId) return null;
  return fetchJson(`https://musicbrainz.org/ws/2/artist/${artistId}?fmt=json`, delayMs);
}

async function lookupArtist(artistName, delayMs) {
  const escaped = String(artistName || '').replace(/["\\]/g, ' ').trim();
  if (!escaped) return null;
  const q = encodeURIComponent(`artist:"${escaped}"`);
  const data = await fetchJson(
    `https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=5`, delayMs
  );
  if (!data?.artists?.length) return null;

  const target = normalizeText(artistName);
  let best = null;
  let bestScore = -1;

  for (const a of data.artists) {
    let score = parseInt(a.score || '0', 10);
    const name = normalizeText(a.name);
    const sortName = normalizeText(a['sort-name']);
    if (name === target) score += 50;
    else if (sortName === target) score += 40;
    else if (name.includes(target) || target.includes(name)) score += 20;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  if (!best || bestScore < 50) return null;

  let country = best.country || best.area?.['iso-3166-1-codes']?.[0] || null;
  let area = best.area?.name || best['begin-area']?.name || null;

  // Search responses sometimes omit country; fetch artist detail for stronger data.
  if ((!country || !area) && best.id) {
    const detail = await fetchArtistDetails(best.id, delayMs);
    if (detail) {
      country = country
        || detail.country
        || detail.area?.['iso-3166-1-codes']?.[0]
        || detail['begin-area']?.['iso-3166-1-codes']?.[0]
        || null;
      area = area || detail.area?.name || detail['begin-area']?.name || null;
    }
  }

  const language = COUNTRY_TO_LANG[country] || null;

  return { country, area, language, mbid: best.id || null };
}

function writeAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

async function main() {
  const args = process.argv.slice(2);
  const refreshMissingCountry = args.includes('--refresh-missing-country');
  const refreshMissing = args.includes('--refresh-missing');
  const targetArtist = getArgValue(args, '--artist');
  const artistsFile = getArgValue(args, '--artists-file');
  const artistsFromFile = readArtistList(artistsFile);
  const workers = args.includes('--workers')
    ? Math.max(1, parseInt(getArgValue(args, '--workers')) || DEFAULT_WORKERS)
    : DEFAULT_WORKERS;
  const delayMs = args.includes('--delay')
    ? Math.max(100, parseInt(getArgValue(args, '--delay')) || DEFAULT_DELAY)
    : DEFAULT_DELAY;

  const albums = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  let enrichment = {};
  if (fs.existsSync(ENRICH_FILE)) {
    try { enrichment = JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf-8')); } catch {}
  }

  // Load artist cache
  let artistCache = {};
  if (fs.existsSync(ARTIST_CACHE)) {
    try { artistCache = JSON.parse(fs.readFileSync(ARTIST_CACHE, 'utf-8')); } catch {}
  }

  // Build list of unique artists that still need lookup
  const artistAlbums = new Map(); // artist -> [album urls]
  for (const a of albums) {
    if (!a.artist || !a.url) continue;
    const key = a.artist.trim();
    if (!artistAlbums.has(key)) artistAlbums.set(key, []);
    artistAlbums.get(key).push(a.url);
  }

  // Build lookup queue according to mode
  let toLookup;
  if (artistsFromFile.length > 0) {
    toLookup = [...new Set(artistsFromFile)];
  } else if (targetArtist) {
    toLookup = [targetArtist.trim()];
  } else if (refreshMissingCountry) {
    toLookup = [...artistAlbums.keys()].filter(a => {
      const cached = artistCache[a];
      return !cached || !isKnown(cached.country);
    });
  } else if (refreshMissing) {
    toLookup = [...artistAlbums.keys()].filter(a => {
      const cached = artistCache[a];
      return !cached || !isKnown(cached.country) || !isKnown(cached.language);
    });
  } else {
    toLookup = [...artistAlbums.keys()].filter(a => !(a in artistCache));
  }

  console.log(`Total albums: ${albums.length}`);
  console.log(`Unique artists: ${artistAlbums.size}`);
  console.log(`Already cached: ${Object.keys(artistCache).length}`);
  const mode = targetArtist
    ? `single artist (${targetArtist})`
    : artistsFromFile.length > 0
      ? `artists file (${artistsFromFile.length} artists)`
    : refreshMissingCountry
      ? 'refresh missing country'
      : refreshMissing
        ? 'refresh missing country/language'
        : 'lookup uncached';
  console.log(`Mode: ${mode}`);
  console.log(`To look up: ${toLookup.length}`);
  console.log(`Workers: ${workers}, Delay: ${delayMs}ms\n`);

  // Parallel artist lookups
  let cursor = 0;
  let resolved = 0;
  let missed = 0;
  let processed = 0;
  const total = toLookup.length;

  async function worker(id) {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      const artist = toLookup[idx];
      const result = await lookupArtist(artist, delayMs);
      const previous = artistCache[artist] || { country: null, area: null, language: null, mbid: null };
      artistCache[artist] = result
        ? { ...previous, ...result }
        : previous;
      if (result?.country) resolved++;
      else missed++;
      processed++;
      if (processed % 20 === 0 || processed === total) {
        process.stdout.write(
          `\r[${((processed/total)*100).toFixed(1)}%] ${processed}/${total} | found ${resolved} | missed ${missed}`
        );
      }
      if (processed % 200 === 0) {
        writeAtomic(ARTIST_CACHE, artistCache);
      }
    }
  }

  if (total > 0) {
    await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
    writeAtomic(ARTIST_CACHE, artistCache);
    console.log(`\n\nArtist lookups done: ${resolved} found, ${missed} missed.\n`);
  }

  // Apply artist data to enrichment
  let applied = 0;
  let stillUnknown = 0;
  for (const [artist, urls] of artistAlbums) {
    const info = artistCache[artist];
    for (const url of urls) {
      const existing = enrichment[url] || {};
      const country = info?.country || existing.country || 'Unknown';
      const language = info?.language || existing.language || COUNTRY_TO_LANG[country] || 'Unknown';

      enrichment[url] = { ...existing, country, language };
      if (country !== 'Unknown' && language !== 'Unknown') applied++;
      else stillUnknown++;
    }
  }

  writeAtomic(ENRICH_FILE, enrichment);

  // Stats
  const countries = {};
  const languages = {};
  Object.values(enrichment).forEach(e => {
    countries[e.country] = (countries[e.country] || 0) + 1;
    languages[e.language] = (languages[e.language] || 0) + 1;
  });

  console.log(`Applied to albums: ${applied} known, ${stillUnknown} still unknown`);
  console.log(`\nTop countries:`);
  Object.entries(countries).sort((a,b) => b[1]-a[1]).slice(0,15)
    .forEach(([c,n]) => console.log(`  ${c}: ${n}`));
  console.log(`\nTop languages:`);
  Object.entries(languages).sort((a,b) => b[1]-a[1]).slice(0,15)
    .forEach(([l,n]) => console.log(`  ${l}: ${n}`));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
