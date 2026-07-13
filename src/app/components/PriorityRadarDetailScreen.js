'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftIcon, BellIcon, ExternalLinkIcon, ShareIcon, SparklesIcon } from './Icons';
import { fetchPriorityRadarItem, fetchPublicPriorityRadarItem, markPriorityRadarItemOpened, interpretPriorityRadarItem, interpretPublicPriorityRadarItem } from '../lib/api';
import { getPriorityRadarReleaseWatchSummary, loadPriorityRadarSettings } from '../lib/alertRadar';
import { openExternalUrl, shareContentLink } from '../lib/external';
import { useAuth } from './AuthProvider';

function formatAlertTimestamp(value) {
  if (!value) {
    return 'Saved in Priority Radar';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Saved in Priority Radar';
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getDetailTone(alert) {
  if (alert?.category === 'geo') {
    if (alert?.threatLevel === 'Critical') {
      return '#dc2626';
    }

    if (alert?.threatLevel === 'High') {
      return '#ea580c';
    }

    return 'var(--accent)';
  }

  return alert?.importance === 'major' ? 'var(--accent)' : 'var(--premium)';
}

export default function PriorityRadarDetailScreen({ alertId, initialAlert, onBack, onAskAi }) {
  const { user } = useAuth();
  const hasInitialContent = Boolean(initialAlert?.title);
  const [alert, setAlert] = useState(initialAlert || null);
  const [loading, setLoading] = useState(!hasInitialContent);
  const [interpreting, setInterpreting] = useState(false);
  const [message, setMessage] = useState('');

  const effectiveAlertId = alertId || initialAlert?.id || '';
  const tone = useMemo(() => getDetailTone(alert), [alert]);
  const releaseWatchSummary = getPriorityRadarReleaseWatchSummary(loadPriorityRadarSettings());

  useEffect(() => {
    let cancelled = false;

    const loadAlert = async () => {
      if (!effectiveAlertId) {
        setLoading(false);
        setMessage('This Priority Radar alert is missing its ID.');
        return;
      }

      const [detailPayload, openedPayload] = await Promise.all([
        user ? fetchPriorityRadarItem(effectiveAlertId) : fetchPublicPriorityRadarItem(effectiveAlertId),
        user ? markPriorityRadarItemOpened(effectiveAlertId) : Promise.resolve(null),
      ]);

      if (cancelled) {
        return;
      }

      const nextAlert = detailPayload?.alert || openedPayload?.alert || (hasInitialContent ? initialAlert : null);
      setAlert(nextAlert);
      setMessage(nextAlert ? '' : 'That Priority Radar item is no longer available.');
      setLoading(false);

      if (nextAlert && !nextAlert.aiInterpretation) {
        setInterpreting(true);
        const interpretPayload = await (user ? interpretPriorityRadarItem(effectiveAlertId) : interpretPublicPriorityRadarItem(effectiveAlertId));
        if (!cancelled && interpretPayload?.alert?.aiInterpretation) {
          setAlert((prev) => ({ ...prev, aiInterpretation: interpretPayload.alert.aiInterpretation }));
        }
        if (!cancelled) {
          setInterpreting(false);
        }
      }
    };

    void loadAlert();

    return () => {
      cancelled = true;
    };
  }, [effectiveAlertId, hasInitialContent, initialAlert, user]);

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0' }}>
      <div className="container page-shell">
        <div className="page-header">
          <div className="page-header-main">
            <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
              <ArrowLeftIcon size={22} />
            </button>
            <div className="page-header-copy">
              <span className="page-kicker">Saved radar item</span>
              <h1 style={{ font: 'var(--font-h1)' }}>Priority Radar</h1>
              <p className="page-subtitle">
                Cached source, summary, and reason in one read view.
              </p>
            </div>
          </div>
        </div>

        {loading && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            <div className="skeleton" style={{ width: '96px', height: '18px' }} />
            <div className="skeleton" style={{ width: '90%', height: '28px' }} />
            <div className="skeleton" style={{ width: '100%', height: '18px' }} />
            <div className="skeleton" style={{ width: '82%', height: '18px' }} />
            <div className="skeleton" style={{ width: '68%', height: '18px' }} />
          </div>
        )}

        {!loading && !alert && (
          <div className="card" style={{ color: 'var(--text-secondary)' }}>
            {message || 'That Priority Radar alert could not be loaded.'}
          </div>
        )}

        {!loading && alert && (
          <>
            <div className="card" style={{
              borderColor: tone,
              borderLeft: `4px solid ${tone}`,
              boxShadow: `0 0 0 1px ${tone}16`,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-base)',
              background: 'var(--surface)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${tone}33`,
                    background: `${tone}18`,
                    color: tone,
                    font: 'var(--font-micro)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}>
                    <BellIcon size={14} />
                    {alert.category === 'geo' ? (alert.threatLevel || 'Elevated') : (alert.importance || 'important').toUpperCase()}
                  </span>
                  <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                    {alert.category === 'geo' ? `${alert.threatLevel || 'Elevated'} geo signal` : 'AI launch radar'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                  <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {alert.source || 'Unknown source'}
                  </span>
                  <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                    {formatAlertTimestamp(alert.publishedAt)}
                  </span>
                </div>
              </div>

              <h2 style={{ font: 'var(--font-h2)', color: 'var(--text-primary)', lineHeight: 1.22 }}>
                {alert.title}
              </h2>

              <div className="metric-grid">
                <div className="metric-card">
                  <span className="metric-label">Source</span>
                  <span className="metric-value" style={{ fontSize: '16px' }}>{alert.source || 'Unknown source'}</span>
                  <span className="metric-note">{formatAlertTimestamp(alert.publishedAt)}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Source type</span>
                  <span className="metric-value" style={{ fontSize: '16px' }}>
                    {alert.source_type === 'official' ? 'Official' : alert.source_type === 'press' ? 'Press' : 'Unknown'}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Qualified because</span>
                  <span className="metric-note" style={{ color: 'var(--text-primary)' }}>
                    {alert.qualified_reason || 'It cleared the strict Priority Radar filter.'}
                  </span>
                </div>
                {alert.category === 'ai' && (
                  <div className="metric-card">
                    <span className="metric-label">Watch mode</span>
                    <span className="metric-note" style={{ color: 'var(--text-primary)' }}>
                      {releaseWatchSummary}
                    </span>
                  </div>
                )}
                {alert.category === 'ai' && (alert.releaseWatchCompanyLabel || alert.releaseWatchReason) && (
                  <div className="metric-card">
                    <span className="metric-label">Release watch match</span>
                    <span className="metric-value" style={{ fontSize: '16px' }}>
                      {alert.releaseWatchCompanyLabel || 'Official AI release'}
                    </span>
                    <span className="metric-note">
                      {alert.releaseWatchReason || 'Matched your selected release-watch companies.'}
                    </span>
                  </div>
                )}
                {alert.direct_notification_reason && (
                  <div className="metric-card">
                    <span className="metric-label">Why notified</span>
                    <span className="metric-note" style={{ color: 'var(--text-primary)' }}>
                      {alert.direct_notification_reason}
                    </span>
                  </div>
                )}
              </div>

              <div className="subtle-panel" style={{ gap: 'var(--space-base)' }}>
                {interpreting || alert.aiInterpretation ? (
                  <div style={{
                    padding: 'var(--space-base)',
                    background: 'var(--accent-light)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--accent-alpha)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <SparklesIcon size={16} />
                      <p style={{ font: 'var(--font-micro)', color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        True AI Interpretation
                      </p>
                    </div>
                    {interpreting && !alert.aiInterpretation ? (
                      <div className="skeleton" style={{ height: '48px', width: '100%', borderRadius: '4px', opacity: 0.6 }} />
                    ) : (
                      <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                        {alert.aiInterpretation}
                      </p>
                    )}
                  </div>
                ) : null}

                <div>
                  <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Summary
                  </p>
                  <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>
                    {alert.summary || 'No summary is cached for this alert yet.'}
                  </p>
                </div>

                <div>
                  <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Why it matters
                  </p>
                  <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>
                    {alert.whyItMatters || 'This alert met the strict Priority Radar threshold.'}
                  </p>
                </div>

                {alert.source_reference?.url && (
                  <div>
                    <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Reference point
                    </p>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { void openExternalUrl(alert.source_reference.url); }}
                    >
                      {alert.source_reference.publisher || alert.source_reference.label || 'Open official source'}
                      <span style={{ marginLeft: '6px', display: 'inline-flex' }}>
                        <ExternalLinkIcon size={15} />
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={() => { void openExternalUrl(alert.url); }}
                disabled={!alert.url}
              >
                Open source
                <span style={{ marginLeft: '6px', display: 'inline-flex' }}>
                  <ExternalLinkIcon size={16} />
                </span>
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  void shareContentLink({
                    title: alert.title,
                    text: alert.summary,
                    url: alert.url,
                  });
                }}
                disabled={!alert.url}
              >
                Share
                <span style={{ marginLeft: '6px', display: 'inline-flex' }}>
                  <ShareIcon size={16} />
                </span>
              </button>
              {typeof onAskAi === 'function' && (
                <button
                  className="btn btn-secondary"
                  style={{ color: 'var(--accent)', fontWeight: 600 }}
                  onClick={() => onAskAi({
                    title: alert.title,
                    summary: alert.summary || alert.whyItMatters || '',
                    source: alert.source || '',
                    url: alert.url || '',
                  })}
                >
                  Ask AI
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
