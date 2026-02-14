const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function normalizePitchforkPath(input) {
  if (!input) return '';
  let pathOnly = String(input).trim();
  if (!pathOnly) return '';

  if (/^https?:\/\//i.test(pathOnly)) {
    try {
      const url = new URL(pathOnly);
      if (!/pitchfork\.com$/i.test(url.hostname)) return '';
      pathOnly = url.pathname;
    } catch {
      return '';
    }
  }

  if (!pathOnly.startsWith('/')) pathOnly = `/${pathOnly}`;
  pathOnly = pathOnly.replace(/[?#].*$/, '').replace(/\/{2,}/g, '/');
  if (!pathOnly.endsWith('/')) pathOnly += '/';
  return pathOnly;
}

function parseReleaseYear(value) {
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = parseInt(match[0], 10);
  const now = new Date().getFullYear();
  return year >= 1900 && year <= now + 1 ? year : null;
}

function extractReleaseYearFromHtml(html) {
  if (!html) return null;

  const stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1]);
      const releaseYear = parseReleaseYear(state?.transformed?.review?.headerProps?.infoSliceFields?.releaseYear);
      if (releaseYear) return releaseYear;
    } catch {}
  }

  const fallback = html.match(/"releaseYear"\s*:\s*"?(19|20)\d{2}"?/);
  return parseReleaseYear(fallback?.[0] || '');
}

export default async function handler(req, res) {
  const raw = req.query.url || '';
  const urlPath = normalizePitchforkPath(raw);

  if (!urlPath || !urlPath.startsWith('/reviews/albums/')) {
    return res.status(400).json({ error: 'Invalid url parameter' });
  }

  try {
    const resp = await fetch(`https://pitchfork.com${urlPath}`, {
      headers: { 'User-Agent': UA },
    });

    if (!resp.ok) {
      return res.status(502).json({ error: `Upstream HTTP ${resp.status}` });
    }

    const html = await resp.text();
    const releaseYear = extractReleaseYearFromHtml(html);

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    return res.status(200).json({ releaseYear });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch release year' });
  }
}
