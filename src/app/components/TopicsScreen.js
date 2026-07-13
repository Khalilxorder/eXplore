'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import { useAuth } from './AuthProvider';
import {
  createTopic,
  discoverTopicSources,
  fetchTopics,
  setTopicSourceApproval,
  updateTopic,
} from '../lib/api';

function Status({ children, tone = 'muted' }) {
  return (
    <p style={{
      margin: 0,
      color: tone === 'error' ? 'var(--error)' : tone === 'success' ? 'var(--success)' : 'var(--text-secondary)',
      font: 'var(--font-caption)',
    }}>
      {children}
    </p>
  );
}

export default function TopicsScreen({ onBack, onOpenSourceWeb }) {
  const { user } = useAuth();
  const [topics, setTopics] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState('muted');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await fetchTopics();
      const nextTopics = Array.isArray(payload?.topics) ? payload.topics : [];
      setTopics(nextTopics);
      if (!selectedId && nextTopics[0]?.id) {
        setSelectedId(nextTopics[0].id);
      }
    } catch (error) {
      setStatus('Topics need a signed-in account and a reachable backend.');
      setStatusTone('error');
    }
  }, [selectedId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const selected = topics.find((topic) => topic.id === selectedId) || null;

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!instruction.trim() && !name.trim()) return;
    setBusy(true);
    setStatus('Interpreting the monitoring instruction and preparing source suggestions...');
    setStatusTone('muted');
    try {
      const result = await createTopic({ name: name.trim(), instruction: instruction.trim(), intended_outcome: outcome.trim() });
      if (result?.topic) {
        setName('');
        setInstruction('');
        setOutcome('');
        setSelectedId(result.topic.id);
        setStatus('Topic created. Approve sources before treating the topic as monitored.');
        setStatusTone('success');
        await load();
      }
    } catch (error) {
      setStatus(error.message || 'Topic creation failed.');
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshSources = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await discoverTopicSources(selected.id);
      await load();
      setStatus('Source suggestions refreshed. They are not active until approved.');
      setStatusTone('success');
    } catch (error) {
      setStatus(error.message || 'Source discovery failed.');
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  };

  const handleApproval = async (source, approved) => {
    if (!selected) return;
    setBusy(true);
    try {
      await setTopicSourceApproval(selected.id, source.id, approved);
      await load();
      setStatus(approved ? 'Source approved for this topic.' : 'Source rejected for this topic.');
      setStatusTone('success');
    } catch (error) {
      setStatus(error.message || 'Source approval failed.');
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await updateTopic(selected.id, { instruction: selected.instruction });
      await load();
      setStatus('Topic instruction saved with a versioned history.');
      setStatusTone('success');
    } catch (error) {
      setStatus(error.message || 'Topic update failed.');
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="container page-enter" style={{ padding: 'var(--space-base)' }}>
        <div className="page-header">
          <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back"><ArrowLeftIcon size={22} /></button>
          <div className="page-header-copy"><span className="page-kicker">Life Directed Intelligence</span><h1>Topics</h1></div>
        </div>
        <div className="card"><Status>Sign in to create and approve monitored topics.</Status></div>
      </div>
    );
  }

  return (
    <div className="container page-enter" style={{ padding: 'var(--space-base)' }}>
      <div className="page-header">
        <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back"><ArrowLeftIcon size={22} /></button>
        <div className="page-header-copy">
          <span className="page-kicker">Life Directed Intelligence</span>
          <h1>Topics</h1>
          <p className="page-subtitle">Turn an ordinary-language question into an editable monitoring plan.</p>
        </div>
      </div>

      <form className="card" onSubmit={handleCreate} style={{ display: 'grid', gap: 'var(--space-small)', marginBottom: 'var(--space-base)' }}>
        <h2 style={{ margin: 0, font: 'var(--font-h3)' }}>Create a monitored topic</h2>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Short name, e.g. Jordan regional risk" aria-label="Topic name" />
        <textarea className="input" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="What should eXplore watch, and what would make it important?" rows={4} aria-label="Topic instruction" />
        <input className="input" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="Intended outcome, e.g. decide whether travel or work plans change" aria-label="Intended outcome" />
        <button className="btn btn-primary" type="submit" disabled={busy}>Create topic and suggest sources</button>
      </form>

      {status ? <div style={{ marginBottom: 'var(--space-base)' }}><Status tone={statusTone}>{status}</Status></div> : null}

      <div style={{ display: 'grid', gap: 'var(--space-base)' }}>
        <div className="card">
          <h2 style={{ marginTop: 0, font: 'var(--font-h3)' }}>Your topics</h2>
          {topics.length ? (
            <div style={{ display: 'grid', gap: 'var(--space-tight)' }}>
              {topics.map((topic) => (
                <button key={topic.id} type="button" className={`list-row ${topic.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(topic.id)} style={{ textAlign: 'left' }}>
                  <strong>{topic.name}</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>{topic.coverage_status || 'partial'} · {topic.importance_threshold || 'important'}</span>
                </button>
              ))}
            </div>
          ) : <Status>No topics yet.</Status>}
        </div>

        {selected ? (
          <div className="card" style={{ display: 'grid', gap: 'var(--space-small)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <span className="page-kicker">Editable instruction</span>
                <h2 style={{ margin: '4px 0 0', font: 'var(--font-h3)' }}>{selected.name}</h2>
              </div>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => onOpenSourceWeb?.(selected.id)}>Open Source Web</button>
            </div>
            <textarea className="input" value={selected.instruction || ''} onChange={(event) => setTopics((current) => current.map((topic) => topic.id === selected.id ? { ...topic, instruction: event.target.value } : topic))} rows={4} aria-label="Edit topic instruction" />
            <button className="btn btn-secondary" type="button" disabled={busy} onClick={handleSaveEdit}>Save instruction version</button>
            <div className="divider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, font: 'var(--font-body)', fontWeight: 700 }}>Suggested sources</h3>
              <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={handleRefreshSources}>Refresh suggestions</button>
            </div>
            <Status>Suggestions are not monitored until you approve them.</Status>
            {(selected.suggested_sources || []).map((source) => (
              <div key={source.id || source.url} className="list-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <strong>{source.name}</strong>
                  <div style={{ color: 'var(--text-secondary)', font: 'var(--font-caption)' }}>{source.role} · trust tier {source.trust_tier}</div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-tight)' }}>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleApproval(source, true)}>Approve</button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => handleApproval(source, false)}>Reject</button>
                </div>
              </div>
            ))}
            {!selected.suggested_sources?.length ? <Status>Refresh source suggestions for this topic.</Status> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
