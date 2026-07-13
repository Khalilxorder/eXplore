'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import { useAuth } from './AuthProvider';
import { fetchExperiments, createExperiment, updateExperiment, deleteExperiment } from '../lib/api';

export default function ExperimentScreen({ onBack }) {
  const { user } = useAuth();
  const [experiments, setExperiments] = useState([]);
  const [hypothesis, setHypothesis] = useState('');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editStatus, setEditStatus] = useState('pending');
  const [editResult, setEditResult] = useState('');

  const STATUS_CONFIGS = {
    pending: { label: 'Pending', color: 'var(--text-secondary)', bg: 'var(--surface-elevated)' },
    active: { label: 'Active', color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 15%, transparent)' },
    success: { label: 'Success', color: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 15%, transparent)' },
    failed: { label: 'Failed', color: 'var(--error)', bg: 'color-mix(in srgb, var(--error) 15%, transparent)' },
  };

  useEffect(() => {
    let cancelled = false;

    async function loadExperiments() {
      setLoadingList(true);
      setError('');
      try {
        const res = await fetchExperiments();
        if (!cancelled && res && res.success) {
          setExperiments(res.experiments || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load experiments.');
        }
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    }

    loadExperiments();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!hypothesis.trim() || !action.trim() || loading) return;

    setLoading(true);
    setError('');
    setStatusMessage('');

    try {
      const res = await createExperiment(hypothesis, action);
      if (res && res.success && res.experiment) {
        setHypothesis('');
        setAction('');
        setStatusMessage('Experiment logged.');
        // Reload list
        const listRes = await fetchExperiments();
        if (listRes && listRes.success) {
          setExperiments(listRes.experiments || []);
        }
      } else {
        setError(res?.error || 'Could not log experiment.');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while creating.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (exp) => {
    setEditingId(exp.id);
    setEditStatus(exp.status);
    setEditResult(exp.result || '');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleUpdate = async (id) => {
    setError('');
    setStatusMessage('');

    try {
      const res = await updateExperiment(id, editStatus, editResult);
      if (res && res.success) {
        setStatusMessage('Experiment updated.');
        setEditingId(null);
        // Refresh local items
        setExperiments((current) =>
          current.map((exp) => (exp.id === id ? { ...exp, status: editStatus, result: editResult } : exp))
        );
      } else {
        setError('Could not update experiment.');
      }
    } catch (err) {
      setError(err.message || 'Error occurred while updating.');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this experiment track?')) return;
    setError('');
    setStatusMessage('');

    try {
      const res = await deleteExperiment(id);
      if (res && res.success) {
        setExperiments((current) => current.filter((exp) => exp.id !== id));
        setStatusMessage('Experiment deleted.');
      } else {
        setError('Could not delete experiment.');
      }
    } catch (err) {
      setError(err.message || 'Error occurred while deleting.');
    }
  };

  const formatTimestamp = (val) => {
    if (!val) return '';
    try {
      return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
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
            <h1 style={{ font: 'var(--font-h1)', margin: 0 }}>eXperiment (Hypothesis Tracker)</h1>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              Design intentional life choices, log metrics, and track results scientifically
            </p>
          </div>
        </div>

        {/* Layout */}
        <div className="experiment-layout">
          {/* New Experiment Column */}
          <div className="experiment-form-panel">
            <div className="card">
              <h2 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-small)' }}>Launch an Experiment</h2>
              
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="exp-hypothesis" style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Hypothesis</label>
                  <textarea
                    id="exp-hypothesis"
                    className="text-surface experiment-textarea"
                    style={{ minHeight: '80px' }}
                    value={hypothesis}
                    onChange={(e) => setHypothesis(e.target.value)}
                    placeholder="If I work only on task at a time for 2 hours daily..."
                    required
                    disabled={loading}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="exp-action" style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Action Attempt</label>
                  <textarea
                    id="exp-action"
                    className="text-surface experiment-textarea"
                    style={{ minHeight: '80px' }}
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    placeholder="I will block notifications and code from 8am to 10am..."
                    required
                    disabled={loading}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ font: 'var(--font-caption)' }}>
                    {error && <span style={{ color: 'var(--error)' }}>{error}</span>}
                    {statusMessage && <span style={{ color: 'var(--success)' }}>{statusMessage}</span>}
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading || !hypothesis.trim() || !action.trim()}
                  >
                    {loading ? 'Logging...' : 'Launch Experiment'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* List Experiments Column */}
          <div className="experiment-list-panel">
            <h2 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-small)' }}>Active & Past Experiments</h2>
            
            {loadingList ? (
              <div style={{ color: 'var(--text-tertiary)', font: 'var(--font-caption)' }}>Loading experiments...</div>
            ) : experiments.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-tertiary)' }}>
                <p style={{ font: 'var(--font-body)', fontStyle: 'italic', margin: 0 }}>No experiments running. Formulate a hypothesis and track its outcome.</p>
              </div>
            ) : (
              <div className="experiment-items-list">
                {experiments.map((exp) => {
                  const isEditing = editingId === exp.id;
                  const currentStatus = STATUS_CONFIGS[exp.status] || STATUS_CONFIGS.pending;

                  return (
                    <div key={exp.id} className="card experiment-card" style={{ borderLeftColor: currentStatus.color }}>
                      <div className="experiment-card-header">
                        <span className="badge" style={{ color: currentStatus.color, background: currentStatus.bg }}>
                          {currentStatus.label}
                        </span>
                        <span className="experiment-card-date">{formatTimestamp(exp.createdAt)}</span>
                      </div>

                      <div className="experiment-card-section">
                        <strong className="section-label">Hypothesis</strong>
                        <p className="section-content">{exp.hypothesis}</p>
                      </div>

                      <div className="experiment-card-section">
                        <strong className="section-label">Action</strong>
                        <p className="section-content">{exp.action}</p>
                      </div>

                      {exp.result && !isEditing && (
                        <div className="experiment-card-section result-box">
                          <strong className="section-label">Outcome Result</strong>
                          <p className="section-content">{exp.result}</p>
                        </div>
                      )}

                      {/* Edit state UI */}
                      {isEditing ? (
                        <div className="experiment-edit-form" style={{ marginTop: 'var(--space-small)', borderTop: '1px solid var(--border-soft)', paddingTop: 'var(--space-small)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>Status</label>
                              <select
                                value={editStatus}
                                onChange={(e) => setEditStatus(e.target.value)}
                                style={{
                                  minHeight: '36px',
                                  border: '1px solid var(--border)',
                                  background: 'var(--surface-elevated)',
                                  color: 'var(--text-primary)',
                                  font: 'var(--font-body)',
                                }}
                              >
                                <option value="pending">Pending</option>
                                <option value="active">Active</option>
                                <option value="success">Success</option>
                                <option value="failed">Failed</option>
                              </select>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>Outcome / Result Details</label>
                              <textarea
                                className="text-surface experiment-textarea"
                                style={{ minHeight: '60px' }}
                                value={editResult}
                                onChange={(e) => setEditResult(e.target.value)}
                                placeholder="Metrics improved by 15%, focus levels held..."
                              />
                            </div>

                            <div style={{ display: 'flex', gap: 'var(--space-tight)', justifyContent: 'flex-end' }}>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={handleCancelEdit}>Cancel</button>
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => handleUpdate(exp.id)}>Save Changes</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="experiment-card-footer" style={{ marginTop: 'var(--space-small)', borderTop: '1px solid var(--border-soft)', paddingTop: 'var(--space-micro)' }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--error)' }}
                            onClick={() => handleDelete(exp.id)}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleStartEdit(exp)}
                          >
                            Update outcome
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .experiment-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-medium);
        }
        @media (max-width: 900px) {
          .experiment-layout {
            grid-template-columns: 1fr;
          }
        }
        .experiment-textarea {
          width: 100%;
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
        .experiment-textarea:focus {
          border-color: var(--accent);
        }
        .experiment-items-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-small);
          max-height: 600px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .experiment-card {
          border-left: 3px solid var(--text-secondary);
          display: flex;
          flex-direction: column;
          gap: var(--space-small);
          padding: var(--space-base);
          transition: all var(--duration-normal);
        }
        .experiment-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .experiment-card-date {
          font: var(--font-micro);
          color: var(--text-tertiary);
        }
        .experiment-card-section {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .section-label {
          font: var(--font-micro);
          color: var(--text-secondary);
          text-transform: uppercase;
        }
        .section-content {
          font: var(--font-body);
          color: var(--text-primary);
          line-height: 1.5;
          margin: 0;
          white-space: pre-wrap;
        }
        .result-box {
          border-left: 2px solid var(--success);
          padding-left: var(--space-small);
          margin-top: 4px;
        }
        .experiment-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
      ` }} />
    </div>
  );
}
