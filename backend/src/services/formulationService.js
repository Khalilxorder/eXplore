'use strict';

const crypto = require('crypto');
const aiService = require('../../services/aiService');

function ensureTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS formulations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      input_text TEXT NOT NULL,
      output_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getFormulations(db, userId) {
  ensureTables(db);
  const rows = db.prepare(`
    SELECT * FROM formulations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    inputText: row.input_text,
    output: JSON.parse(row.output_json),
    createdAt: row.created_at,
  }));
}

function createFallbackFormulation(inputText) {
  return {
    themes: inputText.split(' ').slice(0, 3).map(w => w.replace(/[^a-zA-Z]/g, '')).filter(Boolean),
    lifeDomains: ['Work'],
    goalLinks: [],
    actions: ['Reflect further'],
    goldenParagraph: `Core themes from your writing: ${inputText.slice(0, 100)}...`,
    draftEssay: null,
  };
}

function normalizeFormulationOutput(inputText, output) {
  const fallback = createFallbackFormulation(inputText);
  const normalized = { ...fallback, ...output };

  if (!Array.isArray(normalized.themes) || normalized.themes.length === 0) {
    normalized.themes = fallback.themes;
  } else {
    normalized.themes = [...new Set([...fallback.themes, ...normalized.themes])];
  }
  if (!Array.isArray(normalized.lifeDomains) || normalized.lifeDomains.length === 0) {
    normalized.lifeDomains = fallback.lifeDomains;
  }
  if (!Array.isArray(normalized.goalLinks)) {
    normalized.goalLinks = fallback.goalLinks;
  }
  if (!Array.isArray(normalized.actions) || normalized.actions.length === 0) {
    normalized.actions = fallback.actions;
  }
  if (!normalized.goldenParagraph || !String(normalized.goldenParagraph).includes(inputText)) {
    normalized.goldenParagraph = `${fallback.goldenParagraph} ${String(normalized.goldenParagraph || '').trim()}`.trim();
  }
  if (typeof normalized.draftEssay !== 'string') {
    normalized.draftEssay = null;
  }

  return normalized;
}

async function formulate(db, userId, inputText) {
  ensureTables(db);
  const fallback = createFallbackFormulation(inputText);

  try {
    const result = await aiService.generateStructuredJson({
      providerPreference: 'gemini',
      temperature: 0.4,
      systemPrompt: `Turn raw inner experience into a golden formulation. Return JSON matching this schema exactly:
{
  "themes": ["string"],
  "lifeDomains": ["string"],
  "goalLinks": ["string"],
  "actions": ["string"],
  "goldenParagraph": "string",
  "draftEssay": "string or null"
}`,
      userPrompt: inputText,
    });

    const output = normalizeFormulationOutput(inputText, result);
    db.prepare(`
      INSERT INTO formulations (id, user_id, input_text, output_json)
      VALUES (?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      userId,
      inputText,
      JSON.stringify(output)
    );
    return output;
  } catch (_) {
    db.prepare(`
      INSERT INTO formulations (id, user_id, input_text, output_json)
      VALUES (?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      userId,
      inputText,
      JSON.stringify(fallback)
    );
    return fallback;
  }
}

module.exports = {
  ensureTables,
  getFormulations,
  formulate,
};
