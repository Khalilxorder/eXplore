// Affiliate Service — detect product mentions in summaries, auto-generate affiliate links
'use strict';
const crypto = require('crypto');

// Product type detection keywords
const PRODUCT_PATTERNS = [
  { pattern: /\b(book|novel|read|author|bestseller)\b/i, type: 'book', provider: 'amazon', searchPrefix: 'book+' },
  { pattern: /\b(course|learn|tutorial|certification|udemy|masterclass)\b/i, type: 'course', provider: 'udemy', searchPrefix: 'course+' },
  { pattern: /\b(tool|software|app|platform|saas)\b/i, type: 'software', provider: 'amazon', searchPrefix: 'software+' },
  { pattern: /\b(gadget|device|gear|equipment|product)\b/i, type: 'product', provider: 'amazon', searchPrefix: '' },
];

const AFFILIATE_IDS = {
  amazon: process.env.AMAZON_AFFILIATE_ID || 'explore-20',
  udemy: process.env.UDEMY_AFFILIATE_ID || '',
  skillshare: process.env.SKILLSHARE_AFFILIATE_ID || '',
};

function detectProductType(text) {
  for (const { pattern, type, provider, searchPrefix } of PRODUCT_PATTERNS) {
    if (pattern.test(text)) return { type, provider, searchPrefix };
  }
  return null;
}

function buildAffiliateUrl(provider, searchTerm, affiliateId) {
  const encoded = encodeURIComponent(searchTerm);
  switch (provider) {
    case 'amazon':
      return `https://www.amazon.com/s?k=${encoded}&tag=${affiliateId || AFFILIATE_IDS.amazon}`;
    case 'udemy':
      return `https://www.udemy.com/courses/search/?q=${encoded}`;
    default:
      return `https://www.amazon.com/s?k=${encoded}&tag=${AFFILIATE_IDS.amazon}`;
  }
}

function generateAffiliateLinks(db, contentId, title, summary) {
  const fullText = `${title} ${summary}`;
  const detected = detectProductType(fullText);
  if (!detected) return [];

  // Check if already exists
  const existing = db.prepare('SELECT * FROM affiliate_links WHERE content_id = ?').get(contentId);
  if (existing) return [existing];

  // Extract a clean search term from title
  const searchTerm = title
    .replace(/[^\w\s]/g, '')
    .split(' ')
    .slice(0, 4)
    .join(' ');

  const affiliateUrl = buildAffiliateUrl(detected.provider, searchTerm, AFFILIATE_IDS[detected.provider]);
  const linkId = crypto.randomUUID();

  try {
    db.prepare(`
      INSERT OR IGNORE INTO affiliate_links (id, content_id, product_name, affiliate_url, provider)
      VALUES (?, ?, ?, ?, ?)
    `).run(linkId, contentId, searchTerm, affiliateUrl, detected.provider);

    return [{ id: linkId, content_id: contentId, product_name: searchTerm, affiliate_url: affiliateUrl, provider: detected.provider, type: detected.type }];
  } catch {
    return [];
  }
}

function getAffiliateLinksForContent(db, contentId) {
  return db.prepare('SELECT * FROM affiliate_links WHERE content_id = ?').all(contentId);
}

function trackAffiliateClick(db, linkId) {
  db.prepare('UPDATE affiliate_links SET clicks = clicks + 1 WHERE id = ?').run(linkId);
  return { success: true };
}

module.exports = { generateAffiliateLinks, getAffiliateLinksForContent, trackAffiliateClick };
