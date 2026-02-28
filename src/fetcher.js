/**
 * Content Fetcher
 *
 * Fetches news from WSJ, NYT, and weekly market newsletters
 * (Dividend Cafe, Thoughts from the Frontline)
 */

const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// ============================================================================
// RSS HELPER
// ============================================================================

async function fetchRSSFeed(url, sourceName, maxItems = 5) {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });

    const $ = cheerio.load(data, { xmlMode: true });
    const items = [];

    $('item').slice(0, maxItems).each((_, el) => {
      const title = $(el).find('title').text().trim();
      const description = $(el).find('description').text().trim()
        .replace(/<[^>]*>/g, '')
        .slice(0, 500);
      const pubDate = $(el).find('pubDate').text().trim();
      const link = $(el).find('link').text().trim();

      if (title) {
        items.push({ title, summary: description, date: pubDate, source: sourceName, url: link });
      }
    });

    return items;
  } catch (error) {
    console.error(`  Error fetching ${sourceName}: ${error.message}`);
    return [];
  }
}

// ============================================================================
// WSJ SOURCES (RSS)
// ============================================================================

async function fetchWSJWorld() {
  console.log('  Fetching WSJ World...');
  return fetchRSSFeed('https://feeds.a.dj.com/rss/RSSWorldNews.xml', 'WSJ World', 5);
}

async function fetchWSJBusiness() {
  console.log('  Fetching WSJ Business...');
  return fetchRSSFeed('https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml', 'WSJ Business', 5);
}

async function fetchWSJMarkets() {
  console.log('  Fetching WSJ Markets...');
  return fetchRSSFeed('https://feeds.a.dj.com/rss/RSSMarketsMain.xml', 'WSJ Markets', 5);
}

// ============================================================================
// NYT SOURCES (Top Stories API)
// ============================================================================

async function fetchNYTSection(section, apiKey) {
  try {
    const { data } = await axios.get(
      `https://api.nytimes.com/svc/topstories/v2/${section}.json?api-key=${apiKey}`,
      { timeout: 10000 }
    );

    const items = (data.results || []).slice(0, 5).map(article => ({
      title: article.title,
      summary: article.abstract || '',
      date: article.published_date || '',
      source: `NYT ${section.charAt(0).toUpperCase() + section.slice(1)}`,
      url: article.url,
    }));

    return items;
  } catch (error) {
    console.error(`  Error fetching NYT ${section}: ${error.message}`);
    return [];
  }
}

async function fetchNYTNews(apiKey) {
  console.log('  Fetching NYT Top Stories...');

  if (!apiKey) {
    console.log('    Skipping NYT (no NYT_API_KEY set)');
    return [];
  }

  const [home, business] = await Promise.all([
    fetchNYTSection('home', apiKey),
    fetchNYTSection('business', apiKey),
  ]);

  console.log(`    Found ${home.length} home + ${business.length} business stories`);
  return [...home, ...business];
}

// ============================================================================
// WEEKLY NEWSLETTERS
// ============================================================================

/**
 * Fetch Dividend Cafe (Bahnsen Group) — weekly newsletter via RSS
 * Filters for "Dividend Cafe" category items, extracts content:encoded for substance
 */
async function fetchDividendCafe(lastSeenUrl) {
  console.log('  Fetching Dividend Cafe...');

  try {
    const { data } = await axios.get('https://thebahnsengroup.com/feed', {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
    });

    const $ = cheerio.load(data, { xmlMode: true });
    let found = null;

    $('item').each((_, el) => {
      if (found) return;

      // Check if this is a Dividend Cafe post (by category or title)
      const categories = [];
      $(el).find('category').each((__, cat) => {
        categories.push($(cat).text().trim().toLowerCase());
      });
      const title = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim();

      const isDividendCafe = categories.includes('dividend cafe')
        || title.toLowerCase().includes('dividend cafe');

      if (!isDividendCafe) return;

      // Skip if we already covered this one
      if (lastSeenUrl && link === lastSeenUrl) {
        console.log('    Dividend Cafe: already covered latest issue, skipping');
        return;
      }

      // Extract full content from content:encoded
      const contentEncoded = $(el).find('content\\:encoded').text().trim();
      const plainContent = contentEncoded
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000);

      const pubDate = $(el).find('pubDate').text().trim();

      found = {
        title,
        summary: plainContent || title,
        date: pubDate,
        source: 'Dividend Cafe (Bahnsen Group)',
        url: link,
        isNewsletter: true,
        newsletterKey: 'dividendCafe',
      };
    });

    if (found) {
      console.log(`    Found new Dividend Cafe: "${found.title}"`);
      return [found];
    }

    console.log('    No new Dividend Cafe found');
    return [];
  } catch (error) {
    console.error(`  Error fetching Dividend Cafe: ${error.message}`);
    return [];
  }
}

/**
 * Fetch Thoughts from the Frontline (John Mauldin) — weekly newsletter
 * Scrapes the Wix-hosted site for the latest post
 */
async function fetchFrontlineThoughts(lastSeenUrl) {
  console.log('  Fetching Thoughts from the Frontline...');

  try {
    const { data } = await axios.get('https://www.mauldineconomics.com/frontlinethoughts', {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    let found = null;

    // Try multiple strategies to find the latest post

    // Strategy 1: Look for JSON-LD structured data
    $('script[type="application/ld+json"]').each((_, el) => {
      if (found) return;
      try {
        const json = JSON.parse($(el).html());
        const articles = Array.isArray(json) ? json : [json];
        for (const item of articles) {
          if (item['@type'] === 'Article' || item['@type'] === 'BlogPosting') {
            const url = item.url || item.mainEntityOfPage;
            if (lastSeenUrl && url === lastSeenUrl) {
              console.log('    Frontline Thoughts: already covered latest, skipping');
              return;
            }
            found = {
              title: item.headline || item.name,
              summary: (item.description || item.articleBody || '').slice(0, 3000),
              date: item.datePublished || '',
              source: 'Thoughts from the Frontline (Mauldin)',
              url: url,
              isNewsletter: true,
              newsletterKey: 'frontlineThoughts',
            };
            return;
          }
        }
      } catch {
        // Not valid JSON, skip
      }
    });

    // Strategy 2: Look for article links with og:meta tags
    if (!found) {
      const ogTitle = $('meta[property="og:title"]').attr('content');
      const ogDesc = $('meta[property="og:description"]').attr('content');
      const ogUrl = $('meta[property="og:url"]').attr('content');

      if (ogTitle && ogUrl && ogUrl !== lastSeenUrl) {
        found = {
          title: ogTitle,
          summary: (ogDesc || '').slice(0, 3000),
          date: '',
          source: 'Thoughts from the Frontline (Mauldin)',
          url: ogUrl,
          isNewsletter: true,
          newsletterKey: 'frontlineThoughts',
        };
      }
    }

    // Strategy 3: Scrape article listings from the page
    if (!found) {
      const articleEl = $('article, .post, .blog-post, [class*="article"]').first();
      if (articleEl.length) {
        const title = articleEl.find('h1, h2, h3').first().text().trim();
        const link = articleEl.find('a').first().attr('href');
        const summary = articleEl.find('p').first().text().trim();

        if (title && link !== lastSeenUrl) {
          const fullUrl = link && link.startsWith('http') ? link : `https://www.mauldineconomics.com${link || ''}`;
          found = {
            title,
            summary: (summary || '').slice(0, 3000),
            date: '',
            source: 'Thoughts from the Frontline (Mauldin)',
            url: fullUrl,
            isNewsletter: true,
            newsletterKey: 'frontlineThoughts',
          };
        }
      }
    }

    if (found) {
      console.log(`    Found new Frontline Thoughts: "${found.title}"`);

      // Try to fetch the full article content for a better summary
      try {
        const { data: articleData } = await axios.get(found.url, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });
        const $article = cheerio.load(articleData);

        // Try to get article body content
        const bodyText = $article('article, .post-content, .entry-content, [class*="content"]')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 3000);

        if (bodyText && bodyText.length > found.summary.length) {
          found.summary = bodyText;
        }
      } catch {
        // Use existing summary
      }

      return [found];
    }

    console.log('    No new Frontline Thoughts found');
    return [];
  } catch (error) {
    console.error(`  Error fetching Frontline Thoughts: ${error.message}`);
    return [];
  }
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function wordOverlap(a, b) {
  const wordsA = new Set(normalizeTitle(a).split(' ').filter(w => w.length > 3));
  const wordsB = new Set(normalizeTitle(b).split(' ').filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }
  return overlap / Math.min(wordsA.size, wordsB.size);
}

function deduplicateItems(items) {
  const seen = [];
  const unique = [];

  for (const item of items) {
    const isDuplicate = seen.some(seenTitle => wordOverlap(item.title, seenTitle) > 0.6);
    if (!isDuplicate) {
      seen.push(item.title);
      unique.push(item);
    }
  }

  const removed = items.length - unique.length;
  if (removed > 0) {
    console.log(`  Deduplication: removed ${removed} duplicate items`);
  }

  return unique;
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Fetch all news content and newsletters
 *
 * @param {object} newsletterState - { newsletters: { dividendCafe: { lastSeenUrl }, ... } }
 * @returns {object} { newsItems, newsletters }
 */
async function fetchAllContent(newsletterState = { newsletters: {} }) {
  console.log('Fetching content from all sources...');
  console.log();

  const nytApiKey = process.env.NYT_API_KEY;
  const dcLastSeen = newsletterState.newsletters.dividendCafe?.lastSeenUrl || null;
  const ftLastSeen = newsletterState.newsletters.frontlineThoughts?.lastSeenUrl || null;

  // Fetch everything in parallel
  const [
    wsjWorld, wsjBusiness, wsjMarkets,
    nytNews,
    dividendCafe, frontlineThoughts,
  ] = await Promise.all([
    fetchWSJWorld(),
    fetchWSJBusiness(),
    fetchWSJMarkets(),
    fetchNYTNews(nytApiKey),
    fetchDividendCafe(dcLastSeen),
    fetchFrontlineThoughts(ftLastSeen),
  ]);

  // Separate news items from newsletter items
  const allNewsItems = [...wsjWorld, ...wsjBusiness, ...wsjMarkets, ...nytNews];
  const newsletters = [...dividendCafe, ...frontlineThoughts];

  // Deduplicate news (but not newsletters — they're unique long-form content)
  const dedupedNews = deduplicateItems(allNewsItems);

  console.log();
  console.log(`  WSJ: ${wsjWorld.length + wsjBusiness.length + wsjMarkets.length} items`);
  console.log(`  NYT: ${nytNews.length} items`);
  console.log(`  Newsletters: ${newsletters.length} new issue(s)`);
  console.log(`  After dedup: ${dedupedNews.length} news items`);

  return {
    newsItems: dedupedNews,
    newsletters,
  };
}

module.exports = { fetchAllContent, fetchRSSFeed, deduplicateItems };
