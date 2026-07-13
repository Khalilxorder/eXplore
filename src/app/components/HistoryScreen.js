'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import { clearHistory, fetchHistory, fetchSaved } from '../lib/api';
import { useAuth } from './AuthProvider';
import { clearGuestHistory, loadGuestHistory, loadGuestSavedItems } from '../lib/guestPersistence';

const HISTORY_TABS = ['Viewed', 'Saved', 'Dismissed'];

function toApiTab(tab) {
  return tab === 'Dismissed' ? 'dismissed' : 'viewed';
}

function formatTimestamp(value) {
  if (!value) {
    return 'Just now';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Just now';
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function describeHistoryItem(item, tab) {
  if (tab === 'Saved') {
    return item.savedAt ? `Saved ${formatTimestamp(item.savedAt)}` : 'Saved';
  }

  if (item.historyAction === 'dismiss') {
    return `Dismissed ${formatTimestamp(item.interactedAt)}`;
  }

  if (item.historyAction === 'open_source') {
    return `Opened source ${formatTimestamp(item.interactedAt)}`;
  }

  return `Viewed ${formatTimestamp(item.interactedAt)}`;
}

export default function HistoryScreen({ onBack }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('Viewed');
  const [historyItems, setHistoryItems] = useState([]);
  const [savedItems, setSavedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resetBusy, setResetBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!user) {
        if (!cancelled) {
          setHistoryItems(tab === 'Dismissed' ? loadGuestHistory('dismissed') : loadGuestHistory('viewed'));
          setSavedItems(loadGuestSavedItems());
          setStatusMessage('History is stored on this device until you sign in.');
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setStatusMessage('');

      try {
        if (tab === 'Saved') {
          const payload = await fetchSaved();
          if (!cancelled) {
            setSavedItems(Array.isArray(payload?.items) ? payload.items : []);
          }
        } else {
          const payload = await fetchHistory(toApiTab(tab));
          if (!cancelled) {
            setHistoryItems(Array.isArray(payload?.items) ? payload.items : []);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setStatusMessage('History could not be loaded right now.');
          if (tab === 'Saved') {
            setSavedItems([]);
          } else {
            setHistoryItems([]);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, user]);

  const visibleItems = useMemo(() => (
    tab === 'Saved' ? savedItems : historyItems
  ), [historyItems, savedItems, tab]);

  const secondaryMessage = tab === 'Saved'
    ? user
      ? 'Saved items stay separate from viewed and dismissed history.'
      : 'Saved items are being kept on this device only for now.'
    : user
      ? `Your ${tab.toLowerCase()} feed history now syncs from the live service.`
      : `Your ${tab.toLowerCase()} history is being kept on this device for now.`;

  const historyState = statusMessage
    ? 'Partial / setup needed'
    : visibleItems.length
      ? 'Live'
      : 'No live data yet';

  const handleReset = async () => {
    if (!user) {
      if (tab === 'Saved') {
        clearGuestHistory('all');
        setHistoryItems([]);
        setStatusMessage('Viewed and dismissed history cleared on this device. Saved items were kept.');
      } else {
        clearGuestHistory(toApiTab(tab));
        setHistoryItems(loadGuestHistory(toApiTab(tab)));
        setStatusMessage(`${tab} history cleared on this device.`);
      }
      return;
    }

    setResetBusy(true);
    try {
      const resetTab = tab === 'Saved' ? 'all' : toApiTab(tab);
      const payload = await clearHistory(resetTab);
      if (payload?.success) {
        if (tab !== 'Saved') {
          setHistoryItems([]);
        }
        setStatusMessage(
          tab === 'Saved'
            ? 'Viewed and dismissed history cleared. Saved items were kept.'
            : `${tab} history cleared.`
        );
      } else {
        setStatusMessage('History could not be cleared right now.');
      }
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0', width: '100%' }}>
      <div className="container" style={{ marginBottom: 'var(--space-medium)', display: 'flex', alignItems: 'center' }}>
        <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon size={22} />
        </button>
        <div style={{ marginLeft: 'var(--space-tight)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h1 style={{ font: 'var(--font-h2)' }}>History</h1>
          <span
            className={`status-pill ${historyState === 'Live' ? 'is-live' : historyState === 'Partial / setup needed' ? 'is-partial' : 'is-empty'}`}
          >
            History status: {historyState}
          </span>
        </div>
      </div>

      <div className="container">
        <div className="scroll-row" style={{ gap: 'var(--space-tight)', marginBottom: 'var(--space-large)' }}>
          {HISTORY_TABS.map((filter) => (
            <button
              key={filter}
              className={`chip ${tab === filter ? 'active' : ''}`}
              onClick={() => setTab(filter)}
            >
              {filter}
            </button>
          ))}
        </div>

        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-base)' }}>
          {secondaryMessage}
        </p>

        {statusMessage ? (
          <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', marginBottom: 'var(--space-medium)' }}>
            {statusMessage}
          </p>
        ) : null}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)', marginBottom: 'var(--space-2xl)' }}>
            {[1, 2, 3].map((n) => (
              <div key={n}>
                <div className="skeleton" style={{ width: '100%', height: '20px', marginBottom: '6px' }} />
                <div className="skeleton" style={{ width: '70%', height: '14px' }} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)', marginBottom: 'var(--space-2xl)' }}>
            {visibleItems.length > 0 ? (
              visibleItems.map((item) => (
                <div key={`${tab}-${item.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-base)', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', font: 'var(--font-body)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {item.title}
                    </span>
                    <span style={{ display: 'block', font: 'var(--font-caption)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {item.source || 'Unknown source'}
                    </span>
                  </div>
                  <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>
                    {describeHistoryItem(item, tab)}
                  </span>
                </div>
              ))
            ) : (
              <div className="card" style={{ color: 'var(--text-secondary)' }}>
                <strong style={{ display: 'block', marginBottom: 'var(--space-tight)' }}>
                  No {tab.toLowerCase()} history yet
                </strong>
                <span>{secondaryMessage}</span>
              </div>
            )}
          </div>
        )}

        <>
          <div className="divider" style={{ marginBottom: 'var(--space-base)' }} />
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', marginBottom: 'var(--space-tight)' }}>
            {user
              ? (tab === 'Saved'
                ? 'This clears viewed and dismissed history only. Saved items stay in Saved.'
                : `This clears your ${tab.toLowerCase()} history from the synced service.`)
              : (tab === 'Saved'
                ? 'This clears viewed and dismissed history on this device only. Saved items stay in Saved.'
                : `This clears your ${tab.toLowerCase()} history on this device only.`)}
          </p>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={resetBusy}
            onClick={() => { void handleReset(); }}
            style={{ width: '100%' }}
          >
            {resetBusy
              ? 'Clearing...'
              : tab === 'Saved'
                ? 'Clear viewed + dismissed history'
                : `Clear ${tab.toLowerCase()} history`}
          </button>
        </>
      </div>
    </div>
  );
}
