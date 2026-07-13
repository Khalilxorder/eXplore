'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import {
  ArrowLeftIcon,
  BookmarkIcon,
  XIcon,
  ShareIcon,
  ClockIcon,
  PlayIcon,
  ExternalLinkIcon,
  FileTextIcon,
} from './Icons';
import { fetchContentDetail, saveItem, trackInteraction, apiFetch } from '../lib/api';
import { queueTelemetryEvent } from '../lib/telemetrySdk';
import { openExternalUrl, shareContentLink } from '../lib/external';
import { getSourceTrustBadge } from '../lib/sourceTrust';
import { buildSignalRationale } from '../lib/intelligenceProfile';
import ExplanationChips from './ExplanationChips';
import { useAuth } from './AuthProvider';
import { recordGuestHistory, saveGuestItem } from '../lib/guestPersistence';
import { promoteImageUrlQuality } from '../lib/imageQuality';
import { buildYouTubeEmbedUrl } from '../data/videoLibrary';

function formatDuration(seconds) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }

  if (numeric >= 3600) {
    const hours = Math.floor(numeric / 3600);
    const minutes = Math.floor((numeric % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${Math.max(1, Math.floor(numeric / 60))}m`;
}

function formatDate(value) {
  if (!value) {
    return 'Date unavailable';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Date unavailable';
  }

  return parsed.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function normalizeTranscriptText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildTranscriptPreview(text, maxChars = 420) {
  const transcript = normalizeTranscriptText(text);
  if (!transcript) {
    return { transcript: '', preview: '', hasMore: false };
  }

  if (transcript.length <= maxChars) {
    return { transcript, preview: transcript, hasMore: false };
  }

  const slice = transcript.slice(0, maxChars);
  const safeCut = slice.replace(/\s+\S*$/, '').trimEnd();
  return {
    transcript,
    preview: `${safeCut || slice.trimEnd()}...`,
    hasMore: true,
  };
}

function buildSafeTranscriptPreview(text, maxChars = 420) {
  return buildTranscriptPreview(text, maxChars);
}

function normalizeTranscriptStatus(value, hasTranscriptText = false) {
  const status = String(value || '').trim().toLowerCase();
  if (status) {
    return status;
  }

  return hasTranscriptText ? 'available' : 'missing';
}

function formatTranscriptUpdatedAt(value) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function TranscriptSection({
  transcript,
  transcriptStatus,
  transcriptPreview,
  transcriptSource,
  transcriptUpdatedAt,
}) {
  const [expanded, setExpanded] = useState(false);
  const transcriptText = normalizeTranscriptText(transcript);
  const status = normalizeTranscriptStatus(transcriptStatus, Boolean(transcriptText));
  const normalizedPreview = normalizeTranscriptText(transcriptPreview);
  const transcriptState = transcriptText
    ? buildSafeTranscriptPreview(transcriptText)
    : {
        transcript: '',
        preview: normalizedPreview,
        hasMore: false,
      };
  const previewText = transcriptState.preview || normalizedPreview;
  const hasRenderableTranscript = Boolean(transcriptText || previewText);
  const isUnavailable = ['unavailable', 'missing', 'not_available', 'no_transcript'].includes(status);

  if (!hasRenderableTranscript && isUnavailable) {
    return (
      <div style={{ marginBottom: 'var(--space-medium)' }}>
        <h3 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-tight)' }}>Transcript</h3>
        <div
          className="card"
          style={{
            padding: 'var(--space-base)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-tight)',
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, var(--chrome-bg)) 0%, var(--surface-elevated) 100%)',
          }}
        >
          <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', lineHeight: 1.65, margin: 0 }}>
            Transcript is not publicly available for this item right now.
          </p>
          {transcriptSource ? (
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
              Source: {transcriptSource}
            </p>
          ) : null}
          {transcriptUpdatedAt ? (
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
              Checked: {formatTranscriptUpdatedAt(transcriptUpdatedAt)}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const displayText = expanded || !transcriptState.hasMore
    ? transcriptText || previewText
    : transcriptState.preview;

  return (
    <div style={{ marginBottom: 'var(--space-medium)' }}>
      <h3 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-tight)' }}>Transcript</h3>
      <div
        className="card"
        style={{
          padding: 'var(--space-base)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-small)',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, var(--chrome-bg)) 0%, var(--surface-elevated) 100%)',
        }}
      >
        <p
          style={{
            font: 'var(--font-body)',
            color: 'var(--text-primary)',
            lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
            margin: 0,
          }}
        >
          {displayText}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-tight)' }}>
          <span className="badge badge-accent">
            {status === 'available'
              ? 'Transcript available'
              : status === 'partial'
                ? 'Partial transcript'
                : status === 'description_only'
                  ? 'Description preview'
                  : previewText
                    ? 'Preview available'
                    : 'Transcript unavailable'}
          </span>
          {transcriptSource ? (
            <span className="badge" title={transcriptSource}>
              {transcriptSource}
            </span>
          ) : null}
          {transcriptUpdatedAt ? (
            <span className="badge" title={transcriptUpdatedAt}>
              {formatTranscriptUpdatedAt(transcriptUpdatedAt)}
            </span>
          ) : null}
        </div>

        {transcriptState.hasMore ? (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? 'Show less' : `Show more (${Math.max(0, transcriptState.transcript.length - transcriptState.preview.length)} chars)`}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HeroVisual({ item, sourceTrustBadge, canOpenSource, onOpenSource }) {
  const isWritten = item.channelType === 'written';
  const src = isWritten
    ? promoteImageUrlQuality(String(item.thumbnail || item.image || item.imageUrl || item.coverImage || '').trim())
    : promoteImageUrlQuality(String(item.image || item.imageUrl || item.coverImage || item.thumbnail || '').trim());
  const showOverlayAction = !isWritten && canOpenSource;

  if (!src) {
    return (
      <div style={{
        aspectRatio: '16/9',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 'var(--space-medium)',
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--surface)) 0%, var(--chrome-bg-strong) 100%)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', color: 'var(--text-secondary)' }}>
            <FileTextIcon size={20} />
            <span style={{ font: 'var(--font-caption)', fontWeight: 600 }}>
              {isWritten ? 'Written report' : 'Source view'}
            </span>
          </div>
          {sourceTrustBadge ? (
            <span className="badge" style={sourceTrustBadge.style} title={sourceTrustBadge.title}>
              {sourceTrustBadge.label}
            </span>
          ) : null}
        </div>
        <strong style={{ font: '700 36px/1.05 var(--font-family)', color: 'var(--text-primary)', maxWidth: '420px' }}>
          {item.title}
        </strong>
        <p style={{ color: 'var(--text-secondary)', font: 'var(--font-body)', maxWidth: '520px' }}>
          {isWritten
            ? 'No article image is available, so this view stays focused on the source, summary, and transcript.'
            : 'No source image is available for this item yet.'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', background: '#000' }}>
      {isWritten ? (
        <img
          src={src}
          alt={item.title || 'Written article image'}
          style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', opacity: 0.96, display: 'block' }}
          loading="lazy"
        />
      ) : (
        <Image
          src={src}
          alt={item.title || ''}
          width={1280}
          height={720}
          style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', opacity: 0.96 }}
        />
      )}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: isWritten
          ? 'linear-gradient(180deg, rgba(2, 6, 23, 0.08) 0%, rgba(2, 6, 23, 0.58) 100%)'
          : 'linear-gradient(180deg, rgba(2, 6, 23, 0.08) 0%, rgba(2, 6, 23, 0.34) 100%)',
        pointerEvents: 'none',
      }} />
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 'var(--space-medium)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
            <span className="badge badge-accent" style={{ width: 'fit-content' }}>
            {isWritten ? 'Article image' : 'Source image'}
            </span>
            {sourceTrustBadge ? (
              <span className="badge" style={sourceTrustBadge.style} title={sourceTrustBadge.title}>
                {sourceTrustBadge.label}
              </span>
          ) : null}
        </div>
        <div style={{ maxWidth: '680px', color: '#fff' }}>
          <strong style={{ display: 'block', font: '700 34px/1.05 var(--font-family)', marginBottom: '8px' }}>
            {item.title}
          </strong>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.88)', font: 'var(--font-body)', lineHeight: 1.5 }}>
            {isWritten
              ? 'Written coverage is shown with its real article image when available. Otherwise this stays neutral and focused on the source.'
              : 'Open the source to view the live item in context.'}
          </p>
        </div>
      </div>
      {showOverlayAction ? (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <button
            type="button"
            onClick={onOpenSource}
            style={{
              width: 64,
              height: 64,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(24, 81, 176, 0.92)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              border: 'none',
              color: '#fff',
            }}
            aria-label="Open source"
          >
            <PlayIcon size={28} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function InlineVideoPlayer({ item, sourceTrustBadge, onOpenSource }) {
  const [ytReady, setYtReady] = useState(typeof window !== 'undefined' && !!window.YT && !!window.YT.Player);
  const iframeRef = useRef(null);

  // Load YouTube script
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.YT && window.YT.Player) {
      queueMicrotask(() => setYtReady(true));
      return;
    }
    
    // Check if the script was already injected
    const scripts = document.getElementsByTagName('script');
    let injected = false;
    for (let i = 0; i < scripts.length; i++) {
      if (scripts[i].src === 'https://www.youtube.com/iframe_api') {
        injected = true;
        break;
      }
    }

    if (!injected) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    const checkInterval = setInterval(() => {
      if (window.YT && window.YT.Player) {
        setYtReady(true);
        clearInterval(checkInterval);
      }
    }, 500);

    return () => clearInterval(checkInterval);
  }, []);

  const rawEmbedUrl = String(item?.embedUrl || buildYouTubeEmbedUrl(item?.url) || '').trim();
  const embedUrl = rawEmbedUrl 
    ? (rawEmbedUrl.includes('?') ? `${rawEmbedUrl}&enablejsapi=1` : `${rawEmbedUrl}?enablejsapi=1`) 
    : '';

  useEffect(() => {
    if (!embedUrl || !ytReady || !iframeRef.current || typeof window === 'undefined' || !window.YT || !window.YT.Player) return;

    let player;
    let checkInterval = null;
    const milestonesHit = { 25: false, 50: false, 75: false, 100: false };

    const checkProgress = () => {
      if (!player || typeof player.getCurrentTime !== 'function' || typeof player.getDuration !== 'function') return;
      try {
        const currentTime = player.getCurrentTime();
        const duration = player.getDuration();
        if (duration > 0) {
          const pct = (currentTime / duration) * 100;
          [25, 50, 75, 100].forEach((m) => {
            if (pct >= m && !milestonesHit[m]) {
              milestonesHit[m] = true;
              queueTelemetryEvent('completion', item.id, {
                milestone: m,
                progress: pct,
                duration,
                currentTime,
              });
            }
          });
        }
      } catch (_) {}
    };

    const onStateChange = (event) => {
      // 1 means PLAYING
      if (event.data === 1) {
        if (!checkInterval) {
          checkInterval = setInterval(checkProgress, 1000);
        }
      } else {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
      }
    };

    try {
      player = new window.YT.Player(iframeRef.current, {
        events: {
          onStateChange: onStateChange,
        },
      });
    } catch (err) {
      console.error('Failed to init YT player:', err);
    }

    return () => {
      if (checkInterval) {
        clearInterval(checkInterval);
      }
      if (player && typeof player.destroy === 'function') {
        try {
          player.destroy();
        } catch (_) {}
      }
    };
  }, [embedUrl, ytReady, item?.id]);

  if (!embedUrl) {
    return (
      <HeroVisual
        item={item}
        sourceTrustBadge={sourceTrustBadge}
        canOpenSource={Boolean(item?.url)}
        onOpenSource={onOpenSource}
      />
    );
  }

  return (
    <div style={{ background: '#000' }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', width: '100%' }}>
        <iframe
          ref={iframeRef}
          title={item?.title || 'YouTube video'}
          src={embedUrl}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
        />
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--space-small)',
        flexWrap: 'wrap',
        padding: 'var(--space-small) var(--space-base)',
        background: 'linear-gradient(180deg, rgba(15,23,42,0.94) 0%, rgba(15,23,42,0.98) 100%)',
        color: '#fff',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span className="badge badge-accent" style={{ width: 'fit-content' }}>Playing in app</span>
          <strong style={{ font: 'var(--font-body)' }}>{item?.source || 'YouTube'}</strong>
        </div>
        {sourceTrustBadge ? (
          <span className="badge" style={sourceTrustBadge.style} title={sourceTrustBadge.title}>
            {sourceTrustBadge.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function DetailScreen({ item, onBack, onDismissItem, onAskAi = null }) {
  const { user } = useAuth();
  const [fullItem, setFullItem] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const isLibraryVideo = Boolean(item?.libraryVideo);
  const [feedbackStatus, setFeedbackStatus] = useState('');

  useEffect(() => {
    if (isLibraryVideo || !user?.id || !item?.id) {
      return;
    }

    void trackInteraction(item.id, 'view').catch(() => {});
  }, [isLibraryVideo, item?.id, user?.id]);

  useEffect(() => {
    let cancelled = false;

    if (isLibraryVideo || !item?.id) {
      return undefined;
    }

    (async () => {
      try {
        const payload = await fetchContentDetail(item.id);
        if (!cancelled && payload) {
          setFullItem(payload);
        }
      } catch {
        if (!cancelled) {
          setStatusMessage('Additional detail could not load right now.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLibraryVideo, item?.id]);

  const currentItem = fullItem?.id === item?.id ? fullItem : item;

  useEffect(() => {
    if (!currentItem?.id) return;

    // Send initial dwell heartbeat
    queueTelemetryEvent('dwell', currentItem.id, { heartbeat: 0, duration_ms: 0 });

    let heartbeatCount = 0;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        heartbeatCount += 1;
        queueTelemetryEvent('dwell', currentItem.id, {
          heartbeat: heartbeatCount,
          duration_ms: heartbeatCount * 5000
        }, 5000);
      }
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [currentItem?.id]);

  const submitFeedback = async (action, reason = null) => {
    try {
      setFeedbackStatus('Submitting...');
      const response = await apiFetch('/api/v1/intelligence/feedback', {
        method: 'POST',
        body: JSON.stringify({
          content_item_id: currentItem.id,
          action,
          reason
        })
      });
      if (response && response.success) {
        setFeedbackStatus(`Preferences updated: ${action}${reason ? ` (${reason})` : ''}`);
      } else {
        setFeedbackStatus('Failed to update preferences.');
      }
    } catch (err) {
      console.error(err);
      setFeedbackStatus('Error submitting feedback.');
    }
  };

  const submitValueScore = async (rating) => {
    try {
      setFeedbackStatus('Saving value score...');
      const response = await apiFetch('/api/v1/intelligence/feedback', {
        method: 'POST',
        body: JSON.stringify({
          content_item_id: currentItem.id,
          rating,
          feedback_type: 'value_score',
        }),
      });
      setFeedbackStatus(response?.success ? `Value score saved: ${rating}/10.` : 'Value score could not be saved.');
    } catch {
      setFeedbackStatus('Error saving value score.');
    }
  };

  if (!currentItem) return null;

  const contentUrl = String(currentItem.url || '').trim();
  const hasContentUrl = Boolean(contentUrl);
  const hasSummary = Boolean(currentItem.summary);
  const transcriptText = String(currentItem.transcript || currentItem.transcriptText || '').trim();
  const transcriptStatus = normalizeTranscriptStatus(currentItem.transcriptStatus, Boolean(transcriptText));
  const transcriptPreview = String(currentItem.transcriptPreview || currentItem.transcript_preview || '').trim();
  const transcriptSource = String(currentItem.transcriptSource || currentItem.transcript_source || currentItem.transcriptProvider || '').trim();
  const transcriptUpdatedAt = String(currentItem.transcriptUpdatedAt || currentItem.transcript_updated_at || '').trim();
  const hasTranscript = Boolean(transcriptText || transcriptPreview) && transcriptStatus !== 'unavailable';
  const signalRationale = buildSignalRationale(currentItem);
  const intelligenceExplanation = currentItem.intelligenceExplanation || currentItem.intelligence_explanation || null;
  const sourceTrustBadge = getSourceTrustBadge(currentItem);
  const detailState = hasTranscript
    ? 'Transcript ready'
    : hasSummary
      ? 'Summary ready'
      : 'Summary unavailable';
  const canSave = !currentItem.libraryVideo;

  // AI summary chips — contextual to this article
  const aiSummaryChips = [
    hasSummary && `Summarize "${(currentItem.title || '').slice(0, 50)}"`,
    hasTranscript && 'What are the key takeaways from this transcript?',
    'Why does this matter right now?',
    currentItem.source && `Is ${currentItem.source} a reliable source on this?`,
  ].filter(Boolean).slice(0, 3);

  const handleAskAi = (prefilledQuestion = '') => {
    onAskAi?.({
      title: currentItem.title,
      summary: currentItem.summary || currentItem.reason || '',
      source: currentItem.source || '',
      url: contentUrl,
      prefilledQuestion,
    });
  };

  const handleSave = async () => {
    try {
      if (!canSave) {
        setStatusMessage('This library video is meant to be watched here or opened on YouTube.');
        return;
      }

      if (!user?.id) {
        saveGuestItem(currentItem);
        setStatusMessage('Saved on this device only. Sign in to back it up.');
        return;
      }

      const payload = await saveItem(currentItem.id);
      setStatusMessage(payload?.success ? 'Saved for later.' : 'Sign in to save items.');
    } catch {
      setStatusMessage('Could not save this item right now.');
    }
  };

  const handleOpenSource = async () => {
    try {
      if (!hasContentUrl) {
        setStatusMessage('No source link is available for this item yet.');
        return;
      }

      const result = await openExternalUrl(contentUrl);
      if (result.ok) {
        if (currentItem.libraryVideo) {
          setStatusMessage(result.message || '');
          return;
        }

        if (user?.id) {
          await trackInteraction(currentItem.id, 'open_source');
        } else {
          recordGuestHistory(currentItem, 'open_source');
        }
      }
      setStatusMessage(result.message || '');
    } catch {
      setStatusMessage('Could not open the source right now.');
    }
  };

  const handleShare = async () => {
    try {
      if (!hasContentUrl) {
        setStatusMessage('No source link is available for sharing yet.');
        return;
      }

      const result = await shareContentLink({
        title: currentItem.title,
        text: currentItem.summary || currentItem.reason,
        url: contentUrl,
      });
      setStatusMessage(result.message || '');
    } catch {
      setStatusMessage('Could not share this item right now.');
    }
  };

  const handleDismiss = async () => {
    try {
      if (user?.id) {
        await trackInteraction(currentItem.id, 'dismiss');
      }
    } catch {
      // Keep dismissal working even if tracking fails.
    }
    onDismissItem?.(currentItem);
    onBack?.();
  };

  return (
    <div className="page-enter">
      <div className="container" style={{ paddingTop: 'var(--space-base)' }}>
        <div className="page-header">
          <div className="page-header-main">
            <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
              <ArrowLeftIcon size={22} />
            </button>
            <div className="page-header-copy">
              <span className="page-kicker">Detail view</span>
              <h1 style={{ font: 'var(--font-h2)' }}>Source detail</h1>
              <p className="page-subtitle">
                Source summary, open link, and the reason it entered the feed.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-tight)' }}>
            {canSave ? (
              <button className="btn-icon btn-ghost" onClick={handleSave} aria-label="Save">
                <BookmarkIcon size={22} />
              </button>
            ) : null}
            <button className="btn-icon btn-ghost" onClick={handleShare} aria-label="Share" disabled={!hasContentUrl}>
              <ShareIcon size={22} />
            </button>
          </div>
        </div>
      </div>

      {currentItem.libraryVideo || buildYouTubeEmbedUrl(currentItem.url) ? (
        <InlineVideoPlayer item={currentItem} sourceTrustBadge={sourceTrustBadge} onOpenSource={handleOpenSource} />
      ) : (
        <HeroVisual
          item={currentItem}
          sourceTrustBadge={sourceTrustBadge}
          canOpenSource={hasContentUrl}
          onOpenSource={handleOpenSource}
        />
      )}

      {/* ── AI Summary Bar ─────────────────────────────────────── */}
      {typeof onAskAi === 'function' && (
        <div className="detail-ai-bar">
          <div className="detail-ai-bar-row">
            <div className="detail-ai-bar-icon" aria-hidden="true">✦</div>
            <span className="detail-ai-bar-label">Ask AI about this article</span>
            <button
              type="button"
              className="detail-ai-bar-main-btn"
              onClick={() => handleAskAi()}
            >
              Open chat
            </button>
          </div>
          {aiSummaryChips.length > 0 && (
            <div className="detail-ai-chips">
              {aiSummaryChips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="detail-ai-chip"
                  onClick={() => handleAskAi(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="container" style={{ padding: 'var(--space-medium) var(--space-base)' }}>
        <h1 style={{ font: 'var(--font-h1)', marginBottom: 'var(--space-small)' }}>
          {currentItem.title}
        </h1>
        <div style={{ marginBottom: 'var(--space-small)' }}>
          <span
            className={`status-pill ${(hasSummary || hasTranscript) ? 'is-live' : 'is-partial'}`}
          >
            Detail status: {detailState}
          </span>
        </div>

        <div className="card-meta" style={{ marginBottom: 'var(--space-base)' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{currentItem.source}</span>
          {sourceTrustBadge ? (
            <span className="badge" style={sourceTrustBadge.style} title={sourceTrustBadge.title}>
              {sourceTrustBadge.label}
            </span>
          ) : null}
          <span className="dot-separator">{formatDate(currentItem.date)}</span>
          {currentItem.duration ? (
            <span className="dot-separator" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <ClockIcon size={14} />
              {formatDuration(currentItem.duration)}
            </span>
          ) : (
            <span className="dot-separator">
              {currentItem.channelType === 'written'
                ? 'Written'
                : currentItem.channelType === 'socialVideo'
                  ? 'Video'
                  : 'Photo'}
            </span>
          )}
          {currentItem.templateScore ? (
            <span className="dot-separator">Feed fit {Math.round(currentItem.templateScore * 100)}/100</span>
          ) : null}
          {hasTranscript ? (
            <span className="dot-separator" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <FileTextIcon size={14} />
              Transcript
            </span>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-small)', marginBottom: 'var(--space-medium)', flexWrap: 'wrap' }}>
          {buildYouTubeEmbedUrl(currentItem.url) ? (
            <>
              <button className="btn btn-secondary" onClick={handleOpenSource} disabled={!hasContentUrl}>
                <ExternalLinkIcon size={18} /> Open on YouTube
              </button>
              <button className="btn btn-secondary" onClick={handleShare} disabled={!hasContentUrl}>
                <ShareIcon size={18} /> Share
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={handleOpenSource} disabled={!hasContentUrl}>
                <ExternalLinkIcon size={18} /> Open source
              </button>
              <button className="btn btn-secondary" onClick={handleShare} disabled={!hasContentUrl}>
                <ShareIcon size={18} /> Share
              </button>
            </>
          )}
          {canSave ? (
            <button className="btn btn-secondary" onClick={handleSave}>
              <BookmarkIcon size={18} /> Save
            </button>
          ) : null}
        </div>

        {statusMessage ? (
          <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', marginBottom: 'var(--space-base)' }}>
            {statusMessage}
          </p>
        ) : null}

        <div className="divider" />

        <div style={{
          background: 'var(--accent-light)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-small) var(--space-base)',
          marginBottom: 'var(--space-medium)',
        }}>
          <p style={{ font: 'var(--font-micro)', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: '4px' }}>
            Signal rationale
          </p>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', marginBottom: 'var(--space-tight)' }}>
            {signalRationale.whyShown}
          </p>
          <p style={{ marginTop: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Why trusted:</strong> {signalRationale.whyTrusted}
          </p>
          {signalRationale.whyNotified ? (
            <p style={{ marginTop: 'var(--space-tight)', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Why notified:</strong> {signalRationale.whyNotified}
            </p>
          ) : null}
          {sourceTrustBadge ? (
            <p style={{ marginTop: 'var(--space-tight)', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Source credibility: {sourceTrustBadge.label}
            </p>
          ) : null}
          {currentItem.releaseClassification ? (
            <p style={{ marginTop: 'var(--space-tight)', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Release class: {String(currentItem.releaseClassification).replace(/_/g, ' ')}
            </p>
          ) : null}
          {Array.isArray(currentItem.vendorScope) && currentItem.vendorScope.length ? (
            <p style={{ marginTop: 'var(--space-tight)', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Vendor scope: {currentItem.vendorScope.join(', ')}
            </p>
          ) : null}
          {currentItem.matchedRules?.length ? (
            <p style={{ marginTop: 'var(--space-tight)', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Top rule: {currentItem.matchedRules[0].title}
            </p>
          ) : null}
          {currentItem.goalAlignment > 0 ? (
            <p style={{ marginTop: 'var(--space-tight)', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Long-term fit: {Math.round(currentItem.goalAlignment * 100)}/100
            </p>
          ) : null}
        </div>

        {intelligenceExplanation ? (
          <div style={{ marginBottom: 'var(--space-medium)' }}>
            <p className="page-kicker" style={{ marginBottom: '6px' }}>Shared intelligence explanation</p>
            <ExplanationChips explanation={intelligenceExplanation} rationale={signalRationale} />
          </div>
        ) : null}

        <div style={{ marginBottom: 'var(--space-medium)' }}>
          <h3 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-tight)' }}>Summary</h3>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {currentItem.summary || 'No summary is available for this item yet.'}
          </p>
        </div>

        <TranscriptSection
          transcript={transcriptText}
          transcriptStatus={transcriptStatus}
          transcriptPreview={transcriptPreview}
          transcriptSource={transcriptSource}
          transcriptUpdatedAt={transcriptUpdatedAt}
        />

        {currentItem.topics?.length > 0 ? (
          <div style={{ marginBottom: 'var(--space-medium)' }}>
            <h3 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-tight)' }}>Topics</h3>
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              {currentItem.topics.map((topic) => (
                <span key={topic} className="chip">{topic}</span>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── Explicit Feedback Section ────────────────────────── */}
        <div style={{
          marginTop: 'var(--space-medium)',
          marginBottom: 'var(--space-medium)',
          padding: 'var(--space-base)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-elevated)',
          border: '1px solid var(--border-soft)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-small)'
        }}>
          <h4 style={{ margin: 0, font: 'var(--font-body)', fontWeight: 700 }}>Explicit Feedback</h4>
          <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
            Tell eXplore what you think to adjust your preference profile.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('like')}>
              Valuable
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('more_like')}>
              More like this
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('less_like')}>
              Less like this
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('not_valuable')}>
              Not valuable
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('not_relevant')}>
              Not relevant
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('already_knew')}>
              Already knew this
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('dislike', 'too basic')}>
              Too Basic
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('dislike', 'advanced')}>
              Too Advanced
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('dislike', 'wrong topic')}>
              Wrong Topic
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('dislike', 'wrong_source')}>
              Wrong Source
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('dislike', 'wrong_priority')}>
              Wrong Priority
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => submitFeedback('dislike', 'format mismatch')}>
              Wrong Format
            </button>
          </div>
          <div>
            <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>How valuable was this item to you? (1–10)</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
              {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                <button key={score} type="button" className="btn btn-ghost btn-sm" onClick={() => submitValueScore(score)} aria-label={`Value ${score} out of 10`}>{score}</button>
              ))}
            </div>
          </div>
          {feedbackStatus && (
            <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--success)' }}>
              {feedbackStatus}
            </p>
          )}
        </div>

        {currentItem.scores ? (
          <div style={{ marginBottom: 'var(--space-medium)' }}>
            <h3 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-small)' }}>Scoring breakdown</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
              {Object.entries(currentItem.scores).map(([key, value]) => (
                typeof value === 'number' ? (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-small)' }}>
                    <span style={{
                      font: 'var(--font-caption)',
                      color: 'var(--text-secondary)',
                      width: '120px',
                      textTransform: 'capitalize',
                    }}>{key}</span>
                    <div style={{
                      flex: 1, height: '6px',
                      background: 'var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.max(0, Math.min(100, value * 100))}%`,
                        background: value > 0.8 ? 'var(--accent)' : 'var(--text-tertiary)',
                        borderRadius: 'var(--radius-sm)',
                        transition: 'width 0.5s var(--ease-out)',
                      }} />
                    </div>
                    <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', width: '36px', textAlign: 'right' }}>
                      {Math.round(value * 100)}%
                    </span>
                  </div>
                ) : null
              ))}
            </div>
          </div>
        ) : null}

        {canSave ? (
          <>
            <div className="divider" />

            <div style={{ display: 'flex', gap: 'var(--space-small)', marginBottom: 'var(--space-large)' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleSave}>
                <BookmarkIcon size={18} /> Save
              </button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleDismiss}>
                <XIcon size={18} /> Not for me
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
