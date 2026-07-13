'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { queueTelemetryEvent } from '../lib/telemetrySdk';
import {
  BookmarkIcon,
  XIcon,
  ClockIcon,
  FileTextIcon,
  VideoIcon,
  ImageIcon,
} from './Icons';
import { getSourceTrustBadge } from '../lib/sourceTrust';
import {
  resolveVisualMeaningCopy,
  resolveVisualMeaningImageSource,
  resolveVisualMeaningTitle,
} from '../lib/visualMeaning';
import { promoteImageUrlQuality } from '../lib/imageQuality';
import {
  getEventPriorityStorageKey,
  loadEventPriorityMap,
} from '../lib/eventOnlyIntelligence';

const BADGE_CONFIG = {
  new: { label: 'New', className: 'badge-new' },
  rare: { label: 'Rare', className: 'badge-premium' },
  timeless: { label: 'Timeless', className: 'badge-accent' },
  deep: { label: 'Deep Dive', className: 'badge-accent' },
};

const CHANNEL_META = {
  written: { icon: <FileTextIcon size={14} />, label: 'Written' },
  socialVideo: { icon: <VideoIcon size={14} />, label: 'Video' },
  socialPhoto: { icon: <ImageIcon size={14} />, label: 'Photo' },
};

const COMPACT_BREAKPOINT = 720;

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

function getDiscoveryLaneLabel(discovery) {
  const lane = String(discovery?.lane || '').trim().toLowerCase();
  if (!lane) {
    return '';
  }

  if (lane === 'tracked_channels') {
    return 'Tracked channel';
  }

  if (lane === 'topic_monitors') {
    return 'Topic monitor';
  }

  if (lane === 'strategic_discovery') {
    return 'Discovery';
  }

  return 'Best Feed';
}

function getWrittenThumbnailSource(item = {}) {
  return promoteImageUrlQuality(String(
    item?.thumbnail
      || item?.image
      || item?.imageUrl
      || item?.coverImage
      || item?.media?.thumbnail
      || item?.media?.image
      || item?.media?.imageUrl
      || ''
  ).trim());
}

function getWrittenFallbackCopy(item = {}) {
  return String(
    item?.summary
      || item?.description
      || item?.snippet
      || item?.reason
      || 'Written coverage from the source.'
  ).trim();
}

function ThumbnailPanel({ item, visualMeaning, sourceTrustBadge, compact = false }) {
  const isWritten = item.channelType === 'written';
  const imageSrc = isWritten
    ? getWrittenThumbnailSource(item)
    : resolveVisualMeaningImageSource(item, visualMeaning);
  const summaryTitle = isWritten
    ? String(item?.title || 'Written update').trim()
    : resolveVisualMeaningTitle(item, visualMeaning);
  const summaryCopy = isWritten
    ? getWrittenFallbackCopy(item)
    : resolveVisualMeaningCopy(item, visualMeaning);

  if (imageSrc) {
    return (
      <div style={{ position: 'relative', marginBottom: compact ? '8px' : 'var(--space-small)' }}>
        {isWritten ? (
          <img
            src={imageSrc}
            alt={item.title || 'Article image'}
            className="card-thumbnail"
            loading="lazy"
          />
        ) : (
          <Image
            src={imageSrc}
            alt={item.title || ''}
            className="card-thumbnail"
            width={640}
            height={360}
            loading="lazy"
          />
        )}
        {isWritten ? (
          <span style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: 'rgba(15, 23, 42, 0.82)',
            color: '#fff',
            padding: '3px 7px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(255,255,255,0.12)',
            fontSize: '11px',
            fontWeight: 600,
          }}>
            Article image
          </span>
        ) : null}
        {item.duration ? (
          <span style={{
            position: 'absolute',
            bottom: '8px',
            right: '8px',
            background: 'rgba(15, 23, 42, 0.9)',
            color: '#fff',
            padding: '3px 7px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(255,255,255,0.12)',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            <ClockIcon size={12} />
            {formatDuration(item.duration)}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="card-thumbnail card-thumbnail-fallback"
      style={{
        minHeight: compact ? 'auto' : '240px',
        padding: compact ? 'var(--space-small)' : 'var(--space-base)',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '8px' : 'var(--space-small)',
        background: isWritten
          ? 'linear-gradient(180deg, rgba(30, 90, 168, 0.08) 0%, rgba(30, 90, 168, 0.03) 100%)'
          : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', color: 'var(--text-secondary)' }}>
          {CHANNEL_META[item.channelType]?.icon}
          <span style={{ font: 'var(--font-caption)', fontWeight: 600 }}>
            {CHANNEL_META[item.channelType]?.label || 'Content'}
          </span>
        </div>
        <span className="badge badge-accent" style={{ width: 'fit-content' }}>
          {isWritten ? 'No image' : 'Preview unavailable'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '6px' : '10px' }}>
        <strong style={{ display: 'block', font: compact ? '700 17px/1.15 var(--font-family)' : '700 20px/1.08 var(--font-family)', color: 'var(--text-primary)' }}>
          {summaryTitle}
        </strong>
        <p className="card-thumbnail-fallback-copy" style={{ margin: 0 }}>
          {summaryCopy}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
          {item.source ? (
            <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {item.source}
            </span>
          ) : null}
          {sourceTrustBadge ? (
            <span className="badge" style={sourceTrustBadge.style} title={sourceTrustBadge.title}>
              {sourceTrustBadge.label}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ContentCard({ item, variant = 'compact', onSave, onDismiss, onClick }) {
  const isFeatured = variant === 'featured';
  const [isCompactScreen, setIsCompactScreen] = useState(false);
  const visualMeaning = item.visualMeaning || null;
  const showActions = Boolean(onSave || onDismiss);
  const discoveryLaneLabel = getDiscoveryLaneLabel(item.discovery);
  const sourceTrustBadge = getSourceTrustBadge(item);

  const [priorityMap, setPriorityMap] = useState(() => loadEventPriorityMap());
  const [pressTimer, setPressTimer] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [longPressed, setLongPressed] = useState(false);

  const storageKey = getEventPriorityStorageKey(item);
  const currentPriority = priorityMap[storageKey] || '';

  const startPress = (e) => {
    if (e.button && e.button !== 0) return;
    setLongPressed(false);
    if (pressTimer) clearTimeout(pressTimer);
    const timer = setTimeout(() => {
      setShowPicker(true);
      setLongPressed(true);
    }, 700);
    setPressTimer(timer);
  };

  const endPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      setPressTimer(null);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    setShowPicker(true);
  };

  const handleSetPriority = (levelKey) => {
    const nextMap = { ...priorityMap };
    if (levelKey) {
      nextMap[storageKey] = levelKey;
    } else {
      delete nextMap[storageKey];
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('explore-event-only-priorities-v1', JSON.stringify(nextMap));
    }
    setPriorityMap(nextMap);
  };

  const freshness = (() => {
    const ts = item.date || item.publishedAt;
    if (!ts) return 'Unknown';
    return formatDate(ts);
  })();
  const sourceTrustPercent = Math.round((item.sourceTrust || item.scores?.sourceTrust || 0.5) * 100);
  const matchedRule = item.matchedRules?.[0]?.title || item.reason || 'General Feed';
  const actionValue = Math.round((item.scores?.decisionUsefulness || item.scores?.lifeImpact || 0.5) * 100) + '%';
  const explanation = item.intelligenceExplanation || item.intelligence_explanation || null;

  const cardRef = useRef(null);

  useEffect(() => {
    if (!item?.id || typeof window === 'undefined' || !window.IntersectionObserver) return;

    let timer = null;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            timer = setTimeout(() => {
              queueTelemetryEvent('visible_2s', item.id, {
                title: item.title,
                source: item.source
              });
            }, 2000);
          } else {
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
          }
        });
      },
      { threshold: 0.5 }
    );

    const element = cardRef.current;
    if (element) {
      observer.observe(element);
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (element) {
        try {
          observer.unobserve(element);
        } catch (_) {}
      }
    };
  }, [item?.id, item?.source, item?.title]);

  useEffect(() => {
    const updateCompact = () => {
      setIsCompactScreen(window.innerWidth <= COMPACT_BREAKPOINT);
    };

    updateCompact();
    window.addEventListener('resize', updateCompact);
    return () => window.removeEventListener('resize', updateCompact);
  }, []);

  return (
    <article
      ref={cardRef}
      className={`card ${isFeatured ? 'card--featured' : 'card--compact'}`}
      style={{
        width: isFeatured ? '100%' : (isCompactScreen ? '100%' : '280px'),
        cursor: 'pointer',
        background: 'var(--surface)',
      }}
      onClick={() => {
        if (longPressed) {
          setLongPressed(false);
          return;
        }
        onClick?.({ ...item, visualMeaning: item.channelType === 'written' ? null : visualMeaning });
      }}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
      onContextMenu={handleContextMenu}
    >
      <div className={isFeatured ? 'card-featured-media' : undefined}>
        <ThumbnailPanel
          item={item}
          visualMeaning={visualMeaning}
          sourceTrustBadge={sourceTrustBadge}
          compact={isCompactScreen}
        />
      </div>

      <div
        className={isFeatured ? 'card-featured-body' : undefined}
        style={{ display: 'flex', flexDirection: 'column', gap: isCompactScreen ? '10px' : 'var(--space-tight)' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: isCompactScreen ? '4px' : '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
            <div className="card-meta" style={{ marginBottom: 0, rowGap: '4px' }}>
              {CHANNEL_META[item.channelType]?.label ? (
                <span>{CHANNEL_META[item.channelType].label}</span>
              ) : null}
              <span>{item.source}</span>
              {currentPriority ? (
                <span className="badge badge-accent animate-pulse" style={{ background: 'var(--accent)', color: '#fff', fontWeight: 'bold' }}>
                  Alert: {currentPriority.toUpperCase()}
                </span>
              ) : null}
              {sourceTrustBadge ? (
                <span className="badge" style={sourceTrustBadge.style} title={sourceTrustBadge.title}>
                  {sourceTrustBadge.label}
                </span>
              ) : null}
              <span className="dot-separator">{formatDate(item.date)}</span>
            </div>
            {discoveryLaneLabel ? (
              <span className="badge badge-accent">{discoveryLaneLabel}</span>
            ) : null}
          </div>
          {item.reason && !/^aligned with the current template balance\.?$/i.test(item.reason) ? (
            <p className="card-reason">Why shown: {item.reason}</p>
          ) : null}
          {explanation ? (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>
              {explanation.story_layer?.label && explanation.story_layer.label !== 'Not configured' ? <span className="badge badge-accent">Story: {explanation.story_layer.label}</span> : null}
              {explanation.topics?.[0]?.name ? <span className="badge">Topic: {explanation.topics[0].name}</span> : null}
              {explanation.freshness?.label ? <span>{explanation.freshness.label}</span> : null}
            </div>
          ) : null}
        </div>

        <h3 className="card-title">{item.title}</h3>

        {item.badges?.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-micro)', flexWrap: 'wrap' }}>
            {item.badges.map((badge) => {
              const config = BADGE_CONFIG[badge];
              if (!config) return null;
              return (
                <span key={badge} className={`badge ${config.className}`}>{config.label}</span>
              );
            })}
          </div>
        )}

        {item.matchedRules?.[0] ? (
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
            Rule: <strong style={{ color: 'var(--text-primary)' }}>{item.matchedRules[0].title}</strong>
          </p>
        ) : null}

        <div className="event-rank-metrics" style={{ marginTop: '4px', borderTop: '1px solid var(--border-soft)', paddingTop: '6px' }} aria-label="Why this item was ranked here">
          <span>Trust {sourceTrustPercent}%</span>
          <span>Fresh {freshness}</span>
          <span>Rule: {matchedRule}</span>
          <span>Action Value {actionValue}</span>
        </div>

        {/* Sources/References Box */}
        {(item.sources || item.references || item.sourceMapMatch || item.source) ? (
          <div style={{
            marginTop: '8px',
            padding: '8px',
            background: 'var(--bg-tone-subtle, rgba(255, 255, 255, 0.03))',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-soft)',
            fontSize: '11px',
            color: 'var(--text-secondary)'
          }}>
            <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '10px' }}>
              Sources & References:
            </strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {item.sources && Array.isArray(item.sources) ? (
                item.sources.map((src, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: '4px' }}>
                    <span style={{ fontWeight: 600 }}>{src.name || src.label || src}</span>
                    {src.url && (
                      <a href={src.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }} onClick={(e) => e.stopPropagation()}>
                        Link
                      </a>
                    )}
                  </div>
                ))
              ) : item.references && Array.isArray(item.references) ? (
                item.references.map((ref, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: '4px' }}>
                    <span style={{ fontWeight: 600 }}>{ref.name || ref.label || ref}</span>
                    {ref.url && (
                      <a href={ref.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }} onClick={(e) => e.stopPropagation()}>
                        Link
                      </a>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{item.source}</span>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }} onClick={(e) => e.stopPropagation()}>
                      Reference Link
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {showActions ? (
          <div className="card-actions" onClick={(event) => event.stopPropagation()}>
            {onSave ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onSave(item)}
                aria-label="Save"
              >
                <BookmarkIcon size={16} />
                Save
              </button>
            ) : null}
            {onDismiss ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onDismiss(item)}
                aria-label="Dismiss"
              >
                <XIcon size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {showPicker && (
        <div
          className="event-priority-picker-overlay"
          onClick={(e) => {
            e.stopPropagation();
            setShowPicker(false);
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            className="card event-priority-picker"
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '16px',
              width: '280px',
              background: 'var(--surface-elevated, var(--surface))',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <h4 style={{ margin: 0, font: 'var(--font-body)', fontWeight: 700 }}>Set Alert Level</h4>
            <p style={{ margin: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Choose how you want to prioritize alerts for this item/source.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { key: 'watch', label: 'Watch', desc: 'Add to watch lists & balanced alerts' },
                { key: 'important', label: 'Important', desc: 'Trigger high priority push notifications' },
                { key: 'direct', label: 'Direct', desc: 'Route directly to screen notification alerts' },
              ].map((level) => {
                const active = currentPriority === level.key;
                return (
                  <button
                    key={level.key}
                    type="button"
                    className={`btn ${active ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    onClick={() => {
                      handleSetPriority(active ? '' : level.key);
                      setShowPicker(false);
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '8px 12px',
                      height: 'auto',
                      textAlign: 'left',
                    }}
                  >
                    <strong style={{ fontSize: '14px' }}>{level.label} {active ? '✓' : ''}</strong>
                    <span style={{ fontSize: '11px', fontWeight: 'normal', opacity: 0.8 }}>{level.desc}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowPicker(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
