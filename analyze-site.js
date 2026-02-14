const { chromium } = require('playwright');
const path = require('path');

const SCREENSHOTS = path.join(__dirname, 'screenshots');

async function main() {
  const fs = require('fs');
  if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  const warnings = [];
  const consoleMessages = [];

  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => errors.push(err.message));

  console.log('=== LOADING PAGE ===');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 1. Initial load screenshot (dark mode)
  await page.screenshot({ path: path.join(SCREENSHOTS, '01-initial-dark.png'), fullPage: false });
  console.log('Screenshot: 01-initial-dark.png');

  // Check dark mode is default
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('Theme:', theme);

  // 2. Count albums loaded
  const albumCount = await page.evaluate(() => {
    const el = document.getElementById('statCount');
    return el ? el.textContent : 'not found';
  });
  console.log('Album count shown:', albumCount);

  // 3. Check all controls exist
  const controls = ['search', 'filterGenre', 'filterYear', 'filterScore', 'filterBnm',
    'filterCountry', 'filterLanguage', 'groupBy', 'sortBy', 'sortDirBtn', 'themeToggle', 'statsToggle'];
  for (const id of controls) {
    const exists = await page.locator(`#${id}`).count();
    console.log(`Control #${id}: ${exists > 0 ? 'OK' : 'MISSING'}`);
    if (exists === 0) warnings.push(`Missing control: #${id}`);
  }

  // 4. Check sort options
  const sortOptions = await page.evaluate(() => {
    const sel = document.getElementById('sortBy');
    return sel ? [...sel.options].map(o => o.value) : [];
  });
  console.log('Sort options:', sortOptions);

  // 5. Check filter genre has options
  const genreCount = await page.evaluate(() => document.getElementById('filterGenre')?.options.length || 0);
  console.log('Genre filter options:', genreCount);

  // 6. Check country/language filters
  const countryCount = await page.evaluate(() => document.getElementById('filterCountry')?.options.length || 0);
  const langCount = await page.evaluate(() => document.getElementById('filterLanguage')?.options.length || 0);
  console.log('Country filter options:', countryCount);
  console.log('Language filter options:', langCount);

  // 7. Check album cards rendered
  const cardCount = await page.locator('.album-card').count();
  console.log('Album cards rendered:', cardCount);

  // 8. Check images loading
  const brokenImages = await page.evaluate(() => {
    const imgs = document.querySelectorAll('.album-card img');
    let broken = 0;
    imgs.forEach(img => { if (!img.naturalWidth && img.src) broken++; });
    return broken;
  });
  console.log('Broken images:', brokenImages);

  // 9. Test search
  console.log('\n=== TESTING SEARCH ===');
  await page.fill('#search', 'radiohead');
  await page.waitForTimeout(500);
  const searchResults = await page.locator('.album-card').count();
  console.log('Search "radiohead" results:', searchResults);
  await page.screenshot({ path: path.join(SCREENSHOTS, '02-search.png'), fullPage: false });

  // Clear search
  await page.fill('#search', '');
  await page.waitForTimeout(500);

  // 10. Test genre filter
  console.log('\n=== TESTING GENRE FILTER ===');
  const firstGenre = await page.evaluate(() => {
    const sel = document.getElementById('filterGenre');
    return sel.options.length > 1 ? sel.options[1].value : null;
  });
  if (firstGenre) {
    await page.selectOption('#filterGenre', firstGenre);
    await page.waitForTimeout(500);
    const genreResults = await page.locator('.album-card').count();
    console.log(`Filter "${firstGenre}" results:`, genreResults);
    await page.screenshot({ path: path.join(SCREENSHOTS, '03-genre-filter.png'), fullPage: false });
    await page.selectOption('#filterGenre', 'all');
    await page.waitForTimeout(300);
  }

  // 11. Test sort by score
  console.log('\n=== TESTING SORT ===');
  await page.selectOption('#sortBy', 'score');
  await page.waitForTimeout(500);
  const firstScore = await page.evaluate(() => {
    const card = document.querySelector('.album-card .score-badge');
    return card ? card.textContent.trim() : 'none';
  });
  console.log('First album score (sorted desc):', firstScore);
  await page.screenshot({ path: path.join(SCREENSHOTS, '04-sort-score.png'), fullPage: false });

  // 12. Test sort by year
  await page.selectOption('#sortBy', 'year');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SCREENSHOTS, '05-sort-year.png'), fullPage: false });
  console.log('Sort by year: applied');

  // Reset sort
  await page.selectOption('#sortBy', 'date');
  await page.waitForTimeout(300);

  // 13. Test grouping
  console.log('\n=== TESTING GROUPING ===');
  await page.selectOption('#groupBy', 'genre');
  await page.waitForTimeout(500);
  const groupHeaders = await page.locator('.group-header').count();
  console.log('Group by genre headers:', groupHeaders);
  await page.screenshot({ path: path.join(SCREENSHOTS, '06-group-genre.png'), fullPage: false });
  await page.selectOption('#groupBy', 'none');
  await page.waitForTimeout(300);

  // 14. Test list view
  console.log('\n=== TESTING LIST VIEW ===');
  const listBtn = page.locator('.view-btn[data-view="list"]');
  await listBtn.click();
  await page.waitForTimeout(500);
  const listRows = await page.locator('.list-row').count();
  console.log('List view rows:', listRows);
  await page.screenshot({ path: path.join(SCREENSHOTS, '07-list-view.png'), fullPage: false });

  // Switch back to grid
  await page.locator('.view-btn[data-view="grid"]').click();
  await page.waitForTimeout(300);

  // 15. Test modal (click first album)
  console.log('\n=== TESTING MODAL ===');
  const firstCard = page.locator('.album-card').first();
  await firstCard.click();
  await page.waitForTimeout(500);
  const modalVisible = await page.locator('#modalOverlay.open').count();
  console.log('Modal opened:', modalVisible > 0 ? 'YES' : 'NO');
  await page.screenshot({ path: path.join(SCREENSHOTS, '08-modal.png'), fullPage: false });
  // Close modal by clicking overlay
  if (modalVisible > 0) {
    await page.locator('#modalOverlay').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
  }

  // 16. Test stats panel
  console.log('\n=== TESTING STATS ===');
  await page.locator('#statsToggle').click();
  await page.waitForTimeout(500);
  const statsVisible = await page.locator('.stats-panel:not(.hidden)').count();
  console.log('Stats panel visible:', statsVisible > 0 ? 'YES' : 'NO');
  await page.screenshot({ path: path.join(SCREENSHOTS, '09-stats.png'), fullPage: false });

  // 17. Test score filter
  console.log('\n=== TESTING SCORE FILTER ===');
  await page.selectOption('#filterScore', '9-10');
  await page.waitForTimeout(500);
  const nineResults = await page.locator('.album-card').count();
  console.log('Score 9-10 results:', nineResults);
  await page.screenshot({ path: path.join(SCREENSHOTS, '10-score-filter.png'), fullPage: false });
  await page.selectOption('#filterScore', 'all');
  await page.waitForTimeout(300);

  // 18. Test BNM filter
  await page.selectOption('#filterBnm', 'bnm');
  await page.waitForTimeout(500);
  const bnmResults = await page.locator('.album-card').count();
  console.log('BNM filter results:', bnmResults);
  await page.selectOption('#filterBnm', 'all');
  await page.waitForTimeout(300);

  // 19. Test infinite scroll
  console.log('\n=== TESTING INFINITE SCROLL ===');
  const initialCards = await page.locator('.album-card').count();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  const afterScrollCards = await page.locator('.album-card').count();
  console.log(`Cards before scroll: ${initialCards}, after: ${afterScrollCards}`);
  console.log('Infinite scroll works:', afterScrollCards > initialCards ? 'YES' : 'NO');

  // 20. Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  // 21. Test active filter tags
  console.log('\n=== TESTING ACTIVE FILTER TAGS ===');
  await page.fill('#search', 'kendrick');
  await page.selectOption('#filterGenre', firstGenre || 'Rock');
  await page.waitForTimeout(500);
  const filterTags = await page.locator('.filter-tag').count();
  console.log('Active filter tags:', filterTags);
  await page.screenshot({ path: path.join(SCREENSHOTS, '11-filter-tags.png'), fullPage: false });
  await page.fill('#search', '');
  await page.selectOption('#filterGenre', 'all');
  await page.waitForTimeout(300);

  // 22. Mobile viewport test
  console.log('\n=== TESTING MOBILE ===');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SCREENSHOTS, '12-mobile.png'), fullPage: false });

  // 23. Tablet viewport
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SCREENSHOTS, '13-tablet.png'), fullPage: false });

  // Reset viewport
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  // 24. Theme toggle test
  console.log('\n=== TESTING THEME TOGGLE ===');
  await page.locator('#themeToggle').click();
  await page.waitForTimeout(300);
  const lightTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('After toggle, theme:', lightTheme);
  await page.screenshot({ path: path.join(SCREENSHOTS, '14-light-mode.png'), fullPage: false });
  // Toggle back to dark
  await page.locator('#themeToggle').click();
  await page.waitForTimeout(300);

  // 25. Performance check
  console.log('\n=== PERFORMANCE ===');
  const perfData = await page.evaluate(() => {
    const perf = performance.getEntriesByType('navigation')[0];
    return {
      domContentLoaded: Math.round(perf.domContentLoadedEventEnd),
      loadComplete: Math.round(perf.loadEventEnd),
      domInteractive: Math.round(perf.domInteractive),
    };
  });
  console.log('DOM interactive:', perfData.domInteractive + 'ms');
  console.log('DOM content loaded:', perfData.domContentLoaded + 'ms');
  console.log('Load complete:', perfData.loadComplete + 'ms');

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('Console errors:', errors.length);
  errors.forEach(e => console.log('  ERROR:', e));
  console.log('Warnings:', warnings.length);
  warnings.forEach(w => console.log('  WARN:', w));
  console.log('Console messages:', consoleMessages.filter(m => m.type === 'error').length, 'errors,',
    consoleMessages.filter(m => m.type === 'warning').length, 'warnings');

  await browser.close();
  console.log('\nScreenshots saved to', SCREENSHOTS);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
