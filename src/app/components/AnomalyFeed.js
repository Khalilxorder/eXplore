'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchAnomalyFeed, resolveApiBase } from '../lib/api';
import { queueTelemetryEvent } from '../lib/telemetrySdk';

export default function AnomalyFeed({ onClose }) {
  const [anomalies, setAnomalies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const videoRefs = useRef([]);
  const milestoneRef = useRef({ 25: false, 50: false, 75: false, 100: false });

  useEffect(() => {
    milestoneRef.current = { 25: false, 50: false, 75: false, 100: false };
  }, [currentIndex, anomalies]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const data = await fetchAnomalyFeed();
      if (!cancelled && data?.success) {
        setAnomalies(data.anomalies || []);
      }
      if (!cancelled) {
        setLoading(false);
      }
    })().catch(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleNext = () => {
    if (currentIndex < anomalies.length - 1) {
      videoRefs.current[currentIndex]?.pause();
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      videoRefs.current[currentIndex]?.pause();
      setCurrentIndex((prev) => prev - 1);
    }
  };

  useEffect(() => {
    if (videoRefs.current[currentIndex]) {
      videoRefs.current[currentIndex].currentTime = 0;
      videoRefs.current[currentIndex].play().catch(() => {});
    }
  }, [currentIndex, anomalies]);

  if (loading) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <div className="card" style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
          <div className="skeleton" style={{ width: '34%', height: 16 }} />
          <div className="skeleton" style={{ width: '82%', height: 22 }} />
          <div className="skeleton" style={{ width: '100%', height: 220 }} />
          <div className="skeleton" style={{ width: '72%', height: 16 }} />
        </div>
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <div className="card" style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
          <span className="status-pill is-empty">No live items</span>
          <h2 style={{ font: 'var(--font-h2)' }}>No anomaly items are available right now.</h2>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)' }}>
            The feed will appear here when a qualifying item is available to review.
          </p>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ width: 'fit-content' }}>
            Return to eXplore
          </button>
        </div>
      </div>
    );
  }

  const anomaly = anomalies[currentIndex];
  const videoSrc = anomaly.videoUrl || (anomaly.localVideoPath ? `${resolveApiBase()}${anomaly.localVideoPath}` : '');
  const ratioLabel = anomaly.baselineType === 'followers' ? 'reach ratio' : 'spread ratio';
  const creatorLabel = anomaly.creatorFollowers
    ? `${anomaly.creatorFollowers.toLocaleString()} followers`
    : 'audience baseline estimated';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
          background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 980,
          height: '100%',
          maxHeight: 'min(920px, calc(100vh - 32px))',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 18,
            left: 18,
            zIndex: 20,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            padding: '6px 14px',
            cursor: 'pointer',
            borderRadius: 'var(--radius-md)',
          }}
        >
          Close
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '18px 20px 0',
          }}
        >
          <span className="status-pill is-live">Live feed</span>
          <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
            {currentIndex + 1} of {anomalies.length}
          </span>
        </div>

        <div
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.25fr) minmax(280px, 0.75fr)',
            gap: 'var(--space-medium)',
            padding: 20,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)', minHeight: 0 }}>
            <div style={{ flex: '1 1 auto', minHeight: 0, background: 'var(--surface-elevated)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
              <video
                ref={(el) => {
                  videoRefs.current[currentIndex] = el;
                }}
                src={videoSrc}
                poster={anomaly.thumbnailUrl || undefined}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loop
                playsInline
                muted
                onClick={() => {
                  const vid = videoRefs.current[currentIndex];
                  if (vid) {
                    if (vid.paused) {
                      vid.play().catch(() => {});
                    } else {
                      vid.pause();
                    }
                  }
                }}
                onTimeUpdate={(e) => {
                  const video = e.currentTarget;
                  if (!video.duration || !anomaly?.id) return;
                  // Handle loop reset
                  if (video.currentTime < 0.5) {
                    milestoneRef.current = { 25: false, 50: false, 75: false, 100: false };
                  }
                  const pct = (video.currentTime / video.duration) * 100;
                  [25, 50, 75, 100].forEach((m) => {
                    if (pct >= m && !milestoneRef.current[m]) {
                      milestoneRef.current[m] = true;
                      queueTelemetryEvent('completion', anomaly.id, {
                        milestone: m,
                        progress: pct,
                        duration: video.duration,
                        currentTime: video.currentTime
                      });
                    }
                  });
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                <span className="badge badge-accent">Spread</span>
                <span className="badge" style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}>
                  {anomaly.engagementRatio.toLocaleString(undefined, { maximumFractionDigits: 1 })}x reach
                </span>
              </div>
              <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                @{anomaly.creatorUsername} - {creatorLabel}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)', minHeight: 0 }}>
            <div>
              <span className="status-pill is-partial" style={{ marginBottom: 'var(--space-tight)' }}>Why it surfaced</span>
              <h1 style={{ font: 'var(--font-h2)', color: 'var(--text-primary)', marginBottom: '6px' }}>
                @{anomaly.creatorUsername}
              </h1>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                {creatorLabel} - {anomaly.videoViews.toLocaleString()} views
              </p>
            </div>

            <div className="card" style={{ background: 'var(--surface-elevated)', display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
              <div style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>Summary</div>
              <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', lineHeight: 1.65 }}>
                {anomaly.aiHookAnalysis}
              </p>
            </div>

            <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-small)' }}>
              <div>
                <div style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>Baseline</div>
                <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>{ratioLabel}</strong>
              </div>
              <div>
                <div style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>Views</div>
                <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>{anomaly.videoViews.toLocaleString()}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-tight)', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
              <button className="btn btn-secondary btn-sm" onClick={handlePrev} disabled={currentIndex === 0}>
                Prev
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleNext} disabled={currentIndex >= anomalies.length - 1}>
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
