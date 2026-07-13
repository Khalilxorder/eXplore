'use strict';
const crypto = require('crypto');

const SONG_CATALOG = [
  {
    id: 'tobu-dusk',
    title: 'Dusk',
    artist: 'Tobu',
    energy: 0.72,
    valence: 0.66,
    youtubeUrl: 'https://www.youtube.com/watch?v=w9aZ4n7vVss',
    themes: ['dusk', 'waiting', 'confession', 'love', 'moving', 'departure', 'threshold', 'sudden understanding', 'hope'],
    symbols: ['sunset', 'motion', 'edge', 'distance', 'glow', 'turning point'],
  },
  {
    id: 'threshold-quiet',
    title: 'Threshold Quiet',
    artist: 'Marconi Union - Weightless',
    energy: 0.15,
    valence: 0.42,
    youtubeUrl: 'https://www.youtube.com/watch?v=UfcAVejsrU4',
    themes: ['silence', 'uncertainty', 'reflection', 'night', 'alone', 'memory', 'hesitation', 'calm'],
    symbols: ['moon', 'window', 'room', 'shadow', 'water', 'clouds'],
  },
  {
    id: 'arrival-fire',
    title: 'Arrival Fire',
    artist: 'The Prodigy - Firestarter',
    energy: 0.95,
    valence: 0.68,
    youtubeUrl: 'https://www.youtube.com/watch?v=wmin5WIMEs0',
    themes: ['excitement', 'friends', 'trip', 'arrival', 'courage', 'future', 'rush', 'fire', 'power'],
    symbols: ['road', 'sun', 'open air', 'spark', 'crowd', 'lightning'],
  },
  {
    id: 'old-city-myth',
    title: 'Old City Myth',
    artist: 'Hans Zimmer - Dune Desert Pathway',
    energy: 0.48,
    valence: 0.55,
    youtubeUrl: 'https://www.youtube.com/watch?v=34Na43V4nV4',
    themes: ['tradition', 'myth', 'place', 'history', 'ancestor', 'street', 'journey', 'ancient', 'sand'],
    symbols: ['market', 'stone', 'desert', 'gate', 'ritual', 'wind'],
  },
  {
    id: 'body-signal',
    title: 'Body Signal',
    artist: 'Kavinsky - Nightcall',
    energy: 0.64,
    valence: 0.45,
    youtubeUrl: 'https://www.youtube.com/watch?v=MV_3Dpw-BRY',
    themes: ['heartbeat', 'body', 'pressure', 'fear', 'intensity', 'pulse', 'breath', 'driving', 'night'],
    symbols: ['chest', 'blood', 'drum', 'storm', 'heat', 'neon'],
  },
];

function ensureTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS experience_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
}

function splitTerms(value = '') {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function countPhraseHits(text, phrases = []) {
  return phrases.reduce((count, phrase) => {
    const normalized = normalizeText(phrase);
    if (!normalized) return count;
    return count + (text.includes(normalized) ? 1 : 0);
  }, 0);
}

function inferEnergy(text = '') {
  const high = countPhraseHits(text, ['rush', 'excited', 'running', 'fast', 'heartbeat', 'fire', 'urgent', 'intense', 'power', 'storm']);
  const low = countPhraseHits(text, ['quiet', 'still', 'alone', 'tired', 'slow', 'empty', 'silent', 'calm', 'grief', 'sad']);
  return Math.max(0.12, Math.min(0.98, 0.5 + (high * 0.1) - (low * 0.08)));
}

function inferValence(text = '') {
  const bright = countPhraseHits(text, ['love', 'hope', 'beautiful', 'light', 'friend', 'future', 'joy', 'open', 'dream', 'happy']);
  const dark = countPhraseHits(text, ['fear', 'loss', 'sad', 'leaving', 'pain', 'anxious', 'alone', 'tears', 'cold', 'grief']);
  return Math.max(0.05, Math.min(0.96, 0.5 + (bright * 0.09) - (dark * 0.09)));
}

function matchSong(story = '', context = {}, profile = {}) {
  const text = normalizeText([
    story,
    context.phase,
    context.season,
    context.moon,
    context.weather,
    profile.text,
    ...(Array.isArray(profile.labels) ? profile.labels : []),
  ].filter(Boolean).join(' '));
  const terms = new Set(splitTerms(text));
  const storyEnergy = inferEnergy(text);
  const storyValence = inferValence(text);

  const matches = SONG_CATALOG.map((song) => {
    const themeHits = countPhraseHits(text, song.themes);
    const symbolHits = countPhraseHits(text, song.symbols);
    const termHits = [...terms].filter((term) => (
      song.themes.some((theme) => normalizeText(theme).includes(term))
      || song.symbols.some((symbol) => normalizeText(symbol).includes(term))
    )).length;
    const energyDistance = Math.abs(storyEnergy - song.energy);
    const valenceDistance = Math.abs(storyValence - song.valence);
    const score = Math.min(0.99, (
      (themeHits * 0.16)
      + (symbolHits * 0.13)
      + (Math.min(termHits, 8) * 0.04)
      + ((1 - energyDistance) * 0.18)
      + ((1 - valenceDistance) * 0.18)
    ));

    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      youtubeUrl: song.youtubeUrl,
      score: Number(score.toFixed(3)),
      intensity: Math.round(score * 100),
      reason: [
        themeHits ? `${themeHits} theme matches` : '',
        symbolHits ? `${symbolHits} symbol matches` : '',
        context.phase ? `time: ${context.phase}` : '',
      ].filter(Boolean).join(' | ') || 'Closest symbolic energy match.',
    };
  }).sort((left, right) => right.score - left.score);

  return {
    match: matches[0] || null,
    alternatives: matches.slice(1, 4),
    catalogSize: SONG_CATALOG.length,
  };
}

function getEntries(db, userId) {
  ensureTables(db);
  const rows = db.prepare(`
    SELECT * FROM experience_entries
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
  }));
}

function createEntry(db, userId, kind, body) {
  ensureTables(db);
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO experience_entries (id, user_id, kind, body)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, kind || 'journal', body);
  return { id, userId, kind, body };
}

function updateEntry(db, userId, id, kind, body) {
  ensureTables(db);
  const current = db.prepare(`
    SELECT * FROM experience_entries
    WHERE id = ? AND user_id = ?
  `).get(id, userId);

  if (!current) {
    return null;
  }

  const nextKind = kind || current.kind || 'journal';
  db.prepare(`
    UPDATE experience_entries
    SET kind = ?, body = ?
    WHERE id = ? AND user_id = ?
  `).run(nextKind, body, id, userId);

  return {
    id,
    userId,
    kind: nextKind,
    body,
  };
}

function deleteEntry(db, userId, id) {
  ensureTables(db);
  const info = db.prepare(`
    DELETE FROM experience_entries
    WHERE id = ? AND user_id = ?
  `).run(id, userId);
  return info.changes > 0;
}

module.exports = {
  ensureTables,
  getEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  matchSong,
};
