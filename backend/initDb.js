const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'explore.db');
const schemaPath = path.join(__dirname, 'schema.sql');

try {
  const db = new Database(dbPath);
  
  // Convert Postgres schema to SQLite compatible format loosely
  let schema = fs.readFileSync(schemaPath, 'utf8');

  // Remove Postgres extensions and specific index creations
  schema = schema.replace(/CREATE EXTENSION IF NOT EXISTS vector;/g, '-- CREATE EXTENSION');
  schema = schema.replace(/VECTOR\(1536\)/g, 'TEXT'); // Use TEXT to store vector for SQLite mock
  schema = schema.replace(/TIMESTAMPTZ/g, 'DATETIME');
  schema = schema.replace(/UUID PRIMARY KEY/g, 'TEXT PRIMARY KEY');
  schema = schema.replace(/UUID REFERENCES/g, 'TEXT REFERENCES');
  schema = schema.replace(/TEXT\[\]/g, 'TEXT'); // Represent arrays as JSON strings
  // Replace DEFAULT gen_random_uuid()
  schema = schema.replace(/DEFAULT gen_random_uuid\(\)/g, '');
  
  // SQLite doesn't support vector_cosine_ops in ivfflat
  schema = schema.replace(/CREATE INDEX idx_content_embedding.*/g, '-- CREATE INDEX idx_content_embedding');

  db.exec(schema);

  console.log('Database initialized successfully.');
  db.close();
} catch (error) {
  console.error('Failed to initialize database:', error);
}
