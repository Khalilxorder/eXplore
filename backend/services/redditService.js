'use strict';

const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'eXplore/1.0 (+https://explore.app)';

function getCredentials() {
  return {
    clientId: process.env.REDDIT_CLIENT_ID || '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
  };
}

function parseRedditTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('A subreddit name or Reddit URL is required.');
  }

  const cleaned = raw.replace(/^https?:\/\/(www\.)?reddit\.com\//i, '').replace(/^\/+/, '');
  const subredditMatch = cleaned.match(/^r\/([^/?#]+)/i);
  if (subredditMatch?.[1]) {
    return {
      type: 'subreddit',
      value: subredditMatch[1],
      canonicalUrl: `https://www.reddit.com/r/${subredditMatch[1]}/`,
    };
  }

  if (/^[A-Za-z0-9_]+$/.test(cleaned)) {
    return {
      type: 'subreddit',
      value: cleaned,
      canonicalUrl: `https://www.reddit.com/r/${cleaned}/`,
    };
  }

  throw new Error('Use a subreddit name like "machinelearning" or a Reddit subreddit URL.');
}

async function fetchAccessToken() {
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are required for Reddit import.');
  }

  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.message || 'Unable to fetch a Reddit access token.');
  }

  return payload.access_token;
}

async function fetchSubredditPosts(input, limit = 10) {
  const target = parseRedditTarget(input);
  const accessToken = await fetchAccessToken();
  const url = new URL(`${REDDIT_API_BASE}/r/${encodeURIComponent(target.value)}/hot`);
  url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 25))));
  url.searchParams.set('raw_json', '1');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': USER_AGENT,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Reddit request failed (${response.status}).`);
  }

  const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
  const posts = children
    .map((entry) => entry?.data || null)
    .filter(Boolean)
    .filter((post) => !post.stickied)
    .map((post) => ({
      id: post.id,
      title: post.title || '',
      body: post.selftext || '',
      permalink: `https://www.reddit.com${post.permalink || ''}`,
      publishDate: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : new Date().toISOString(),
      thumbnailUrl: typeof post.thumbnail === 'string' && /^https?:\/\//i.test(post.thumbnail) ? post.thumbnail : '',
      imageUrl: post.preview?.images?.[0]?.source?.url || '',
      isVideo: Boolean(post.is_video || /youtube\.com|youtu\.be|v\.redd\.it/i.test(post.url || '')),
      score: Number(post.score || 0),
      commentCount: Number(post.num_comments || 0),
      subreddit: post.subreddit || target.value,
      author: post.author || '',
      outboundUrl: post.url_overridden_by_dest || post.url || '',
    }));

  return {
    target,
    posts,
  };
}

module.exports = {
  fetchSubredditPosts,
};
