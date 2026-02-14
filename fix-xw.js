#!/usr/bin/env node
const fs = require('fs');
const enrichment = require('./enrichment.json');

const COUNTRY_TO_LANG = {
  US:'eng',GB:'eng',AU:'eng',CA:'eng',NZ:'eng',IE:'eng',JM:'eng',TT:'eng',BB:'eng',
  XW:'eng',XE:'eng',
  DE:'deu',AT:'deu',CH:'deu',
  FR:'fra',BE:'fra',
  ES:'spa',MX:'spa',AR:'spa',CO:'spa',CL:'spa',PE:'spa',
  BR:'por',PT:'por',
  IT:'ita',JP:'jpn',KR:'kor',CN:'zho',TW:'zho',
  SE:'swe',NO:'nor',DK:'dan',FI:'fin',IS:'isl',NL:'nld',
  RU:'rus',PL:'pol',
};

// Fix: for any entry with a known country but Unknown language, infer language from country
let langFixed = 0;
for (const [url, e] of Object.entries(enrichment)) {
  if (e.country && e.country !== 'Unknown' && (!e.language || e.language === 'Unknown')) {
    const lang = COUNTRY_TO_LANG[e.country];
    if (lang) {
      e.language = lang;
      langFixed++;
    }
  }
}

const tmp = './enrichment.json.tmp';
fs.writeFileSync(tmp, JSON.stringify(enrichment, null, 2));
fs.renameSync(tmp, './enrichment.json');
console.log(`Fixed ${langFixed} entries: inferred language from known country`);

// Final stats
const countries = {};
const languages = {};
let bothKnown = 0;
let bothUnknown = 0;
let countryOnly = 0;
let langOnly = 0;
const total = Object.keys(enrichment).length;

Object.values(enrichment).forEach(e => {
  countries[e.country] = (countries[e.country] || 0) + 1;
  languages[e.language] = (languages[e.language] || 0) + 1;
  const cKnown = e.country && e.country !== 'Unknown';
  const lKnown = e.language && e.language !== 'Unknown';
  if (cKnown && lKnown) bothKnown++;
  else if (cKnown && !lKnown) countryOnly++;
  else if (!cKnown && lKnown) langOnly++;
  else bothUnknown++;
});

console.log(`\nFinal enrichment stats (${total} albums):`);
console.log(`Both country+language known: ${bothKnown} (${((bothKnown / total) * 100).toFixed(1)}%)`);
console.log(`Country only: ${countryOnly}`);
console.log(`Language only: ${langOnly}`);
console.log(`Both unknown: ${bothUnknown} (${((bothUnknown / total) * 100).toFixed(1)}%)`);

console.log('\nTop countries:');
Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([c, n]) => console.log(`  ${c}: ${n}`));

console.log('\nTop languages:');
Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([l, n]) => console.log(`  ${l}: ${n}`));
