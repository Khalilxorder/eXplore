'use client';

import { useState } from 'react';
import { addSourcePack, addTopicMonitor, previewSourcePack } from '../lib/api';

function mapIntentToSpiderLane(intentValue) {
  if (intentValue === 'risk_alert') {
    return 'war';
  }
  if (intentValue === 'market_intelligence') {
    return 'markets';
  }
  return 'ai_advantage';
}

function mapWeightToSpiderPriority(weightValue) {
  if (Number(weightValue) >= 0.9) {
    return 'important';
  }
  return 'watch';
}

function pickDefaultSpiderNetSourceIds(sources = []) {
  const prioritySources = sources.filter((source) => source.priority === 'high');
  const selected = prioritySources.length ? prioritySources : sources.slice(0, 6);
  return selected.map((source) => source.id).filter(Boolean);
}

function getSourceUrl(source = {}) {
  return source.feedUrl || source.url || '';
}

export default function AddInterestScreen({ onBack }) {
  const [sentence, setSentence] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  // Editable structured fields
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState('personal_match');
  const [weight, setWeight] = useState(0.72);
  const [topics, setTopics] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [spiderNetPreview, setSpiderNetPreview] = useState(null);
  const [spiderNetSelectedIds, setSpiderNetSelectedIds] = useState([]);
  const [spiderNetBusy, setSpiderNetBusy] = useState(false);
  const [spiderNetMessage, setSpiderNetMessage] = useState('');

  const loadSpiderNetPreview = async (topicValue, intentValue, weightValue) => {
    const topic = String(topicValue || '').trim();
    if (!topic) {
      setSpiderNetPreview(null);
      setSpiderNetSelectedIds([]);
      return;
    }

    setSpiderNetBusy(true);
    setSpiderNetMessage('');

    try {
      const result = await previewSourcePack({
        topic,
        lane: mapIntentToSpiderLane(intentValue),
        priority: mapWeightToSpiderPriority(weightValue),
      });
      const pack = result?.pack || null;
      const sources = Array.isArray(pack?.generatedSources)
        ? pack.generatedSources
        : Array.isArray(pack?.generated_sources)
          ? pack.generated_sources
          : [];

      setSpiderNetPreview(pack ? { ...pack, generatedSources: sources } : null);
      setSpiderNetSelectedIds(pickDefaultSpiderNetSourceIds(sources));
      setSpiderNetMessage(sources.length
        ? 'Choose the important links before activating the monitor.'
        : 'No suggested source links were generated for this topic yet.');
    } catch (err) {
      setSpiderNetPreview(null);
      setSpiderNetSelectedIds([]);
      setSpiderNetMessage(err.message || 'Could not build SPIDER NET suggestions.');
    } finally {
      setSpiderNetBusy(false);
    }
  };

  const toggleSpiderNetSource = (sourceId) => {
    setSpiderNetSelectedIds((current) => (
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId]
    ));
  };

  const handleAnalyze = () => {
    if (!sentence.trim()) return;
    setIsAnalyzing(true);
    
    setTimeout(() => {
      const text = sentence.toLowerCase();
      
      // Extract companies
      const knownCompanies = ['openai', 'anthropic', 'google', 'meta', 'xai', 'microsoft', 'amazon', 'mistral', 'stability'];
      const matchedCompanies = knownCompanies.filter(c => text.includes(c));
      
      // Extract intent
      let matchedIntent = 'personal_match';
      if (text.includes('release') || text.includes('launch') || text.includes('unveil') || text.includes('version')) {
        matchedIntent = 'release_watch';
      } else if (text.includes('war') || text.includes('risk') || text.includes('conflict') || text.includes('threat') || text.includes('regional')) {
        matchedIntent = 'risk_alert';
      } else if (text.includes('market') || text.includes('stock') || text.includes('funding') || text.includes('acquisition') || text.includes('price')) {
        matchedIntent = 'market_intelligence';
      }
      
      // Extract weight
      let matchedWeight = 0.72;
      if (text.includes('urgent') || text.includes('critical') || text.includes('important') || text.includes('immediate') || text.includes('high priority')) {
        matchedWeight = 0.95;
      } else if (text.includes('low') || text.includes('background') || text.includes('ignore')) {
        matchedWeight = 0.35;
      }

      // Extract topics (nouns / keywords)
      const stopwords = new Set(['i', 'want', 'to', 'track', 'new', 'releases', 'from', 'and', 'related', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'with', 'about']);
      const words = sentence
        .replace(/[^a-zA-Z\s]/g, '')
        .split(/\s+/)
        .map(w => w.toLowerCase())
        .filter(w => w.length > 3 && !stopwords.has(w) && !knownCompanies.includes(w));
      const matchedTopics = [...new Set(words)];

      // Build structured query
      const structuredQuery = [
        ...matchedCompanies.map(c => c.charAt(0).toUpperCase() + c.slice(1)),
        ...matchedTopics
      ].join(' ');

      setQuery(structuredQuery || sentence);
      setIntent(matchedIntent);
      setWeight(matchedWeight);
      setTopics(matchedTopics);
      setCompanies(matchedCompanies);
      
      setAnalysisResult({
        structuredQuery: structuredQuery || sentence,
        intent: matchedIntent,
        weight: matchedWeight,
        topics: matchedTopics,
        companies: matchedCompanies
      });
      void loadSpiderNetPreview(structuredQuery || sentence, matchedIntent, matchedWeight);
      setIsAnalyzing(false);
    }, 800);
  };

  const handleSave = async () => {
    setStatusMessage('');
    setIsSuccess(false);
    
    try {
      const payload = {
        query: query.trim(),
        intent,
        weight,
        meta: {
          original_sentence: sentence,
          topics,
          companies
        }
      };
      
      const result = await addTopicMonitor(payload);
      if (result?.error) {
        setStatusMessage(result.error);
      } else {
        if (spiderNetPreview && spiderNetSelectedIds.length > 0) {
          await addSourcePack({
            topic: query.trim(),
            lane: spiderNetPreview.lane || mapIntentToSpiderLane(intent),
            priority: mapWeightToSpiderPriority(weight),
            selected_source_ids: spiderNetSelectedIds,
            why: `SPIDER NET source links selected for ${query.trim()}.`,
            active: true,
          });
        }
        setIsSuccess(true);
        setStatusMessage(spiderNetSelectedIds.length > 0
          ? 'Monitor activated and selected SPIDER NET links added to the feed.'
          : 'Structured Monitor activated without SPIDER NET links.');
        setTimeout(() => {
          onBack?.();
        }, 1500);
      }
    } catch (err) {
      setStatusMessage(err.message || 'Error saving monitor');
    }
  };

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0', color: 'var(--text-primary)' }}>
      <div className="container" style={{ maxWidth: '640px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-base)', marginBottom: 'var(--space-large)' }}>
          <button className="btn btn-secondary btn-sm" onClick={onBack} style={{ borderRadius: '50%', width: '36px', height: '36px', padding: 0 }}>
            ←
          </button>
          <div>
            <span className="page-kicker">Simple Interest Builder</span>
            <h2 className="section-title" style={{ margin: 0 }}>Activate New Monitor</h2>
          </div>
        </div>

        {/* Input Card */}
        <div className="card" style={{ padding: 'var(--space-medium)', marginBottom: 'var(--space-base)', background: 'var(--surface-elevated)' }}>
          <label style={{ display: 'block', font: 'var(--font-body)', fontWeight: 600, marginBottom: 'var(--space-small)' }}>
            What would you like to track?
          </label>
          <textarea
            className="opp-search-input"
            style={{ width: '100%', minHeight: '100px', resize: 'vertical', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '14px', lineHeight: '1.5', color: 'var(--text-primary)' }}
            placeholder="e.g., I want to track OpenAI releases related to GPT models and agents with high priority..."
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-small)' }}>
            <button
              className="btn btn-primary"
              disabled={isAnalyzing || !sentence.trim()}
              onClick={handleAnalyze}
              style={{ padding: '10px 24px', fontWeight: 600, borderRadius: 'var(--radius-md)' }}
            >
              {isAnalyzing ? 'Analyzing Sentence...' : 'Analyze & Build Monitor'}
            </button>
          </div>
        </div>

        {/* Structured Results Card */}
        {analysisResult && (
          <div className="card page-enter" style={{ padding: 'var(--space-medium)', background: 'var(--surface-elevated)', border: '1px solid var(--accent)' }}>
            <h3 style={{ font: 'var(--font-h3)', margin: '0 0 var(--space-base) 0', color: 'var(--accent)' }}>
              Structured Intelligence Preview
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
              {/* Query Field */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Generated Search Query
                </label>
                <input
                  type="text"
                  className="opp-search-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ width: '100%', background: 'var(--surface)' }}
                />
              </div>

              {/* Companies & Topics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-base)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Detected Companies
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {companies.length > 0 ? companies.map(c => (
                      <span key={c} className="badge badge-premium">{c}</span>
                    )) : <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>None detected</span>}
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Extracted Topics
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {topics.length > 0 ? topics.map(t => (
                      <span key={t} className="badge badge-accent">{t}</span>
                    )) : <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>None extracted</span>}
                  </div>
                </div>
              </div>

              {/* Intent Selector */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Monitor Intent
                </label>
                <select
                  className="opp-select"
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  style={{ width: '100%', background: 'var(--surface)', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}
                >
                  <option value="personal_match">Personal Match</option>
                  <option value="release_watch">Release Watch</option>
                  <option value="risk_alert">Risk Alert</option>
                  <option value="market_intelligence">Market Intelligence</option>
                </select>
              </div>

              {/* Weight Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    Signal Weight
                  </label>
                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{Math.round(weight * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={weight}
                  onChange={(e) => setWeight(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-base)', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'flex-start', marginBottom: 'var(--space-small)' }}>
                  <div>
                    <p style={{ font: 'var(--font-micro)', color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
                      SPIDER NET
                    </p>
                    <h3 style={{ font: 'var(--font-h3)', margin: '4px 0', color: 'var(--text-primary)' }}>
                      Suggested source links
                    </h3>
                    <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                      Pick the links that matter. Only selected links will be added as feed sources.
                    </p>
                  </div>
                  {spiderNetPreview?.lane ? (
                    <span className="badge badge-accent">{spiderNetPreview.lane}</span>
                  ) : null}
                </div>

                {spiderNetBusy ? (
                  <div className="skeleton" style={{ height: '64px', borderRadius: 'var(--radius-sm)' }} />
                ) : null}

                {!spiderNetBusy && spiderNetMessage ? (
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '0 0 var(--space-small) 0' }}>
                    {spiderNetMessage}
                  </p>
                ) : null}

                {!spiderNetBusy && spiderNetPreview?.generatedSources?.length ? (
                  <>
                    <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', marginBottom: 'var(--space-small)' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSpiderNetSelectedIds(spiderNetPreview.generatedSources.map((source) => source.id).filter(Boolean))}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSpiderNetSelectedIds([])}
                      >
                        Clear
                      </button>
                      <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                        {spiderNetSelectedIds.length}/{spiderNetPreview.generatedSources.length} selected
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto', paddingRight: '2px' }}>
                      {spiderNetPreview.generatedSources.map((source) => {
                        const checked = spiderNetSelectedIds.includes(source.id);
                        return (
                          <label
                            key={source.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'auto minmax(0, 1fr)',
                              gap: '10px',
                              alignItems: 'start',
                              padding: '10px 12px',
                              border: checked ? '1px solid var(--accent)' : '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              background: checked ? 'var(--accent-light)' : 'var(--surface-elevated)',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSpiderNetSource(source.id)}
                              style={{ marginTop: '3px' }}
                            />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                                  {source.label || source.id}
                                </strong>
                                <span className="badge" style={{ color: 'var(--accent)', background: 'var(--accent-light)' }}>
                                  {source.priority || 'source'}
                                </span>
                              </span>
                              <span style={{ display: 'block', font: 'var(--font-micro)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {getSourceUrl(source)}
                              </span>
                              {source.watchFor?.length ? (
                                <span style={{ display: 'block', font: 'var(--font-micro)', color: 'var(--text-secondary)', marginTop: '3px' }}>
                                  Watches: {source.watchFor.slice(0, 3).join(', ')}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>

              {/* Status Message */}
              {statusMessage && (
                <div style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  background: isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: isSuccess ? '#10b981' : '#ef4444',
                  fontSize: '14px',
                  fontWeight: 600,
                  textAlign: 'center'
                }}>
                  {statusMessage}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-small)', marginTop: 'var(--space-small)' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setAnalysisResult(null)}
                  style={{ padding: '10px 20px' }}
                >
                  Reset
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  style={{ padding: '10px 24px', fontWeight: 600, background: 'var(--success)', borderColor: 'var(--success)' }}
                >
                  Activate Monitor
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
