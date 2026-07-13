'use strict';

function decodeHtml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gis, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? stripHtml(match[1]) : '';
}

function extractAttr(block, tagName, attrName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*${attrName}="([^"]+)"[^>]*\\/?>`, 'i'));
  return match?.[1] ? String(match[1]).trim() : '';
}

function extractLink(block) {
  const enclosure = extractAttr(block, 'enclosure', 'url');
  if (enclosure) {
    return enclosure;
  }

  const link = extractTag(block, 'link');
  return link || extractTag(block, 'guid');
}

function parseFeed(xml, feedUrl, limit = 8) {
  const channelTitle = extractTag(xml, 'title') || 'Podcast feed';
  const channelImage = extractAttr(xml, 'itunes:image', 'href') || extractTag(xml, 'url');
  const items = (xml.match(/<item\b[\s\S]*?<\/item>/gi) || [])
    .slice(0, limit)
    .map((block) => {
      const title = extractTag(block, 'title');
      const audioUrl = extractAttr(block, 'enclosure', 'url');
      const pageUrl = extractTag(block, 'link');
      const guid = extractTag(block, 'guid');
      const description = extractTag(block, 'description') || extractTag(block, 'content:encoded') || extractTag(block, 'summary');
      const publishDate = extractTag(block, 'pubDate') || extractTag(block, 'published');
      const duration = extractTag(block, 'itunes:duration');
      const imageUrl = extractAttr(block, 'itunes:image', 'href') || channelImage || '';

      return {
        title,
        url: audioUrl || pageUrl || guid,
        canonicalUrl: pageUrl || audioUrl || guid,
        description,
        publishDate,
        duration,
        imageUrl,
      };
    })
    .filter((item) => item.title && item.url);

  return {
    sourceName: channelTitle,
    sourceUrl: feedUrl,
    imageUrl: channelImage || '',
    items,
  };
}

async function fetchPodcastFeed(feedUrl, limit = 8) {
  const response = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'eXplore/1.0 (+podcast-feed-import)',
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Podcast feed request failed (${response.status}).`);
  }

  const xml = await response.text();
  const parsed = parseFeed(xml, feedUrl, limit);
  if (!parsed.items.length) {
    throw new Error('No podcast episodes were found in that RSS feed.');
  }

  return parsed;
}

module.exports = {
  fetchPodcastFeed,
};
