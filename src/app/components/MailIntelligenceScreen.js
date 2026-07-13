'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchMailAuthUrl,
  syncMail,
  fetchMailPriorityFeed,
  fetchReferenceSenders,
  addReferenceSender,
} from '../lib/api';

function formatDate(receivedStr) {
  if (!receivedStr) return '';
  try {
    const d = new Date(receivedStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return receivedStr;
  }
}

function getDomainStyle(domain) {
  const map = {
    'University': { bg: 'rgba(96, 165, 250, 0.1)', border: 'var(--accent)', text: 'var(--accent)' },
    'Work': { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.5)', text: '#60a5fa' },
    'Scholarship': { bg: 'rgba(245, 158, 11, 0.1)', border: 'var(--warning)', text: 'var(--warning)' },
    'Visa/Documents': { bg: 'rgba(52, 211, 153, 0.1)', border: 'var(--success)', text: 'var(--success)' },
    'Money': { bg: 'rgba(239, 68, 68, 0.1)', border: 'var(--error)', text: 'var(--error)' },
    'Family': { bg: 'rgba(236, 72, 153, 0.1)', border: 'rgba(236, 72, 153, 0.5)', text: '#f472b6' },
    'Housing': { bg: 'rgba(139, 92, 246, 0.1)', border: 'rgba(139, 92, 246, 0.5)', text: '#a78bfa' },
    'Health': { bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.5)', text: '#34d399' },
    'Urgent': { bg: 'rgba(220, 38, 38, 0.1)', border: 'var(--danger)', text: 'var(--danger)' },
    'Creative/SPHERE': { bg: 'rgba(167, 139, 250, 0.1)', border: '#a78bfa', text: '#a78bfa' },
  };
  return map[domain] || { bg: 'rgba(255, 255, 255, 0.05)', border: 'var(--border-soft)', text: 'var(--text-secondary)' };
}

function getTierHeader(tier) {
  const map = {
    emergency: { label: '⚡ EMERGENCY', color: 'var(--error)' },
    today: { label: '📅 TODAY', color: 'var(--warning)' },
    week: { label: '📅 THIS WEEK', color: 'var(--text-primary)' },
    opportunity: { label: '🔭 OPPORTUNITIES', color: '#a78bfa' },
    archive: { label: '🏛️ ARCHIVE', color: 'var(--text-secondary)' },
    ignore: { label: '🗑️ IGNORE', color: 'var(--text-tertiary)' },
  };
  return map[tier] || { label: tier.toUpperCase(), color: 'var(--text-secondary)' };
}

export default function MailIntelligenceScreen({ onBack }) {
  const [feed, setFeed] = useState([]);
  const [isConfigured, setIsConfigured] = useState(true);
  const [authUrl, setAuthUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  
  // Reference Senders
  const [referenceSenders, setReferenceSenders] = useState([]);
  const [newSenderEmail, setNewSenderEmail] = useState('');
  const [newSenderLabel, setNewSenderLabel] = useState('');
  const [addingSender, setAddingSender] = useState(false);
  const [senderMessage, setSenderMessage] = useState('');

  // UI state
  const [expandedMessages, setExpandedMessages] = useState({});
  const [copiedId, setCopiedId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await fetchMailAuthUrl();
      if (auth) {
        setIsConfigured(auth.configured);
        setAuthUrl(auth.url || '');
      }
      
      const feedRes = await fetchMailPriorityFeed();
      if (feedRes && feedRes.success) {
        setFeed(feedRes.tiers || []);
      } else {
        setError('Failed to load mail feed.');
      }
      
      const sendersRes = await fetchReferenceSenders();
      if (sendersRes && sendersRes.success) {
        setReferenceSenders(sendersRes.senders || []);
      }
    } catch (err) {
      setError(err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await syncMail();
      if (res && res.success) {
        const feedRes = await fetchMailPriorityFeed();
        if (feedRes && feedRes.success) {
          setFeed(feedRes.tiers || []);
        }
      } else {
        setError(res?.error || 'Sync execution failed.');
      }
    } catch (err) {
      setError(err.message || 'An error occurred during sync.');
    } finally {
      setSyncing(false);
    }
  };

  const handleAddSender = async (e) => {
    e.preventDefault();
    if (!newSenderEmail) return;
    setAddingSender(true);
    setSenderMessage('');
    try {
      const res = await addReferenceSender(newSenderEmail, newSenderLabel);
      if (res && res.success) {
        setNewSenderEmail('');
        setNewSenderLabel('');
        setSenderMessage('Sender added successfully!');
        const sendersRes = await fetchReferenceSenders();
        if (sendersRes && sendersRes.success) {
          setReferenceSenders(sendersRes.senders || []);
        }
      } else {
        setSenderMessage(res?.error || 'Failed to add reference sender.');
      }
    } catch (err) {
      setSenderMessage(err.message || 'An error occurred.');
    } finally {
      setAddingSender(false);
    }
  };

  const toggleExpand = (msgId) => {
    setExpandedMessages((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  const handleCopy = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Helper to extract emergency and today messages for "Today's true 20%" strip
  const emergencyMessages = feed.find(t => t.tier === 'emergency')?.messages || [];
  const todayMessages = feed.find(t => t.tier === 'today')?.messages || [];
  const true20Messages = [...emergencyMessages, ...todayMessages];

  if (loading) {
    return (
      <div className="mail-screen-loading">
        <div className="mail-spinner" />
        <p>Analyzing inbox priority signals...</p>
        <style>{`
          .mail-screen-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 80vh;
            color: var(--text-secondary);
            font: var(--font-body);
          }
          .mail-spinner {
            border: 2px solid var(--border-soft);
            border-top: 2px solid #a78bfa;
            border-radius: 50%;
            width: 28px;
            height: 28px;
            animation: mail-spin 1s linear infinite;
            margin-bottom: 16px;
          }
          @keyframes mail-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="mail-screen container">
      {/* Top Banner/Action Header */}
      <div className="mail-header-bar">
        <div>
          <span className="mail-kicker">Personal Intelligent Inbox</span>
          <h1 className="mail-page-title">Inbox Priority Feed</h1>
        </div>
        <button 
          className={`btn ${syncing ? 'btn-ghost' : 'btn-primary'}`} 
          onClick={handleSync}
          disabled={syncing || !isConfigured}
        >
          {syncing ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="sync-loader" /> Syncing...
            </span>
          ) : (
            'Sync ↻'
          )}
        </button>
      </div>

      {error && (
        <div className="mail-error-banner">
          ⚠️ {error}
        </div>
      )}

      {/* Gmail OAuth connection screen */}
      {!isConfigured ? (
        <div className="mail-auth-card card">
          <div className="mail-auth-icon">📬</div>
          <h2>Connect Your Gmail Account</h2>
          <p>
            eXplore scans your recent emails securely locally, applies AI classification to map messages to your life goals, highlights key action items, and generates auto-draft replies.
          </p>
          <a href={authUrl || '#'} className="btn btn-primary" style={{ width: 'fit-content', margin: '16px auto 0' }}>
            Connect Gmail
          </a>
        </div>
      ) : (
        <>
          {/* Today's true 20% strip */}
          {true20Messages.length > 0 && (
            <div className="true-20-container">
              <div className="true-20-header">
                <span>Today&apos;s True 20% Strip</span>
                <span className="true-20-badge">Highest Urgency</span>
              </div>
              <div className="true-20-scroll scroll-row">
                {true20Messages.map((msg) => {
                  const domStyle = getDomainStyle(msg.life_domain);
                  return (
                    <div key={msg.id} className="true-20-card card" onClick={() => toggleExpand(msg.id)}>
                      <div className="true-20-top">
                        <span className="true-20-domain" style={{ color: domStyle.text, backgroundColor: domStyle.bg }}>
                          {msg.life_domain}
                        </span>
                        <span className="true-20-date">{formatDate(msg.received_at)}</span>
                      </div>
                      <div className="true-20-sender">{msg.sender}</div>
                      <div className="true-20-subject">{msg.subject}</div>
                      {msg.action && <div className="true-20-action">🎯 {msg.action}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tiers feed lists */}
          <div className="tiers-container">
            {feed.map((tierData) => {
              if (tierData.messages.length === 0) return null;
              const header = getTierHeader(tierData.tier);
              
              return (
                <section key={tierData.tier} className="tier-section">
                  <h2 className="tier-title" style={{ color: header.color }}>
                    {header.label}
                  </h2>
                  <div className="tier-list">
                    {tierData.messages.map((msg) => {
                      const isExpanded = !!expandedMessages[msg.id];
                      const domStyle = getDomainStyle(msg.life_domain);
                      
                      return (
                        <div 
                          key={msg.id} 
                          className={`msg-card card ${isExpanded ? 'msg-card--expanded' : ''}`}
                          style={{ borderLeft: `3px solid ${domStyle.text}` }}
                        >
                          <div className="msg-card-header" onClick={() => toggleExpand(msg.id)}>
                            <div className="msg-card-top-row">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span className="msg-domain-badge" style={{ color: domStyle.text, backgroundColor: domStyle.bg, border: `1px solid ${domStyle.border}` }}>
                                  {msg.life_domain}
                                </span>
                                {msg.deadline && (
                                  <span className="msg-deadline-badge">📅 {msg.deadline}</span>
                                )}
                                {msg.action && (
                                  <span className="msg-action-badge">🎯 Action Item</span>
                                )}
                              </div>
                              <span className="msg-date">{formatDate(msg.received_at)}</span>
                            </div>
                            <div className="msg-sender">{msg.sender}</div>
                            <div className="msg-subject">{msg.subject}</div>
                            {msg.summary && (
                              <p className="msg-summary-preview">
                                {msg.summary.slice(0, 100)}{msg.summary.length > 100 ? '...' : ''}
                              </p>
                            )}
                            <div className="msg-collapse-indicator">
                              {isExpanded ? 'Collapse ▲' : 'Show Details ▼'}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="msg-card-body">
                              {msg.summary && (
                                <div className="msg-body-section">
                                  <div className="msg-section-title">Summary</div>
                                  <p className="msg-section-text">{msg.summary}</p>
                                </div>
                              )}
                              
                              {msg.action && (
                                <div className="msg-body-section">
                                  <div className="msg-section-title">Action Required</div>
                                  <p className="msg-section-text" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                                    {msg.action}
                                  </p>
                                </div>
                              )}

                              {msg.snippet && (
                                <div className="msg-body-section">
                                  <div className="msg-section-title">Email Excerpt</div>
                                  <p className="msg-snippet">{msg.snippet}</p>
                                </div>
                              )}

                              {msg.draft_reply && (
                                <div className="msg-body-section msg-draft-section">
                                  <div className="msg-draft-header">
                                    <div className="msg-section-title" style={{ margin: 0 }}>Suggested Auto-Draft Reply</div>
                                    <button 
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => handleCopy(msg.draft_reply, msg.id)}
                                      style={{ padding: '4px 8px', fontSize: '11px' }}
                                    >
                                      {copiedId === msg.id ? 'Copied ✔' : 'Copy Draft'}
                                    </button>
                                  </div>
                                  <p className="msg-draft-text">{msg.draft_reply}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          {/* Reference Senders Panel */}
          <section className="senders-section">
            <h2 className="section-title">Manage Reference Senders</h2>
            <div className="card text-secondary" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <p style={{ font: 'var(--font-caption)', margin: 0 }}>
                Emails matching these senders are pinned with personalized urgency labels and bypass generic classification models.
              </p>

              {/* Senders list */}
              {referenceSenders.length > 0 ? (
                <div className="senders-list">
                  {referenceSenders.map((sender) => (
                    <div key={sender.id} className="sender-chip">
                      <span className="sender-chip-label">{sender.label}</span>
                      <span className="sender-chip-email">{sender.email}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ font: 'var(--font-caption)', fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
                  No custom reference senders added yet.
                </div>
              )}

              {/* Add form */}
              <form onSubmit={handleAddSender} className="sender-add-form">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="input-group">
                    <input 
                      type="email"
                      placeholder="email@example.com"
                      value={newSenderEmail}
                      onChange={(e) => setNewSenderEmail(e.target.value)}
                      required
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div className="input-group">
                    <input 
                      type="text"
                      placeholder="Label (e.g. Thesis Advisor)"
                      value={newSenderLabel}
                      onChange={(e) => setNewSenderLabel(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-secondary btn-sm" disabled={addingSender} style={{ alignSelf: 'flex-start', marginTop: '12px' }}>
                  {addingSender ? 'Adding...' : 'Add Sender'}
                </button>
              </form>
              {senderMessage && (
                <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', margin: 0 }}>
                  {senderMessage}
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {/* Inline styles block */}
      <style>{`
        .mail-screen {
          padding: 0 0 80px;
          color: var(--text-primary);
          font-family: 'Inter', 'Outfit', system-ui, sans-serif;
        }

        .mail-header-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-large);
          padding-top: var(--space-medium);
        }

        .mail-kicker {
          font: var(--font-micro);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .mail-page-title {
          font: var(--font-h1);
          margin: 4px 0 0;
        }

        .mail-error-banner {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid var(--error);
          color: var(--error);
          border-radius: var(--radius-md);
          padding: var(--space-small);
          margin-bottom: var(--space-medium);
          font: var(--font-body);
        }

        /* ── Auth Card ── */
        .mail-auth-card {
          text-align: center;
          padding: var(--space-2xl);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          background: var(--surface);
          border: 1px dashed var(--border-soft);
        }
        .mail-auth-icon {
          font-size: 48px;
        }

        /* ── True 20 Strip ── */
        .true-20-container {
          margin-bottom: var(--space-large);
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.06), rgba(245, 158, 11, 0.06));
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: var(--radius-lg);
          padding: var(--space-medium);
        }
        .true-20-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-small);
          font-family: 'Outfit', sans-serif;
          font-weight: 700;
          font-size: 14px;
        }
        .true-20-badge {
          font-size: 11px;
          text-transform: uppercase;
          background: var(--error);
          color: #fff;
          padding: 2px 8px;
          border-radius: var(--radius-sm);
        }
        .true-20-scroll {
          display: flex;
          gap: var(--space-small);
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .true-20-card {
          flex: 0 0 280px;
          background: var(--surface-elevated);
          border: 1px solid var(--border-soft);
          padding: var(--space-small);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: transform 0.2s ease, border-color 0.2s ease;
        }
        .true-20-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent);
        }
        .true-20-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          margin-bottom: 6px;
        }
        .true-20-domain {
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        .true-20-date {
          color: var(--text-tertiary);
        }
        .true-20-sender {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .true-20-subject {
          font-size: 13px;
          font-weight: 700;
          margin: 4px 0;
          color: var(--text-primary);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .true-20-action {
          font-size: 12px;
          color: var(--accent);
          font-weight: 600;
          margin-top: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ── Tier Section ── */
        .tiers-container {
          display: flex;
          flex-direction: column;
          gap: var(--space-xl);
        }
        .tier-section {
          display: flex;
          flex-direction: column;
          gap: var(--space-small);
        }
        .tier-title {
          font-family: 'Outfit', sans-serif;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.03em;
          border-bottom: 1px solid var(--border-soft);
          padding-bottom: 8px;
          margin: 0;
        }
        .tier-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-small);
        }

        /* ── Message Card ── */
        .msg-card {
          background: var(--surface);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-md);
          overflow: hidden;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .msg-card:hover {
          border-color: rgba(255,255,255,0.15);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .msg-card-header {
          padding: var(--space-base);
          cursor: pointer;
        }
        .msg-card-top-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .msg-domain-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .msg-deadline-badge {
          font-size: 11px;
          background: rgba(239, 68, 68, 0.1);
          color: var(--error);
          border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        .msg-action-badge {
          font-size: 11px;
          background: rgba(96, 165, 250, 0.1);
          color: var(--accent);
          border: 1px solid rgba(96, 165, 250, 0.2);
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        .msg-date {
          font-size: 11px;
          color: var(--text-tertiary);
        }
        .msg-sender {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .msg-subject {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 4px 0 6px;
        }
        .msg-summary-preview {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0 0 8px;
          line-height: 1.4;
        }
        .msg-collapse-indicator {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-tertiary);
          text-align: right;
        }

        .msg-card-body {
          border-top: 1px solid var(--border-soft);
          background: var(--surface-elevated);
          padding: var(--space-base);
          display: flex;
          flex-direction: column;
          gap: var(--space-base);
        }
        .msg-body-section {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .msg-section-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
          font-weight: 700;
        }
        .msg-section-text {
          font-size: 13px;
          color: var(--text-primary);
          margin: 0;
          line-height: 1.45;
        }
        .msg-snippet {
          font-size: 13px;
          color: var(--text-secondary);
          background: rgba(0, 0, 0, 0.15);
          padding: 10px;
          border-radius: var(--radius-sm);
          font-family: monospace;
          white-space: pre-wrap;
          margin: 0;
        }

        /* ── Suggested Draft Reply ── */
        .msg-draft-section {
          border-left: 2px solid var(--accent);
          padding-left: 12px;
        }
        .msg-draft-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        .msg-draft-text {
          font-size: 13px;
          color: var(--text-primary);
          background: rgba(167, 139, 250, 0.04);
          border: 1px solid rgba(167, 139, 250, 0.15);
          padding: 12px;
          border-radius: var(--radius-sm);
          white-space: pre-wrap;
          line-height: 1.5;
          margin: 0;
        }

        /* ── Senders Section ── */
        .senders-section {
          margin-top: var(--space-2xl);
        }
        .senders-list {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-tight);
        }
        .sender-chip {
          display: flex;
          flex-direction: column;
          background: var(--surface-elevated);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-md);
          padding: 8px 12px;
          font-size: 12px;
        }
        .sender-chip-label {
          font-weight: 700;
          color: var(--text-primary);
        }
        .sender-chip-email {
          color: var(--text-tertiary);
          font-size: 11px;
        }
        .sender-add-form {
          border-top: 1px solid var(--border-soft);
          padding-top: 16px;
          display: flex;
          flex-direction: column;
        }

        /* Sync loader spinner */
        .sync-loader {
          border: 2px solid transparent;
          border-top: 2px solid currentColor;
          border-radius: 50%;
          width: 12px;
          height: 12px;
          animation: mail-spin 0.8s linear infinite;
        }
      `}</style>
    </div>
  );
}
