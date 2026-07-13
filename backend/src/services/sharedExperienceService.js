'use strict';

const crypto = require('crypto');

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_workspaces (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shared_items (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      body TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shared_comments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      item_id TEXT,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shared_project_tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'normal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function defaultWorkspace(db, userId) {
  ensureTables(db);
  let row = db.prepare(`
    SELECT * FROM shared_workspaces
    WHERE owner_id = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(userId);

  if (!row) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO shared_workspaces (id, owner_id, title)
      VALUES (?, ?, ?)
    `).run(id, userId, 'Shared Experience');
    row = db.prepare(`SELECT * FROM shared_workspaces WHERE id = ?`).get(id);
  }

  return row;
}

function parseMetadata(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (_) {
    return {};
  }
}

function listProjects(db, userId) {
  const workspace = defaultWorkspace(db, userId);
  const items = db.prepare(`
    SELECT * FROM shared_items
    WHERE workspace_id = ?
    ORDER BY datetime(updated_at) DESC
  `).all(workspace.id).map((row) => ({ ...row, metadata: parseMetadata(row.metadata_json) }));
  const comments = db.prepare(`
    SELECT * FROM shared_comments
    WHERE workspace_id = ?
    ORDER BY datetime(created_at) ASC
  `).all(workspace.id);
  const tasks = db.prepare(`
    SELECT * FROM shared_project_tasks
    WHERE workspace_id = ?
    ORDER BY done ASC, datetime(created_at) ASC
  `).all(workspace.id).map((row) => ({ ...row, done: Boolean(row.done) }));

  return { workspace, items, comments, tasks };
}

function addItem(db, userId, payload = {}) {
  const workspace = defaultWorkspace(db, userId);
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO shared_items (id, workspace_id, owner_id, kind, title, url, body, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspace.id,
    userId,
    String(payload.kind || 'video'),
    String(payload.title || 'Untitled shared item'),
    payload.url || null,
    payload.body || null,
    JSON.stringify(payload.metadata || {})
  );
  return listProjects(db, userId).items.find((item) => item.id === id);
}

function interact(db, userId, payload = {}) {
  const workspace = defaultWorkspace(db, userId);
  const type = String(payload.type || 'comment');

  if (type === 'task') {
    const id = payload.id || crypto.randomUUID();
    db.prepare(`
      INSERT INTO shared_project_tasks (id, workspace_id, title, done, priority)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        done = excluded.done,
        priority = excluded.priority,
        updated_at = CURRENT_TIMESTAMP
    `).run(id, workspace.id, String(payload.title || 'Shared task'), Number(Boolean(payload.done)), String(payload.priority || 'normal'));
    return { success: true, taskId: id, state: listProjects(db, userId) };
  }

  const body = String(payload.body || '').trim();
  if (!body) {
    const error = new Error('body is required for comments.');
    error.statusCode = 400;
    throw error;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO shared_comments (id, workspace_id, item_id, author_id, body)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, workspace.id, payload.itemId || null, userId, body);
  return { success: true, commentId: id, state: listProjects(db, userId) };
}

module.exports = {
  ensureTables,
  listProjects,
  addItem,
  interact,
};
