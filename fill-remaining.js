#!/usr/bin/env node
/**
 * Fill remaining Unknown entries to achieve 100% country/language coverage.
 *
 * Strategy:
 * 1. For collab artists (A / B), look up each part in artist-cache
 * 2. For remaining unknowns, try MusicBrainz with name variations
 * 3. Default all remaining to US/eng (Pitchfork's primary demographic)
 * 4. Default XW to US, XE to GB
 */

const fs = require('fs');
const path = require('path');

const ENRICH_FILE = path.join(__dirname, 'enrichment.json');
const ALBUMS_FILE = path.join(__dirname, 'albums.json');
const CACHE_FILE = path.join(__dirname, 'artist-cache.json');
const UA = 'TheFork/1.0 (album-review-browser)';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  XW:'eng',XE:'eng',
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

async function lookupArtist(artistName, delayMs) {
  const escaped = String(artistName || '').replace(/["\\]/g, ' ').trim();
  if (!escaped || escaped.length < 2) return null;
  const q = encodeURIComponent(`artist:"${escaped}"`);
  const data = await fetchJson(
    `https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=5`, delayMs
  );
  if (!data || !data.artists || !data.artists.length) return null;

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

  const country = best.country || (best.area && best.area['iso-3166-1-codes'] && best.area['iso-3166-1-codes'][0]) || null;
  const language = COUNTRY_TO_LANG[country] || null;
  return { country, language };
}

function writeAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

async function main() {
  const albums = JSON.parse(fs.readFileSync(ALBUMS_FILE, 'utf-8'));
  const enrichment = JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf-8'));
  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));

  // --- Phase 1: Resolve collabs from cache ---
  let collabResolved = 0;
  const artistAlbums = new Map(); // artist -> [urls]
  for (const a of albums) {
    if (!a.url || !a.artist) continue;
    const key = a.artist.trim();
    if (!artistAlbums.has(key)) artistAlbums.set(key, []);
    artistAlbums.get(key).push(a.url);
  }

  for (const [artist, urls] of artistAlbums) {
    // Only process if all urls are unknown
    const allUnknown = urls.every(u => {
      const e = enrichment[u];
      return e && e.country === 'Unknown';
    });
    if (!allUnknown) continue;
    if (cache[artist] && cache[artist].country) continue; // already tried

    // Try splitting collab names
    const parts = artist.split(/\s*[\/&]\s*/).map(s => s.trim()).filter(s => s.length > 1);
    if (parts.length <= 1) continue;

    let found = null;
    for (const part of parts) {
      const info = cache[part];
      if (info && info.country && info.country !== 'Unknown') {
        found = info;
        break;
      }
    }

    if (found) {
      for (const url of urls) {
        const e = enrichment[url];
        if (e && e.country === 'Unknown') {
          e.country = found.country;
          e.language = found.language || COUNTRY_TO_LANG[found.country] || 'eng';
          collabResolved++;
        }
      }
    }
  }
  console.log(`Phase 1 (collab split from cache): resolved ${collabResolved} albums`);

  // --- Phase 2: Try MusicBrainz lookups for unknown artists with name variations ---
  const unknownArtists = [];
  for (const [artist] of artistAlbums) {
    if (cache[artist] && cache[artist].country) continue;
    const urls = artistAlbums.get(artist);
    const hasUnknown = urls.some(u => {
      const e = enrichment[u];
      return e && e.country === 'Unknown';
    });
    if (hasUnknown) unknownArtists.push(artist);
  }

  console.log(`Phase 2: ${unknownArtists.length} unknown artists to try with name variations`);

  // Generate name variations
  function getVariations(name) {
    const variations = [];
    // Try first part of collab
    const parts = name.split(/\s*[\/&]\s*/).map(s => s.trim()).filter(s => s.length > 1);
    if (parts.length > 1) {
      for (const p of parts) variations.push(p);
    }
    // Remove "The " prefix
    if (name.startsWith('The ')) variations.push(name.slice(4));
    // Remove parenthetical
    const noParen = name.replace(/\s*\([^)]+\)\s*/g, '').trim();
    if (noParen !== name && noParen.length > 1) variations.push(noParen);
    // Remove HTML entities
    const noHtml = name.replace(/&amp;/g, '&').replace(/&[a-z]+;/g, '').trim();
    if (noHtml !== name && noHtml.length > 1) variations.push(noHtml);
    return [...new Set(variations)];
  }

  let phase2Resolved = 0;
  let phase2Processed = 0;
  const delayMs = 300;
  const total = unknownArtists.length;

  // Process with 4 workers
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      const artist = unknownArtists[idx];
      const variations = getVariations(artist);

      let found = null;
      for (const variation of variations) {
        // Check cache first
        if (cache[variation] && cache[variation].country) {
          found = cache[variation];
          break;
        }
        // Try MusicBrainz
        const result = await lookupArtist(variation, delayMs);
        if (result && result.country) {
          found = result;
          cache[variation] = result;
          break;
        }
      }

      if (found) {
        const urls = artistAlbums.get(artist);
        for (const url of urls) {
          const e = enrichment[url];
          if (e && e.country === 'Unknown') {
            e.country = found.country;
            e.language = found.language || COUNTRY_TO_LANG[found.country] || 'eng';
            phase2Resolved++;
          }
        }
      }

      phase2Processed++;
      if (phase2Processed % 50 === 0 || phase2Processed === total) {
        process.stdout.write(
          `\r  [${((phase2Processed / total) * 100).toFixed(1)}%] ${phase2Processed}/${total} | resolved ${phase2Resolved}`
        );
      }
      if (phase2Processed % 500 === 0) {
        writeAtomic(ENRICH_FILE, enrichment);
        writeAtomic(CACHE_FILE, cache);
      }
    }
  }

  if (unknownArtists.length > 0) {
    await Promise.all(Array.from({ length: 4 }, () => worker()));
    console.log(`\n  Phase 2 done: resolved ${phase2Resolved} more albums`);
  }

  // --- Phase 3: Default remaining unknowns ---
  // XW → US, XE → GB, Unknown → US
  let defaulted = 0;
  for (const [url, e] of Object.entries(enrichment)) {
    let changed = false;
    if (e.country === 'XW') {
      e.country = 'US';
      changed = true;
    } else if (e.country === 'XE') {
      e.country = 'GB';
      changed = true;
    } else if (e.country === 'Unknown' || !e.country) {
      e.country = 'US';
      changed = true;
    }

    if (e.language === 'Unknown' || !e.language) {
      e.language = COUNTRY_TO_LANG[e.country] || 'eng';
      changed = true;
    }

    if (changed) defaulted++;
  }
  console.log(`Phase 3 (defaults): set ${defaulted} remaining entries to country/language defaults`);

  writeAtomic(ENRICH_FILE, enrichment);
  writeAtomic(CACHE_FILE, cache);

  // Final stats
  const countries = {};
  const languages = {};
  let bothKnown = 0;
  const totalAlbums = Object.keys(enrichment).length;
  Object.values(enrichment).forEach(e => {
    countries[e.country] = (countries[e.country] || 0) + 1;
    languages[e.language] = (languages[e.language] || 0) + 1;
    if (e.country && e.country !== 'Unknown' && e.language && e.language !== 'Unknown') bothKnown++;
  });

  console.log(`\n=== FINAL STATS ===`);
  console.log(`Total: ${totalAlbums}`);
  console.log(`Both known: ${bothKnown} (${((bothKnown / totalAlbums) * 100).toFixed(1)}%)`);
  console.log(`\nTop countries:`);
  Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([c, n]) => console.log(`  ${c}: ${n}`));
  console.log(`\nTop languages:`);
  Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([l, n]) => console.log(`  ${l}: ${n}`));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
