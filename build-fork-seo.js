// Build the compact slug index (for the /api/album function) + sitemap.xml + robots.txt.
// One small JSON instead of 28k static files; the function renders pages on demand.
const fs = require('fs');
const path = require('path');

const SITE = 'https://the-fork.vercel.app';
const albums = JSON.parse(fs.readFileSync(path.join(__dirname, 'albums.json'), 'utf8'));
const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const used = new Set();
function slugFor(a) {
  let base = `${slugify(a.artist)}-${slugify(a.title)}`.replace(/^-+/, '') || slugify(a.id);
  let s = base, i = 2;
  while (used.has(s)) s = `${base}-${i++}`;
  used.add(s);
  return s;
}

const idx = {};
for (const a of albums) {
  if (!a.artist || !a.title || typeof a.score !== 'number') continue;
  idx[slugFor(a)] = {
    ar: a.artist, ti: a.title, sc: a.score, rv: a.reviewer || '',
    u: a.url || '', d: a.date ? a.date.slice(0, 10) : '', g: (a.genres && a.genres[0]) || '',
    im: a.image || '', bnm: !!a.bnm, bnr: !!a.bnr,
  };
}
fs.writeFileSync(path.join(__dirname, 'album-index.json'), JSON.stringify(idx));

const slugs = Object.keys(idx);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  `<url><loc>${SITE}/</loc><priority>1.0</priority></url>\n` +
  slugs.map(s => `<url><loc>${SITE}/album/${s}</loc><priority>0.6</priority></url>`).join('\n') + `\n</urlset>\n`;
fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);
fs.writeFileSync(path.join(__dirname, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`album-index.json: ${slugs.length} albums | sitemap.xml: ${slugs.length + 1} URLs`);
