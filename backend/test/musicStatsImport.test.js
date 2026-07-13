'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureSqliteIdealState } = require('../src/db/sqliteBootstrap');
const {
  importMusicStatement,
  normalizeStatementRows,
} = require('../src/services/musicStatsImportService');

test('normalizeStatementRows maps distributor statement columns', () => {
  const csv = [
    'Title,Artist,ISRC,Store,Streams,Earnings,Reporting Period',
    '"Neon Heartbeat","K-Explore",USRC12600001,Spotify,"1,200",$4.20,2026-05',
    '"Neon Heartbeat","K-Explore",USRC12600001,Instagram Reels,4500,$0.75,2026-05',
  ].join('\n');

  const rows = normalizeStatementRows(csv, { source: 'DistroKid', fileName: 'distrokid-may.csv' });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'Neon Heartbeat');
  assert.equal(rows[0].platform, 'Spotify');
  assert.equal(rows[0].streamsViews, 1200);
  assert.equal(rows[0].revenue, 4.2);
  assert.equal(rows[1].platform, 'Instagram Reels');
  assert.equal(rows[1].streamsViews, 4500);
});

test('importMusicStatement upserts tracks and aggregates platform stats', () => {
  const db = new Database(':memory:');
  ensureSqliteIdealState(db);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, onboarding)
    VALUES ('user_1', 'user_1@explore.local', 'Test User', 1)
  `).run();

  const csv = [
    'Track Title,Primary Artist,ISRC,Service,Plays,Royalties,Sales Month',
    'New Signal,K-Explore,USRC12600999,SoundCloud,100,2.50,2026-05',
    'New Signal,K-Explore,USRC12600999,SoundCloud,50,1.25,2026-05',
    'New Signal,K-Explore,USRC12600999,TikTok,300,0.60,2026-05',
  ].join('\n');

  const result = importMusicStatement(db, 'user_1', csv, {
    source: 'SoundCloud Artists',
    fileName: 'soundcloud-may.tsv',
  });

  assert.equal(result.importedRows, 3);
  assert.equal(result.tracksTouched, 1);
  assert.equal(result.platformsTouched, 2);

  const track = db.prepare("SELECT * FROM music_tracks WHERE title = 'New Signal'").get();
  assert.equal(track.distributor, 'SoundCloud Artists');

  const soundcloud = db.prepare(`
    SELECT streams_views, revenue
    FROM music_track_stats
    WHERE track_id = ? AND platform = 'SoundCloud'
  `).get(track.id);
  assert.equal(soundcloud.streams_views, 150);
  assert.equal(soundcloud.revenue, 3.75);
});
