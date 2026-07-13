'use strict';
const crypto = require('crypto');

function ensureTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      hypothesis TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getExperiments(db, userId) {
  ensureTables(db);
  const rows = db.prepare(`
    SELECT * FROM experiments
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    hypothesis: row.hypothesis,
    action: row.action,
    status: row.status,
    result: row.result,
    createdAt: row.created_at,
  }));
}

function createExperiment(db, userId, hypothesis, action) {
  ensureTables(db);
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO experiments (id, user_id, hypothesis, action, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(id, userId, hypothesis, action);
  return { id, userId, hypothesis, action, status: 'pending' };
}

function updateExperiment(db, userId, id, status, result) {
  ensureTables(db);
  db.prepare(`
    UPDATE experiments
    SET status = ?, result = ?
    WHERE id = ? AND user_id = ?
  `).run(status, result || null, id, userId);
  return { id, status, result };
}

function deleteExperiment(db, userId, id) {
  ensureTables(db);
  const info = db.prepare(`
    DELETE FROM experiments
    WHERE id = ? AND user_id = ?
  `).run(id, userId);
  return info.changes > 0;
}

module.exports = {
  ensureTables,
  getExperiments,
  createExperiment,
  updateExperiment,
  deleteExperiment,
};
