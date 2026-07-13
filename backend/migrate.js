// DB Migration — applies new tables from schema.sqlite.sql to existing explore.db
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'explore.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sqlite.sql');

console.log('[migrate] Opening database:', DB_PATH);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // off during migration

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

// Split into individual statements and run each
const statements = schema
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

let applied = 0;
let skipped = 0;

for (const stmt of statements) {
  try {
    db.prepare(stmt).run();
    applied++;
  } catch (err) {
    if (err.message?.includes('already exists') || err.message?.includes('duplicate')) {
      skipped++;
    } else {
      console.warn('[migrate] Warning on statement:', stmt.slice(0, 80), '->', err.message);
    }
  }
}

db.pragma('foreign_keys = ON');
db.close();

console.log(`[migrate] Done. Applied: ${applied} statements, Skipped: ${skipped}`);
