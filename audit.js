const a = JSON.parse(require('fs').readFileSync('albums.json','utf-8'));
const e = JSON.parse(require('fs').readFileSync('enrichment.json','utf-8'));

console.log('=== FULL DATA AUDIT ===');
console.log('Total albums:', a.length);
console.log('Enriched (country/lang):', Object.keys(e).length);
console.log('With genres:', a.filter(x=>x.genres && x.genres.length>0).length);
console.log('With images:', a.filter(x=>x.image).length);
console.log('With reviewer:', a.filter(x=>x.reviewer).length);
console.log('With URL:', a.filter(x=>x.url).length);
console.log('With date:', a.filter(x=>x.date).length);

const urls = a.filter(x=>x.url).map(x=>x.url);
const dupes = urls.length - new Set(urls).size;
console.log('Duplicate URLs:', dupes);

const years = {};
a.forEach(x => {
  const y = new Date(x.date).getFullYear();
  if (y && !isNaN(y)) years[y] = (years[y]||0)+1;
});
console.log('\n=== YEAR DISTRIBUTION ===');
Object.keys(years).sort().forEach(y => console.log('  ' + y + ': ' + years[y]));

const genres = {};
a.forEach(x => (x.genres||[]).forEach(g => { genres[g] = (genres[g]||0)+1; }));
console.log('\n=== GENRE DISTRIBUTION ===');
Object.entries(genres).sort((a,b)=>b[1]-a[1]).forEach(([g,c]) => console.log('  ' + g + ': ' + c));

const scores = a.map(x=>x.score).filter(x=>typeof x==='number');
const avg = (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(2);
const sorted = [...scores].sort((a,b)=>a-b);
const median = sorted[Math.floor(sorted.length/2)].toFixed(1);
const bnm = a.filter(x=>x.bnm).length;
const bnr = a.filter(x=>x.bnr).length;
const perfect = a.filter(x=>x.score>=10).length;
const over9 = a.filter(x=>x.score>=9).length;
console.log('\n=== SCORE STATS ===');
console.log('Average:', avg);
console.log('Median:', median);
console.log('BNM:', bnm);
console.log('BNR:', bnr);
console.log('Perfect 10s:', perfect);
console.log('9.0+:', over9);

// Decade distribution
const decades = {};
a.forEach(x => {
  const y = new Date(x.date).getFullYear();
  if (y && !isNaN(y)) {
    const d = Math.floor(y/10)*10 + 's';
    decades[d] = (decades[d]||0)+1;
  }
});
console.log('\n=== DECADE DISTRIBUTION ===');
Object.keys(decades).sort().forEach(d => console.log('  ' + d + ': ' + decades[d]));

// Enrichment stats
const ecountries = {};
const elangs = {};
Object.values(e).forEach(v => {
  if (v.country) ecountries[v.country] = (ecountries[v.country]||0)+1;
  if (v.language) elangs[v.language] = (elangs[v.language]||0)+1;
});
console.log('\n=== ENRICHMENT: TOP COUNTRIES ===');
Object.entries(ecountries).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([c,n]) => console.log('  ' + c + ': ' + n));
console.log('\n=== ENRICHMENT: TOP LANGUAGES ===');
Object.entries(elangs).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([l,n]) => console.log('  ' + l + ': ' + n));

console.log('\n=== COVERAGE ===');
console.log('Pitchfork pagination API reports: 10,000 reviews');
console.log('Sitemap discovered: ~9,665 unique review URLs');
console.log('Our dataset: ' + a.length + ' albums');
console.log('Coverage: ~' + Math.round(a.length/10000*100) + '% of accessible reviews');
console.log('Note: Pre-2016 archive was removed when Pitchfork merged into GQ (Jan 2024)');
