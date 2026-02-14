const fs = require('fs');
const a = JSON.parse(fs.readFileSync('albums.json','utf-8'));
console.log('albums.json:', a.length);
fs.writeFileSync('albums.full.json', JSON.stringify(a, null, 2));
console.log('Synced to albums.full.json');
const years = {};
a.forEach(x => {
  const y = new Date(x.date).getFullYear();
  if (y && !isNaN(y)) years[y] = (years[y]||0) + 1;
});
Object.keys(years).sort().forEach(y => console.log('  ' + y + ': ' + years[y]));
console.log('Duplicates:', a.length - new Set(a.map(x=>x.url)).size);
const bnm = a.filter(x=>x.bnm).length;
const genres = a.filter(x=>x.genres && x.genres.length>0).length;
const images = a.filter(x=>x.image).length;
console.log('BNM:', bnm, '| With genres:', genres, '| With images:', images);
