'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
} from './Icons';
import { useAuth } from './AuthProvider';
import {
  addTopicSource,
  createTopic,
  discoverTopicSources,
  fetchTopicEvents,
  fetchTopicResearch,
  fetchTopics,
  removeTopicSource,
  runTopicDeepResearch,
  setTopicSourceApproval,
  updateTopic,
} from '../lib/api';

const PRIORITIES = [
  { value: 'watch', label: 'Watch' },
  { value: 'important', label: 'Important' },
  { value: 'direct', label: 'Direct' },
];

function cleanArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function formatDate(value) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Status({ children, tone = 'muted' }) {
  if (!children) return null;
  return (
    <p className={`topic-status topic-status--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

function ResearchList({ title, items }) {
  const rows = cleanArray(items);
  if (!rows.length) return null;
  return (
    <section className="topic-research-section">
      <h4>{title}</h4>
      <ul>
        {rows.map((item, index) => {
          const text = typeof item === 'string'
            ? item
            : item?.claim || item?.title || item?.question || item?.action || JSON.stringify(item);
          const url = typeof item === 'object' ? item?.url : '';
          return (
            <li key={`${title}-${index}`}>
              {text}
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" aria-label={`Open evidence for ${text}`}>
                  <ExternalLinkIcon size={15} />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function TopicsScreen({ onBack, onOpenSourceWeb }) {
  const { user } = useAuth();
  const [topics, setTopics] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [activeView, setActiveView] = useState('connections');
  const [showNewTopic, setShowNewTopic] = useState(false);
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [events, setEvents] = useState([]);
  const [researchRuns, setResearchRuns] = useState([]);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState('muted');
  const [busy, setBusy] = useState('');

  const selected = useMemo(
    () => topics.find((topic) => topic.id === selectedId) || null,
    [topics, selectedId],
  );

  const loadTopics = useCallback(async (preferredId = '') => {
    const payload = await fetchTopics();
    const nextTopics = cleanArray(payload?.topics);
    setTopics(nextTopics);
    setSelectedId((current) => {
      const requested = preferredId || current;
      return nextTopics.some((topic) => topic.id === requested)
        ? requested
        : (nextTopics[0]?.id || '');
    });
    return nextTopics;
  }, []);

  const loadTopicData = useCallback(async (topicId) => {
    if (!topicId) {
      setEvents([]);
      setResearchRuns([]);
      return;
    }
    const [eventResult, researchResult] = await Promise.allSettled([
      fetchTopicEvents(topicId, { limit: 20, ageHours: 72 }),
      fetchTopicResearch(topicId, 8),
    ]);
    setEvents(eventResult.status === 'fulfilled' ? cleanArray(eventResult.value?.events) : []);
    setResearchRuns(researchResult.status === 'fulfilled' ? cleanArray(researchResult.value?.runs) : []);
  }, []);

  useEffect(() => {
    if (!user) return;
    setBusy('load');
    void loadTopics()
      .catch((error) => {
        setStatus(error.message || 'Topics could not be loaded.');
        setStatusTone('error');
      })
      .finally(() => setBusy(''));
  }, [user, loadTopics]);

  useEffect(() => {
    if (user && selectedId) void loadTopicData(selectedId);
  }, [user, selectedId, loadTopicData]);

  const refreshSelected = useCallback(async () => {
    await Promise.all([loadTopics(selectedId), loadTopicData(selectedId)]);
  }, [loadTopics, loadTopicData, selectedId]);

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!name.trim() && !instruction.trim()) return;
    setBusy('create');
    setStatus('');
    try {
      const result = await createTopic({
        name: name.trim(),
        instruction: instruction.trim(),
        intended_outcome: outcome.trim(),
      });
      setName('');
      setInstruction('');
      setOutcome('');
      setShowNewTopic(false);
      await loadTopics(result?.topic?.id || '');
      setStatus('Topic created. Review its connections before monitoring them.');
      setStatusTone('success');
    } catch (error) {
      setStatus(error.message || 'Topic creation failed.');
      setStatusTone('error');
    } finally {
      setBusy('');
    }
  };

  const handleTopicPatch = async (patch, message = 'Topic updated.') => {
    if (!selected) return;
    setBusy('topic');
    try {
      await updateTopic(selected.id, patch);
      await refreshSelected();
      setStatus(message);
      setStatusTone('success');
    } catch (error) {
      setStatus(error.message || 'Topic update failed.');
      setStatusTone('error');
    } finally {
      setBusy('');
    }
  };

  const handleDiscover = async () => {
    if (!selected) return;
    setBusy('discover');
    setStatus('Finding official, independent, and specialist connections...');
    setStatusTone('muted');
    try {
      const result = await discoverTopicSources(selected.id, { mode: 'ai', limit: 12 });
      await loadTopics(selected.id);
      const generated = Number(result?.generated_count || 0);
      setStatus(generated > 0
        ? `${generated} new connections found. Approve only the sources you trust.`
        : 'The AI provider was unavailable, so eXplore used its verified source catalog.');
      setStatusTone(generated > 0 ? 'success' : 'muted');
    } catch (error) {
      setStatus(error.message || 'Source discovery failed.');
      setStatusTone('error');
    } finally {
      setBusy('');
    }
  };

  const handleAddSource = async (event) => {
    event.preventDefault();
    if (!selected || !sourceUrl.trim()) return;
    setBusy('source');
    try {
      await addTopicSource(selected.id, {
        name: sourceName.trim(),
        url: sourceUrl.trim(),
        approved: false,
      });
      setSourceName('');
      setSourceUrl('');
      await loadTopics(selected.id);
      setStatus('Connection added. Approve it to monitor it.');
      setStatusTone('success');
    } catch (error) {
      setStatus(error.message || 'Source could not be added.');
      setStatusTone('error');
    } finally {
      setBusy('');
    }
  };

  const handleSourceStatus = async (source, approved) => {
    if (!selected) return;
    setBusy(`source-${source.id}`);
    try {
      await setTopicSourceApproval(selected.id, source.id, approved);
      await loadTopics(selected.id);
      setStatus(approved ? 'Connection is now monitored.' : 'Connection rejected.');
      setStatusTone('success');
    } catch (error) {
      setStatus(error.message || 'Connection status could not be changed.');
      setStatusTone('error');
    } finally {
      setBusy('');
    }
  };

  const handleRemoveSource = async (source) => {
    if (!selected) return;
    setBusy(`source-${source.id}`);
    try {
      await removeTopicSource(selected.id, source.id);
      await loadTopics(selected.id);
      setStatus('Connection removed.');
      setStatusTone('success');
    } catch (error) {
      setStatus(error.message || 'Connection could not be removed.');
      setStatusTone('error');
    } finally {
      setBusy('');
    }
  };

  const handleResearch = async () => {
    if (!selected) return;
    setBusy('research');
    setStatus('Researching the approved source map and recent indexed evidence...');
    setStatusTone('muted');
    try {
      const result = await runTopicDeepResearch(selected.id);
      await loadTopicData(selected.id);
      setStatus(result?.run?.status === 'degraded'
        ? 'Research saved with deterministic evidence because the AI provider was unavailable.'
        : 'Deep research complete.');
      setStatusTone(result?.run?.status === 'degraded' ? 'muted' : 'success');
    } catch (error) {
      setStatus(error.message || 'Deep research failed.');
      setStatusTone('error');
    } finally {
      setBusy('');
    }
  };

  if (!user) {
    return (
      <main className="container topic-page page-enter">
        <header className="topic-page-header">
          <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
            <ArrowLeftIcon size={22} />
          </button>
          <h1>Topics</h1>
        </header>
        <section className="topic-signin-state">
          <h2>Sign in to monitor a topic</h2>
          <p>Your source approvals, priority, research, and alerts stay connected to your account.</p>
        </section>
      </main>
    );
  }

  const sources = cleanArray(selected?.suggested_sources);
  const approvedCount = sources.filter((source) => source.status === 'approved').length;
  const latestResearch = researchRuns[0] || null;
  const research = latestResearch?.result || {};

  return (
    <main className="container topic-page page-enter">
      <header className="topic-page-header">
        <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon size={22} />
        </button>
        <h1>Topics</h1>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setShowNewTopic((value) => !value)}>
          {showNewTopic ? 'Cancel' : 'New topic'}
        </button>
      </header>

      {showNewTopic ? (
        <form className="topic-create-form" onSubmit={handleCreate}>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Topic name" aria-label="Topic name" />
          <textarea className="input" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="What should eXplore watch, and when does it matter?" rows={3} aria-label="Monitoring instruction" />
          <input className="input" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What decision should this help you make?" aria-label="Intended outcome" />
          <button className="btn btn-primary" type="submit" disabled={Boolean(busy)}>
            {busy === 'create' ? 'Creating...' : 'Create'}
          </button>
        </form>
      ) : null}

      <div className="topic-strip scroll-row" aria-label="Monitored topics">
        {topics.map((topic) => (
          <button
            key={topic.id}
            className={`topic-chip ${topic.id === selectedId ? 'topic-chip--active' : ''}`}
            type="button"
            onClick={() => setSelectedId(topic.id)}
          >
            <strong>{topic.name}</strong>
            <span>{topic.importance_threshold || 'important'}</span>
          </button>
        ))}
        {!topics.length && busy !== 'load' ? <span className="topic-empty-inline">Create your first topic.</span> : null}
      </div>

      <Status tone={statusTone}>{status}</Status>

      {selected ? (
        <>
          <section className="topic-overview">
            <div className="topic-overview-copy">
              <input
                className="topic-name-input"
                value={selected.name || ''}
                onChange={(event) => setTopics((current) => current.map((topic) => (
                  topic.id === selected.id ? { ...topic, name: event.target.value } : topic
                )))}
                onBlur={() => {
                  if (selected.name.trim()) void handleTopicPatch({ name: selected.name.trim() }, 'Topic name updated.');
                }}
                aria-label="Topic name"
              />
              <textarea
                className="topic-instruction-input"
                value={selected.instruction || ''}
                onChange={(event) => setTopics((current) => current.map((topic) => (
                  topic.id === selected.id ? { ...topic, instruction: event.target.value } : topic
                )))}
                onBlur={() => void handleTopicPatch(
                  { instruction: selected.instruction || '' },
                  'Monitoring instruction saved.',
                )}
                rows={3}
                aria-label="Monitoring instruction"
              />
            </div>
            <div className="topic-priority-control" aria-label="Topic priority">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority.value}
                  type="button"
                  className={selected.importance_threshold === priority.value ? 'active' : ''}
                  onClick={() => void handleTopicPatch(
                    {
                      importance_threshold: priority.value,
                      notification_policy: {
                        ...(selected.notification_policy || {}),
                        priority: priority.value,
                      },
                    },
                    `${priority.label} priority selected.`,
                  )}
                >
                  {priority.label}
                </button>
              ))}
            </div>
          </section>

          <nav className="topic-view-tabs" aria-label="Topic workspace">
            {[
              { key: 'connections', label: `Connections ${sources.length}` },
              { key: 'latest', label: `Latest ${events.length}` },
              { key: 'research', label: `Research ${researchRuns.length}` },
            ].map((view) => (
              <button
                key={view.key}
                className={activeView === view.key ? 'active' : ''}
                type="button"
                onClick={() => setActiveView(view.key)}
              >
                {view.label}
              </button>
            ))}
          </nav>

          {activeView === 'connections' ? (
            <section className="topic-workspace" aria-labelledby="topic-connections-title">
              <div className="topic-section-heading">
                <div>
                  <h2 id="topic-connections-title">Connections</h2>
                  <span>{approvedCount} monitored</span>
                </div>
                <div className="topic-heading-actions">
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => onOpenSourceWeb?.(selected.id)}>
                    Evidence map
                  </button>
                  <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={handleDiscover}>
                    <SparklesIcon size={16} />
                    {busy === 'discover' ? 'Finding...' : 'Find connections'}
                  </button>
                </div>
              </div>

              <form className="topic-source-form" onSubmit={handleAddSource}>
                <input className="input" value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Source name (optional)" aria-label="Source name" />
                <input className="input" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://official-source.example" aria-label="Source URL" inputMode="url" />
                <button className="btn btn-secondary" type="submit" disabled={Boolean(busy)}>Add link</button>
              </form>

              <div className="topic-source-list">
                {sources.map((source) => (
                  <article key={source.id || source.url} className={`topic-source-card topic-source-card--${source.status || 'suggested'}`}>
                    <div className="topic-source-main">
                      <div>
                        <span className={`topic-source-status topic-source-status--${source.status || 'suggested'}`}>
                          {source.status === 'approved' ? 'Monitored' : source.status || 'Suggested'}
                        </span>
                        <h3>{source.name}</h3>
                      </div>
                      <a href={source.url} target="_blank" rel="noreferrer" className="topic-source-link" aria-label={`Open ${source.name}`}>
                        <ExternalLinkIcon size={18} />
                      </a>
                    </div>
                    <p>{source.suggestion_reason || source.notes || 'Connected to this topic.'}</p>
                    <div className="topic-source-meta">
                      <span>{source.role || source.category || 'source'}</span>
                      <span>Trust {source.trust_tier || 3}/4</span>
                    </div>
                    <div className="topic-source-actions">
                      {source.status !== 'approved' ? (
                        <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => handleSourceStatus(source, true)}>
                          Monitor
                        </button>
                      ) : (
                        <button className="btn btn-secondary btn-sm" type="button" disabled={Boolean(busy)} onClick={() => handleSourceStatus(source, false)}>
                          Stop
                        </button>
                      )}
                      <button className="btn-icon btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => handleRemoveSource(source)} aria-label={`Remove ${source.name}`}>
                        <TrashIcon size={17} />
                      </button>
                    </div>
                  </article>
                ))}
                {!sources.length ? (
                  <div className="topic-empty-state">
                    <SearchIcon size={24} />
                    <p>Add a link or find valuable connections.</p>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeView === 'latest' ? (
            <section className="topic-workspace" aria-labelledby="topic-latest-title">
              <div className="topic-section-heading">
                <div>
                  <h2 id="topic-latest-title">Latest for this topic</h2>
                  <span>Last 72 hours only</span>
                </div>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => loadTopicData(selected.id)}>
                  Refresh
                </button>
              </div>
              <div className="topic-event-list">
                {events.map((event) => (
                  <article className="topic-event-card" key={event.id}>
                    {event.thumbnail_url ? (
                      <Image
                        src={event.thumbnail_url}
                        alt=""
                        width={96}
                        height={96}
                        loading="lazy"
                        unoptimized
                      />
                    ) : null}
                    <div>
                      <div className="topic-event-meta">
                        <span>{event.source}</span>
                        <time dateTime={event.published_at}>{formatDate(event.published_at)}</time>
                      </div>
                      <h3>{event.title}</h3>
                      <p>{event.reason}</p>
                      <div className="topic-event-footer">
                        <span>Fit {Math.round(event.relevance_score)}</span>
                        {event.approved_source ? <span>Approved source</span> : null}
                        <a href={event.url} target="_blank" rel="noreferrer">Open</a>
                      </div>
                    </div>
                  </article>
                ))}
                {!events.length ? (
                  <div className="topic-empty-state">
                    <p>No matching indexed events in the last 72 hours.</p>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeView === 'research' ? (
            <section className="topic-workspace" aria-labelledby="topic-research-title">
              <div className="topic-section-heading">
                <div>
                  <h2 id="topic-research-title">Deep research</h2>
                  <span>Approved sources and indexed evidence only</span>
                </div>
                <button className="btn btn-primary btn-sm" type="button" disabled={Boolean(busy)} onClick={handleResearch}>
                  <SparklesIcon size={16} />
                  {busy === 'research' ? 'Researching...' : 'Run research'}
                </button>
              </div>

              {latestResearch ? (
                <article className="topic-research-result">
                  <header>
                    <div>
                      <span className={`topic-source-status topic-source-status--${latestResearch.status}`}>
                        {latestResearch.status}
                      </span>
                      <time dateTime={latestResearch.created_at}>{formatDate(latestResearch.created_at)}</time>
                    </div>
                    <span>{latestResearch.provider || 'deterministic'} {latestResearch.model || ''}</span>
                  </header>
                  <p className="topic-research-summary">{research.summary || 'Research result saved.'}</p>
                  <ResearchList title="Important changes" items={research.important_changes} />
                  <ResearchList title="Evidence" items={research.evidence_map} />
                  <ResearchList title="Uncertainties" items={research.uncertainties} />
                  <ResearchList title="Next actions" items={research.actions} />
                  <ResearchList title="Next questions" items={research.next_questions} />
                </article>
              ) : (
                <div className="topic-empty-state">
                  <p>Run research when this topic needs a deeper answer.</p>
                </div>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
