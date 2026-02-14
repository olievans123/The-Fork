const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'albums.json');
const ENRICH_FILE = path.join(__dirname, '..', 'enrichment.json');
const ARTIST_CACHE_FILE = path.join(__dirname, '..', 'artist-cache.json');

const PRIMARY_LANGUAGE_BY_COUNTRY = {
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

function isKnownTag(v) {
  return typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'unknown';
}

function artistKey(name) {
  return String(name || '').trim().toLowerCase();
}

function inferCountryFromText(input) {
  const text = String(input || '').toLowerCase();
  if (!text) return null;
  const rules = [
    { code: 'US', pattern: /\b(united states|u\.s\.|usa|new york|brooklyn|queens|bronx|los angeles|california|texas|florida|chicago|atlanta|houston|detroit|oakland|san francisco|philadelphia|seattle|new orleans|nashville|dallas|boston|rhode island|minnesota|virginia)\b/ },
    { code: 'GB', pattern: /\b(united kingdom|england|scotland|wales|london|manchester|liverpool|bristol|brighton|sheffield)\b/ },
    { code: 'CA', pattern: /\b(canada|toronto|vancouver|montreal|montréal)\b/ },
    { code: 'AU', pattern: /\b(australia|sydney|melbourne)\b/ },
    { code: 'NZ', pattern: /\b(new zealand|auckland|wellington)\b/ },
    { code: 'PT', pattern: /\b(portugal|lisbon|lisboa)\b/ },
    { code: 'ES', pattern: /\b(spain|madrid|barcelona)\b/ },
    { code: 'FR', pattern: /\b(france|paris)\b/ },
    { code: 'DE', pattern: /\b(germany|berlin)\b/ },
    { code: 'KR', pattern: /\b(south korea|seoul)\b/ },
  ];
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.code;
  }
  return null;
}

function buildArtistProfiles(artistCache) {
  const profiles = new Map();
  Object.entries(artistCache || {}).forEach(([artist, info]) => {
    if (!artist || !info || typeof info !== 'object') return;
    let country = isKnownTag(info.country) ? info.country : null;
    if (!country && isKnownTag(info.area)) country = inferCountryFromText(info.area);
    let language = isKnownTag(info.language) ? info.language : null;
    if (!language && country) language = PRIMARY_LANGUAGE_BY_COUNTRY[country] || null;
    if (country || language) profiles.set(artistKey(artist), { country, language });
  });
  return profiles;
}

function canUseEnrichmentCountry(country, language) {
  if (!isKnownTag(country)) return false;
  if (country === 'XW' || country === 'XE' || country === 'XU') return false;
  const primary = PRIMARY_LANGUAGE_BY_COUNTRY[country];
  if (!primary) return false;
  if (!isKnownTag(language)) return true;
  return language === primary;
}

function buildArtistCountryFallbacks(albums, enrichment) {
  const votesByArtist = new Map();

  for (const album of albums) {
    const entry = album.url ? enrichment[album.url] : null;
    const country = entry?.country;
    if (!isKnownTag(country) || country === 'XW' || country === 'XE' || country === 'XU') continue;

    const key = artistKey(album.artist);
    if (!key) continue;

    if (!votesByArtist.has(key)) votesByArtist.set(key, new Map());
    const voteMap = votesByArtist.get(key);
    const weight = canUseEnrichmentCountry(country, entry.language) ? 3 : 1;
    voteMap.set(country, (voteMap.get(country) || 0) + weight);
  }

  const fallbacks = new Map();
  votesByArtist.forEach((voteMap, key) => {
    let bestCountry = null;
    let bestVotes = -1;
    let secondVotes = -1;

    voteMap.forEach((votes, country) => {
      if (votes > bestVotes) {
        secondVotes = bestVotes;
        bestVotes = votes;
        bestCountry = country;
      } else if (votes > secondVotes) {
        secondVotes = votes;
      }
    });

    if (!bestCountry) return;
    const singleCountry = voteMap.size === 1;
    const clearWinner = bestVotes >= secondVotes + 1;
    if (singleCountry || clearWinner || bestVotes >= 3) {
      fallbacks.set(key, bestCountry);
    }
  });

  return fallbacks;
}

function mergeTags(albums, enrichment, artistProfiles, artistCountryFallbacks) {
  return albums.map(album => {
    const entry = album.url ? enrichment[album.url] : null;
    const profile = artistProfiles.get(artistKey(album.artist));
    let country = null;
    let language = null;

    if (profile?.country) country = profile.country;
    if (profile?.language) language = profile.language;

    if (!country) country = inferCountryFromText(album.description);
    if (!country) country = artistCountryFallbacks.get(artistKey(album.artist)) || null;
    if (!country && entry && canUseEnrichmentCountry(entry.country, entry.language)) {
      country = entry.country;
    }

    if (!language && entry && isKnownTag(entry.language)) language = entry.language;
    if (!language && country) language = PRIMARY_LANGUAGE_BY_COUNTRY[country] || null;

    return {
      ...album,
      country: country || 'Unknown',
      language: language || 'Unknown',
    };
  });
}

test.describe('Data Integrity', () => {
  let albums;

  test.beforeAll(() => {
    albums = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  });

  test('albums.json exists and is valid JSON', () => {
    expect(albums).toBeDefined();
    expect(Array.isArray(albums)).toBe(true);
  });

  test('has substantial number of albums', () => {
    expect(albums.length).toBeGreaterThan(5000);
  });

  test('every album has required fields', () => {
    for (const album of albums.slice(0, 500)) {
      expect(album.artist).toBeTruthy();
      expect(album.title).toBeTruthy();
      expect(typeof album.score).toBe('number');
      expect(album.score).toBeGreaterThan(0);
      expect(album.score).toBeLessThanOrEqual(10);
      expect(typeof album.bnm).toBe('boolean');
      expect(Array.isArray(album.genres)).toBe(true);
    }
  });

  test('albums are sorted by date descending', () => {
    for (let i = 1; i < Math.min(100, albums.length); i++) {
      if (albums[i].date && albums[i - 1].date) {
        expect(new Date(albums[i - 1].date) >= new Date(albums[i].date)).toBeTruthy();
      }
    }
  });

  test('no duplicate URLs', () => {
    const urls = albums.filter(a => a.url).map(a => a.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });

  test('scores are in valid range', () => {
    for (const album of albums) {
      expect(album.score).toBeGreaterThanOrEqual(0);
      expect(album.score).toBeLessThanOrEqual(10);
    }
  });

  test('genres are non-empty strings', () => {
    for (const album of albums.slice(0, 500)) {
      for (const genre of album.genres) {
        expect(typeof genre).toBe('string');
        expect(genre.length).toBeGreaterThan(0);
      }
    }
  });

  test('BNM albums have high scores', () => {
    const bnmAlbums = albums.filter(a => a.bnm);
    expect(bnmAlbums.length).toBeGreaterThan(100);
    for (const album of bnmAlbums) {
      expect(album.score).toBeGreaterThanOrEqual(7.5);
    }
  });

  test('date formats are valid ISO dates', () => {
    for (const album of albums.slice(0, 500)) {
      if (album.date) {
        const d = new Date(album.date);
        expect(d.toString()).not.toBe('Invalid Date');
        expect(d.getFullYear()).toBeGreaterThanOrEqual(1990);
        expect(d.getFullYear()).toBeLessThanOrEqual(2030);
      }
    }
  });

  test('images are valid URLs when present', () => {
    const withImages = albums.filter(a => a.image);
    expect(withImages.length).toBeGreaterThan(albums.length * 0.5);
    for (const album of withImages.slice(0, 200)) {
      expect(album.image).toMatch(/^https?:\/\//);
    }
  });
});

test.describe('Enrichment Data', () => {
  test('enrichment.json exists and is valid', () => {
    if (!fs.existsSync(ENRICH_FILE)) {
      test.skip();
      return;
    }
    const data = JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf-8'));
    expect(typeof data).toBe('object');
  });

  test('enrichment entries have country/language fields', () => {
    if (!fs.existsSync(ENRICH_FILE)) {
      test.skip();
      return;
    }
    const data = JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf-8'));
    const entries = Object.values(data);
    if (entries.length === 0) {
      test.skip();
      return;
    }
    for (const entry of entries.slice(0, 50)) {
      expect(entry).toHaveProperty('country');
      expect(entry).toHaveProperty('language');
    }
  });

  test('enrichment keys are valid URL paths', () => {
    if (!fs.existsSync(ENRICH_FILE)) {
      test.skip();
      return;
    }
    const data = JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf-8'));
    for (const key of Object.keys(data).slice(0, 50)) {
      expect(key).toMatch(/^\/reviews\/albums\//);
    }
  });
});

test.describe('Tagging Quality', () => {
  let mergedAlbums = [];
  let artistProfiles = new Map();
  let artistCountryFallbacks = new Map();

  test.beforeAll(() => {
    const albums = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const enrichment = fs.existsSync(ENRICH_FILE)
      ? JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf-8'))
      : {};
    const artistCache = fs.existsSync(ARTIST_CACHE_FILE)
      ? JSON.parse(fs.readFileSync(ARTIST_CACHE_FILE, 'utf-8'))
      : {};

    artistProfiles = buildArtistProfiles(artistCache);
    artistCountryFallbacks = buildArtistCountryFallbacks(albums, enrichment);
    mergedAlbums = mergeTags(albums, enrichment, artistProfiles, artistCountryFallbacks);
  });

  test('artist cache country is authoritative in merged tags', () => {
    for (const album of mergedAlbums) {
      const profile = artistProfiles.get(artistKey(album.artist));
      if (profile?.country) {
        expect(album.country).toBe(profile.country);
      }
    }
  });

  test('rap albums avoid suspicious english + non-anglophone country combos', () => {
    const suspicious = mergedAlbums.filter(a =>
      a.genres.includes('Rap')
      && a.language === 'eng'
      && ['FR', 'DE', 'ES', 'IT', 'JP', 'KR', 'CN'].includes(a.country)
    );
    expect(suspicious.length).toBeLessThanOrEqual(2);
  });

  test('merged tags have full country/language coverage', () => {
    const unknownCountry = mergedAlbums.filter(a => a.country === 'Unknown').length;
    const unknownLanguage = mergedAlbums.filter(a => a.language === 'Unknown').length;
    expect(unknownCountry).toBe(0);
    expect(unknownLanguage).toBe(0);
  });

  test('regression: Ja Rule / Pain Is Love uses US + English tags', () => {
    const album = mergedAlbums.find(a => a.url === '/reviews/albums/ja-rule-pain-is-love/');
    expect(album).toBeTruthy();
    expect(album.country).toBe('US');
    expect(album.language).toBe('eng');
  });
});

test.describe('Server', () => {
  test('serves index.html', async ({ request }) => {
    const resp = await request.get('/');
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    expect(text).toContain('THE <span>FORK</span>');
  });

  test('serves albums.json', async ({ request }) => {
    const resp = await request.get('/albums.json');
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('serves CSS', async ({ request }) => {
    const resp = await request.get('/style.css');
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    expect(text).toContain('data-theme');
  });

  test('serves app.js', async ({ request }) => {
    const resp = await request.get('/app.js');
    expect(resp.status()).toBe(200);
  });

  test('release-year API returns album release year for Ja Rule regression', async () => {
    let resp;
    try {
      resp = await fetch('http://localhost:3000/api/release-year?url=/reviews/albums/ja-rule-pain-is-love/');
    } catch (err) {
      const msg = String(err?.cause || err || '');
      test.skip(/\bEPERM\b/.test(msg), 'Localhost networking is blocked in this runtime');
      throw err;
    }
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.releaseYear).toBe(2001);
  });

  test('returns 404 for missing files', async ({ request }) => {
    const resp = await request.get('/nonexistent.xyz');
    expect(resp.status()).toBe(404);
  });
});
