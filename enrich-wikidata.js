#!/usr/bin/env node
/**
 * Wikidata artist enrichment: looks up unknown artists on Wikidata
 * to get country of origin/citizenship, then bakes into enrichment.json.
 *
 * Usage: node enrich-wikidata.js [--dry-run] [--workers 4]
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'albums.json');
const ENRICH_FILE = path.join(__dirname, 'enrichment.json');
const ARTIST_CACHE = path.join(__dirname, 'artist-cache.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function artistKey(name) { return (name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function isKnown(v) { return typeof v === 'string' && v.trim() && v !== 'Unknown'; }

const PRIMARY_LANG = { US:'eng',GB:'eng',CA:'eng',AU:'eng',NZ:'eng',IE:'eng',DE:'deu',FR:'fra',ES:'spa',IT:'ita',JP:'jpn',KR:'kor',BR:'por',PT:'por',SE:'swe',NO:'nor',DK:'dan',FI:'fin',NL:'nld',BE:'nld',AT:'deu',CH:'deu',MX:'spa',AR:'spa',CO:'spa',CL:'spa',PE:'spa',CU:'spa',PR:'spa',JM:'eng',TT:'eng',IN:'hin',CN:'cmn',TW:'cmn',RU:'rus',UA:'ukr',PL:'pol',CZ:'ces',GR:'ell',TR:'tur',IL:'heb',NG:'eng',ZA:'eng',EG:'ara',KE:'eng',GH:'eng',SN:'fra',IS:'isl',ID:'ind',PH:'tgl',LB:'ara',ML:'fra',CD:'fra',UG:'eng',ET:'amh',MA:'ara' };

const COUNTRY_Q = {
  Q30:'US',Q145:'GB',Q16:'CA',Q408:'AU',Q664:'NZ',Q27:'IE',Q142:'FR',Q183:'DE',
  Q34:'SE',Q20:'NO',Q35:'DK',Q33:'FI',Q189:'IS',Q55:'NL',Q31:'BE',Q38:'IT',
  Q29:'ES',Q45:'PT',Q17:'JP',Q884:'KR',Q155:'BR',Q96:'MX',Q414:'AR',Q739:'CO',
  Q298:'CL',Q241:'CU',Q1183:'PR',Q766:'JM',Q733:'TT',Q1033:'NG',Q117:'GH',
  Q258:'ZA',Q115:'ET',Q912:'ML',Q1041:'SN',Q974:'CD',Q1036:'UG',Q114:'KE',
  Q212:'UA',Q668:'IN',Q148:'CN',Q865:'TW',Q252:'ID',Q928:'PH',Q801:'IL',
  Q822:'LB',Q159:'RU',Q36:'PL',Q213:'CZ',Q41:'GR',Q43:'TR',Q79:'EG',Q1028:'MA',
  Q22:'GB',Q25:'GB',Q26:'GB', // Scotland, Wales, N. Ireland -> GB
  Q15180:'RU', // Soviet Union -> RU
  Q36704:'US', // New York City -> US
  Q65:'US', // Los Angeles -> US
  Q1297:'US', // Chicago -> US
  Q84:'GB', // London -> GB
  Q64:'DE', // Berlin -> DE
  Q90:'FR', // Paris -> FR
  Q1490:'JP', // Tokyo -> JP
  Q60:'US', // NYC again
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'TheFork/1.0 (album-review-browser)' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function lookupArtist(artist) {
  const q = encodeURIComponent(artist);
  const search = await httpGet(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${q}&language=en&type=item&limit=5&format=json`);
  if (!search.search || search.search.length === 0) return null;

  for (const result of search.search) {
    const desc = (result.description || '').toLowerCase();
    // Filter for music-related entities
    if (!desc.includes('band') && !desc.includes('musician') && !desc.includes('singer') &&
        !desc.includes('rapper') && !desc.includes('artist') && !desc.includes('group') &&
        !desc.includes('duo') && !desc.includes('trio') && !desc.includes('quartet') &&
        !desc.includes('composer') && !desc.includes('dj') && !desc.includes('disc jockey') &&
        !desc.includes('producer') && !desc.includes('music') && !desc.includes('vocalist') &&
        !desc.includes('guitarist') && !desc.includes('drummer') && !desc.includes('bassist') &&
        !desc.includes('pianist') && !desc.includes('songwriter') && !desc.includes('hip hop') &&
        !desc.includes('rock') && !desc.includes('pop') && !desc.includes('jazz') &&
        !desc.includes('electronic') && !desc.includes('punk') && !desc.includes('metal') &&
        !desc.includes('folk') && !desc.includes('soul') && !desc.includes('r&b') &&
        !desc.includes('rap') && !desc.includes('mc') && !desc.includes('emcee')) continue;

    const entity = await httpGet(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${result.id}&props=claims&format=json`);
    const claims = entity.entities?.[result.id]?.claims;
    if (!claims) continue;

    // P495 = country of origin, P27 = country of citizenship
    // P740 = location of formation, P19 = place of birth
    for (const prop of ['P495', 'P27', 'P740', 'P19']) {
      const claim = claims[prop];
      if (!claim) continue;
      const qid = claim[0]?.mainsnak?.datavalue?.value?.id;
      if (qid && COUNTRY_Q[qid]) return COUNTRY_Q[qid];

      // If the QID isn't directly a country, look up its country (P17)
      if (qid && !COUNTRY_Q[qid]) {
        try {
          const loc = await httpGet(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`);
          const locClaims = loc.entities?.[qid]?.claims;
          const countryQ = locClaims?.P17?.[0]?.mainsnak?.datavalue?.value?.id;
          if (countryQ && COUNTRY_Q[countryQ]) return COUNTRY_Q[countryQ];
        } catch {}
      }
    }
    await sleep(500);
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const workerCount = parseInt(args[args.indexOf('--workers') + 1]) || 2;

  const albums = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const enrichment = JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf8'));
  const artistCache = JSON.parse(fs.readFileSync(ARTIST_CACHE, 'utf8'));

  // Find unknown artists
  const unknownArtists = new Map(); // artistKey -> { name, urls: [] }
  albums.forEach(album => {
    if (album.artist === 'Various Artists' || album.artist === 'Unknown') return;
    const entry = enrichment[album.url];
    if (entry && isKnown(entry.country) && !['XW','XE','XU'].includes(entry.country)) return;
    // Check artist-cache
    const acEntry = Object.values(artistCache).find(v => v.name === album.artist);
    if (acEntry && isKnown(acEntry.country)) return;

    const key = artistKey(album.artist);
    if (!unknownArtists.has(key)) {
      unknownArtists.set(key, { name: album.artist, urls: [] });
    }
    unknownArtists.get(key).urls.push(album.url);
  });

  const artists = [...unknownArtists.values()];
  console.log(`Wikidata Artist Enrichment`);
  console.log(`==========================`);
  console.log(`Unknown artists: ${artists.length}`);
  console.log(`Workers: ${workerCount}, Dry run: ${dryRun}`);
  console.log();

  let found = 0, missed = 0, errors = 0, processed = 0;

  async function processArtist(artist) {
    try {
      const country = await lookupArtist(artist.name);
      processed++;
      if (country) {
        found++;
        const lang = PRIMARY_LANG[country] || 'Unknown';
        if (!dryRun) {
          artist.urls.forEach(url => {
            if (enrichment[url]) {
              enrichment[url].country = country;
              if (!isKnown(enrichment[url].language)) enrichment[url].language = lang;
            }
          });
        }
        if (found <= 20 || found % 50 === 0) {
          process.stdout.write(`  [FOUND] ${artist.name} -> ${country} (${artist.urls.length} albums)\n`);
        }
      } else {
        missed++;
      }

      if (processed % 20 === 0) {
        const pct = (100 * processed / artists.length).toFixed(1);
        process.stdout.write(`\r[${pct}%] ${processed}/${artists.length} | found ${found} | missed ${missed} | errors ${errors}`);
      }
    } catch (err) {
      errors++;
      processed++;
    }
    await sleep(800);
  }

  // Process in batches
  for (let i = 0; i < artists.length; i += workerCount) {
    const batch = artists.slice(i, i + workerCount);
    await Promise.all(batch.map(a => processArtist(a)));
  }

  console.log(`\r[100%] ${processed}/${artists.length} | found ${found} | missed ${missed} | errors ${errors}`);
  console.log();

  if (!dryRun) {
    fs.writeFileSync(ENRICH_FILE, JSON.stringify(enrichment, null, 2));
    console.log(`Saved enrichment.json`);

    // Count remaining unknowns
    const remaining = albums.filter(album => {
      const entry = enrichment[album.url];
      return !entry || !isKnown(entry.country) || ['XW','XE','XU'].includes(entry.country);
    }).length;
    console.log(`Remaining unknown: ${remaining} / ${albums.length} (${(100*remaining/albums.length).toFixed(1)}%)`);
  }

  console.log(`\nFound country for ${found} artists (${(100*found/artists.length).toFixed(1)}% hit rate)`);
}

main().catch(console.error);
