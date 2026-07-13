// B2B Anomaly Radar API — public routes with API key auth
'use strict';
const crypto = require('crypto');

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

module.exports = async function radarApiRoutes(fastify, options) {
  const { db } = options;

  // ─── Middleware: API Key Auth ────────────────────────────────────────
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip for key creation endpoint
    if (request.url === '/api/v2/radar/keys' && request.method === 'POST') return;

    const rawKey = request.headers['x-api-key'];
    if (!rawKey) {
      return reply.status(401).send({
        error: 'Missing API key',
        docs: 'Include your API key as the X-Api-Key header. Get a free key at /api/v2/radar/keys',
      });
    }

    const keyHash = hashKey(rawKey);
    const keyRow = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND active = 1').get(keyHash);

    if (!keyRow) {
      return reply.status(403).send({ error: 'Invalid or expired API key.' });
    }

    // Reset daily counter if it's a new day
    const today = new Date().toISOString().split('T')[0];
    if (keyRow.requests_reset_at !== today) {
      db.prepare('UPDATE api_keys SET requests_today = 0, requests_reset_at = ? WHERE id = ?').run(today, keyRow.id);
      keyRow.requests_today = 0;
    }

    // Rate limit check
    if (keyRow.requests_today >= keyRow.rate_limit_daily) {
      return reply.status(429).send({
        error: 'Daily rate limit exceeded',
        limit: keyRow.rate_limit_daily,
        tier: keyRow.tier,
        upgrade: 'Contact us at explore@example.com to upgrade your plan.',
      });
    }

    // Increment counter
    db.prepare('UPDATE api_keys SET requests_today = requests_today + 1 WHERE id = ?').run(keyRow.id);
    request.apiKey = keyRow;
  });

  // ─── POST /api/v2/radar/keys — Create API key ─────────────────────
  fastify.post('/keys', async (request, reply) => {
    const { email, name } = request.body || {};
    if (!email) return reply.status(400).send({ error: 'email is required' });

    const rawKey = `exr_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);
    const keyId = crypto.randomUUID();

    try {
      db.prepare(`
        INSERT INTO api_keys (id, owner_email, owner_name, key_hash, key_prefix, tier, rate_limit_daily)
        VALUES (?, ?, ?, ?, ?, 'starter', 100)
      `).run(keyId, email, name || '', keyHash, keyPrefix);
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return reply.status(409).send({ error: 'An API key already exists for this email.' });
      }
      throw err;
    }

    return {
      api_key: rawKey,
      key_prefix: keyPrefix,
      tier: 'starter',
      rate_limit_daily: 100,
      message: 'Save this key securely — it will not be shown again.',
      docs: {
        score_url: '/api/v2/radar/score',
        trends_url: '/api/v2/radar/trends',
        auth_header: 'X-Api-Key: <your-key>',
        tiers: {
          starter: { price: '$299/mo', daily_limit: 100 },
          pro: { price: '$999/mo', daily_limit: 1000 },
          enterprise: { price: '$5000+/mo', daily_limit: 10000 },
        },
      },
    };
  });

  // ─── POST /api/v2/radar/score — Score a URL ───────────────────────
  fastify.post('/score', async (request, reply) => {
    const { url, content_id } = request.body || {};

    let item = null;

    // Try to look up content by ID or URL
    if (content_id) {
      item = db.prepare('SELECT * FROM content_items WHERE id = ? OR external_id = ?').get(content_id, content_id);
    } else if (url) {
      // Check if this URL is already in our DB as an anomaly
      const rows = db.prepare(`
        SELECT * FROM content_items
        WHERE url LIKE ? OR url = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(`%${url.slice(-40)}%`, url);
      item = rows;
    }

    if (!item) {
      return {
        url: url || content_id,
        anomaly_score: 0.5,
        breakout_probability: 0.3,
        sentiment: 'neutral',
        verdict: 'not_in_database',
        message: 'This URL has not been analyzed yet. Submit it via POST /api/v1/ingest/youtube or /api/v1/ingest/instagram first.',
      };
    }

    const anomalyScore = Math.round(((item.rarity_score || 0) * 0.4 + (item.depth_score || 0) * 0.3 + (item.freshness_score || 0) * 0.3) * 100) / 100;
    const breakoutProb = Math.round(((item.freshness_score || 0) * 0.6 + (item.rarity_score || 0) * 0.4) * 100) / 100;

    return {
      url: item.url,
      title: item.title,
      anomaly_score: anomalyScore,
      breakout_probability: breakoutProb,
      scores: {
        depth: item.depth_score,
        rarity: item.rarity_score,
        freshness: item.freshness_score,
        timeless: item.timeless_score,
        clickbait: item.clickbait_score,
      },
      sentiment: item.clickbait_score > 0.6 ? 'manipulative' : anomalyScore > 0.7 ? 'exceptional' : 'neutral',
      verdict: anomalyScore > 0.75 ? 'high_anomaly' : anomalyScore > 0.5 ? 'moderate_anomaly' : 'normal',
      api_key_tier: request.apiKey?.tier,
    };
  });

  // ─── GET /api/v2/radar/trends — Top current anomalies ─────────────
  fastify.get('/trends', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit) || 20, request.apiKey?.tier === 'enterprise' ? 100 : 20);
    const platform = request.query.platform; // optional filter

    let query = `
      SELECT c.*, s.name AS source_name,
        (c.rarity_score * 0.4 + c.depth_score * 0.3 + c.freshness_score * 0.3) AS anomaly_score
      FROM content_items c
      LEFT JOIN sources s ON s.id = c.source_id
    `;
    const params = [];

    if (platform) {
      query += ' WHERE s.platform = ?';
      params.push(platform);
    }

    query += ' ORDER BY anomaly_score DESC, c.created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params);

    return {
      trends: rows.map(r => ({
        id: r.id,
        title: r.title,
        url: r.url,
        source: r.source_name,
        platform: r.platform,
        anomaly_score: Math.round((r.anomaly_score || 0) * 100) / 100,
        breakout_probability: Math.round(((r.freshness_score || 0) * 0.6 + (r.rarity_score || 0) * 0.4) * 100) / 100,
        depth_score: r.depth_score,
        rarity_score: r.rarity_score,
        publish_date: r.publish_date,
        view_count: r.view_count,
      })),
      meta: {
        count: rows.length,
        generated_at: new Date().toISOString(),
        api_tier: request.apiKey?.tier,
        rate_limit: { used: request.apiKey?.requests_today, daily: request.apiKey?.rate_limit_daily },
      },
    };
  });

  // ─── GET /api/v2/radar/alerts/config — Webhook config ───────────────
  fastify.get('/alerts/config', async (request, reply) => {
    return {
      message: 'Webhook alerts for anomaly spikes are available on Pro and Enterprise tiers.',
      current_tier: request.apiKey?.tier,
      upgrade_url: 'mailto:explore@example.com?subject=Upgrade%20API%20Tier',
      webhook_format: {
        event: 'anomaly.spike',
        payload: { content_id: 'string', url: 'string', anomaly_score: 'number', spike_delta: 'number' },
      },
    };
  });
};
