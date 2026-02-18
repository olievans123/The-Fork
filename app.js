/* ── State ── */
let allAlbums = [];
let filtered = [];
let rendered = 0;
const PAGE_SIZE = 60;
const RELEASE_YEAR_CACHE_KEY = 'fork_release_year_cache_v1';
const RELEASE_YEAR_PREFETCH_LIMIT = 120;
const RELEASE_YEAR_PREFETCH_CONCURRENCY = 6;
const releaseYearCache = new Map();
const releaseYearFetches = new Map();
const releaseYearNoResult = new Set();
const releaseYearPrefetchQueue = [];
const releaseYearQueued = new Set();
let releaseYearPrefetchActive = 0;
let releaseYearRefreshTimer = null;
let activeModalAlbumId = null;
let modalTriggerElement = null;
const albumById = new Map();

const state = {
  view: 'grid',
  groupBy: 'none',
  sortBy: 'score',
  sortDir: 'desc',
  filterGenre: 'all',
  filterDecade: 'all',
  filterYear: 'all',
  filterScore: 'all',
  filterCountry: 'all',
  filterLanguage: 'all',
  search: '',
};

/* ── Name Lookups ── */
const COUNTRY_NAMES = {
  AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AD:'Andorra',AO:'Angola',AR:'Argentina',AM:'Armenia',
  AU:'Australia',AT:'Austria',AZ:'Azerbaijan',BS:'Bahamas',BH:'Bahrain',BD:'Bangladesh',BB:'Barbados',
  BY:'Belarus',BE:'Belgium',BZ:'Belize',BJ:'Benin',BT:'Bhutan',BO:'Bolivia',BA:'Bosnia',BW:'Botswana',
  BR:'Brazil',BN:'Brunei',BG:'Bulgaria',BF:'Burkina Faso',BI:'Burundi',KH:'Cambodia',CM:'Cameroon',
  CA:'Canada',CV:'Cape Verde',CF:'Central African Republic',TD:'Chad',CL:'Chile',CN:'China',
  CO:'Colombia',KM:'Comoros',CG:'Congo',CD:'DR Congo',CR:'Costa Rica',CI:"Ivory Coast",HR:'Croatia',
  CU:'Cuba',CY:'Cyprus',CZ:'Czechia',DK:'Denmark',DJ:'Djibouti',DM:'Dominica',DO:'Dominican Republic',
  EC:'Ecuador',EG:'Egypt',SV:'El Salvador',GQ:'Equatorial Guinea',ER:'Eritrea',EE:'Estonia',
  SZ:'Eswatini',ET:'Ethiopia',FJ:'Fiji',FI:'Finland',FR:'France',GA:'Gabon',GM:'Gambia',GE:'Georgia',
  DE:'Germany',GH:'Ghana',GR:'Greece',GD:'Grenada',GT:'Guatemala',GN:'Guinea',GW:'Guinea-Bissau',
  GY:'Guyana',HT:'Haiti',HN:'Honduras',HK:'Hong Kong',HU:'Hungary',IS:'Iceland',IN:'India',
  ID:'Indonesia',IR:'Iran',IQ:'Iraq',IE:'Ireland',IL:'Israel',IT:'Italy',JM:'Jamaica',JP:'Japan',
  JO:'Jordan',KZ:'Kazakhstan',KE:'Kenya',KR:'South Korea',KP:'North Korea',KW:'Kuwait',KG:'Kyrgyzstan',
  LA:'Laos',LV:'Latvia',LB:'Lebanon',LS:'Lesotho',LR:'Liberia',LY:'Libya',LI:'Liechtenstein',
  LT:'Lithuania',LU:'Luxembourg',MO:'Macau',MG:'Madagascar',MW:'Malawi',MY:'Malaysia',MV:'Maldives',
  ML:'Mali',MT:'Malta',MH:'Marshall Islands',MR:'Mauritania',MU:'Mauritius',MX:'Mexico',MD:'Moldova',
  MC:'Monaco',MN:'Mongolia',ME:'Montenegro',MA:'Morocco',MZ:'Mozambique',MM:'Myanmar',NA:'Namibia',
  NP:'Nepal',NL:'Netherlands',NZ:'New Zealand',NI:'Nicaragua',NE:'Niger',NG:'Nigeria',MK:'North Macedonia',
  NO:'Norway',OM:'Oman',PK:'Pakistan',PA:'Panama',PG:'Papua New Guinea',PY:'Paraguay',PE:'Peru',
  PH:'Philippines',PL:'Poland',PT:'Portugal',PR:'Puerto Rico',QA:'Qatar',RO:'Romania',RU:'Russia',
  RW:'Rwanda',SA:'Saudi Arabia',SN:'Senegal',RS:'Serbia',SL:'Sierra Leone',SG:'Singapore',SK:'Slovakia',
  SI:'Slovenia',SO:'Somalia',ZA:'South Africa',SS:'South Sudan',ES:'Spain',LK:'Sri Lanka',SD:'Sudan',
  SR:'Suriname',SE:'Sweden',CH:'Switzerland',SY:'Syria',TW:'Taiwan',TJ:'Tajikistan',TZ:'Tanzania',
  TH:'Thailand',TL:'Timor-Leste',TG:'Togo',TO:'Tonga',TT:'Trinidad and Tobago',TN:'Tunisia',
  TR:'Turkey',TM:'Turkmenistan',UG:'Uganda',UA:'Ukraine',AE:'UAE',GB:'United Kingdom',US:'United States',
  UY:'Uruguay',UZ:'Uzbekistan',VE:'Venezuela',VN:'Vietnam',YE:'Yemen',ZM:'Zambia',ZW:'Zimbabwe',
  XW:'Worldwide',XE:'Europe',XU:'Unknown',XC:'Czechoslovakia',SU:'Soviet Union',YU:'Yugoslavia',
};
const LANGUAGE_NAMES = {
  eng:'English',spa:'Spanish',fra:'French',deu:'German',por:'Portuguese',ita:'Italian',jpn:'Japanese',
  kor:'Korean',zho:'Chinese',ara:'Arabic',hin:'Hindi',rus:'Russian',tur:'Turkish',pol:'Polish',
  nld:'Dutch',swe:'Swedish',nor:'Norwegian',dan:'Danish',fin:'Finnish',ell:'Greek',heb:'Hebrew',
  ron:'Romanian',hun:'Hungarian',ces:'Czech',slk:'Slovak',bul:'Bulgarian',hrv:'Croatian',srp:'Serbian',
  ukr:'Ukrainian',cat:'Catalan',eus:'Basque',glg:'Galician',cym:'Welsh',gle:'Irish',isl:'Icelandic',
  ind:'Indonesian',msa:'Malay',tgl:'Tagalog',vie:'Vietnamese',tha:'Thai',swa:'Swahili',amh:'Amharic',
  hau:'Hausa',yor:'Yoruba',ibo:'Igbo',wol:'Wolof',pan:'Punjabi',ben:'Bengali',tam:'Tamil',tel:'Telugu',
  kan:'Kannada',mal:'Malayalam',mar:'Marathi',guj:'Gujarati',urd:'Urdu',fas:'Persian',pus:'Pashto',
  mul:'Multiple Languages',zxx:'No Lyrics',mis:'Miscellaneous',und:'Undetermined',
};

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

function countryName(code) { return (code && COUNTRY_NAMES[code]) || code || 'Unknown'; }
function languageName(code) { return (code && LANGUAGE_NAMES[code]) || code || 'Unknown'; }

/* ── Helpers ── */
function esc(str) {
  const d = document.createElement('div');
  d.innerHTML = str;
  const text = d.textContent;
  d.textContent = text;
  return d.innerHTML;
}

function scoreClass(score) {
  if (score >= 9.5) return 'score-perfect';
  if (score >= 7.0) return 'score-high';
  if (score >= 5.0) return 'score-mid';
  return 'score-low';
}

function normalizeReleaseYear(value) {
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  if (!match) return 0;
  const year = parseInt(match[0], 10);
  const now = new Date().getFullYear();
  return year >= 1900 && year <= now + 1 ? year : 0;
}

function albumYear(album) {
  return normalizeReleaseYear(album?.originalYear) || normalizeReleaseYear(album?.releaseYear);
}

function albumDecade(album) {
  const y = albumYear(album);
  if (!y) return '';
  return `${Math.floor(y / 10) * 10}s`;
}

function loadReleaseYearCache() {
  try {
    const raw = localStorage.getItem(RELEASE_YEAR_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    Object.entries(parsed).forEach(([url, year]) => {
      const normalized = normalizeReleaseYear(year);
      if (url && normalized) releaseYearCache.set(url, normalized);
    });
  } catch {}
}

function persistReleaseYearCache() {
  try {
    const obj = {};
    releaseYearCache.forEach((year, url) => { obj[url] = year; });
    localStorage.setItem(RELEASE_YEAR_CACHE_KEY, JSON.stringify(obj));
  } catch {}
}

async function fetchReleaseYearForAlbum(album) {
  if (!album?.url) return null;
  const urlPath = String(album.url);
  if (releaseYearNoResult.has(urlPath)) return null;

  const existing = normalizeReleaseYear(album.releaseYear) || releaseYearCache.get(urlPath) || 0;
  if (existing) {
    album.releaseYear = existing;
    return existing;
  }

  if (releaseYearFetches.has(urlPath)) return releaseYearFetches.get(urlPath);

  const task = (async () => {
    try {
      const resp = await fetch(`/api/release-year?url=${encodeURIComponent(urlPath)}`);
      if (!resp.ok) return null;
      const data = await resp.json();
      const year = normalizeReleaseYear(data?.releaseYear);
      if (!year) {
        releaseYearNoResult.add(urlPath);
        return null;
      }
      album.releaseYear = year;
      releaseYearNoResult.delete(urlPath);
      releaseYearCache.set(urlPath, year);
      persistReleaseYearCache();
      return year;
    } catch {
      return null;
    } finally {
      releaseYearFetches.delete(urlPath);
    }
  })();

  releaseYearFetches.set(urlPath, task);
  return task;
}

function scheduleReleaseYearRefresh() {
  if (releaseYearRefreshTimer) return;
  releaseYearRefreshTimer = setTimeout(() => {
    releaseYearRefreshTimer = null;
    const yearDependentState =
      state.filterDecade !== 'all'
      || state.filterYear !== 'all'
      || state.sortBy === 'year'
      || state.groupBy === 'year'
      || state.groupBy === 'decade';

    if (yearDependentState) {
      // Avoid flashing/reflow loops while background prefetch is still running.
      if (releaseYearPrefetchActive > 0 || releaseYearPrefetchQueue.length > 0) {
        scheduleReleaseYearRefresh();
        return;
      }
      applyFilters();
      return;
    }

    // Non year-dependent states only need visible label text updates.
    document.querySelectorAll('.album-card[data-album-id]').forEach(card => {
      const album = albumById.get(card.dataset.albumId);
      if (!album) return;
      const meta = card.querySelector('.album-meta');
      if (!meta) return;
      const year = albumYear(album);
      const genreStr = album.genres.join(', ');
      meta.textContent = `${year ? `${year} / ` : ''}${genreStr}`;
    });

    document.querySelectorAll('.list-row[data-album-id]').forEach(row => {
      const album = albumById.get(row.dataset.albumId);
      if (!album) return;
      const yearCell = row.querySelector('.list-year');
      if (yearCell) yearCell.textContent = albumYear(album) || '—';
    });
  }, 250);
}

function pumpReleaseYearPrefetchQueue() {
  while (releaseYearPrefetchActive < RELEASE_YEAR_PREFETCH_CONCURRENCY && releaseYearPrefetchQueue.length) {
    const album = releaseYearPrefetchQueue.shift();
    const urlPath = String(album?.url || '');
    if (!urlPath) continue;

    releaseYearPrefetchActive++;
    fetchReleaseYearForAlbum(album)
      .then(year => {
        if (year) scheduleReleaseYearRefresh();
      })
      .finally(() => {
        releaseYearPrefetchActive--;
        releaseYearQueued.delete(urlPath);
        pumpReleaseYearPrefetchQueue();
      });
  }
}

function prefetchReleaseYears(albums) {
  if (!Array.isArray(albums) || albums.length === 0) return;
  const slice = albums.slice(0, RELEASE_YEAR_PREFETCH_LIMIT);
  slice.forEach(album => {
    if (!album?.url) return;
    if (normalizeReleaseYear(album.releaseYear)) return;
    const urlPath = String(album.url);
    if (!urlPath || releaseYearNoResult.has(urlPath) || releaseYearQueued.has(urlPath)) return;
    releaseYearQueued.add(urlPath);
    releaseYearPrefetchQueue.push(album);
  });
  pumpReleaseYearPrefetchQueue();
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

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
  if (!artistCache || typeof artistCache !== 'object') return profiles;

  Object.entries(artistCache).forEach(([artist, info]) => {
    if (!artist || !info || typeof info !== 'object') return;

    let country = isKnownTag(info.country) ? info.country : null;
    if (!country && isKnownTag(info.area)) {
      country = inferCountryFromText(info.area);
    }

    let language = isKnownTag(info.language) ? info.language : null;
    if (!language && country) {
      language = PRIMARY_LANGUAGE_BY_COUNTRY[country] || null;
    }

    if (country || language) {
      profiles.set(artistKey(artist), { country, language });
    }
  });

  return profiles;
}

// Secondary English-speaking distribution markets — release country from these
// almost never reflects the artist's actual origin. US and GB are kept because
// the vast majority of Pitchfork-reviewed artists genuinely are American or British.
const SECONDARY_DIST_COUNTRIES = new Set(['CA', 'AU', 'NZ', 'IE']);

function canUseEnrichmentCountry(country, language) {
  if (!isKnownTag(country)) return false;
  if (country === 'XW' || country === 'XE' || country === 'XU') return false;
  // Don't trust secondary distribution markets as artist origin —
  // a Beyoncé album released in Canada doesn't make her Canadian.
  if (SECONDARY_DIST_COUNTRIES.has(country)) return false;

  const primary = PRIMARY_LANGUAGE_BY_COUNTRY[country];
  if (!primary) return false;
  if (!isKnownTag(language)) return true;

  // Release-country data is often edition-specific; only trust when language matches.
  return language === primary;
}

function buildArtistCountryFallbacks(albums, enrichData) {
  const votesByArtist = new Map();

  albums.forEach(album => {
    const entry = (album.url && enrichData[album.url]) ? enrichData[album.url] : null;
    const country = entry?.country;
    if (!isKnownTag(country) || country === 'XW' || country === 'XE' || country === 'XU') return;

    const key = artistKey(album.artist);
    if (!key) return;

    if (!votesByArtist.has(key)) votesByArtist.set(key, new Map());
    const voteMap = votesByArtist.get(key);
    const weight = canUseEnrichmentCountry(country, entry.language) ? 3 : 1;
    voteMap.set(country, (voteMap.get(country) || 0) + weight);
  });

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
    // If all release countries are secondary distribution markets (CA/AU/NZ/IE),
    // the data is just distribution noise, not artist origin.
    const allSecondary = [...voteMap.keys()].every(c => SECONDARY_DIST_COUNTRIES.has(c));
    if (allSecondary) return;

    const singleCountry = voteMap.size === 1;
    const clearWinner = bestVotes >= secondVotes + 1;
    if (singleCountry || clearWinner || bestVotes >= 3) {
      fallbacks.set(key, bestCountry);
    }
  });

  return fallbacks;
}

/* ── Data Loading ── */
async function loadData() {
  const cacheBust = '?v=' + Date.now();
  try {
    const dataSources = ['albums.full.json', 'albums.json'];
    let loaded = false;
    for (const file of dataSources) {
      try {
        const resp = await fetch(file + cacheBust);
        if (!resp.ok) continue;
        allAlbums = await resp.json();
        loaded = true;
        break;
      } catch {}
    }
    if (!loaded) throw new Error('No albums data found');
  } catch {
    // Fallback: try data.js (old format)
    if (typeof albums !== 'undefined') {
      allAlbums = albums.map((a, i) => ({
        id: 'static_' + i,
        artist: a.artist,
        title: a.title,
        score: a.score,
        bnm: a.bnm || false,
        bnr: false,
        genres: [a.genre],
        date: a.year + '-01-01',
        dateFormatted: a.year.toString(),
        releaseYear: normalizeReleaseYear(a.year) || null,
        url: '',
        description: '',
        reviewer: '',
        image: '',
      }));
    }
  }

  albumById.clear();
  allAlbums.forEach(a => {
    if (a?.id) albumById.set(a.id, a);
    a._dateTs = new Date(a.date || 0).getTime();
  });

  loadReleaseYearCache();
  allAlbums.forEach(a => {
    const release = normalizeReleaseYear(a.releaseYear);
    if (release) {
      a.releaseYear = release;
      return;
    }
    const cached = a.url ? releaseYearCache.get(a.url) : 0;
    if (cached) a.releaseYear = cached;
  });

  // Merge enrichment with artist-level profile data.
  let enrichData = {};
  let artistProfiles = new Map();
  let artistCountryFallbacks = new Map();
  try {
    const [enrichResp, artistResp] = await Promise.all([
      fetch('enrichment.json' + cacheBust),
      fetch('artist-cache.json' + cacheBust),
    ]);

    if (enrichResp.ok) {
      const loadedEnrichment = await enrichResp.json();
      if (loadedEnrichment && typeof loadedEnrichment === 'object') {
        enrichData = loadedEnrichment;
      }
    }

    if (artistResp.ok) {
      const artistCache = await artistResp.json();
      artistProfiles = buildArtistProfiles(artistCache);
    }
  } catch {}

  artistCountryFallbacks = buildArtistCountryFallbacks(allAlbums, enrichData);

  allAlbums.forEach(a => {
    const entry = (a.url && enrichData[a.url]) ? enrichData[a.url] : null;
    const profile = artistProfiles.get(artistKey(a.artist));
    // For collabs like "Drake / 21 Savage", also try the first artist name.
    const primaryName = a.artist.split(/\s*[\/&]\s*/)[0].trim();
    const primaryProfile = primaryName !== a.artist ? artistProfiles.get(artistKey(primaryName)) : null;
    let country = null;
    let language = null;

    if (profile?.country) country = profile.country;
    else if (primaryProfile?.country) country = primaryProfile.country;
    if (profile?.language) language = profile.language;
    else if (primaryProfile?.language) language = primaryProfile.language;

    if (!country) {
      country = inferCountryFromText(a.description);
    }

    if (!country) {
      country = artistCountryFallbacks.get(artistKey(a.artist)) || null;
    }

    if (!country && entry && canUseEnrichmentCountry(entry.country, entry.language)) {
      country = entry.country;
    }

    if (!language && entry && isKnownTag(entry.language)) {
      language = entry.language;
    }

    if (!language && country) {
      language = PRIMARY_LANGUAGE_BY_COUNTRY[country] || null;
    }

    a.country = country || 'Unknown';
    a.language = language || 'Unknown';
  });

  document.getElementById('loading').classList.add('hidden');
  populateFilters();
  applyFilters();
}

/* ── URL State ── */
const URL_PARAM_MAP = {
  q: 'search', genre: 'filterGenre', decade: 'filterDecade', year: 'filterYear',
  score: 'filterScore', country: 'filterCountry',
  language: 'filterLanguage', sort: 'sortBy', dir: 'sortDir', view: 'view', group: 'groupBy',
};

const STATE_DEFAULTS = {
  search: '', filterGenre: 'all', filterDecade: 'all', filterYear: 'all',
  filterScore: 'all', filterCountry: 'all', filterLanguage: 'all',
  sortBy: 'score', sortDir: 'desc', view: 'grid', groupBy: 'none',
};

function stateToUrl() {
  const params = new URLSearchParams();
  for (const [param, key] of Object.entries(URL_PARAM_MAP)) {
    if (state[key] !== STATE_DEFAULTS[key]) params.set(param, state[key]);
  }
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function urlToState() {
  const params = new URLSearchParams(location.search);
  for (const [param, key] of Object.entries(URL_PARAM_MAP)) {
    const val = params.get(param);
    if (val !== null) state[key] = val;
  }
}

/* ── Filters ── */
function populateFilters() {
  // Genres
  const genres = new Map();
  allAlbums.forEach(a => a.genres.forEach(g => genres.set(g, (genres.get(g) || 0) + 1)));
  const sortedGenres = [...genres.entries()].sort((a, b) => b[1] - a[1]);
  const genreSelect = document.getElementById('filterGenre');
  sortedGenres.forEach(([g, c]) => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = `${g} (${c})`;
    genreSelect.appendChild(opt);
  });

  // Years
  const years = new Map();
  allAlbums.forEach(a => {
    const y = albumYear(a);
    if (y) years.set(y, (years.get(y) || 0) + 1);
  });
  const sortedYears = [...years.keys()].sort((a, b) => b - a);
  const yearSelect = document.getElementById('filterYear');
  sortedYears.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = `${y} (${years.get(y)})`;
    yearSelect.appendChild(opt);
  });

  // Decades
  const decades = new Map();
  allAlbums.forEach(a => {
    const d = albumDecade(a);
    if (d) decades.set(d, (decades.get(d) || 0) + 1);
  });
  const sortedDecades = [...decades.keys()].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const decadeSelect = document.getElementById('filterDecade');
  sortedDecades.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `${d} (${decades.get(d)})`;
    decadeSelect.appendChild(opt);
  });

  // Country + Language
  const countries = new Map();
  allAlbums.forEach(a => { if (a.country) countries.set(a.country, (countries.get(a.country) || 0) + 1); });
  const sortedCountries = [...countries.entries()].sort((a, b) => b[1] - a[1]);
  const countrySel = document.getElementById('filterCountry');
  sortedCountries.forEach(([c, n]) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = `${countryName(c)} (${n})`;
    countrySel.appendChild(opt);
  });

  const languages = new Map();
  allAlbums.forEach(a => { if (a.language) languages.set(a.language, (languages.get(a.language) || 0) + 1); });
  const sortedLanguages = [...languages.entries()].sort((a, b) => b[1] - a[1]);
  const langSel = document.getElementById('filterLanguage');
  sortedLanguages.forEach(([l, n]) => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = `${languageName(l)} (${n})`;
    langSel.appendChild(opt);
  });

  // Sync DOM controls to URL state
  genreSelect.value = state.filterGenre;
  decadeSelect.value = state.filterDecade;
  yearSelect.value = state.filterYear;
  document.getElementById('filterScore').value = state.filterScore;
  countrySel.value = state.filterCountry;
  langSel.value = state.filterLanguage;
  document.getElementById('groupBy').value = state.groupBy;
  document.getElementById('sortBy').value = state.sortBy;
  document.getElementById('search').value = state.search;
  // Auto-open "More filters" if country or language is active from URL
  if (state.filterYear !== 'all' || state.filterCountry !== 'all' || state.filterLanguage !== 'all' || state.groupBy !== 'none') {
    document.getElementById('filtersMore').classList.add('open');
    document.getElementById('moreFiltersBtn').classList.add('active');
  }

  if (state.sortDir === 'asc') document.getElementById('sortDirBtn').classList.add('asc');
  if (state.view !== 'grid') {
    document.querySelectorAll('.view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === state.view);
    });
  }
}

function getFiltered() {
  const q = state.search.toLowerCase();

  return allAlbums.filter(a => {
    if (state.filterGenre !== 'all' && !a.genres.includes(state.filterGenre)) return false;
    if (state.filterDecade !== 'all' && albumDecade(a) !== state.filterDecade) return false;
    if (state.filterYear !== 'all' && albumYear(a) !== parseInt(state.filterYear, 10)) return false;

    if (state.filterScore !== 'all') {
      const [lo, hi] = state.filterScore.split('-').map(Number);
      if (a.score < lo || a.score >= (hi === 10 ? 10.1 : hi)) return false;
    }

    if (state.filterCountry !== 'all' && a.country !== state.filterCountry) return false;
    if (state.filterLanguage !== 'all' && a.language !== state.filterLanguage) return false;

    if (q) {
      const haystack = `${a.artist} ${a.title} ${a.reviewer} ${a.genres.join(' ')}`.toLowerCase();
      // Support multi-word search
      const terms = q.split(/\s+/).filter(Boolean);
      if (!terms.every(t => haystack.includes(t))) return false;
    }

    return true;
  });
}

function getSorted(list) {
  const dir = state.sortDir === 'desc' ? 1 : -1;

  return [...list].sort((a, b) => {
    let va, vb;
    switch (state.sortBy) {
      case 'score': va = a.score; vb = b.score; break;
      case 'date': va = a._dateTs; vb = b._dateTs; return (vb - va) * dir;
      case 'year': va = albumYear(a); vb = albumYear(b); break;
      case 'artist': va = a.artist.toLowerCase(); vb = b.artist.toLowerCase(); return va < vb ? -dir : va > vb ? dir : 0;
      case 'title': va = a.title.toLowerCase(); vb = b.title.toLowerCase(); return va < vb ? -dir : va > vb ? dir : 0;
      default: va = a.score; vb = b.score;
    }
    return (vb - va) * dir;
  });
}

function getGrouped(list) {
  if (state.groupBy === 'none') return null;

  const groups = new Map();
  list.forEach(a => {
    let keys;
    switch (state.groupBy) {
      case 'genre': keys = a.genres.length ? a.genres : ['Unknown']; break;
      case 'year': {
        const y = albumYear(a);
        keys = [y ? String(y) : 'Unknown'];
        break;
      }
      case 'score': {
        const s = Math.floor(a.score);
        keys = [s >= 9 ? '9.0+' : `${s}.0 \u2013 ${s}.9`];
        break;
      }
      case 'decade': keys = [albumDecade(a) || 'Unknown']; break;
      case 'reviewer': keys = [a.reviewer || 'Unknown']; break;
      case 'country': keys = [countryName(a.country)]; break;
      case 'language': keys = [languageName(a.language)]; break;
      case 'bnm': keys = [a.bnm ? 'Best New Music' : a.bnr ? 'Best New Reissue' : 'Standard']; break;
      default: keys = ['Other'];
    }
    keys.forEach(key => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    });
  });

  // Sort group keys
  const entries = [...groups.entries()].sort(([a], [b]) => {
    if (state.groupBy === 'year' || state.groupBy === 'score' || state.groupBy === 'decade') return b.localeCompare(a, undefined, { numeric: true });
    if (state.groupBy === 'country' || state.groupBy === 'language') return a.localeCompare(b);
    if (state.groupBy === 'bnm') {
      const order = { 'Best New Music': 0, 'Best New Reissue': 1, 'Standard': 2 };
      return (order[a] ?? 9) - (order[b] ?? 9);
    }
    return a.localeCompare(b);
  });

  return entries;
}

/* ── Apply & Render ── */
function applyFilters() {
  filtered = getSorted(getFiltered());
  rendered = 0;
  updateStats(filtered);
  updateActiveFilters();
  renderAlbums();
  stateToUrl();
}

function renderAlbums() {
  const container = document.getElementById('albumContainer');
  const loadMore = document.getElementById('loadMore');
  let visibleAlbums = [];

  if (filtered.length === 0) {
    container.innerHTML = '<div class="no-results"><h2>No albums found</h2><p>Try adjusting your filters or search terms.</p></div>';
    loadMore.classList.remove('visible');
    return;
  }

  const grouped = getGrouped(filtered);

  if (grouped) {
    // Grouped view — render all groups, paginate within each
    let html = '';
    for (const [groupName, groupAlbums] of grouped) {
      const avg = (groupAlbums.reduce((s, a) => s + a.score, 0) / groupAlbums.length).toFixed(1);
      html += `<div class="group-header"><h2 class="group-title">${esc(groupName)}</h2><span class="group-count">${groupAlbums.length} album${groupAlbums.length !== 1 ? 's' : ''}<span class="group-avg">avg ${avg}</span></span></div>`;
      const visibleSlice = groupAlbums.slice(0, PAGE_SIZE);
      visibleAlbums.push(...visibleSlice);
      html += renderAlbumBlock(visibleSlice);
    }
    container.innerHTML = html;
    loadMore.classList.remove('visible');
  } else {
    // Flat view with pagination
    const chunk = filtered.slice(0, rendered + PAGE_SIZE);
    visibleAlbums = chunk;
    rendered = chunk.length;
    container.innerHTML = renderAlbumBlock(chunk);

    if (rendered < filtered.length) {
      loadMore.classList.add('visible');
      document.getElementById('loadMoreCount').textContent = `Showing ${rendered} of ${filtered.length}`;
    } else {
      loadMore.classList.remove('visible');
    }
  }

  prefetchReleaseYears(visibleAlbums);
}

function loadMoreAlbums() {
  if (getGrouped(filtered)) return;

  const container = document.getElementById('albumContainer');
  const loadMore = document.getElementById('loadMore');
  const start = rendered;
  const chunk = filtered.slice(start, start + PAGE_SIZE);
  rendered = start + chunk.length;

  // Append new items
  const temp = document.createElement('div');
  temp.innerHTML = renderAlbumBlock(chunk);

  // In grid mode, find the grid and append to it; in list mode, find the list
  if (state.view === 'grid') {
    let grid = container.querySelector('.album-grid');
    if (!grid) {
      container.innerHTML = renderAlbumBlock(filtered.slice(0, rendered));
    } else {
      const newGrid = temp.querySelector('.album-grid');
      if (newGrid) {
        Array.from(newGrid.children).forEach(child => grid.appendChild(child));
      }
    }
  } else {
    let list = container.querySelector('.album-list');
    if (!list) {
      container.innerHTML = renderAlbumBlock(filtered.slice(0, rendered));
    } else {
      const newList = temp.querySelector('.album-list');
      if (newList) {
        // Skip the header from the new block
        Array.from(newList.children).forEach(child => {
          if (!child.classList.contains('list-header')) list.appendChild(child);
        });
      }
    }
  }

  if (rendered < filtered.length) {
    loadMore.classList.add('visible');
    document.getElementById('loadMoreCount').textContent = `Showing ${rendered} of ${filtered.length}`;
  } else {
    loadMore.classList.remove('visible');
  }

  prefetchReleaseYears(chunk);
}

function renderAlbumBlock(items) {
  if (state.view === 'grid') {
    return `<div class="album-grid">${items.map(renderCard).join('')}</div>`;
  } else {
    return `<div class="album-list" role="table">
      <div class="list-header" role="row">
        <div role="columnheader">Score</div><div role="columnheader"></div><div role="columnheader">Artist</div><div role="columnheader">Album</div><div class="list-genre" role="columnheader">Genre</div><div class="list-year" role="columnheader">Year</div>

      </div>

      ${items.map(renderRow).join('')}
    </div>`;
  }
}

function renderCard(album) {
  const imgHtml = album.image
    ? `<img src="${esc(album.image)}" alt="${esc(album.title)}" loading="lazy">`
    : `<div class="album-cover-placeholder">${esc(album.artist)}<br>${esc(album.title)}</div>`;

  const badgeHtml = album.bnm ? '<div class="badge-bnm">BNM</div>' : album.bnr ? '<div class="badge-bnr">BNR</div>' : '';

  const year = albumYear(album);
  const genreStr = album.genres.join(', ');

  return `<div class="album-card" data-album-id="${esc(album.id)}" tabindex="0" role="button" aria-label="${esc(album.artist)} — ${esc(album.title)}">
    <div class="album-cover">
      ${imgHtml}
      <div class="score-badge ${scoreClass(album.score)}">${album.score.toFixed(1)}</div>
      ${badgeHtml}
    </div>
    <div class="album-artist">${esc(album.artist)}</div>
    <div class="album-title">${esc(album.title)}</div>
    <div class="album-meta">${year ? year + ' / ' : ''}${esc(genreStr)}</div>
  </div>`;
}

function renderRow(album) {
  const year = albumYear(album);
  const bnmBadge = album.bnm ? '<span class="list-bnm">BNM</span>' : album.bnr ? '<span class="list-bnm">BNR</span>' : '';

  const coverHtml = album.image
    ? `<div class="list-cover" role="cell"><img src="${esc(album.image)}" alt="" loading="lazy"></div>`
    : `<div class="list-cover" role="cell"></div>`;

  return `<div class="list-row" data-album-id="${esc(album.id)}" tabindex="0" role="row" aria-label="${esc(album.artist)} — ${esc(album.title)}">
    <div class="list-score ${scoreClass(album.score)}" role="cell">${album.score.toFixed(1)}</div>
    ${coverHtml}
    <div class="list-artist" role="cell">${esc(album.artist)}${bnmBadge}</div>
    <div class="list-album" role="cell">${esc(album.title)}</div>
    <div class="list-genre" role="cell">${esc(album.genres.join(', '))}</div>
    <div class="list-year" role="cell">${year || '—'}</div>
  </div>`;
}

/* ── Stats ── */
function updateStats(list) {
  document.getElementById('statCount').textContent = list.length.toLocaleString();
  const avg = list.length ? (list.reduce((s, a) => s + a.score, 0) / list.length).toFixed(1) : '—';
  document.getElementById('statAvg').textContent = avg;
  document.getElementById('statBnm').textContent = list.filter(a => a.bnm).length.toLocaleString();
}

function renderStatsPanel(list) {
  // Score distribution
  const scoreBuckets = Array(11).fill(0);
  list.forEach(a => {
    const bucket = Math.min(Math.floor(a.score), 10);
    scoreBuckets[bucket]++;
  });
  const maxBucket = Math.max(...scoreBuckets, 1);
  document.getElementById('scoreChart').innerHTML = scoreBuckets.map((count, i) => {
    const pct = (count / maxBucket) * 100;
    const label = i === 10 ? '10' : `${i}`;
    const cls = i >= 8 ? 'score-high' : i >= 5 ? 'score-mid' : 'score-low';
    return `<div class="score-bar ${cls}" style="height:${Math.max(pct, 2)}%">
      <span class="score-bar-count">${count}</span>
      <span class="score-bar-label">${label}</span>
    </div>`;
  }).join('');

  // Genre chart
  const genres = new Map();
  list.forEach(a => a.genres.forEach(g => genres.set(g, (genres.get(g) || 0) + 1)));
  const topGenres = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxGenre = topGenres.length ? topGenres[0][1] : 1;
  document.getElementById('genreChart').innerHTML = topGenres.map(([g, c]) => {
    const pct = (c / maxGenre) * 100;
    return `<div class="genre-bar-row">
      <span class="genre-bar-label">${esc(g)}</span>
      <div class="genre-bar-track"><div class="genre-bar-fill" style="width:${pct}%"></div></div>
      <span class="genre-bar-value">${c}</span>
    </div>`;
  }).join('');

  // Year chart
  const years = new Map();
  list.forEach(a => {
    const y = albumYear(a);
    if (y) years.set(y, (years.get(y) || 0) + 1);
  });
  const sortedYears = [...years.entries()].sort((a, b) => a[0] - b[0]);
  const maxYear = Math.max(...sortedYears.map(([, c]) => c), 1);
  document.getElementById('yearChart').innerHTML = sortedYears.map(([y, c]) => {
    const pct = (c / maxYear) * 100;
    return `<div class="year-bar" style="height:${Math.max(pct, 2)}%">
      <div class="year-bar-tip">${y}: ${c}</div>
    </div>`;
  }).join('');

  // Quick stats
  const perfectCount = list.filter(a => a.score >= 9.5).length;
  const bnmCount = list.filter(a => a.bnm).length;
  const reviewers = new Set(list.map(a => a.reviewer).filter(Boolean)).size;
  const median = list.length ? [...list].sort((a, b) => a.score - b.score)[Math.floor(list.length / 2)].score.toFixed(1) : '—';

  document.getElementById('quickStats').innerHTML = `
    <div class="quick-stat"><div class="value">${perfectCount}</div><div class="label">9.5+ Scores</div></div>
    <div class="quick-stat"><div class="value">${bnmCount}</div><div class="label">Best New Music</div></div>
    <div class="quick-stat"><div class="value">${reviewers}</div><div class="label">Reviewers</div></div>
    <div class="quick-stat"><div class="value">${median}</div><div class="label">Median Score</div></div>
  `;
}

const FILTER_TAG_CONFIG = [
  { key: 'filterGenre', id: 'filterGenre', defaultVal: 'all', label: v => v },
  { key: 'filterDecade', id: 'filterDecade', defaultVal: 'all', label: v => v },
  { key: 'filterYear', id: 'filterYear', defaultVal: 'all', label: v => v },
  { key: 'filterScore', id: 'filterScore', defaultVal: 'all', label: v => v },
  { key: 'filterCountry', id: 'filterCountry', defaultVal: 'all', label: v => countryName(v) },
  { key: 'filterLanguage', id: 'filterLanguage', defaultVal: 'all', label: v => languageName(v) },
  { key: 'search', id: 'search', defaultVal: '', label: v => `"${v}"`, valProp: 'value' },
];

function updateActiveFilters() {
  const el = document.getElementById('activeFilters');
  const tags = [];

  for (const cfg of FILTER_TAG_CONFIG) {
    if (state[cfg.key] === cfg.defaultVal) continue;
    tags.push({
      label: cfg.label(state[cfg.key]),
      clear: () => { state[cfg.key] = cfg.defaultVal; document.getElementById(cfg.id).value = cfg.defaultVal; },
    });
  }

  let html = tags.map((t, i) => `<span class="filter-tag" data-idx="${i}">${esc(t.label)} &times;</span>`).join('');
  if (tags.length >= 2) html += '<span class="filter-tag filter-tag-clear" data-action="clear-all">Clear all &times;</span>';
  el.innerHTML = html;

  el.querySelectorAll('.filter-tag').forEach(tag => {
    if (tag.dataset.action === 'clear-all') {
      tag.addEventListener('click', () => { tags.forEach(t => t.clear()); applyFilters(); });
    } else {
      const i = parseInt(tag.dataset.idx, 10);
      tag.addEventListener('click', () => { tags[i].clear(); applyFilters(); });
    }
  });
}

/* ── Modal ── */
function renderModal(album) {
  const year = albumYear(album);
  const imgHtml = album.image ? `<img src="${esc(album.image)}" alt="">` : '';
  const bnmHtml = album.bnm ? '<span class="modal-bnm-badge">Best New Music</span>' : album.bnr ? '<span class="modal-bnm-badge" style="background:var(--fg);color:var(--bg)">Best New Reissue</span>' : '';
  const pitchforkUrl = album.url ? `https://pitchfork.com${album.url}` : '';

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-hero">
      <div class="modal-cover">${imgHtml}</div>
      <div class="modal-info">
        <div class="modal-artist">${esc(album.artist)}</div>
        <div class="modal-title">${esc(album.title)}</div>
        <div class="modal-score-row">
          <span class="modal-score" style="color:var(--${album.score >= 7 ? 'green' : album.score >= 5 ? 'yellow' : 'red'})">${album.score.toFixed(1)}</span>
          ${bnmHtml}
        </div>
        <div class="modal-meta">
          ${album.genres.length ? `<div><strong>Genre</strong> ${esc(album.genres.join(', '))}</div>` : ''}
          ${year ? `<div><strong>Year</strong> ${year}</div>` : ''}
          ${album.reviewer ? `<div><strong>Reviewer</strong> ${esc(album.reviewer)}</div>` : ''}
          ${album.country && album.country !== 'Unknown' ? `<div><strong>Country</strong> ${esc(countryName(album.country))}</div>` : ''}
          ${album.language && album.language !== 'Unknown' ? `<div><strong>Language</strong> ${esc(languageName(album.language))}</div>` : ''}
          ${album.dateFormatted ? `<div><strong>Published</strong> ${esc(album.dateFormatted)}</div>` : ''}
        </div>
        ${album.description ? `<p class="modal-description">${esc(album.description)}</p>` : ''}
        ${pitchforkUrl ? `<a class="modal-link" href="${esc(pitchforkUrl)}" target="_blank" rel="noopener">Read full review on Pitchfork &rarr;</a>` : ''}
      </div>
    </div>
  `;
}

async function openModal(id) {
  const album = albumById.get(id);
  if (!album) return;

  modalTriggerElement = document.activeElement;
  activeModalAlbumId = id;
  renderModal(album);

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => {
    document.getElementById('modalClose').focus();
  });

  // Backfill release year on demand for older datasets.
  if (!normalizeReleaseYear(album.releaseYear)) {
    const year = await fetchReleaseYearForAlbum(album);
    if (year && activeModalAlbumId === id && document.getElementById('modalOverlay').classList.contains('open')) {
      renderModal(album);
      if (
        state.filterDecade !== 'all'
        || state.filterYear !== 'all'
        || state.sortBy === 'year'
        || state.groupBy === 'year'
        || state.groupBy === 'decade'
      ) {
        applyFilters();
      }
    }
  }
}

function closeModal() {
  activeModalAlbumId = null;
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  if (modalTriggerElement) {
    modalTriggerElement.focus();
    modalTriggerElement = null;
  }
}

/* ── Dark Mode ── */
function initTheme() {
  const saved = localStorage.getItem('fork_theme');
  if (saved !== 'light') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('fork_theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('fork_theme', 'dark');
  }
}

/* ── Infinite Scroll ── */
function initInfiniteScroll() {
  const sentinel = document.getElementById('loadMore');
  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && rendered < filtered.length && !getGrouped(filtered)) {
      loadMoreAlbums();
    }
  }, { rootMargin: '400px' });
  observer.observe(sentinel);
}

/* ── Init ── */
function init() {
  initTheme();
  urlToState();

  // On mobile, move Score and Country into "More Filters"
  if (window.matchMedia('(max-width: 700px)').matches) {
    const filtersMore = document.getElementById('filtersMore');
    const scoreGroup = document.getElementById('filterScore').closest('.control-group');
    const countryGroup = document.getElementById('countryFilterGroup');
    filtersMore.prepend(countryGroup);
    filtersMore.prepend(scoreGroup);
  }

  // Controls
  const bindSelect = (id, key) => {
    document.getElementById(id).addEventListener('change', e => { state[key] = e.target.value; applyFilters(); });
  };
  bindSelect('filterGenre', 'filterGenre');
  bindSelect('filterDecade', 'filterDecade');
  bindSelect('filterYear', 'filterYear');
  bindSelect('filterScore', 'filterScore');
  bindSelect('filterCountry', 'filterCountry');
  bindSelect('filterLanguage', 'filterLanguage');
  bindSelect('groupBy', 'groupBy');
  bindSelect('sortBy', 'sortBy');

  // Logo click: reset all filters
  document.querySelector('.logo').addEventListener('click', e => {
    e.preventDefault();
    Object.assign(state, STATE_DEFAULTS);
    document.getElementById('search').value = '';
    document.querySelectorAll('select').forEach(s => { s.value = state[s.id] || 'all'; });
    applyFilters();
  });

  // More filters toggle
  const moreFiltersBtn = document.getElementById('moreFiltersBtn');
  const filtersMore = document.getElementById('filtersMore');
  moreFiltersBtn.addEventListener('click', () => {
    filtersMore.classList.toggle('open');
    moreFiltersBtn.classList.toggle('active');
  });

  // Search with debounce
  let searchTimeout;
  document.getElementById('search').addEventListener('input', e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { state.search = e.target.value; applyFilters(); }, 200);
  });

  // Sort direction
  const sortDirBtn = document.getElementById('sortDirBtn');
  sortDirBtn.addEventListener('click', () => {
    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    sortDirBtn.classList.toggle('asc', state.sortDir === 'asc');
    applyFilters();
  });

  // View toggle
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = btn.dataset.view;
      rendered = 0;
      renderAlbums();
    });
  });

  // Delegated album click handler
  const albumContainer = document.getElementById('albumContainer');
  albumContainer.addEventListener('click', e => {
    const card = e.target.closest('[data-album-id]');
    if (card) openModal(card.dataset.albumId);
  });

  // Keyboard: Enter/Space to open album card
  albumContainer.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('[data-album-id]');
      if (card) { e.preventDefault(); openModal(card.dataset.albumId); }
    }
  });

  // Load more
  document.getElementById('loadMoreBtn').addEventListener('click', loadMoreAlbums);

  // Stats toggle
  const statsToggle = document.getElementById('statsToggle');
  statsToggle.addEventListener('click', () => {
    const panel = document.getElementById('statsPanel');
    const isOpen = panel.classList.toggle('open');
    statsToggle.classList.toggle('active', isOpen);
    statsToggle.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) renderStatsPanel(filtered);
  });

  // Dark mode
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Modal
  const modalOverlay = document.getElementById('modalOverlay');
  modalOverlay.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    // "/" to focus search
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      document.getElementById('search').focus();
    }
    // Focus trap inside modal
    if (e.key === 'Tab' && modalOverlay.classList.contains('open')) {
      const modal = document.getElementById('modal');
      const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  });

  // Infinite scroll
  initInfiniteScroll();

  // Load data
  loadData();
}

document.addEventListener('DOMContentLoaded', init);
