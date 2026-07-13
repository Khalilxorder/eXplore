'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import { useAuth } from './AuthProvider';
import { fetchFormulations, createFormulation } from '../lib/api';

export default function FormulationScreen({ onBack }) {
  const { user } = useAuth();
  const [inputText, setInputText] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');
  const [activeFormulation, setActiveFormulation] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setLoadingHistory(true);
      setError('');
      try {
        const res = await fetchFormulations();
        if (!cancelled && res && res.success) {
          setHistory(res.formulations || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load past formulations.');
        }
      } finally {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;

    setLoading(true);
    setError('');
    setActiveFormulation(null);

    try {
      const res = await createFormulation(inputText);
      if (res && res.success && res.formulation) {
        setActiveFormulation(res.formulation);
        setInputText('');
        // Reload history
        const histRes = await fetchFormulations();
        if (histRes && histRes.success) {
          setHistory(histRes.formulations || []);
        }
      } else {
        setError(res?.error || 'Could not generate formulation.');
      }
    } catch (err) {
      setError(err.message || 'An error occurred during formulation.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectHistory = (item) => {
    setActiveFormulation({
      themes: item.output.themes,
      lifeDomains: item.output.lifeDomains,
      goalLinks: item.output.goalLinks,
      actions: item.output.actions,
      goldenParagraph: item.output.goldenParagraph,
      draftEssay: item.output.draftEssay,
      createdAt: item.createdAt,
      inputText: item.inputText,
    });
  };

  const formatTimestamp = (val) => {
    if (!val) return '';
    try {
      return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(val));
    } catch {
      return String(val);
    }
  };

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0' }}>
      <div className="container">
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-small)',
          marginBottom: 'var(--space-medium)',
        }}>
          <button type="button" className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
            <ArrowLeftIcon size={22} />
          </button>
          <div>
            <h1 style={{ font: 'var(--font-h1)', margin: 0 }}>Golden Formulation</h1>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              Deconstruct raw experience into goal-aligned life narrative anchor points
            </p>
          </div>
        </div>

        {/* Main Grid Layout */}
        <div className="formulation-layout">
          {/* Left panel: Form input + active formulation */}
          <div className="formulation-main-col">
            {/* Input card */}
            <div className="card" style={{ marginBottom: 'var(--space-medium)' }}>
              <h2 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-small)' }}>Write your raw experience</h2>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-small)' }}>
                Pour out your raw feelings, thoughts, dreams, or inner writing. The AI will distill them into theme, domain, and actionable core golden paragraph alignment.
              </p>
              
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                <textarea
                  className="text-surface formulation-textarea"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Today I was thinking about..."
                  required
                  disabled={loading}
                />
                
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--space-small)' }}>
                  {error && <span style={{ color: 'var(--error)', font: 'var(--font-caption)' }}>{error}</span>}
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading || !inputText.trim()}
                  >
                    {loading ? 'Formulating...' : 'Generate Formulation'}
                  </button>
                </div>
              </form>
            </div>

            {/* Active Formulation Results */}
            {activeFormulation && (
              <div className="card active-formulation-card fade-in">
                <div className="active-formulation-header">
                  <span className="active-formulation-kicker">distilled insight</span>
                  <h3 style={{ font: 'var(--font-h3)', margin: '4px 0 0' }}>Distilled Core</h3>
                  {activeFormulation.createdAt && (
                    <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>Distilled: {formatTimestamp(activeFormulation.createdAt)}</span>
                  )}
                </div>

                {activeFormulation.inputText && (
                  <div style={{ margin: 'var(--space-small) 0', padding: 'var(--space-small)', background: 'var(--surface-elevated)', borderRadius: 'var(--radius-sm)', borderLeft: '2px solid var(--border-soft)' }}>
                    <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Your text:</span>
                    <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '4px 0 0', fontStyle: 'italic' }}>
                      &quot;{activeFormulation.inputText}&quot;
                    </p>
                  </div>
                )}

                {/* Golden Paragraph */}
                <div className="golden-paragraph-box">
                  <span className="golden-label">Golden Formulation</span>
                  <p className="golden-text">{activeFormulation.goldenParagraph}</p>
                </div>

                {/* Metadata grid */}
                <div className="meta-distill-grid">
                  <div className="meta-distill-cell">
                    <strong>Core Themes</strong>
                    <div className="meta-chips-row">
                      {activeFormulation.themes && activeFormulation.themes.length > 0 ? (
                        activeFormulation.themes.map((t, idx) => (
                          <span key={idx} className="chip active">{t}</span>
                        ))
                      ) : (
                        <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>No themes</span>
                      )}
                    </div>
                  </div>

                  <div className="meta-distill-cell">
                    <strong>Life Domains</strong>
                    <div className="meta-chips-row">
                      {activeFormulation.lifeDomains && activeFormulation.lifeDomains.length > 0 ? (
                        activeFormulation.lifeDomains.map((d, idx) => (
                          <span key={idx} className="chip active" style={{ borderColor: '#a78bfa', color: '#a78bfa' }}>{d}</span>
                        ))
                      ) : (
                        <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>No domains</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Goal Links & Actions */}
                <div className="actions-section">
                  <div className="actions-column">
                    <strong>Goal Alignments</strong>
                    <ul>
                      {activeFormulation.goalLinks && activeFormulation.goalLinks.length > 0 ? (
                        activeFormulation.goalLinks.map((g, idx) => <li key={idx}>{g}</li>)
                      ) : (
                        <li>General personal development alignment</li>
                      )}
                    </ul>
                  </div>

                  <div className="actions-column">
                    <strong>Suggested Next Actions</strong>
                    <ul>
                      {activeFormulation.actions && activeFormulation.actions.length > 0 ? (
                        activeFormulation.actions.map((a, idx) => <li key={idx}>{a}</li>)
                      ) : (
                        <li>Continue micro-journaling and reflection</li>
                      )}
                    </ul>
                  </div>
                </div>

                {/* Draft Essay */}
                {activeFormulation.draftEssay && (
                  <div style={{ marginTop: 'var(--space-medium)', borderTop: '1px solid var(--border-soft)', paddingTop: 'var(--space-small)' }}>
                    <strong>Draft Essay Expansion</strong>
                    <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginTop: '8px', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                      {activeFormulation.draftEssay}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right panel: History list */}
          <div className="formulation-history-col">
            <div className="card history-card-panel">
              <h3 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-small)' }}>Past distillations</h3>
              
              {loadingHistory ? (
                <div style={{ color: 'var(--text-tertiary)', font: 'var(--font-caption)' }}>Loading history...</div>
              ) : history.length === 0 ? (
                <div style={{ color: 'var(--text-tertiary)', font: 'var(--font-caption)', fontStyle: 'italic' }}>
                  No past formulations yet. distil your first thoughts!
                </div>
              ) : (
                <div className="history-items-list">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="history-list-item"
                      onClick={() => handleSelectHistory(item)}
                    >
                      <div className="history-item-top">
                        <span className="history-item-date">{formatTimestamp(item.createdAt)}</span>
                        {item.output.lifeDomains && item.output.lifeDomains[0] && (
                          <span className="history-item-badge">{item.output.lifeDomains[0]}</span>
                        )}
                      </div>
                      <p className="history-item-snippet">{item.inputText}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .formulation-layout {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: var(--space-medium);
        }
        @media (max-width: 900px) {
          .formulation-layout {
            grid-template-columns: 1fr;
          }
        }
        .formulation-textarea {
          width: 100%;
          min-height: 140px;
          padding: var(--space-small);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          background: var(--surface-elevated);
          color: var(--text-primary);
          font: var(--font-body);
          outline: none;
          resize: vertical;
          transition: border-color var(--duration-normal);
        }
        .formulation-textarea:focus {
          border-color: var(--accent);
        }
        
        /* distil card output */
        .active-formulation-card {
          border-left: 4px solid var(--accent);
        }
        .active-formulation-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 1px solid var(--border-soft);
          padding-bottom: var(--space-small);
          margin-bottom: var(--space-small);
        }
        .active-formulation-kicker {
          font: var(--font-micro);
          color: var(--accent);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 700;
        }
        .golden-paragraph-box {
          border: 1px solid hsl(45, 40%, 30%);
          background: linear-gradient(135deg, hsl(45, 30%, 8%), var(--surface-elevated));
          padding: var(--space-base);
          border-radius: var(--radius-md);
          margin-bottom: var(--space-medium);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .golden-label {
          display: block;
          font: var(--font-micro);
          color: hsl(45, 90%, 65%);
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
        }
        .golden-text {
          font: var(--font-body);
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-primary);
          margin: 0;
        }
        .meta-distill-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-small);
          margin-bottom: var(--space-medium);
        }
        .meta-distill-cell {
          background: var(--surface-elevated);
          padding: var(--space-small);
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-soft);
        }
        .meta-distill-cell strong {
          display: block;
          font: var(--font-micro);
          color: var(--text-secondary);
          margin-bottom: 6px;
          text-transform: uppercase;
        }
        .meta-chips-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-micro);
        }
        
        .actions-section {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-small);
          border-top: 1px solid var(--border-soft);
          padding-top: var(--space-medium);
        }
        .actions-column strong {
          display: block;
          font: var(--font-caption);
          color: var(--text-primary);
          margin-bottom: 6px;
        }
        .actions-column ul {
          margin: 0;
          padding-left: var(--space-base);
          font: var(--font-caption);
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        /* History items list */
        .history-card-panel {
          max-height: 500px;
          display: flex;
          flex-direction: column;
        }
        .history-items-list {
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: var(--space-tight);
          max-height: 400px;
          padding-right: 4px;
        }
        .history-list-item {
          background: var(--surface-elevated);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-sm);
          padding: var(--space-small);
          text-align: left;
          cursor: pointer;
          transition: all var(--duration-fast);
          width: 100%;
        }
        .history-list-item:hover {
          border-color: var(--accent);
          background: var(--surface);
        }
        .history-item-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        .history-item-date {
          font: var(--font-micro);
          color: var(--text-tertiary);
        }
        .history-item-badge {
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 4px;
          background: color-mix(in srgb, var(--accent) 15%, transparent);
          color: var(--accent);
          font-weight: 600;
        }
        .history-item-snippet {
          font: var(--font-caption);
          color: var(--text-secondary);
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      ` }} />
    </div>
  );
}
