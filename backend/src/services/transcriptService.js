'use strict';

const TRANSCRIPT_PREVIEW_LIMIT = 280;

function decodeEscapedJson(value) {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/');
}

function stripHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function pickCaptionTrack(tracks = []) {
  return (
    tracks.find((track) => track.languageCode === 'en') ||
    tracks.find((track) => track.languageCode === 'en-US') ||
    tracks.find((track) => track.kind !== 'asr') ||
    tracks[0] ||
    null
  );
}

function parseCaptionEvents(payload) {
  const events = payload?.events || [];
  const text = events
    .flatMap((event) => event.segs || [])
    .map((segment) => stripHtmlEntities(segment.utf8 || ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function normalizeTranscriptPreview(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TRANSCRIPT_PREVIEW_LIMIT);
}

function buildTranscriptEnvelope({
  transcript = '',
  transcriptStatus,
  transcriptSource,
  transcriptUpdatedAt,
  transcriptProvider,
  fallbackText = '',
} = {}) {
  const cleanTranscript = String(transcript || '').replace(/\s+/g, ' ').trim();
  const cleanFallback = String(fallbackText || '').replace(/\s+/g, ' ').trim();
  const hasTranscript = Boolean(cleanTranscript);
  const hasFallback = Boolean(cleanFallback);
  const now = transcriptUpdatedAt || new Date().toISOString();
  const resolvedTranscript = hasTranscript ? cleanTranscript : (hasFallback ? cleanFallback : '');
  const resolvedStatus = transcriptStatus || (
    hasTranscript ? 'available'
      : hasFallback ? 'description_only'
        : 'unavailable'
  );
  const resolvedSource = transcriptSource || (
    hasTranscript ? 'public_captions'
      : hasFallback ? 'description_fallback'
        : 'unavailable'
  );
  const resolvedProvider = transcriptProvider || (
    hasTranscript ? 'youtube-json3'
      : hasFallback ? 'description_fallback'
        : 'youtube-watch-page'
  );

  return {
    transcript: resolvedTranscript,
    transcriptStatus: resolvedStatus,
    transcriptSource: resolvedSource,
    transcriptPreview: normalizeTranscriptPreview(resolvedTranscript),
    transcriptUpdatedAt: now,
    transcriptProvider: resolvedProvider,
    transcript_status: resolvedStatus,
    transcript_source: resolvedSource,
    transcript_preview: normalizeTranscriptPreview(resolvedTranscript),
    transcript_updated_at: now,
    transcript_provider: resolvedProvider,
  };
}

async function fetchPublicTranscript(videoId) {
  const transcriptUpdatedAt = new Date().toISOString();

  try {
    const watchResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; eXploreBot/1.0)',
      },
    });

    if (!watchResponse.ok) {
      return buildTranscriptEnvelope({
        transcript: '',
        transcriptStatus: 'unavailable',
        transcriptSource: 'unavailable',
        transcriptUpdatedAt,
        transcriptProvider: 'youtube-watch-page',
      });
    }

    const html = await watchResponse.text();
    const match = html.match(/"captionTracks":(\[[\s\S]*?\])/);
    if (!match) {
      return buildTranscriptEnvelope({
        transcript: '',
        transcriptStatus: 'unavailable',
        transcriptSource: 'unavailable',
        transcriptUpdatedAt,
        transcriptProvider: 'youtube-watch-page',
      });
    }

    const tracks = JSON.parse(decodeEscapedJson(match[1]));
    const track = pickCaptionTrack(tracks);
    if (!track?.baseUrl) {
      return buildTranscriptEnvelope({
        transcript: '',
        transcriptStatus: 'unavailable',
        transcriptSource: 'unavailable',
        transcriptUpdatedAt,
        transcriptProvider: 'youtube-watch-page',
      });
    }

    const transcriptResponse = await fetch(`${track.baseUrl}&fmt=json3`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; eXploreBot/1.0)',
      },
    });

    if (!transcriptResponse.ok) {
      return buildTranscriptEnvelope({
        transcript: '',
        transcriptStatus: 'unavailable',
        transcriptSource: 'unavailable',
        transcriptUpdatedAt,
        transcriptProvider: 'youtube-json3',
      });
    }

    const transcriptPayload = await transcriptResponse.json();
    const transcript = parseCaptionEvents(transcriptPayload);

    return buildTranscriptEnvelope({
      transcript,
      transcriptStatus: transcript ? 'available' : 'unavailable',
      transcriptSource: transcript ? 'public_captions' : 'unavailable',
      transcriptUpdatedAt,
      transcriptProvider: 'youtube-json3',
    });
  } catch (error) {
    return buildTranscriptEnvelope({
      transcript: '',
      transcriptStatus: 'unavailable',
      transcriptSource: 'unavailable',
      transcriptUpdatedAt,
      transcriptProvider: 'youtube-watch-page',
    });
  }
}

module.exports = {
  fetchPublicTranscript,
  __test__: {
    buildTranscriptEnvelope,
    decodeEscapedJson,
    normalizeTranscriptPreview,
    parseCaptionEvents,
    pickCaptionTrack,
  },
};
