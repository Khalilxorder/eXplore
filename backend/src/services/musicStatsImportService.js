'use strict';

const crypto = require('crypto');

const HEADER_ALIASES = {
  title: ['title', 'track', 'track title', 'track name', 'song', 'song title', 'release title'],
  artist: ['artist', 'artists', 'primary artist', 'artist name'],
  isrc: ['isrc', 'isrc code'],
  upc: ['upc', 'ean', 'barcode'],
  releaseDate: ['release date', 'released', 'release_date'],
  period: ['period', 'reporting period', 'sales month', 'month', 'statement month', 'date'],
  platform: ['platform', 'store', 'service', 'dsp', 'partner', 'retailer', 'channel'],
  streams: ['streams', 'stream', 'plays', 'views', 'units', 'quantity', 'stream count'],
  reels: ['reels', 'reels count', 'videos', 'video count', 'creations', 'ugc', 'uses', 'usage count'],
  downloads: ['downloads', 'download count'],
  revenue: ['revenue', 'royalties', 'earnings', 'earned', 'amount', 'net revenue', 'you earned', 'payable'],
};

function normalizeHeader(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function detectDelimiter(headerLine = '') {
  const candidates = [',', '\t', ';'];
  return candidates
    .map((delimiter) => ({ delimiter, count: splitDelimitedLine(headerLine, delimiter).length }))
    .sort((left, right) => right.count - left.count)[0].delimiter;
}

function parseDelimitedText(rawText = '') {
  const lines = String(rawText)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());

  if (lines.length < 2) {
    return [];
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitDelimitedLine(lines[0], delimiter).map(normalizeHeader);

  return lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, delimiter);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] || '';
      return row;
    }, {});
  });
}

function findValue(row, field) {
  const aliases = HEADER_ALIASES[field] || [];
  for (const alias of aliases) {
    const normalized = normalizeHeader(alias);
    if (Object.prototype.hasOwnProperty.call(row, normalized) && String(row[normalized] || '').trim()) {
      return String(row[normalized]).trim();
    }
  }
  return '';
}

function parseNumber(value) {
  const cleaned = String(value || '')
    .replace(/\(([^)]+)\)/, '-$1')
    .replace(/[$€£,\s]/g, '')
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePlatform(value = '') {
  const platform = String(value || '').trim();
  const lower = platform.toLowerCase();
  if (lower.includes('spotify')) return 'Spotify';
  if (lower.includes('apple')) return 'Apple Music';
  if (lower.includes('soundcloud')) return 'SoundCloud';
  if (lower.includes('youtube')) return 'YouTube';
  if (lower.includes('instagram') || lower.includes('reels')) return 'Instagram Reels';
  if (lower.includes('tiktok') || lower.includes('tik tok')) return 'TikTok';
  if (platform) return platform;
  return 'Other';
}

function inferDistributor(source = '', fileName = '') {
  const text = `${source} ${fileName}`.toLowerCase();
  if (text.includes('distrokid')) return 'DistroKid';
  if (text.includes('soundcloud')) return 'SoundCloud Artists';
  if (text.includes('tunecore')) return 'TuneCore';
  if (text.includes('cdbaby') || text.includes('cd baby')) return 'CD Baby';
  if (text.includes('unitedmasters')) return 'UnitedMasters';
  return source && source !== 'auto' ? source : 'Imported Distributor';
}

function stableId(parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 16);
}

function normalizeStatementRows(rawText, options = {}) {
  const rows = parseDelimitedText(rawText);
  const distributor = inferDistributor(options.source, options.fileName);

  return rows.map((row) => {
    const title = findValue(row, 'title');
    const isrc = findValue(row, 'isrc');
    const upc = findValue(row, 'upc');
    const platform = normalizePlatform(findValue(row, 'platform'));
    const streams = Math.round(parseNumber(findValue(row, 'streams')));
    const reels = Math.round(parseNumber(findValue(row, 'reels')));
    const downloads = Math.round(parseNumber(findValue(row, 'downloads')));
    const revenue = Number(parseNumber(findValue(row, 'revenue')).toFixed(4));

    return {
      title,
      artist: findValue(row, 'artist'),
      isrc,
      upc,
      releaseDate: findValue(row, 'releaseDate'),
      reportingPeriod: findValue(row, 'period'),
      distributor,
      platform,
      streamsViews: streams,
      reelsCount: reels,
      downloads,
      revenue,
    };
  }).filter((row) => row.title || row.isrc || row.upc);
}

function ensureMusicImportColumns(db) {
  const statements = [
    'ALTER TABLE music_tracks ADD COLUMN source_file TEXT',
    'ALTER TABLE music_track_stats ADD COLUMN source_name TEXT',
    'ALTER TABLE music_track_stats ADD COLUMN source_file TEXT',
    'ALTER TABLE music_track_stats ADD COLUMN reporting_period TEXT',
    'ALTER TABLE music_track_stats ADD COLUMN last_imported_at DATETIME',
  ];

  for (const statement of statements) {
    try {
      db.prepare(statement).run();
    } catch (error) {
      if (!/duplicate column|already exists/i.test(error.message || '')) {
        throw error;
      }
    }
  }
}

function importMusicStatement(db, userId, rawText, options = {}) {
  ensureMusicImportColumns(db);
  const normalizedRows = normalizeStatementRows(rawText, options);
  if (!normalizedRows.length) {
    return { importedRows: 0, tracksTouched: 0, platformsTouched: 0 };
  }

  const touchedTracks = new Set();
  const touchedPlatforms = new Set();
  const sourceFile = String(options.fileName || '').slice(0, 240);

  db.transaction(() => {
    for (const row of normalizedRows) {
      const trackId = `music_${stableId([userId, row.isrc, row.upc, row.title, row.artist])}`;
      const releaseDate = row.releaseDate || row.reportingPeriod || null;

      db.prepare(`
        INSERT INTO music_tracks (id, user_id, title, artist, isrc, upc, release_date, distributor, status, source_file, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Distributed', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          title = COALESCE(NULLIF(excluded.title, ''), music_tracks.title),
          artist = COALESCE(NULLIF(excluded.artist, ''), music_tracks.artist),
          isrc = COALESCE(NULLIF(excluded.isrc, ''), music_tracks.isrc),
          upc = COALESCE(NULLIF(excluded.upc, ''), music_tracks.upc),
          release_date = COALESCE(excluded.release_date, music_tracks.release_date),
          distributor = excluded.distributor,
          status = 'Distributed',
          source_file = COALESCE(NULLIF(excluded.source_file, ''), music_tracks.source_file),
          updated_at = CURRENT_TIMESTAMP
      `).run(
        trackId,
        userId,
        row.title || row.isrc || row.upc,
        row.artist || null,
        row.isrc || null,
        row.upc || null,
        releaseDate,
        row.distributor,
        sourceFile || null
      );

      const statId = `${trackId}_${stableId([row.platform, row.reportingPeriod, sourceFile])}`;
      db.prepare(`
        INSERT INTO music_track_stats (
          id, track_id, platform, streams_views, reels_count, downloads, revenue,
          source_name, source_file, reporting_period, last_imported_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(track_id, platform) DO UPDATE SET
          streams_views = music_track_stats.streams_views + excluded.streams_views,
          reels_count = music_track_stats.reels_count + excluded.reels_count,
          downloads = music_track_stats.downloads + excluded.downloads,
          revenue = music_track_stats.revenue + excluded.revenue,
          source_name = excluded.source_name,
          source_file = excluded.source_file,
          reporting_period = excluded.reporting_period,
          last_imported_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        statId,
        trackId,
        row.platform,
        row.streamsViews,
        row.reelsCount,
        row.downloads,
        row.revenue,
        row.distributor,
        sourceFile || null,
        row.reportingPeriod || null
      );

      touchedTracks.add(trackId);
      touchedPlatforms.add(row.platform);
    }
  })();

  return {
    importedRows: normalizedRows.length,
    tracksTouched: touchedTracks.size,
    platformsTouched: touchedPlatforms.size,
  };
}

module.exports = {
  importMusicStatement,
  normalizeStatementRows,
  parseDelimitedText,
};
