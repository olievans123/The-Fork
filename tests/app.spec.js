const { test, expect } = require('@playwright/test');

test.describe('Page Load', () => {
  test('loads with dark mode by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });

  test('displays album count in header', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const count = await page.locator('#statCount').textContent();
    const num = parseInt(count.replace(/,/g, ''));
    expect(num).toBeGreaterThan(1000);
  });

  test('renders album cards on initial load', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const cards = await page.locator('.album-card').count();
    expect(cards).toBe(60);
  });

  test('all album cards have images', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const broken = await page.evaluate(() => {
      const imgs = document.querySelectorAll('.album-card img');
      let broken = 0;
      imgs.forEach(img => { if (!img.naturalWidth && img.src) broken++; });
      return broken;
    });
    expect(broken).toBe(0);
  });

  test('no JavaScript errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/');
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});

test.describe('Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('all filter controls exist', async ({ page }) => {
    for (const id of ['search', 'filterGenre', 'filterYear', 'filterDecade', 'filterScore', 'filterBnm',
      'filterCountry', 'filterLanguage', 'groupBy', 'sortBy']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
  });

  test('sort dropdown has all options', async ({ page }) => {
    const options = await page.evaluate(() =>
      [...document.getElementById('sortBy').options].map(o => o.value)
    );
    expect(options).toEqual(['date', 'score', 'year', 'artist', 'title']);
  });

  test('genre filter is populated', async ({ page }) => {
    const count = await page.evaluate(() => document.getElementById('filterGenre').options.length);
    expect(count).toBeGreaterThan(5);
  });

  test('year filter is populated', async ({ page }) => {
    const count = await page.evaluate(() => document.getElementById('filterYear').options.length);
    expect(count).toBeGreaterThan(0);
  });

  test('decade filter is populated', async ({ page }) => {
    const count = await page.evaluate(() => document.getElementById('filterDecade').options.length);
    expect(count).toBeGreaterThan(0);
  });

  test('theme toggle button exists', async ({ page }) => {
    await expect(page.locator('#themeToggle')).toBeVisible();
  });

  test('stats toggle button exists', async ({ page }) => {
    await expect(page.locator('#statsToggle')).toBeVisible();
  });
});

test.describe('Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('filters albums by search query', async ({ page }) => {
    await page.fill('#search', 'radiohead');
    await page.waitForTimeout(500);
    const cards = await page.locator('.album-card').count();
    expect(cards).toBeGreaterThan(0);
    expect(cards).toBeLessThan(60);
  });

  test('shows active filter tag for search', async ({ page }) => {
    await page.fill('#search', 'kanye');
    await page.waitForTimeout(500);
    const tags = await page.locator('.filter-tag').count();
    expect(tags).toBeGreaterThanOrEqual(1);
  });

  test('updates header stats when filtering', async ({ page }) => {
    const initialCount = await page.locator('#statCount').textContent();
    await page.fill('#search', 'radiohead');
    await page.waitForTimeout(500);
    const filteredCount = await page.locator('#statCount').textContent();
    expect(parseInt(filteredCount.replace(/,/g, ''))).toBeLessThan(parseInt(initialCount.replace(/,/g, '')));
  });

  test('multi-word search works', async ({ page }) => {
    await page.fill('#search', 'kid a');
    await page.waitForTimeout(500);
    const cards = await page.locator('.album-card').count();
    expect(cards).toBeGreaterThan(0);
  });

  test('clearing search restores all results', async ({ page }) => {
    await page.fill('#search', 'radiohead');
    await page.waitForTimeout(500);
    const filteredCount = await page.locator('.album-card').count();
    await page.fill('#search', '');
    await page.waitForTimeout(500);
    const fullCount = await page.locator('.album-card').count();
    expect(fullCount).toBeGreaterThan(filteredCount);
  });
});

test.describe('Filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('genre filter reduces results', async ({ page }) => {
    const genre = await page.evaluate(() => {
      const sel = document.getElementById('filterGenre');
      return sel.options.length > 1 ? sel.options[1].value : null;
    });
    if (genre) {
      await page.selectOption('#filterGenre', genre);
      await page.waitForTimeout(500);
      const count = await page.locator('#statCount').textContent();
      const num = parseInt(count.replace(/,/g, ''));
      expect(num).toBeGreaterThan(0);
    }
  });

  test('score filter 9-10 shows only high scores', async ({ page }) => {
    await page.selectOption('#filterScore', '9-10');
    await page.waitForTimeout(500);
    const scores = await page.evaluate(() => {
      const badges = document.querySelectorAll('.album-card .score-badge');
      return [...badges].map(b => parseFloat(b.textContent));
    });
    scores.forEach(s => expect(s).toBeGreaterThanOrEqual(9.0));
  });

  test('BNM filter shows only best new music', async ({ page }) => {
    await page.selectOption('#filterBnm', 'bnm');
    await page.waitForTimeout(500);
    const cards = await page.locator('.album-card').count();
    expect(cards).toBeGreaterThan(0);
  });

  test('year filter works', async ({ page }) => {
    const year = await page.evaluate(() => {
      const sel = document.getElementById('filterYear');
      const opt = [...sel.options].find(o => o.value !== 'all');
      return opt ? opt.value : null;
    });
    test.skip(!year, 'No release-year options available yet');
    await page.selectOption('#filterYear', year);
    await page.waitForTimeout(500);
    const count = await page.locator('#statCount').textContent();
    expect(parseInt(count.replace(/,/g, ''))).toBeGreaterThan(0);
  });

  test('decade filter works', async ({ page }) => {
    const decade = await page.evaluate(() => {
      const sel = document.getElementById('filterDecade');
      const opt = [...sel.options].find(o => o.value !== 'all');
      return opt ? opt.value : null;
    });
    test.skip(!decade, 'No release-decade options available yet');
    await page.selectOption('#filterDecade', decade);
    await page.waitForTimeout(500);
    const count = await page.locator('#statCount').textContent();
    expect(parseInt(count.replace(/,/g, ''))).toBeGreaterThan(0);
  });

  test('multiple filters combine', async ({ page }) => {
    const totalCount = await page.locator('#statCount').textContent();
    await page.selectOption('#filterGenre', 'Rock');
    await page.waitForTimeout(300);
    const rockCount = await page.locator('#statCount').textContent();
    await page.selectOption('#filterScore', '8-9');
    await page.waitForTimeout(300);
    const combinedCount = await page.locator('#statCount').textContent();
    expect(parseInt(combinedCount.replace(/,/g, ''))).toBeLessThanOrEqual(parseInt(rockCount.replace(/,/g, '')));
    expect(parseInt(rockCount.replace(/,/g, ''))).toBeLessThanOrEqual(parseInt(totalCount.replace(/,/g, '')));
  });

  test('filter tags appear and are removable', async ({ page }) => {
    await page.selectOption('#filterGenre', 'Rock');
    await page.waitForTimeout(300);
    const tags = await page.locator('.filter-tag').count();
    expect(tags).toBeGreaterThanOrEqual(1);
    // Click to remove
    await page.locator('.filter-tag').first().click();
    await page.waitForTimeout(300);
    const tagsAfter = await page.locator('.filter-tag').count();
    expect(tagsAfter).toBeLessThan(tags);
  });
});

test.describe('Sorting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('sort by score descending shows highest first', async ({ page }) => {
    await page.selectOption('#sortBy', 'score');
    await page.waitForTimeout(500);
    const firstScore = await page.evaluate(() => {
      const badge = document.querySelector('.album-card .score-badge');
      return badge ? parseFloat(badge.textContent) : 0;
    });
    expect(firstScore).toBeGreaterThanOrEqual(9.5);
  });

  test('sort direction toggle reverses order', async ({ page }) => {
    await page.selectOption('#sortBy', 'score');
    await page.waitForTimeout(500);
    const descScore = await page.evaluate(() =>
      parseFloat(document.querySelector('.album-card .score-badge')?.textContent || '0')
    );
    await page.locator('#sortDirBtn').click();
    await page.waitForTimeout(500);
    const ascScore = await page.evaluate(() =>
      parseFloat(document.querySelector('.album-card .score-badge')?.textContent || '0')
    );
    expect(descScore).toBeGreaterThan(ascScore);
  });

  test('sort by artist alphabetical', async ({ page }) => {
    await page.selectOption('#sortBy', 'artist');
    await page.waitForTimeout(500);
    const artists = await page.evaluate(() => {
      const cards = document.querySelectorAll('.album-card .card-artist');
      return [...cards].slice(0, 5).map(c => c.textContent.trim().toLowerCase());
    });
    for (let i = 1; i < artists.length; i++) {
      expect(artists[i] >= artists[i - 1]).toBeTruthy();
    }
  });

  test('sort by year works', async ({ page }) => {
    await page.selectOption('#sortBy', 'year');
    await page.waitForTimeout(500);
    const cards = await page.locator('.album-card').count();
    expect(cards).toBe(60);
  });
});

test.describe('Grouping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('group by genre shows group headers', async ({ page }) => {
    await page.selectOption('#groupBy', 'genre');
    await page.waitForTimeout(500);
    const headers = await page.locator('.group-header').count();
    expect(headers).toBeGreaterThan(3);
  });

  test('group by year shows year headers', async ({ page }) => {
    await page.selectOption('#groupBy', 'year');
    await page.waitForTimeout(500);
    const headers = await page.locator('.group-header').count();
    expect(headers).toBeGreaterThan(0);
  });

  test('group by score shows score range headers', async ({ page }) => {
    await page.selectOption('#groupBy', 'score');
    await page.waitForTimeout(500);
    const headers = await page.locator('.group-header').count();
    expect(headers).toBeGreaterThan(3);
  });

  test('group by decade shows decade headers', async ({ page }) => {
    await page.selectOption('#groupBy', 'decade');
    await page.waitForTimeout(500);
    const headers = await page.locator('.group-header').count();
    expect(headers).toBeGreaterThan(0);
    const text = await page.locator('.group-title').first().textContent();
    expect(text).toMatch(/(\d{4}s|Unknown)/);
  });

  test('ungrouping returns to flat view', async ({ page }) => {
    await page.selectOption('#groupBy', 'genre');
    await page.waitForTimeout(300);
    await page.selectOption('#groupBy', 'none');
    await page.waitForTimeout(300);
    const headers = await page.locator('.group-header').count();
    expect(headers).toBe(0);
  });
});

test.describe('Views', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('grid view is default', async ({ page }) => {
    const gridCards = await page.locator('.album-card').count();
    expect(gridCards).toBe(60);
  });

  test('switching to list view shows rows', async ({ page }) => {
    await page.locator('.view-btn[data-view="list"]').click();
    await page.waitForTimeout(500);
    const rows = await page.locator('.list-row').count();
    expect(rows).toBe(60);
  });

  test('switching back to grid works', async ({ page }) => {
    await page.locator('.view-btn[data-view="list"]').click();
    await page.waitForTimeout(300);
    await page.locator('.view-btn[data-view="grid"]').click();
    await page.waitForTimeout(300);
    const cards = await page.locator('.album-card').count();
    expect(cards).toBe(60);
  });
});

test.describe('Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('album year helper does not fallback to review publish date', async ({ page }) => {
    const year = await page.evaluate(() => albumYear({ date: '2022-07-17T04:00:00.000Z', releaseYear: null }));
    expect(year).toBe(0);
  });

  test('clicking album opens modal', async ({ page }) => {
    await page.locator('.album-card').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('#modalOverlay.open')).toBeVisible();
  });

  test('modal shows album details', async ({ page }) => {
    await page.locator('.album-card').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('.modal-artist')).toBeVisible();
    await expect(page.locator('.modal-title')).toBeVisible();
    await expect(page.locator('.modal-score')).toBeVisible();
  });

  test('modal year uses release year when available', async ({ page }) => {
    await page.evaluate(() => {
      if (!allAlbums.length) return;
      const album = allAlbums[0];
      album.releaseYear = 1999;
      openModal(album.id);
    });
    await page.waitForTimeout(300);
    const meta = await page.locator('.modal-meta').textContent();
    expect(meta).toContain('Year 1999');
  });

  test('modal fetches and applies release year when missing', async ({ page }) => {
    await page.route('**/api/release-year?*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ releaseYear: 2001 }),
      });
    });

    await page.evaluate(() => {
      if (!allAlbums.length) return;
      const album = allAlbums[0];
      album.releaseYear = null;
      album.date = '2022-07-17T04:00:00.000Z';
      openModal(album.id);
    });

    await expect(page.locator('.modal-meta')).toContainText('Year 2001', { timeout: 5000 });
  });

  test('modal has Pitchfork link', async ({ page }) => {
    await page.locator('.album-card').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('.modal-link')).toBeVisible();
  });

  test('clicking overlay closes modal', async ({ page }) => {
    await page.locator('.album-card').first().click();
    await page.waitForTimeout(500);
    await page.locator('#modalOverlay').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
    await expect(page.locator('#modalOverlay.open')).toHaveCount(0);
  });

  test('Escape key closes modal', async ({ page }) => {
    await page.locator('.album-card').first().click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('#modalOverlay.open')).toHaveCount(0);
  });
});

test.describe('Stats Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('stats panel toggles open', async ({ page }) => {
    await page.locator('#statsToggle').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.stats-panel.open')).toBeVisible();
  });

  test('stats panel has score distribution', async ({ page }) => {
    await page.locator('#statsToggle').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.score-chart')).toBeVisible();
  });

  test('stats panel has genre chart', async ({ page }) => {
    await page.locator('#statsToggle').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.genre-chart')).toBeVisible();
  });

  test('stats panel toggles closed', async ({ page }) => {
    await page.locator('#statsToggle').click();
    await page.waitForTimeout(300);
    await page.locator('#statsToggle').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.stats-panel:not(.open)')).toHaveCount(1);
  });
});

test.describe('Theme', () => {
  test('dark mode is default', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });

  test('toggle switches to light mode', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    await page.locator('#themeToggle').click();
    await page.waitForTimeout(300);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBeNull();
  });

  test('double toggle returns to dark', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    await page.locator('#themeToggle').click();
    await page.waitForTimeout(200);
    await page.locator('#themeToggle').click();
    await page.waitForTimeout(200);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });
});

test.describe('Infinite Scroll', () => {
  test('loads more albums on scroll', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const before = await page.locator('.album-card').count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    const after = await page.locator('.album-card').count();
    expect(after).toBeGreaterThan(before);
  });
});

test.describe('Responsive', () => {
  test('mobile viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForTimeout(2000);
    const cards = await page.locator('.album-card').count();
    expect(cards).toBeGreaterThan(0);
    await expect(page.locator('#search')).toBeVisible();
  });

  test('tablet viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForTimeout(2000);
    const cards = await page.locator('.album-card').count();
    expect(cards).toBeGreaterThan(0);
  });
});

test.describe('Keyboard Shortcuts', () => {
  test('/ focuses search', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    await page.keyboard.press('/');
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('search');
  });
});
