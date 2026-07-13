'use strict';

const mailService = require('../services/mailIntelligenceService');

const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

function isConfigured() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

function resolveUserId(request) {
  return request.user?.id || 'guest';
}

module.exports = async function mailRoutes(fastify, opts) {
  const db = opts.db;
  mailService.ensureTables(db);

  fastify.get('/auth-url', async (request, reply) => {
    if (!isConfigured()) {
      return { configured: false };
    }
    const userId = resolveUserId(request);
    const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${process.env.GOOGLE_OAUTH_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(process.env.GOOGLE_OAUTH_REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(GOOGLE_SCOPES)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(userId)}`;
    return { configured: true, url };
  });

  fastify.get('/callback', async (request, reply) => {
    const frontendUrl = process.env.META_FRONTEND_SUCCESS_URL || 'http://localhost:3000';
    if (!isConfigured()) {
      return reply.redirect(`${frontendUrl}/?mail=not_configured`);
    }

    const { code, state: userId } = request.query;
    if (!code) {
      return reply.redirect(`${frontendUrl}/?mail=error&message=missing_code`);
    }

    const targetUserId = userId || 'guest';

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[mail-oauth] Token exchange failed:', errorText);
        return reply.redirect(`${frontendUrl}/?mail=error&message=token_exchange_failed`);
      }

      const tokens = await tokenResponse.json();

      // Retrieve user email
      const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      let email = null;
      if (userinfoResponse.ok) {
        const userinfo = await userinfoResponse.json();
        email = userinfo.email;
      }

      // Upsert mail account
      const crypto = require('crypto');
      const existing = db.prepare(`SELECT id FROM mail_accounts WHERE user_id = ? LIMIT 1`).get(targetUserId);
      const expiryTime = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

      if (existing) {
        db.prepare(`
          UPDATE mail_accounts
          SET email = ?,
              access_token = ?,
              refresh_token = COALESCE(?, refresh_token),
              token_expiry = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(email, tokens.access_token, tokens.refresh_token || null, expiryTime, existing.id);
      } else {
        db.prepare(`
          INSERT INTO mail_accounts (id, user_id, provider, email, access_token, refresh_token, token_expiry)
          VALUES (?, ?, 'google', ?, ?, ?, ?)
        `).run(crypto.randomUUID(), targetUserId, email, tokens.access_token, tokens.refresh_token || '', expiryTime);
      }

      return reply.redirect(`${frontendUrl}/?mail=connected`);
    } catch (err) {
      console.error('[mail-oauth] OAuth callback error:', err.message);
      return reply.redirect(`${frontendUrl}/?mail=error&message=${encodeURIComponent(err.message)}`);
    }
  });

  // POST /sync
  fastify.post('/sync', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const result = await mailService.syncMail(db, userId);
      return { success: true, ...result };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // GET /messages
  fastify.get('/messages', async (request, reply) => {
    const userId = resolveUserId(request);
    const { domain, importance } = request.query;
    let sql = `SELECT * FROM mail_messages WHERE user_id = ?`;
    const params = [userId];

    if (domain) {
      sql += ` AND life_domain = ?`;
      params.push(domain);
    }
    if (importance) {
      sql += ` AND importance = ?`;
      params.push(importance);
    }

    sql += ` ORDER BY received_at DESC LIMIT 100`;

    try {
      const messages = db.prepare(sql).all(...params);
      return { success: true, messages };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // GET /priority-feed
  fastify.get('/priority-feed', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const tiers = ['emergency', 'today', 'week', 'opportunity', 'archive', 'ignore'];
      const result = tiers.map((tier) => {
        const messages = db.prepare(`
          SELECT *
          FROM mail_messages
          WHERE user_id = ? AND importance = ?
          ORDER BY received_at DESC
          LIMIT 20
        `).all(userId, tier);
        return { tier, messages };
      });
      return { success: true, tiers: result };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // GET /reference-senders
  fastify.get('/reference-senders', async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      const senders = db.prepare(`
        SELECT *
        FROM mail_reference_senders
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId);
      return { success: true, senders };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // POST /reference-senders
  fastify.post('/reference-senders', async (request, reply) => {
    const userId = resolveUserId(request);
    const { email, label } = request.body || {};
    if (!email) {
      return reply.status(400).send({ success: false, error: 'email is required' });
    }

    try {
      const crypto = require('crypto');
      db.prepare(`
        INSERT OR REPLACE INTO mail_reference_senders (id, user_id, email, label)
        VALUES (?, ?, ?, ?)
      `).run(crypto.randomUUID(), userId, email.trim(), (label || email).trim());
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
};
