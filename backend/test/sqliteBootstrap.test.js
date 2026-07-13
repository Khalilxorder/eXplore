const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { syncSqliteUser } = require('../src/db/sqliteBootstrap');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      onboarding INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE notification_preferences (
      user_id TEXT PRIMARY KEY,
      alerts_enabled INTEGER,
      ai_enabled INTEGER,
      geo_enabled INTEGER,
      push_enabled INTEGER,
      local_fallback_enabled INTEGER,
      ai_release_watch_enabled INTEGER,
      ai_release_watch_companies_json TEXT,
      ai_release_watch_min_importance TEXT,
      direct_news_watch_enabled INTEGER,
      direct_news_watch_sources_json TEXT,
      direct_news_watch_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

test('syncSqliteUser does not fail when a second auth id reuses an existing email', () => {
  const db = createDb();

  try {
    syncSqliteUser(db, {
      id: 'auth-user-a',
      email: 'same@example.com',
      name: 'First User',
    });
    syncSqliteUser(db, {
      id: 'auth-user-b',
      email: 'same@example.com',
      name: 'Second User',
    });

    const rows = db.prepare('SELECT id, email, name FROM users ORDER BY id').all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows, [
      { id: 'auth-user-a', email: 'same@example.com', name: 'First User' },
      { id: 'auth-user-b', email: 'auth-user-b@explore.local', name: 'Second User' },
    ]);

    const preferenceCount = db.prepare('SELECT COUNT(*) AS count FROM notification_preferences').get().count;
    assert.equal(preferenceCount, 2);
  } finally {
    db.close();
  }
});
