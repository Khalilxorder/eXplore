'use strict';

const crypto = require('crypto');
const aiService = require('../../services/aiService');

function ensureTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_variants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      body_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getVariants(db, userId) {
  ensureTables(db);
  const rows = db.prepare(`SELECT * FROM profile_variants WHERE user_id = ? ORDER BY updated_at DESC`).all(userId);
  return rows.map((row) => {
    let body = null;
    try {
      body = row.body_json ? JSON.parse(row.body_json) : null;
    } catch (_) {}
    return {
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      title: row.title,
      body,
      updatedAt: row.updated_at,
    };
  });
}

async function generateVariant(db, userId, kind) {
  ensureTables(db);
  const { getState } = require('./valueHierarchySync');
  const state = getState(db, userId) || {};

  const fallback = {
    summary: `${kind.charAt(0).toUpperCase() + kind.slice(1)} profile variant focused on: ${state.currentGoal || 'active pursuits'}`,
    skills: state.coreValues || [],
    highlights: [
      `Tailored alignment for the current main goal: ${state.currentGoal || 'General growth'}`
    ],
    tailoredFor: kind,
  };

  try {
    const result = await aiService.generateStructuredJson({
      providerPreference: 'gemini',
      temperature: 0.3,
      systemPrompt: `You are a career development assistant. Generate a tailored profile variant in JSON format matching the kind "${kind}". Use the user's values, narrative wishes, and current goal to create highly aligned messaging.
Return exactly this JSON structure:
{
  "summary": "a short summary paragraph detailing the professional / academic trajectory tailored for the kind",
  "skills": ["array of 4-6 aligned skills or core values"],
  "highlights": ["3-4 bulleted bullet points of key experiences or attributes alignment"],
  "tailoredFor": "${kind}"
}`,
      userPrompt: `Main Goal: ${state.currentGoal || 'Not specified'}
Core Values: ${(state.coreValues || []).join(', ')}
Personal Story: ${state.storyYours || 'Not specified'}
Sub-stories: ${state.storySubStories || 'Not specified'}`,
    });

    if (result && typeof result === 'object' && result.summary && Array.isArray(result.skills)) {
      return {
        summary: result.summary,
        skills: result.skills,
        highlights: Array.isArray(result.highlights) ? result.highlights : fallback.highlights,
        tailoredFor: result.tailoredFor || kind,
      };
    }
    return fallback;
  } catch (_) {
    return fallback;
  }
}

function saveVariant(db, userId, kind, title, body) {
  ensureTables(db);
  const existing = db.prepare(`SELECT id FROM profile_variants WHERE user_id = ? AND kind = ? LIMIT 1`).get(userId, kind);
  const bodyJson = JSON.stringify(body);
  if (existing) {
    db.prepare(`
      UPDATE profile_variants
      SET title = ?, body_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, bodyJson, existing.id);
    return existing.id;
  } else {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO profile_variants (id, user_id, kind, title, body_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, kind, title, bodyJson);
    return id;
  }
}

module.exports = { ensureTables, getVariants, generateVariant, saveVariant };
