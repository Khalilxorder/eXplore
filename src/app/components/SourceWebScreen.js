'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import { apiFetch, fetchSourceWeb, setTopicSourceApproval } from '../lib/api';

export default function SourceWebScreen({ topicId, onBack }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [claimText, setClaimText] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!topicId) return;
    const next = await fetchSourceWeb(topicId);
    setPayload(next?.source_web || null);
  }, [topicId]);

  useEffect(() => {
    let cancelled = false;
    if (!topicId) return undefined;
    void reload().catch((nextError) => {
      if (!cancelled) setError(nextError.message || 'Source Web could not load.');
    });
    return () => { cancelled = true; };
  }, [topicId, reload]);

  const updateSource = async (sourceId, status) => {
    setBusy(true);
    setStatusMessage('');
    try {
      await setTopicSourceApproval(topicId, sourceId, status === 'approved', '', status);
      await reload();
      setStatusMessage(`Source marked ${status}.`);
    } catch (nextError) {
      setStatusMessage(nextError.message || 'Could not update source.');
    } finally {
      setBusy(false);
    }
  };

  const addClaim = async () => {
    const text = claimText.trim();
    if (!text) return;
    setBusy(true);
    setStatusMessage('');
    try {
      await apiFetch('/api/v1/source-web/claims', {
        method: 'POST',
        body: JSON.stringify({ topic_id: topicId, claim_text: text, status: 'uncertain' }),
      });
      setClaimText('');
      await reload();
      setStatusMessage('Claim added.');
    } catch (nextError) {
      setStatusMessage(nextError.message || 'Could not add claim.');
    } finally {
      setBusy(false);
    }
  };

  const sourceWeb = payload;
  return (
    <div className="container page-enter" style={{ padding: 'var(--space-base)' }}>
      <div className="page-header">
        <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back"><ArrowLeftIcon size={22} /></button>
        <div className="page-header-copy">
          <span className="page-kicker">Evidence and monitoring</span>
          <h1>Source Web</h1>
          <p className="page-subtitle">Approved sources, checks, claims, agreement, contradiction, and missing evidence.</p>
        </div>
      </div>
      {error ? <div className="card"><p style={{ margin: 0, color: 'var(--error)' }}>{error}</p></div> : null}
      {statusMessage ? <p style={{ color: 'var(--text-secondary)', font: 'var(--font-caption)' }}>{statusMessage}</p> : null}
      {sourceWeb ? (
        <div style={{ display: 'grid', gap: 'var(--space-base)' }}>
          <div className="card">
            <span className="page-kicker">Topic</span>
            <h2 style={{ margin: '4px 0', font: 'var(--font-h3)' }}>{sourceWeb.topic.name}</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{sourceWeb.topic.instruction}</p>
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', marginTop: 'var(--space-small)' }}>
              <span className="status-pill is-partial">Approved: {sourceWeb.coverage.approved}</span>
              <span className="status-pill is-partial">Checked: {sourceWeb.coverage.checked}</span>
              <span className="status-pill is-partial">Claims: {sourceWeb.claims.length}</span>
            </div>
            {sourceWeb.coverage.missing_evidence.map((gap) => <p key={gap} style={{ margin: 'var(--space-small) 0 0', color: 'var(--warning)' }}>{gap}</p>)}
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0, font: 'var(--font-h3)' }}>Sources</h2>
            {sourceWeb.sources.length ? sourceWeb.sources.map((source) => (
              <div key={source.id || source.source_id} className="list-row" style={{ marginBottom: 'var(--space-tight)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
                  <strong>{source.name}</strong>
                  <span style={{ color: source.status === 'approved' ? 'var(--success)' : source.status === 'blocked' ? 'var(--error)' : 'var(--text-secondary)' }}>{source.status}</span>
                </div>
                <div style={{ color: 'var(--text-secondary)', font: 'var(--font-caption)' }}>{source.role || source.category} · trust tier {source.trust_tier} · {source.check_status || 'not checked'}</div>
                <a href={source.url} target="_blank" rel="noreferrer" style={{ font: 'var(--font-caption)' }}>{source.url}</a>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => updateSource(source.source_id || source.id, 'approved')}>Approve</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => updateSource(source.source_id || source.id, 'rejected')}>Reject</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => updateSource(source.source_id || source.id, 'blocked')}>Block</button>
                </div>
              </div>
            )) : <p style={{ color: 'var(--text-secondary)' }}>No source candidates are attached yet.</p>}
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0, font: 'var(--font-h3)' }}>Claims and evidence</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--space-small)' }}>
              <textarea
                rows={3}
                value={claimText}
                onChange={(event) => setClaimText(event.target.value)}
                placeholder="Add a claim to monitor (for example: Official statement confirms airspace interception)."
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-soft)', background: 'var(--surface)', color: 'var(--text-primary)' }}
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !claimText.trim()} onClick={() => { void addClaim(); }}>
                Add claim
              </button>
            </div>
            {sourceWeb.claims.length ? sourceWeb.claims.map((claim) => (
              <div key={claim.id} className="list-row" style={{ marginBottom: 'var(--space-tight)' }}>
                <strong>{claim.claim_text}</strong>
                <div style={{ color: 'var(--text-secondary)', font: 'var(--font-caption)' }}>{claim.status} · {claim.evidence_count} evidence item(s)</div>
                {sourceWeb.evidence.filter((evidence) => evidence.claim_id === claim.id).map((evidence) => (
                  <div key={evidence.id} style={{ marginTop: '6px', paddingLeft: 'var(--space-small)', borderLeft: '2px solid var(--border-soft)', color: 'var(--text-secondary)', font: 'var(--font-caption)' }}>
                    {evidence.relation} · {evidence.source_name || evidence.url || 'source not named'}{evidence.excerpt ? ` — ${evidence.excerpt}` : ''}
                  </div>
                ))}
              </div>
            )) : <p style={{ color: 'var(--text-secondary)' }}>Claims become visible when a sweep or user review attaches evidence.</p>}
          </div>
        </div>
      ) : !error ? <div className="card"><p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading Source Web…</p></div> : null}
    </div>
  );
}
