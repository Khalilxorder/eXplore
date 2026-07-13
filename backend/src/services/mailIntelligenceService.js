'use strict';

const crypto = require('crypto');
const aiService = require('../../services/aiService');

function ensureTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'google',
      email TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mail_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT,
      gmail_id TEXT UNIQUE,
      sender TEXT,
      subject TEXT,
      snippet TEXT,
      received_at TEXT,
      life_domain TEXT,
      importance TEXT,
      summary TEXT,
      deadline TEXT,
      action TEXT,
      draft_reply TEXT,
      is_emergency INTEGER DEFAULT 0,
      processed_at TEXT,
      raw_excerpt TEXT
    );

    CREATE TABLE IF NOT EXISTS mail_reference_senders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Dynamic migrations to add new columns if schema updates
  const columnsToAdd = [
    ['mail_messages', 'draft_reply', 'TEXT'],
    ['mail_messages', 'is_emergency', 'INTEGER DEFAULT 0'],
    ['mail_messages', 'raw_excerpt', 'TEXT'],
  ];

  for (const [table, colName, colType] of columnsToAdd) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colType};`);
    } catch (_) {
      // Column already exists
    }
  }
}

// LIFE DOMAIN CLASSIFIER (deterministic fallback)
const DOMAIN_KEYWORD_MAP = {
  'Visa/Documents': ['visa', 'passport', 'permit', 'residence', 'immigration', 'embassy', 'id card', 'okmany', 'tartozkodasi'],
  'University': ['university', 'campus', 'lecture', 'semester', 'professor', 'course', 'assignment', 'grade', 'exam', 'diak', 'egyetem'],
  'Work': ['job', 'interview', 'employer', 'salary', 'contract', 'colleague', 'meeting', 'hr', 'work', 'munka', 'karrier'],
  'Scholarship': ['scholarship', 'grant', 'fellowship', 'stipend', 'funding', 'application', 'award', 'osztondij'],
  'Money': ['invoice', 'bill', 'payment', 'bank', 'transaction', 'rent', 'fee', 'subscription', 'szamla', 'fizetes'],
  'Family': ['family', 'parent', 'mother', 'father', 'sibling', 'relative', 'csalad'],
  'Housing': ['apartment', 'landlord', 'rent', 'housing', 'accommodation', 'lease', 'alberlet', 'lakas'],
  'Health': ['doctor', 'appointment', 'hospital', 'health', 'medical', 'prescription', 'orvos', 'egeszseg'],
  'Urgent': ['urgent', 'asap', 'immediately', 'deadline', 'expire', 'overdue', 'surgos', 'hatarido'],
  'Creative/SPHERE': ['project', 'creative', 'sphere', 'design', 'art', 'music', 'film', 'alkoto', 'muvesz'],
};

function classifyLifeDomain(text) {
  const lower = (text || '').toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORD_MAP)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return domain;
    }
  }
  return 'Work'; // safe default
}

// DETERMINISTIC IMPORTANCE FALLBACK
function classifyImportanceFallback(subject = '', snippet = '') {
  const text = (subject + ' ' + snippet).toLowerCase();
  if (/urgent|asap|immediately|expire|overdue|surgos|azonnal|fontos/.test(text)) {
    return 'emergency';
  }
  if (/deadline|due|invoice|bill|payment|szamla|fizet/.test(text)) {
    return 'today';
  }
  if (/scholarship|visa|permit|university|osztondij|egyetem/.test(text)) {
    return 'opportunity';
  }
  if (/newsletter|unsubscribe|promo|hirlevel|reklam/.test(text)) {
    return 'ignore';
  }
  return 'week'; // default to week
}

async function classifyMessage(db, message) {
  const fallback = {
    life_domain: classifyLifeDomain((message.subject || '') + ' ' + (message.snippet || '')),
    importance: classifyImportanceFallback(message.subject, message.snippet),
    summary: (message.snippet || '').slice(0, 200),
    deadline: null,
    action: null,
    draft_reply: null,
    is_emergency: 0,
  };

  try {
    const systemPrompt = `
You classify incoming email notifications for a personal assistant.
Analyze the email content and determine metadata fields.

Return valid JSON matching this schema exactly:
{
  "life_domain": "University|Work|Scholarship|Visa/Documents|Money|Family|Housing|Health|Urgent|Creative/SPHERE",
  "importance": "emergency|today|week|opportunity|archive|ignore",
  "summary": "Short 1-sentence summary of the email (max 100 characters)",
  "deadline": "ISO date string if a clear deadline exists, otherwise null",
  "action": "A single concrete action required from the user, otherwise null",
  "draft_reply": "A brief polite response draft if the email expects a reply, otherwise null",
  "is_emergency": 0 or 1
}
`.trim();

    const userPrompt = `
From: ${message.sender}
Subject: ${message.subject}
Snippet: ${message.snippet}
`.trim();

    const result = await aiService.generateStructuredJson({
      providerPreference: 'gemini',
      temperature: 0.2,
      systemPrompt,
      userPrompt,
    });

    const validDomains = Object.keys(DOMAIN_KEYWORD_MAP);
    const validImportance = ['emergency', 'today', 'week', 'opportunity', 'archive', 'ignore'];

    return {
      life_domain: validDomains.includes(result?.life_domain) ? result.life_domain : fallback.life_domain,
      importance: validImportance.includes(result?.importance) ? result.importance : fallback.importance,
      summary: result?.summary || fallback.summary,
      deadline: result?.deadline || fallback.deadline,
      action: result?.action || fallback.action,
      draft_reply: result?.draft_reply || fallback.draft_reply,
      is_emergency: result?.is_emergency === 1 || result?.is_emergency === true ? 1 : 0,
    };
  } catch (_) {
    return fallback;
  }
}

async function refreshAccessToken(db, account) {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
      refresh_token: account.refresh_token || '',
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.statusText}`);
  }

  const tokens = await res.json();
  const expiryTime = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

  db.prepare(`
    UPDATE mail_accounts
    SET access_token = ?,
        token_expiry = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(tokens.access_token, expiryTime, account.id);

  return tokens.access_token;
}

async function syncMail(db, userId) {
  ensureTables(db);
  const account = db.prepare(`
    SELECT *
    FROM mail_accounts
    WHERE user_id = ?
    LIMIT 1
  `).get(userId);

  if (!account) {
    return { synced: 0, classified: 0, error: 'No connected mail account found' };
  }

  let accessToken = account.access_token;
  const expiryTime = account.token_expiry ? new Date(account.token_expiry).getTime() : 0;
  if (Date.now() >= expiryTime - 60000) {
    try {
      accessToken = await refreshAccessToken(db, account);
    } catch (err) {
      console.error('[mail-sync] Failed to refresh token:', err.message);
      return { synced: 0, classified: 0, error: `Auth refresh failed: ${err.message}` };
    }
  }

  try {
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      throw new Error(`Gmail API list returned status ${listRes.status}`);
    }

    const listData = await listRes.json();
    const messages = listData.messages || [];

    let synced = 0;
    let classified = 0;

    for (const msg of messages) {
      const existing = db.prepare(`SELECT id FROM mail_messages WHERE gmail_id = ? LIMIT 1`).get(msg.id);
      if (existing) {
        continue;
      }

      // Fetch message metadata
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!msgRes.ok) {
        console.warn(`[mail-sync] Failed to fetch message details for ${msg.id}: ${msgRes.statusText}`);
        continue;
      }

      const msgData = await msgRes.json();
      const headers = msgData.payload?.headers || [];
      const senderHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'unknown';
      const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
      const dateHeader = headers.find(h => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();

      const messageObj = {
        gmail_id: msg.id,
        sender: senderHeader,
        subject: subjectHeader,
        snippet: msgData.snippet || '',
        received_at: new Date(dateHeader).toISOString(),
      };

      // Classify the message using AI or fallback
      const classification = await classifyMessage(db, messageObj);
      classified++;

      db.prepare(`
        INSERT INTO mail_messages (
          id, user_id, account_id, gmail_id, sender, subject, snippet, received_at,
          life_domain, importance, summary, deadline, action, draft_reply, is_emergency, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        crypto.randomUUID(),
        userId,
        account.id,
        messageObj.gmail_id,
        messageObj.sender,
        messageObj.subject,
        messageObj.snippet,
        messageObj.received_at,
        classification.life_domain,
        classification.importance,
        classification.summary,
        classification.deadline,
        classification.action,
        classification.draft_reply,
        classification.is_emergency
      );

      synced++;
    }

    return { synced, classified };
  } catch (err) {
    console.error('[mail-sync] Gmail fetch error:', err.message);
    return { synced: 0, classified: 0, error: err.message };
  }
}

module.exports = {
  ensureTables,
  classifyLifeDomain,
  classifyImportanceFallback,
  classifyMessage,
  syncMail,
};
