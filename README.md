# The Fork

Browse and explore 18,500+ Pitchfork album reviews in a fast, filterable interface. All data scraped directly from Pitchfork and enriched with MusicBrainz metadata.

![The Fork](screenshot.png)

## Features

**Browsing**
- 18,594 album reviews with scores, genres, and cover art
- Grid and list view modes
- Infinite scroll with paginated loading
- Album detail modal with full review info and link to Pitchfork

**Filtering & Search**
- Full-text search across artists, albums, and reviewers
- Filter by genre, decade, year, score range, country, and language
- Sort by date, score, or release year (ascending/descending)
- Group by genre, year, decade, score range, reviewer, country, language, or BNM status
- URL state sync — filters persist in the URL for sharing
- Keyboard shortcut: `/` to focus search

**Statistics Panel**
- Score distribution histogram
- Top genres breakdown
- Reviews by year timeline
- Quick stats: 9.5+ scores, Best New Music count, reviewer count, median score

**Other**
- Dark/light mode with system preference detection
- Responsive design
- Country and language metadata via MusicBrainz enrichment
- On-demand release year fetching from Pitchfork for older entries

## Data Pipeline

The dataset is built through a multi-step pipeline:

1. **Scrape** (`scrape-sitemap.js`) — Crawls Pitchfork's sitemap to extract all album review URLs, then scrapes each review page for artist, title, score, genre, BNM/BNR status, reviewer, description, cover art, and release year
2. **Enrich** (`enrich.js`) — Looks up each album on MusicBrainz to get country and language metadata for the release
3. **Enrich Artists** (`enrich-artists.js`) — Looks up each unique artist on MusicBrainz once to get origin country and inferred language, with much higher hit rate than per-release lookups
4. **Serve** (`serve.js`) — Local Node.js server that serves the static frontend and provides an API endpoint for on-demand release year fetching

## Dataset

| Stat | Value |
|------|-------|
| Total reviews | 18,594 |
| Best New Music | 789 |
| Best New Reissue | 529 |
| Average score | 7.2 |
| Genres | 9 |
| Reviewers | 600 |
| Date range | 2009–2026 |

## Run Locally

```bash
npm install
npm run serve
```

Then open [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
npm run serve              # Start local server
npm run scrape:sitemap     # Scrape all reviews from Pitchfork sitemap
npm run enrich             # Enrich albums with MusicBrainz data
node enrich-artists.js     # Enrich artist-level country/language
```

## Tech Stack

- **Frontend**: Vanilla JS, HTML, CSS (no framework)
- **Fonts**: Inter + Lora (Google Fonts)
- **Server**: Node.js HTTP server
- **Scraping**: Playwright (headless browser)
- **Enrichment**: MusicBrainz API
- **Data**: Static JSON files (~13MB)

## License

MIT
