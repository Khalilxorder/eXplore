'use client';
// eXplore — FinalInterpretationCard.js
// Read-only synthesis of the EFFECTIVE news filter the AI applies after all of
// the user's rules (3 story layers + goals + values + cognitive profile).

import { useState, useEffect, useCallback } from 'react';
import { fetchFinalInterpretation } from '../lib/api';

function Chips({ items, variant }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="fi-chips">
      {items.map((item, i) => (
        <span key={i} className={`fi-chip ${variant === 'suppress' ? 'fi-chip--suppress' : 'fi-chip--amplify'}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

export default function FinalInterpretationCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFinalInterpretation();
      if (!res || !res.success || !res.interpretation) {
        throw new Error('Service unavailable');
      }
      setData(res.interpretation);
    } catch (err) {
      setError(err.message || 'Could not load the final interpretation.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fi-card">
      <div className="fi-header">
        <div>
          <div className="fi-title">◎ Final Interpretation</div>
          <div className="fi-sub">What the AI finally filters your news on — after all your rules.</div>
        </div>
        <button type="button" className="fi-refresh" onClick={load} disabled={loading}>
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {loading && !data && <div className="fi-state">Synthesizing your effective filter…</div>}
      {error && (
        <div className="fi-state fi-state--err">
          {error}
          <button type="button" className="fi-retry" onClick={load}>Retry</button>
        </div>
      )}

      {data && (
        <div className="fi-body">
          <p className="fi-headline">{data.headline}</p>

          {Array.isArray(data.configuredLayers) && data.configuredLayers.length > 0 && (
            <div className="fi-section">
              <div className="fi-label">Story layers in effect</div>
              <div className="fi-chips">
                {data.configuredLayers.map((layer) => (
                  <span
                    key={layer.id}
                    className={`fi-chip ${layer.configured ? 'fi-chip--on' : 'fi-chip--off'} ${data.dominantLayer?.id === layer.id ? 'fi-chip--dominant' : ''}`}
                    title={layer.preview || ''}
                  >
                    {data.dominantLayer?.id === layer.id ? '★ ' : ''}{layer.label}{layer.configured ? '' : ' — not set'}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="fi-section">
            <div className="fi-label">Amplify (surfaced)</div>
            <Chips items={data.amplify} variant="amplify" />
          </div>

          <div className="fi-section">
            <div className="fi-label">Suppress (downgraded / hidden)</div>
            <Chips items={data.suppress} variant="suppress" />
          </div>

          {data.sourcePosture && (
            <div className="fi-section">
              <div className="fi-label">Source posture</div>
              <p className="fi-text">{data.sourcePosture}</p>
            </div>
          )}

          {data.cognitiveTilt && (
            <div className="fi-section">
              <div className="fi-label">Cognitive tilt</div>
              <p className="fi-text">{data.cognitiveTilt}</p>
            </div>
          )}

          {data.plainSummary && (
            <div className="fi-summary">
              <div className="fi-label">In plain words</div>
              <p className="fi-text">{data.plainSummary}</p>
            </div>
          )}

          <div className="fi-meta">
            <span>{data.source === 'ai' ? 'AI-synthesized' : 'Rule-based summary'}</span>
            {!data.hasSignal && <span className="fi-meta-warn">No rules set yet — add your story layers and goals to steer this.</span>}
          </div>
        </div>
      )}

      <style>{`
        .fi-card {
          background: var(--surface);
          border: 1px solid var(--border-soft);
          border-left: 3px solid #a78bfa;
          border-radius: 8px;
          padding: 14px 16px;
          margin: 14px 0;
          color: var(--text-primary);
        }
        .fi-header {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px; margin-bottom: 10px;
        }
        .fi-title {
          font-family: 'Outfit', 'Inter', sans-serif;
          font-size: 13px; font-weight: 600; color: #a78bfa;
          letter-spacing: 0.04em; text-transform: uppercase;
        }
        .fi-sub { font-size: 11.5px; color: var(--text-secondary); margin-top: 3px; line-height: 1.45; }
        .fi-refresh {
          background: rgba(167, 139, 250, 0.1);
          border: 1px solid rgba(167, 139, 250, 0.3);
          color: #a78bfa; border-radius: 8px; padding: 5px 12px;
          font-size: 11.5px; font-weight: 600; cursor: pointer; white-space: nowrap;
        }
        .fi-refresh:hover:not(:disabled) { background: rgba(167, 139, 250, 0.22); }
        .fi-refresh:disabled { opacity: 0.6; cursor: default; }
        .fi-state { padding: 14px 0; color: var(--text-tertiary); font-size: 12.5px; }
        .fi-state--err { color: var(--error); display: flex; gap: 10px; align-items: center; }
        .fi-retry {
          background: transparent; border: 1px solid var(--border); color: var(--text-secondary);
          border-radius: 6px; padding: 3px 10px; font-size: 11px; cursor: pointer;
        }
        .fi-body { display: flex; flex-direction: column; gap: 12px; }
        .fi-headline {
          margin: 0; font-size: 13.5px; font-weight: 600; line-height: 1.5;
          color: var(--text-primary);
        }
        .fi-section { display: flex; flex-direction: column; gap: 6px; }
        .fi-label {
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--text-tertiary);
        }
        .fi-text { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--text-secondary); }
        .fi-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .fi-chip {
          font-size: 11px; border-radius: 4px; padding: 3px 9px;
          border: 1px solid var(--border-soft); color: var(--text-secondary);
          background: var(--surface-muted);
        }
        .fi-chip--amplify {
          color: var(--success, #34d399);
          background: var(--success-light, rgba(52,211,153,0.08));
          border-color: color-mix(in srgb, var(--success, #34d399) 25%, var(--border));
        }
        .fi-chip--suppress {
          color: var(--text-tertiary);
          background: var(--surface-muted);
        }
        .fi-chip--on {
          color: #c4b5fd; background: rgba(167, 139, 250, 0.12);
          border-color: rgba(167, 139, 250, 0.35);
        }
        .fi-chip--off { color: var(--text-tertiary); opacity: 0.8; }
        .fi-chip--dominant { font-weight: 700; border-color: rgba(167, 139, 250, 0.6); }
        .fi-summary {
          background: var(--surface-elevated);
          border: 1px solid var(--border-soft);
          border-radius: 8px; padding: 10px 12px;
          display: flex; flex-direction: column; gap: 6px;
        }
        .fi-meta {
          display: flex; gap: 14px; flex-wrap: wrap; align-items: center;
          font-size: 10.5px; color: var(--text-tertiary);
          border-top: 1px solid var(--border-soft); padding-top: 8px;
        }
        .fi-meta-warn { color: var(--warning, #f59e0b); }
      `}</style>
    </div>
  );
}
