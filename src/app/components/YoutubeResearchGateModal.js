'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { CheckIcon, PlayIcon } from './Icons';
import { inspectYouTubeResearchUrl } from '../lib/api';

const STORAGE_NOTES_KEY = 'explore-youtube-research-notes-v2';
const STORAGE_HISTORY_KEY = 'explore-youtube-research-history-v1';

export function parseYouTubeVideoId(inputUrl = '') {
  const value = String(inputUrl || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    let candidate = '';
    if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      candidate = url.pathname.match(/^\/(?:embed|v|shorts)\/([^/]+)/)?.[1] || url.searchParams.get('v') || '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function loadNotes(videoId) {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_NOTES_KEY) || '{}')[videoId] || '';
  } catch {
    return '';
  }
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '';
  const minutes = Math.floor(total / 60);
  return `${minutes}m${total % 60 ? ` ${total % 60}s` : ''}`;
}

export default function YoutubeResearchGateModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [research, setResearch] = useState(null);
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

  const inspect = async (rawUrl, supplied = {}) => {
    const videoId = parseYouTubeVideoId(rawUrl);
    setError('');
    setIsPlaying(false);
    setConfirmed(false);
    if (!videoId) {
      setResearch(null);
      setError('Paste a valid YouTube watch, short, embed, or youtu.be URL.');
      return;
    }

    setInput(rawUrl);
    setIsInspecting(true);
    try {
      const result = await inspectYouTubeResearchUrl(rawUrl);
      if (!result?.videoId) throw new Error('The video could not be verified.');
      setResearch({ ...result, title: supplied.title || result.title, summary: supplied.summary || result.summary });
      setNotes(loadNotes(result.videoId));
    } catch (inspectionError) {
      setResearch(null);
      setError(inspectionError.message || 'The research service could not verify this video. Playback remains locked.');
    } finally {
      setIsInspecting(false);
    }
  };

  useEffect(() => {
    const openGate = (event) => {
      const detail = event?.detail || {};
      setIsOpen(true);
      void inspect(detail.url || '', detail);
    };
    window.addEventListener('explore:open-youtube-gate', openGate);
    return () => window.removeEventListener('explore:open-youtube-gate', openGate);
  }, []);

  const saveNotes = (value) => {
    setNotes(value);
    if (!research?.videoId) return;
    try {
      const allNotes = JSON.parse(window.localStorage.getItem(STORAGE_NOTES_KEY) || '{}');
      allNotes[research.videoId] = value;
      window.localStorage.setItem(STORAGE_NOTES_KEY, JSON.stringify(allNotes));
    } catch {}
  };

  const play = () => {
    if (!research || !confirmed || purpose.trim().length < 12) return;
    const entry = { videoId: research.videoId, title: research.title, purpose: purpose.trim(), openedAt: new Date().toISOString() };
    try {
      const history = JSON.parse(window.localStorage.getItem(STORAGE_HISTORY_KEY) || '[]');
      window.localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify([entry, ...history.filter((item) => item.videoId !== entry.videoId)].slice(0, 20)));
    } catch {}
    setIsPlaying(true);
  };

  if (!isOpen) return null;
  const canPlay = Boolean(research && confirmed && purpose.trim().length >= 12);
  const embedUrl = research ? `https://www.youtube-nocookie.com/embed/${research.videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1` : '';

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999, overflowY: 'auto', padding: 16, display: 'grid', placeItems: 'center', background: 'rgba(3, 7, 18, .88)' }}>
      <section role="dialog" aria-modal="true" aria-label="YouTube controlled research gate" onMouseDown={(event) => event.stopPropagation()} className="card" style={{ width: 'min(900px, 100%)', maxHeight: '92vh', overflowY: 'auto', padding: 0 }}>
        <header style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div><strong>Controlled YouTube Research</strong><div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Verification is required before the internal player is enabled.</div></div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsOpen(false)} aria-label="Close research gate">Close</button>
        </header>
        <div style={{ padding: 20, display: 'grid', gap: 18 }}>
          <form onSubmit={(event) => { event.preventDefault(); void inspect(input); }} style={{ display: 'flex', gap: 8 }}>
            <input aria-label="YouTube URL" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Paste a YouTube URL or video ID" style={{ flex: 1, minWidth: 0, padding: '10px 12px' }} />
            <button type="submit" className="btn btn-primary" disabled={isInspecting}>{isInspecting ? 'Verifying…' : 'Inspect'}</button>
          </form>
          {error ? <div role="alert" className="notice notice-error">{error}</div> : null}
          {research ? <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr', gap: 16 }}>
              {research.thumbnailUrl ? <img src={research.thumbnailUrl} alt="Verified video thumbnail" style={{ width: '100%', borderRadius: 8, alignSelf: 'start' }} /> : null}
              <div><span className="badge badge-accent">Phase 1 verified</span><h2 style={{ margin: '8px 0' }}>{research.title}</h2><p style={{ margin: 0, color: 'var(--text-secondary)' }}>{research.summary || 'No publisher description is available.'}</p><p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{research.channelTitle}{research.publishDate ? ` · ${new Date(research.publishDate).toLocaleDateString()}` : ''}{research.durationSeconds ? ` · ${formatDuration(research.durationSeconds)}` : ''}</p><p style={{ fontSize: 13 }}><strong>Transcript:</strong> {research.transcriptStatus === 'available' ? 'available for review' : 'not available'}{research.transcriptPreview ? ` — ${research.transcriptPreview}` : ''}</p></div>
            </div>
            <label style={{ display: 'grid', gap: 6 }}><strong>Research purpose</strong><textarea rows={2} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="State the specific question or knowledge you will extract (12+ characters)." /></label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed the verified metadata and the video directly serves this stated research purpose.</span></label>
            {!isPlaying ? <button type="button" className="btn btn-primary" onClick={play} disabled={!canPlay}><PlayIcon size={18} /> Play inside eXplore</button> : <><iframe title={research.title || 'YouTube research player'} src={embedUrl} sandbox="allow-scripts allow-same-origin allow-presentation" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" style={{ width: '100%', aspectRatio: '16 / 9', border: 0, borderRadius: 8, background: '#000' }} /><button type="button" className="btn btn-secondary" onClick={() => setIsPlaying(false)}><CheckIcon size={16} /> Return to gate</button></>}
            <label style={{ display: 'grid', gap: 6 }}><strong>Research notes</strong><textarea rows={4} value={notes} onChange={(event) => saveNotes(event.target.value)} placeholder="Notes are saved locally for this verified video." /></label>
          </> : null}
        </div>
      </section>
    </div>
  );
}
