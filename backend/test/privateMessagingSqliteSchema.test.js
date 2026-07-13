'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  REQUIRED_MESSAGE_COLUMNS,
  REQUIRED_RUNTIME_TABLES,
  buildPrivateMessagingReadiness,
} = require('../src/services/privateMessagingReadinessService');

function createDbFromSqliteSchema() {
  const db = new Database(':memory:');
  const schemaPath = path.resolve(__dirname, '../schema.sqlite.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  return db;
}

test('sqlite schema includes private messenger runtime tables and message action columns', () => {
  const db = createDbFromSqliteSchema();
  try {
    const tables = new Set(db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).all().map((row) => row.name));

    REQUIRED_RUNTIME_TABLES.forEach((tableName) => {
      assert.equal(tables.has(tableName), true, `${tableName} should exist in sqlite schema`);
    });

    const messageColumns = new Set(db.prepare('PRAGMA table_info(private_messages)').all().map((row) => row.name));
    REQUIRED_MESSAGE_COLUMNS.forEach((columnName) => {
      assert.equal(messageColumns.has(columnName), true, `private_messages.${columnName} should exist`);
    });
  } finally {
    db.close();
  }
});

test('sqlite schema lets private messaging readiness prove runtime schema parity', () => {
  const db = createDbFromSqliteSchema();
  try {
    const readiness = buildPrivateMessagingReadiness({
      db,
      user: null,
    });

    assert.equal(readiness.status, 'partial');
    assert.equal(readiness.migration_proof_ready, true);
    assert.equal(readiness.runtime_schema_ready, true);
    assert.deepEqual(readiness.missing_tables, []);
    assert.deepEqual(readiness.missing_message_columns, []);
    assert.ok(readiness.blockers.some((blocker) => /signed-in user/i.test(blocker)));
    assert.ok(readiness.blockers.some((blocker) => /recipient device/i.test(blocker)));
  } finally {
    db.close();
  }
});
