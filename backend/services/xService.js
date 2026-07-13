'use strict';

const X_API_BASE = 'https://api.twitter.com/2';

function getBearerToken() {
  return process.env.X_BEARER_TOKEN || '';
}

function parseUsername(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('An X profile URL or username is required.');
  }

  const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  return raw.replace(/^@/, '');
}

async function xRequest(pathname, query = {}) {
  const bearerToken = getBearerToken();
  if (!bearerToken) {
    throw new Error('X_BEARER_TOKEN is required for X import.');
  }

  const url = new URL(`${X_API_BASE}/${String(pathname || '').replace(/^\/+/, '')}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.title || `X request failed (${response.status}).`);
  }

  return payload;
}

async function fetchProfilePosts(input, limit = 10) {
  const username = parseUsername(input);
  const userPayload = await xRequest(`users/by/username/${encodeURIComponent(username)}`, {
    'user.fields': 'name,username,profile_image_url',
  });
  const userId = userPayload?.data?.id;

  if (!userId) {
    throw new Error('That X user could not be found.');
  }

  const tweetPayload = await xRequest(`users/${encodeURIComponent(userId)}/tweets`, {
    max_results: Math.max(5, Math.min(limit, 25)),
    exclude: 'replies,retweets',
    expansions: 'attachments.media_keys',
    'tweet.fields': 'created_at,attachments,text',
    'media.fields': 'type,url,preview_image_url',
  });

  const mediaByKey = new Map(
    (tweetPayload?.includes?.media || []).map((media) => [media.media_key, media]),
  );

  const posts = Array.isArray(tweetPayload?.data)
    ? tweetPayload.data.map((tweet) => {
        const mediaKeys = Array.isArray(tweet?.attachments?.media_keys) ? tweet.attachments.media_keys : [];
        const media = mediaKeys.map((key) => mediaByKey.get(key)).filter(Boolean);
        const firstMedia = media[0] || null;

        return {
          id: tweet.id,
          text: tweet.text || '',
          publishDate: tweet.created_at || new Date().toISOString(),
          profileUrl: `https://x.com/${username}/status/${tweet.id}`,
          mediaType: firstMedia?.type || '',
          imageUrl: firstMedia?.url || firstMedia?.preview_image_url || '',
          username,
          name: userPayload?.data?.name || username,
          profileImageUrl: userPayload?.data?.profile_image_url || '',
        };
      })
    : [];

  return {
    username,
    name: userPayload?.data?.name || username,
    profileImageUrl: userPayload?.data?.profile_image_url || '',
    profileUrl: `https://x.com/${username}`,
    posts,
  };
}

module.exports = {
  fetchProfilePosts,
};
