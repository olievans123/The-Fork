#!/usr/bin/env node
/**
 * Scrape full Pitchfork review text for remaining unknown-country albums,
 * then run CONTEXT-AWARE text inference to extract country.
 *
 * Only matches patterns that indicate artist origin:
 *   - Nationality adjectives ("the Japanese composer", "Norwegian trumpeter")
 *   - "based in [city]", "[city]-based"
 *   - "from [city/country]", "hails from", "native of"
 *   - "[city] band/group/act/outfit/trio/duo"
 *
 * Does NOT match random location mentions in reviews (tour stops, reviewer context, etc.)
 *
 * Usage: node enrich-reviews.js [--workers 4] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'albums.json');
const ENRICH_FILE = path.join(__dirname, 'enrichment.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PITCHFORK = 'https://pitchfork.com';
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isKnown(v) { return typeof v === 'string' && v.trim() && v !== 'Unknown'; }

const PRIMARY_LANG = { US:'eng',GB:'eng',CA:'eng',AU:'eng',NZ:'eng',IE:'eng',DE:'deu',FR:'fra',ES:'spa',IT:'ita',JP:'jpn',KR:'kor',BR:'por',PT:'por',SE:'swe',NO:'nor',DK:'dan',FI:'fin',NL:'nld',BE:'nld',AT:'deu',CH:'deu',MX:'spa',AR:'spa',CO:'spa',CL:'spa',PE:'spa',CU:'spa',PR:'spa',JM:'eng',TT:'eng',IN:'hin',CN:'cmn',TW:'cmn',RU:'rus',UA:'ukr',PL:'pol',CZ:'ces',GR:'ell',TR:'tur',IL:'heb',NG:'eng',ZA:'eng',EG:'ara',KE:'eng',GH:'eng',SN:'fra',IS:'isl',IR:'fas',ZW:'eng',VE:'spa',MG:'mlg',HK:'cmn',TH:'tha',HR:'hrv',RS:'srp',RO:'ron',HU:'hun',DZ:'ara',AO:'por',CM:'fra',UG:'eng',ET:'amh',ML:'fra',CD:'fra',ID:'ind',LB:'ara',MA:'ara',PK:'urd',VN:'vie',TZ:'swa',UY:'spa',HT:'fra',MM:'mya',BD:'ben',SG:'eng',PH:'tgl',BG:'bul' };

// Nationality adjectives → country code
const NATIONALITIES = [
  { code: 'US', words: ['american'] },
  { code: 'GB', words: ['british', 'english', 'scottish', 'welsh'] },
  { code: 'CA', words: ['canadian'] },
  { code: 'AU', words: ['australian'] },
  { code: 'NZ', words: ['new zealand', 'kiwi'] },
  { code: 'IE', words: ['irish'] },
  { code: 'FR', words: ['french'] },
  { code: 'DE', words: ['german'] },
  { code: 'SE', words: ['swedish'] },
  { code: 'NO', words: ['norwegian'] },
  { code: 'DK', words: ['danish'] },
  { code: 'FI', words: ['finnish'] },
  { code: 'IS', words: ['icelandic'] },
  { code: 'NL', words: ['dutch'] },
  { code: 'BE', words: ['belgian'] },
  { code: 'IT', words: ['italian'] },
  { code: 'ES', words: ['spanish'] },
  { code: 'PT', words: ['portuguese'] },
  { code: 'JP', words: ['japanese'] },
  { code: 'KR', words: ['korean', 'south korean'] },
  { code: 'BR', words: ['brazilian'] },
  { code: 'MX', words: ['mexican'] },
  { code: 'AR', words: ['argentinian', 'argentine'] },
  { code: 'CO', words: ['colombian'] },
  { code: 'CU', words: ['cuban'] },
  { code: 'JM', words: ['jamaican'] },
  { code: 'TT', words: ['trinidadian'] },
  { code: 'NG', words: ['nigerian'] },
  { code: 'GH', words: ['ghanaian'] },
  { code: 'ZA', words: ['south african'] },
  { code: 'ET', words: ['ethiopian'] },
  { code: 'ML', words: ['malian'] },
  { code: 'SN', words: ['senegalese'] },
  { code: 'CD', words: ['congolese'] },
  { code: 'UG', words: ['ugandan'] },
  { code: 'KE', words: ['kenyan'] },
  { code: 'UA', words: ['ukrainian'] },
  { code: 'IN', words: ['indian'] },
  { code: 'CN', words: ['chinese'] },
  { code: 'TW', words: ['taiwanese'] },
  { code: 'ID', words: ['indonesian'] },
  { code: 'IL', words: ['israeli'] },
  { code: 'LB', words: ['lebanese'] },
  { code: 'RU', words: ['russian'] },
  { code: 'PL', words: ['polish'] },
  { code: 'GR', words: ['greek'] },
  { code: 'TR', words: ['turkish'] },
  { code: 'EG', words: ['egyptian'] },
  { code: 'MA', words: ['moroccan'] },
  { code: 'IR', words: ['iranian', 'persian'] },
  { code: 'ZW', words: ['zimbabwean'] },
  { code: 'VE', words: ['venezuelan'] },
  { code: 'HR', words: ['croatian'] },
  { code: 'RS', words: ['serbian'] },
  { code: 'RO', words: ['romanian'] },
  { code: 'HU', words: ['hungarian'] },
  { code: 'BG', words: ['bulgarian'] },
  { code: 'TH', words: ['thai'] },
  { code: 'VN', words: ['vietnamese'] },
  { code: 'PK', words: ['pakistani'] },
  { code: 'PE', words: ['peruvian'] },
  { code: 'CL', words: ['chilean'] },
  { code: 'PR', words: ['puerto rican'] },
  { code: 'TZ', words: ['tanzanian'] },
  { code: 'CM', words: ['cameroonian'] },
  { code: 'AO', words: ['angolan'] },
  { code: 'DZ', words: ['algerian'] },
  { code: 'MG', words: ['malagasy'] },
  { code: 'HT', words: ['haitian'] },
  { code: 'MM', words: ['burmese'] },
  { code: 'BD', words: ['bangladeshi'] },
  { code: 'LK', words: ['sri lankan'] },
  { code: 'PH', words: ['filipino'] },
  { code: 'SG', words: ['singaporean'] },
  { code: 'NP', words: ['nepalese', 'nepali'] },
];

// Cities/regions that can appear in "[city]-based" or "from [city]" patterns
const CITY_COUNTRY = [
  // US
  ...['new york', 'nyc', 'brooklyn', 'queens', 'bronx', 'harlem', 'manhattan', 'los angeles', 'l.a.', 'chicago', 'atlanta', 'houston', 'detroit', 'oakland', 'san francisco', 'philadelphia', 'philly', 'seattle', 'new orleans', 'nashville', 'dallas', 'boston', 'minneapolis', 'portland, ore', 'portland, or', 'pittsburgh', 'memphis', 'cleveland', 'milwaukee', 'denver', 'phoenix', 'austin', 'tucson', 'san diego', 'sacramento', 'st. louis', 'omaha', 'raleigh', 'durham', 'richmond', 'savannah', 'ann arbor', 'baton rouge', 'gainesville', 'chapel hill', 'carrboro', 'olympia', 'washington, d.c', 'washington d.c', 'd.c.'].map(c => ({ city: c, code: 'US' })),
  // GB
  ...['london', 'manchester', 'liverpool', 'bristol', 'brighton', 'sheffield', 'glasgow', 'edinburgh', 'leeds', 'birmingham', 'nottingham', 'cardiff', 'newcastle', 'southampton', 'leicester', 'coventry', 'dundee', 'aberdeen', 'oxford', 'cambridge'].map(c => ({ city: c, code: 'GB' })),
  // Other
  { city: 'toronto', code: 'CA' }, { city: 'vancouver', code: 'CA' }, { city: 'montreal', code: 'CA' }, { city: 'montréal', code: 'CA' },
  { city: 'sydney', code: 'AU' }, { city: 'melbourne', code: 'AU' }, { city: 'brisbane', code: 'AU' },
  { city: 'dublin', code: 'IE' }, { city: 'paris', code: 'FR' }, { city: 'berlin', code: 'DE' },
  { city: 'hamburg', code: 'DE' }, { city: 'cologne', code: 'DE' }, { city: 'munich', code: 'DE' },
  { city: 'stockholm', code: 'SE' }, { city: 'gothenburg', code: 'SE' }, { city: 'oslo', code: 'NO' },
  { city: 'copenhagen', code: 'DK' }, { city: 'helsinki', code: 'FI' }, { city: 'reykjavik', code: 'IS' }, { city: 'reykjavík', code: 'IS' },
  { city: 'amsterdam', code: 'NL' }, { city: 'rotterdam', code: 'NL' }, { city: 'brussels', code: 'BE' },
  { city: 'tokyo', code: 'JP' }, { city: 'osaka', code: 'JP' }, { city: 'seoul', code: 'KR' },
  { city: 'são paulo', code: 'BR' }, { city: 'sao paulo', code: 'BR' }, { city: 'rio de janeiro', code: 'BR' },
  { city: 'mexico city', code: 'MX' }, { city: 'buenos aires', code: 'AR' }, { city: 'bogotá', code: 'CO' },
  { city: 'havana', code: 'CU' }, { city: 'kingston', code: 'JM' }, { city: 'lagos', code: 'NG' },
  { city: 'johannesburg', code: 'ZA' }, { city: 'cape town', code: 'ZA' }, { city: 'nairobi', code: 'KE' },
  { city: 'cairo', code: 'EG' }, { city: 'istanbul', code: 'TR' }, { city: 'tel aviv', code: 'IL' },
  { city: 'beirut', code: 'LB' }, { city: 'moscow', code: 'RU' }, { city: 'warsaw', code: 'PL' },
  { city: 'tehran', code: 'IR' }, { city: 'bangkok', code: 'TH' }, { city: 'jakarta', code: 'ID' },
  { city: 'addis ababa', code: 'ET' }, { city: 'dakar', code: 'SN' }, { city: 'bamako', code: 'ML' },
  { city: 'kinshasa', code: 'CD' }, { city: 'kampala', code: 'UG' },
];

// US states for "[state] native" / "from [state]" patterns
const US_STATES = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming'];

function inferCountryContextual(text) {
  text = String(text || '').toLowerCase();
  if (!text) return null;

  // 1. Nationality adjectives used to describe artist/band/musician etc.
  // Pattern: "[nationality] [music-word]" or "the [nationality] ..."
  const musicWords = '(?:artist|band|group|duo|trio|quartet|quintet|ensemble|musician|singer|songwriter|rapper|emcee|mc|producer|dj|composer|multi-instrumentalist|instrumentalist|vocalist|guitarist|bassist|drummer|pianist|trumpeter|saxophonist|violinist|cellist|percussionist|keyboardist|frontman|frontwoman|act|outfit|collective|project|supergroup|icon|legend|pioneer|veteran|native|expat|born)';

  for (const nat of NATIONALITIES) {
    for (const word of nat.words) {
      // "the Japanese composer" / "Japanese-born" / "a Brazilian icon"
      const pattern = new RegExp(`\\b${word}[- ]?${musicWords}|\\b${word}[- ]born\\b|\\bthe ${word} `, 'i');
      if (pattern.test(text)) return nat.code;
    }
  }

  // 2. "[city/country]-based" patterns
  for (const { city, code } of CITY_COUNTRY) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}[- ]based|based (?:in|out of) ${escaped}`, 'i');
    if (pattern.test(text)) return code;
  }

  // 3. "from [city]" / "hails from [city]" / "native of [city]" / "[city] native"
  for (const { city, code } of CITY_COUNTRY) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // "from Brooklyn" / "hails from Detroit" / "native of Chicago" / "Brooklyn native"
    const pattern = new RegExp(`(?:from|hails from|native of|raised in|grew up in|born in|living in|moved to|relocated to) ${escaped}\\b|\\b${escaped} (?:native|resident|local)`, 'i');
    if (pattern.test(text)) return code;
  }

  // 4. "[city] band/group/act" etc.
  for (const { city, code } of CITY_COUNTRY) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}(?:'s)? (?:band|group|act|outfit|trio|duo|quartet|ensemble|collective|scene|rapper|producer|dj|mc)\\b`, 'i');
    if (pattern.test(text)) return code;
  }

  // 5. US state patterns: "from [state]" / "[state] native" / "[state]-based"
  for (const state of US_STATES) {
    const escaped = state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:from|native of|based in|raised in|born in|grew up in) ${escaped}\\b|\\b${escaped}[- ](?:based|native|born|raised|bred)\\b|\\b${escaped} (?:band|group|act|outfit|trio|duo|native)\\b`, 'i');
    if (pattern.test(text)) return 'US';
  }

  return null;
}

async function fetchText(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA } });
      if (resp.ok) return await resp.text();
      if (!RETRYABLE.has(resp.status) || attempt === 3) return null;
    } catch {
      if (attempt === 3) return null;
    }
    await sleep(500 * attempt);
  }
  return null;
}

function extractReviewText(html) {
  if (!html) return '';
  const paragraphs = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gs)].map(m => m[1]);
  return paragraphs.join(' ').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const workerCount = parseInt(args[args.indexOf('--workers') + 1]) || 4;

  const albums = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const enrichment = JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf8'));

  const unknowns = albums.filter(album => {
    const entry = enrichment[album.url];
    if (!entry) return false;
    if (isKnown(entry.country) && !['XW', 'XE', 'XU'].includes(entry.country)) return false;
    return album.url && album.url.startsWith('/');
  });

  console.log(`Review Text Enrichment (Context-Aware)`);
  console.log(`=======================================`);
  console.log(`Unknown albums with URLs: ${unknowns.length}`);
  console.log(`Workers: ${workerCount}, Dry run: ${dryRun}`);
  console.log();

  let found = 0, missed = 0, errors = 0, processed = 0;

  async function processAlbum(album) {
    const url = PITCHFORK + album.url;
    try {
      const html = await fetchText(url);
      if (!html) { errors++; processed++; return; }

      const reviewText = extractReviewText(html);
      const country = inferCountryContextual(reviewText);
      processed++;

      if (country) {
        found++;
        const lang = PRIMARY_LANG[country] || 'Unknown';
        if (!dryRun) {
          enrichment[album.url].country = country;
          if (!isKnown(enrichment[album.url].language)) enrichment[album.url].language = lang;
        }
        if (found <= 30 || found % 50 === 0) {
          process.stdout.write(`  [FOUND] ${album.artist} - ${album.title}: ${country}\n`);
        }
      } else {
        missed++;
      }

      if (processed % 20 === 0) {
        const pct = (100 * processed / unknowns.length).toFixed(1);
        process.stdout.write(`\r[${pct}%] ${processed}/${unknowns.length} | found ${found} | missed ${missed} | errors ${errors}`);
      }
    } catch {
      errors++;
      processed++;
    }
    await sleep(200);
  }

  for (let i = 0; i < unknowns.length; i += workerCount) {
    const batch = unknowns.slice(i, i + workerCount);
    await Promise.all(batch.map(a => processAlbum(a)));

    if (!dryRun && processed % 100 === 0) {
      fs.writeFileSync(ENRICH_FILE, JSON.stringify(enrichment, null, 2));
    }
  }

  console.log(`\r[100%] ${processed}/${unknowns.length} | found ${found} | missed ${missed} | errors ${errors}`);
  console.log();

  if (!dryRun) {
    fs.writeFileSync(ENRICH_FILE, JSON.stringify(enrichment, null, 2));
    console.log(`Saved enrichment.json`);

    const remaining = albums.filter(al => {
      const en = enrichment[al.url];
      return !en || !isKnown(en.country) || ['XW', 'XE', 'XU'].includes(en.country);
    }).length;
    console.log(`Remaining unknown: ${remaining} / ${albums.length} (${(100 * remaining / albums.length).toFixed(1)}%)`);
  }

  console.log(`\nFound country for ${found} albums (${(100 * found / unknowns.length).toFixed(1)}% hit rate)`);
}

main().catch(console.error);
