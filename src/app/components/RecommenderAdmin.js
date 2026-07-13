'use client';
// eXplore — RecommenderAdmin.js
// Admin console for the Personal Intelligence Engine.

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import { useAuth } from './AuthProvider';
import {
  fetchRecommenderStatus,
  trainRecommenderModel,
  adminIngestYouTube,
} from '../lib/api';

// ─── tiny helpers ────────────────────────────────────────────────────────────

function Badge({ color, label }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: '0.7rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        background: color + '22',
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {label}
    </span>
  );
}

function StatCard({ label, value, unit = '', accent = false }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        padding: 'var(--space-base)',
        borderRadius: 12,
        background: accent ? 'var(--accent)12' : 'var(--surface)',
        border: '1px solid var(--surface-elevated)',
        minWidth: 120,
      }}
    >
      <p
        style={{
          font: 'var(--font-caption)',
          color: 'var(--text-tertiary)',
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </p>
      <p
        style={{
          font: 'var(--font-hero)',
          fontSize: '1.5rem',
          color: accent ? 'var(--accent)' : 'var(--text-primary)',
          marginBottom: 0,
        }}
      >
        {value ?? '—'}{unit}
      </p>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <h2
      style={{
        font: 'var(--font-label)',
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontSize: '0.7rem',
        marginBottom: 'var(--space-tight)',
        marginTop: 'var(--space-large)',
      }}
    >
      {children}
    </h2>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RecommenderAdmin({ onBack }) {
  const { isAdmin, loading: authLoading } = useAuth();
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);

  // Training
  const [trainBusy, setTrainBusy] = useState(false);
  const [trainMessage, setTrainMessage] = useState('');
  const [trainMode, setTrainMode] = useState('baseline');

  // YouTube Ingestion
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMessage, setIngestMessage] = useState('');
  const [ingestResult, setIngestResult] = useState(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const data = await fetchRecommenderStatus();
      setStatus(data);
    } catch (e) {
      setStatusError(e.message || 'Could not reach status endpoint.');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    void loadStatus();
  }, [isAdmin, loadStatus]);

  if (authLoading) {
    return (
      <div style={{ padding: 'var(--space-large)' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Checking admin access…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 'var(--space-large)' }}>
        <button className="btn btn-secondary" onClick={onBack} style={{ marginBottom: 'var(--space-base)' }}>
          <ArrowLeftIcon size={16} /> Back
        </button>
        <h1 style={{ font: 'var(--font-title)', marginBottom: 'var(--space-small)' }}>Admin access required</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          This console is limited to authorized administrators.
        </p>
      </div>
    );
  }

  const handleTrain = async () => {
    if (trainBusy) return;
    setTrainBusy(true);
    setTrainMessage('');
    try {
      const res = await trainRecommenderModel({ mode: trainMode });
      setTrainMessage(
        res?.message || res?.error || (res?.success ? 'Training job triggered.' : 'Unexpected response.'),
      );
      await loadStatus();
    } catch (e) {
      setTrainMessage(e.message || 'Error triggering training.');
    } finally {
      setTrainBusy(false);
    }
  };

  const handleIngest = async () => {
    const url = youtubeUrl.trim();
    if (!url || ingestBusy) return;
    setIngestBusy(true);
    setIngestMessage('');
    setIngestResult(null);
    try {
      const res = await adminIngestYouTube(url);
      if (res?.success || res?.item_id) {
        setIngestResult(res);
        setIngestMessage('');
        setYoutubeUrl('');
      } else {
        setIngestMessage(res?.error || 'Ingestion failed with no details.');
      }
      await loadStatus();
    } catch (e) {
      setIngestMessage(e.message || 'Ingestion error.');
    } finally {
      setIngestBusy(false);
    }
  };

  // ── Derived status values ──────────────────────────────────────────────────
  const eventCount        = status?.event_count          ?? status?.total_events   ?? 0;
  const contentCount      = status?.content_count        ?? status?.total_content  ?? 0;
  const modelVersion      = status?.active_model_version ?? status?.model_version  ?? 'baseline';
  const explorationBudget = status?.exploration_budget   ?? status?.exploration    ?? null;
  const lastTrained       = status?.last_trained_at      ?? status?.last_training  ?? null;
  const trainingRuns      = status?.training_runs        ?? status?.total_runs     ?? null;

  let modelTier = 'Baseline';
  if (eventCount >= 500) modelTier = 'Full Neural';
  else if (eventCount >= 100) modelTier = 'Neural 20%';

  return (
    <div style={{ padding: 'var(--space-large)', maxWidth: 700, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-base)', marginBottom: 'var(--space-large)' }}>
        {typeof onBack === 'function' && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onBack}
            aria-label="Back"
            style={{ padding: '6px 10px' }}
          >
            <ArrowLeftIcon size={16} />
          </button>
        )}
        <div>
          <h1 style={{ font: 'var(--font-hero)', fontSize: '1.3rem', margin: 0, color: 'var(--text-primary)' }}>
            Intelligence Engine
          </h1>
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            Admin console · recommender training &amp; content ingestion
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void loadStatus()}
            disabled={statusLoading}
          >
            {statusLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {statusError && (
        <div
          style={{
            padding: 'var(--space-base)',
            borderRadius: 10,
            background: 'var(--error)18',
            border: '1px solid var(--error)44',
            color: 'var(--error)',
            font: 'var(--font-caption)',
            marginBottom: 'var(--space-base)',
          }}
        >
          ⚠ {statusError}
        </div>
      )}

      {/* ── Status Grid ──────────────────────────────────────────────────────── */}
      <SectionHeading>System Status</SectionHeading>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-tight)', marginBottom: 'var(--space-base)' }}>
        <StatCard label="Interaction Events" value={eventCount.toLocaleString()} accent />
        <StatCard label="Content Items" value={contentCount.toLocaleString()} />
        <StatCard label="Model Tier" value={modelTier} />
        {explorationBudget != null && (
          <StatCard label="Exploration Budget" value={`${Math.round(Number(explorationBudget) * 100)}`} unit="%" />
        )}
        {trainingRuns != null && (
          <StatCard label="Training Runs" value={trainingRuns} />
        )}
      </div>

      {status && (
        <div
          style={{
            padding: 'var(--space-tight) var(--space-base)',
            borderRadius: 8,
            background: 'var(--surface)',
            font: 'var(--font-caption)',
            color: 'var(--text-secondary)',
            marginBottom: 'var(--space-base)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-tight)',
            alignItems: 'center',
          }}
        >
          <span>Active model:</span>
          <Badge color="var(--accent)" label={String(modelVersion)} />
          {lastTrained && (
            <>
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <span>Last trained: {lastTrained}</span>
            </>
          )}
          <span style={{ color: 'var(--text-tertiary)' }}>·</span>
          <span>
            Gate: events ≥ 100 → 20 % neural &nbsp;|&nbsp; events ≥ 500 → full neural
          </span>
        </div>
      )}

      {/* ── Model Training ───────────────────────────────────────────────────── */}
      <SectionHeading>Model Training</SectionHeading>
      <div
        className="card"
        style={{ background: 'var(--surface)', marginBottom: 'var(--space-base)' }}
      >
        <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', marginBottom: 'var(--space-tight)' }}>
          Trigger an offline training run and review the returned status before promoting a model.
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', marginBottom: 'var(--space-tight)' }}>
          {['baseline', 'two-tower', 'multitask', 'sasrec'].map((m) => (
            <button
              key={m}
              type="button"
              className={`btn btn-sm ${trainMode === m ? 'btn-primary' : 'btn-secondary'}`}
              style={{ textTransform: 'capitalize' }}
              onClick={() => setTrainMode(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            id="admin-train-btn"
            className="btn btn-primary"
            onClick={() => void handleTrain()}
            disabled={trainBusy}
          >
            {trainBusy ? 'Training…' : `Train ${trainMode}`}
          </button>
          {trainMessage && (
            <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', margin: 0 }}>
              {trainMessage}
            </p>
          )}
        </div>
      </div>

      {/* ── YouTube Ingestion ─────────────────────────────────────────────────── */}
      <SectionHeading>Content Ingestion — YouTube</SectionHeading>
      <div
        className="card"
        style={{ background: 'var(--surface)', marginBottom: 'var(--space-base)' }}
      >
        <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', marginBottom: 'var(--space-tight)' }}>
          Ingest a YouTube video: fetch transcript, chunk, embed, and score credibility.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', marginBottom: 'var(--space-tight)' }}>
          <input
            id="admin-yt-url"
            className="text-surface"
            style={{ flex: 1, minWidth: 260, fontSize: '0.85rem', padding: '6px 10px', borderRadius: 8 }}
            placeholder="https://www.youtube.com/watch?v=…"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleIngest()}
            disabled={ingestBusy}
          />
          <button
            id="admin-ingest-btn"
            className="btn btn-primary"
            onClick={() => void handleIngest()}
            disabled={ingestBusy || !youtubeUrl.trim()}
          >
            {ingestBusy ? 'Ingesting…' : 'Ingest'}
          </button>
        </div>

        {ingestMessage && (
          <p style={{ font: 'var(--font-caption)', color: 'var(--error)', margin: '4px 0 0' }}>
            {ingestMessage}
          </p>
        )}

        {ingestResult && (
          <div
            style={{
              marginTop: 'var(--space-tight)',
              padding: 'var(--space-tight) var(--space-base)',
              borderRadius: 8,
              background: 'var(--success)14',
              border: '1px solid var(--success)44',
            }}
          >
            <p style={{ font: 'var(--font-label)', color: 'var(--success)', margin: '0 0 4px' }}>
              ✓ Ingested successfully
            </p>
            {ingestResult.item_id && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                Item ID: <code style={{ color: 'var(--accent)' }}>{ingestResult.item_id}</code>
              </p>
            )}
            {ingestResult.title && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                Title: {ingestResult.title}
              </p>
            )}
            {ingestResult.credibility_score != null && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                Credibility: {(Number(ingestResult.credibility_score) * 100).toFixed(1)}%
              </p>
            )}
            {ingestResult.chunk_count != null && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                Chunks: {ingestResult.chunk_count}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Raw Status JSON (collapsed) ────────────────────────────────────────── */}
      {status && (
        <>
          <SectionHeading>Raw Status Payload</SectionHeading>
          <details
            style={{
              background: 'var(--surface)',
              borderRadius: 10,
              border: '1px solid var(--surface-elevated)',
              padding: 'var(--space-tight) var(--space-base)',
              font: 'var(--font-caption)',
              color: 'var(--text-secondary)',
            }}
          >
            <summary style={{ cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 600 }}>
              Expand raw JSON
            </summary>
            <pre
              style={{
                marginTop: 'var(--space-tight)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontSize: '0.72rem',
                color: 'var(--text-secondary)',
              }}
            >
              {JSON.stringify(status, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
