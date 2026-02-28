/**
 * RSS Feed Publisher
 *
 * Builds or updates an RSS 2.0 feed with iTunes podcast tags
 */

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build or update RSS 2.0 feed
 */
function buildUpdatedFeed(existingFeedXml, episode, baseUrl, podcastInfo) {
  const episodeUrl = `${baseUrl}/episodes/${episode.fileName}`;
  const pubDate = new Date(episode.date).toUTCString();

  const newItem = `
    <item>
      <title>${escapeXml(episode.title)}</title>
      <description>${escapeXml(episode.description)}</description>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${episodeUrl}" length="${episode.fileSizeBytes}" type="audio/mpeg"/>
      <guid isPermaLink="true">${episodeUrl}</guid>
      <itunes:duration>${episode.durationSeconds}</itunes:duration>
    </item>`;

  if (!existingFeedXml || existingFeedXml.trim() === '') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(podcastInfo.title)}</title>
    <link>${baseUrl}</link>
    <description>${escapeXml(podcastInfo.description)}</description>
    <language>en-us</language>
    <itunes:image href="${baseUrl}/artwork.jpg"/>
    <itunes:author>${escapeXml(podcastInfo.author)}</itunes:author>
    <itunes:owner>
      <itunes:name>${escapeXml(podcastInfo.author)}</itunes:name>
    </itunes:owner>
    <itunes:category text="News"/>
    <itunes:explicit>false</itunes:explicit>
    ${newItem}
  </channel>
</rss>`;
  }

  // Subsequent runs — insert new item after <itunes:explicit> tag
  const insertPosition = existingFeedXml.indexOf('</itunes:explicit>');
  if (insertPosition === -1) {
    throw new Error('Invalid feed XML: missing </itunes:explicit> tag');
  }

  const insertPoint = existingFeedXml.indexOf('>', insertPosition) + 1;

  return (
    existingFeedXml.slice(0, insertPoint) +
    newItem +
    existingFeedXml.slice(insertPoint)
  );
}

module.exports = { buildUpdatedFeed };
