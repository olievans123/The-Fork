// On-demand SEO page renderer for /album/<slug> (rewritten to /api/album?slug=<slug>).
// Reads the compact slug index built by build-fork-seo.js.
const idx = require('../album-index.json');

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const scoreColor = n => n >= 7.5 ? '#145a23' : n >= 5 ? '#b8860b' : '#ff3530';
const SITE = 'https://the-fork.vercel.app';
const TOTAL = Object.keys(idx).length;

function render(slug, e) {
  const url = `${SITE}/album/${slug}`;
  const reviewed = e.d ? new Date(e.d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const sc = e.sc.toFixed(1);
  const bnmTxt = e.bnm ? ' (Best New Music)' : e.bnr ? ' (Best New Reissue)' : '';
  const title = `${e.ar} – ${e.ti}: Pitchfork review & score`;
  const desc = `Pitchfork gave ${e.ar}'s ${e.ti} a ${sc}${bnmTxt}${reviewed ? `, reviewed ${reviewed}` : ''}${e.rv ? ` by ${e.rv}` : ''}. See it on The Fork — every Pitchfork review.`;
  const img = e.im || `${SITE}/og.png`;
  const pfUrl = e.u ? `https://pitchfork.com${e.u}` : '';
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Review',
    itemReviewed: { '@type': 'MusicAlbum', name: e.ti, byArtist: { '@type': 'MusicGroup', name: e.ar } },
    author: { '@type': 'Organization', name: 'Pitchfork' },
    reviewRating: { '@type': 'Rating', ratingValue: e.sc, bestRating: 10, worstRating: 0 },
    ...(e.d ? { datePublished: e.d } : {}), url,
  };
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(img)}"><meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
:root{--bg:#111;--fg:#e8e8e8;--mut:#888;--red:#ff4842;--border:#2a2a2a}
*{margin:0;box-sizing:border-box}body{background:var(--bg);color:var(--fg);font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.5}
a{color:inherit}.wrap{max-width:680px;margin:0 auto;padding:28px 20px 60px}
.top{font-weight:700;letter-spacing:-.4px;font-size:18px;text-decoration:none;display:inline-block;margin-bottom:32px}.top span{color:var(--red)}
.hero{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap}
.cover{width:200px;height:200px;object-fit:cover;border:1px solid var(--border);background:#1a1a1a}
.meta{flex:1;min-width:240px}.artist{font-size:15px;color:var(--mut);font-weight:600}
h1{font-family:Georgia,serif;font-size:30px;font-style:italic;font-weight:400;margin:2px 0 16px;line-height:1.2}
.score{display:inline-flex;align-items:center;gap:10px;font-size:20px;font-weight:700;flex-wrap:wrap}
.badge{min-width:58px;height:58px;padding:0 8px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff}
.bnm{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--red)}
.facts{margin:20px 0;font-size:15px;color:var(--mut)}.facts b{color:var(--fg);font-weight:600}
.btn{display:inline-block;margin-top:8px;background:var(--red);color:#111;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:6px}
.cta{margin-top:40px;padding-top:24px;border-top:1px solid var(--border);font-size:15px}.cta a{color:var(--red);font-weight:600;text-decoration:none}
.disc{margin-top:40px;font-size:12px;color:var(--mut)}
</style></head><body><div class="wrap">
<a class="top" href="/">THE <span>FORK</span></a>
<div class="hero">
  ${e.im ? `<img class="cover" src="${esc(e.im)}" alt="${esc(e.ar)} – ${esc(e.ti)} cover" loading="lazy">` : ''}
  <div class="meta">
    <div class="artist">${esc(e.ar)}</div>
    <h1>${esc(e.ti)}</h1>
    <div class="score"><span class="badge" style="background:${scoreColor(e.sc)}">${sc}</span> Pitchfork score: ${sc}/10 ${e.bnm ? '<span class="bnm">Best New Music</span>' : e.bnr ? '<span class="bnm">Best New Reissue</span>' : ''}</div>
    <div class="facts">
      ${reviewed ? `<div><b>Reviewed</b> ${esc(reviewed)}${e.rv ? ` by ${esc(e.rv)}` : ''}</div>` : ''}
      ${e.g ? `<div><b>Genre</b> ${esc(e.g)}</div>` : ''}
    </div>
    ${pfUrl ? `<a class="btn" href="${esc(pfUrl)}" target="_blank" rel="noopener">Read the full review on Pitchfork →</a>` : ''}
  </div>
</div>
<p class="cta">→ <a href="/">Explore every Pitchfork review on The Fork</a> — ${TOTAL.toLocaleString()} reviews, searchable by score, genre, decade & reviewer.</p>
<p class="disc">The Fork aggregates publicly available album reviews. Not affiliated with Pitchfork or Condé Nast.</p>
</div></body></html>`;
}

module.exports = (req, res) => {
  const slug = (req.query && req.query.slug) || '';
  const e = idx[slug];
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!e) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(404).send(`<!DOCTYPE html><meta charset="UTF-8"><title>Not found — The Fork</title><body style="background:#111;color:#e8e8e8;font-family:sans-serif;text-align:center;padding:80px"><h1>Album not found</h1><p><a href="/" style="color:#ff4842">← The Fork</a></p>`);
  }
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).send(render(slug, e));
};
