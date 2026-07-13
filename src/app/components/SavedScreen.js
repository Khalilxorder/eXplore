'use client';
// eXplore — SavedScreen.js

import { useEffect, useState } from 'react';
import { ArrowLeftIcon, BookmarkIcon } from './Icons';
import { useAuth } from './AuthProvider';
import ContentCard from './ContentCard';
import {
  createCollection,
  fetchCollections,
  fetchSaved,
  unsaveItem,
  updateSavedItem,
  resolveApiBase,
} from '../lib/api';
import { loadGuestSavedItems, removeGuestSavedItem } from '../lib/guestPersistence';

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'written', label: 'Written' },
  { id: 'video', label: 'Videos' },
  { id: 'photo', label: 'Photos' },
];

function matchesTypeFilter(item, filterId) {
  if (filterId === 'written') {
    return item.channelType === 'written';
  }

  if (filterId === 'video') {
    return item.channelType === 'socialVideo';
  }

  if (filterId === 'photo') {
    return item.channelType === 'socialPhoto';
  }

  return true;
}

function SavedJobCard({ job, onUnsave }) {
  if (!job) return null;
  return (
    <div className="saved-opp-card" style={{ borderLeft: '3px solid var(--success)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-small)' }}>
        <div style={{ flex: 1 }}>
          <div className="saved-opp-title">{job.title || 'Untitled Role'}</div>
          <div className="saved-opp-meta">
            {job.company && <span className="saved-opp-tag">{job.company}</span>}
            {job.location && <span className="saved-opp-tag">📍 {job.location}</span>}
            {job.type && <span className="saved-opp-tag">{job.type}</span>}
            {job.salary && <span className="saved-opp-tag salary">💰 {job.salary}</span>}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onUnsave}
          style={{ whiteSpace: 'nowrap' }}
        >
          Remove
        </button>
      </div>
      {job.description && (
        <p className="saved-opp-desc">{job.description.slice(0, 200)}{job.description.length > 200 ? '…' : ''}</p>
      )}
      {job.url && (
        <a href={job.url} target="_blank" rel="noopener noreferrer" className="saved-opp-btn">
          Apply →
        </a>
      )}
    </div>
  );
}

function SavedScholarshipCard({ s, onUnsave }) {
  if (!s) return null;
  const levels = Array.isArray(s.levels) ? s.levels.join(', ') : (s.levels || '');
  return (
    <div className="saved-opp-card" style={{ borderLeft: '3px solid var(--warning)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-small)' }}>
        <div style={{ flex: 1 }}>
          <div className="saved-opp-title">{s.title || 'Unnamed Scholarship'}</div>
          <div className="saved-opp-meta">
            {s.host_organization && <span className="saved-opp-tag">{s.host_organization}</span>}
            {levels && <span className="saved-opp-tag">{levels}</span>}
            {s.country && <span className="saved-opp-tag">🌍 {s.country}</span>}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onUnsave}
          style={{ whiteSpace: 'nowrap' }}
        >
          Remove
        </button>
      </div>
      {s.description && (
        <p className="saved-opp-desc">{s.description.slice(0, 200)}{s.description.length > 200 ? '…' : ''}</p>
      )}
      {s.url && (
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="saved-opp-btn">
          View Scholarship →
        </a>
      )}
    </div>
  );
}

export default function SavedScreen({ hiddenItemIds = [], onBack, onNavigate }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [subTab, setSubTab] = useState('articles'); // 'articles', 'jobs', 'scholarships'
  const [savedOpportunities, setSavedOpportunities] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCompactScreen, setIsCompactScreen] = useState(false);
  const [activeTypeFilter, setActiveTypeFilter] = useState('all');
  const [activeCollectionFilter, setActiveCollectionFilter] = useState('all');
  const [statusMessage, setStatusMessage] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDescription, setNewCollectionDescription] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);

  useEffect(() => {
    const updateCompact = () => {
      setIsCompactScreen(window.innerWidth <= 720);
    };

    updateCompact();
    window.addEventListener('resize', updateCompact);
    return () => window.removeEventListener('resize', updateCompact);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      try {
        const oppRes = await fetch(`${resolveApiBase()}/api/v1/opportunities/saved`);
        if (oppRes.ok && !cancelled) {
          const oppData = await oppRes.json();
          if (oppData.success && Array.isArray(oppData.items)) {
            setSavedOpportunities(oppData.items);
          }
        }
      } catch (err) {
        console.error('Failed to load saved opportunities:', err);
      }

      if (!user) {
        if (!cancelled) {
          setItems(loadGuestSavedItems());
          setCollections([]);
          setActiveCollectionFilter('all');
          setLoadFailed(false);
          setStatusMessage('');
          setLoading(false);
        }
        return;
      }

      const [savedData, collectionsData] = await Promise.all([
        fetchSaved(),
        fetchCollections(),
      ]);

      if (cancelled) {
        return;
      }

      if (savedData && Array.isArray(savedData.items)) {
        setItems(savedData.items);
        setLoadFailed(false);
      } else {
        setItems([]);
        setLoadFailed(true);
        setStatusMessage('Saved items could not be loaded right now.');
      }

      setCollections(collectionsData?.collections || []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleRemoveOpportunity = async (oppId, oppType) => {
    setBusyKey(`remove-opp-${oppId}`);
    try {
      const res = await fetch(`${resolveApiBase()}/api/v1/opportunities/unsave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opportunity_id: oppId,
          opportunity_type: oppType,
        }),
      });
      if (res.ok) {
        setSavedOpportunities((prev) =>
          prev.filter((item) => !(item.opportunity_id === oppId && item.opportunity_type === oppType))
        );
        setStatusMessage('Removed from saved.');
      } else {
        setStatusMessage('Could not unsave opportunity.');
      }
    } catch (err) {
      console.error(err);
      setStatusMessage('Error unsaving opportunity.');
    } finally {
      setBusyKey('');
    }
  };

  const unsortedCount = items.filter((item) => !item.collection?.id).length;
  const hiddenIdSet = new Set(hiddenItemIds);
  const visibleItems = items.filter((item) => {
    if (hiddenIdSet.has(item.id)) {
      return false;
    }

    const matchesCollection = activeCollectionFilter === 'all'
      ? true
      : activeCollectionFilter === 'unsorted'
        ? !item.collection?.id
        : item.collection?.id === activeCollectionFilter;

    return matchesCollection && matchesTypeFilter(item, activeTypeFilter);
  });

  const handleCreateCollection = async (event) => {
    event.preventDefault();

    const name = newCollectionName.trim();
    if (!name) {
      setStatusMessage('Name the collection first.');
      return;
    }

    setCreatingCollection(true);
    setStatusMessage('');

    const payload = await createCollection(name, newCollectionDescription.trim());
    if (payload?.collection) {
      setCollections((current) => [payload.collection, ...current]);
      setNewCollectionName('');
      setNewCollectionDescription('');
      setStatusMessage(`Collection created: ${payload.collection.name}.`);
    } else {
      setStatusMessage('Collection could not be created right now.');
    }

    setCreatingCollection(false);
  };

  const handleCollectionChange = async (itemId, nextCollectionId) => {
    setBusyKey(`collection-${itemId}`);
    setStatusMessage('');

    const payload = await updateSavedItem(itemId, {
      collection_id: nextCollectionId || null,
    });

    if (payload?.saved_item) {
      setItems((current) => current.map((item) => (
        item.id === itemId ? payload.saved_item : item
      )));
      setStatusMessage(nextCollectionId ? 'Saved item organized.' : 'Saved item moved back to unsorted.');
    } else {
      setStatusMessage('That saved item could not be updated right now.');
    }

    setBusyKey('');
  };

  const handleRemove = async (itemId) => {
    setBusyKey(`remove-${itemId}`);
    setStatusMessage('');

    if (!user) {
      removeGuestSavedItem(itemId);
      setItems((current) => current.filter((item) => item.id !== itemId));
      setStatusMessage('Removed from this device.');
      setBusyKey('');
      return;
    }

    const payload = await unsaveItem(itemId);
    if (payload?.success) {
      setItems((current) => current.filter((item) => item.id !== itemId));
      setStatusMessage('Removed from saved.');
    } else {
      setStatusMessage('That item could not be removed right now.');
    }

    setBusyKey('');
  };

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0' }}>
      <div className="container">
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-small)',
          marginBottom: isCompactScreen ? 'var(--space-small)' : 'var(--space-medium)',
        }}>
          <button type="button" className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
            <ArrowLeftIcon size={22} />
          </button>
          <div>
            <h1 style={{ font: 'var(--font-h1)', display: 'flex', alignItems: 'center', gap: 'var(--space-tight)' }}>
              <BookmarkIcon size={24} filled /> Saved
            </h1>
          </div>
        </div>

        {/* Sub-tab Switcher: Articles, Jobs, Scholarships */}
        <div className="saved-subtab-row">
          <button
            type="button"
            className={`saved-subtab ${subTab === 'articles' ? 'saved-subtab--active' : ''}`}
            onClick={() => setSubTab('articles')}
          >
            Articles & Videos ({items.length})
          </button>
          <button
            type="button"
            className={`saved-subtab ${subTab === 'jobs' ? 'saved-subtab--active' : ''}`}
            onClick={() => setSubTab('jobs')}
          >
            Jobs ({savedOpportunities.filter(o => o.opportunity_type === 'job').length})
          </button>
          <button
            type="button"
            className={`saved-subtab ${subTab === 'scholarships' ? 'saved-subtab--active' : ''}`}
            onClick={() => setSubTab('scholarships')}
          >
            Scholarships ({savedOpportunities.filter(o => o.opportunity_type === 'scholarship').length})
          </button>
        </div>

        {subTab === 'articles' && (
          <>

        <section
          className="card"
          style={{
            marginBottom: 'var(--space-medium)',
            display: 'flex',
            flexDirection: 'column',
            gap: isCompactScreen ? 'var(--space-tight)' : 'var(--space-small)',
            padding: isCompactScreen ? 'var(--space-small)' : undefined,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ font: 'var(--font-h3)' }}>Collections</h2>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="badge badge-accent">{items.length} saved</span>
              <span className="badge badge-premium">{collections.length} collections</span>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('collections')}
                  style={{ font: 'var(--font-caption)', fontWeight: 600, color: 'var(--accent)', background: 'none', padding: '2px 0' }}
                >
                  Manage all →
                </button>
              )}
            </div>
          </div>

          {!user ? null : (
            <form onSubmit={handleCreateCollection} style={{ display: 'flex', flexDirection: 'column', gap: isCompactScreen ? 'var(--space-tight)' : 'var(--space-small)' }}>
              <div style={{ display: 'grid', gap: isCompactScreen ? 'var(--space-tight)' : 'var(--space-small)' }}>
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(event) => setNewCollectionName(event.target.value)}
                  placeholder="New collection name"
                  style={{
                    minHeight: '44px',
                    border: '1px solid var(--border)',
                    padding: '0 var(--space-small)',
                    background: 'var(--surface)',
                    color: 'var(--text-primary)',
                  }}
                />
                <input
                  type="text"
                  value={newCollectionDescription}
                  onChange={(event) => setNewCollectionDescription(event.target.value)}
                  placeholder="Short description (optional)"
                  style={{
                    minHeight: '44px',
                    border: '1px solid var(--border)',
                    padding: '0 var(--space-small)',
                    background: 'var(--surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="btn btn-primary" disabled={creatingCollection}>
                  {creatingCollection ? 'Creating...' : 'Create collection'}
                </button>
              </div>
            </form>
          )}
        </section>

        {user && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-tight)',
            marginBottom: 'var(--space-small)',
            flexWrap: isCompactScreen ? 'nowrap' : 'wrap',
            overflowX: isCompactScreen ? 'auto' : 'visible',
            WebkitOverflowScrolling: 'touch',
            paddingBottom: isCompactScreen ? 'var(--space-micro)' : 0,
          }}
        >
          <button
            className={`chip ${activeCollectionFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveCollectionFilter('all')}
          >
            All ({items.length})
          </button>
          <button
            className={`chip ${activeCollectionFilter === 'unsorted' ? 'active' : ''}`}
            onClick={() => setActiveCollectionFilter('unsorted')}
          >
            Unsorted ({unsortedCount})
          </button>
          {collections.map((collection) => {
            const count = items.filter((item) => item.collection?.id === collection.id).length;

            return (
              <button
                key={collection.id}
                className={`chip ${activeCollectionFilter === collection.id ? 'active' : ''}`}
                onClick={() => setActiveCollectionFilter(collection.id)}
              >
                {collection.name} ({count})
              </button>
            );
          })}
        </div>
        )}

        {items.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-tight)',
            marginBottom: 'var(--space-medium)',
            flexWrap: isCompactScreen ? 'nowrap' : 'wrap',
            overflowX: isCompactScreen ? 'auto' : 'visible',
            WebkitOverflowScrolling: 'touch',
            paddingBottom: isCompactScreen ? 'var(--space-micro)' : 0,
          }}
        >
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.id}
              className={`chip ${activeTypeFilter === filter.id ? 'active' : ''}`}
              onClick={() => setActiveTypeFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        )}

        {statusMessage ? (
          <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', marginBottom: 'var(--space-medium)' }}>
            {statusMessage}
          </p>
        ) : null}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            {[1, 2, 3].map((n) => (
              <div key={n}>
                <div className="skeleton" style={{ width: '100%', height: '180px', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-small)' }} />
                <div className="skeleton" style={{ width: '80%', height: '18px', marginBottom: '6px' }} />
                <div className="skeleton" style={{ width: '50%', height: '14px' }} />
              </div>
            ))}
          </div>
        )}

        {!loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            {visibleItems.map((item) => {
              const selectBusy = busyKey === `collection-${item.id}`;
              const removeBusy = busyKey === `remove-${item.id}`;

              return (
                <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: isCompactScreen ? 'var(--space-micro)' : 'var(--space-tight)' }}>
                  <ContentCard
                    item={item}
                    variant={isCompactScreen ? 'compact' : 'featured'}
                    onClick={(selectedItem) => onNavigate?.('detail', selectedItem)}
                  />

                  <div
                    className="card"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 'var(--space-small)',
                      flexWrap: 'wrap',
                      alignItems: 'flex-end',
                      padding: isCompactScreen ? 'var(--space-small)' : undefined,
                    }}
                  >
                    {user ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 240px' }}>
                        <span style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          Collection
                        </span>
                        <select
                          value={item.collection?.id || ''}
                          onChange={(event) => { void handleCollectionChange(item.id, event.target.value); }}
                          disabled={selectBusy}
                          style={{
                            minHeight: '44px',
                            border: '1px solid var(--border)',
                            padding: '0 var(--space-small)',
                            background: 'var(--surface)',
                            color: 'var(--text-primary)',
                            font: 'var(--font-body)',
                          }}
                        >
                          <option value="">Unsorted</option>
                          {collections.map((collection) => (
                            <option key={collection.id} value={collection.id}>
                              {collection.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 240px' }}>
                        <span style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          Storage
                        </span>
                        <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                          Saved on this device only until you sign in.
                        </p>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 'var(--space-tight)', alignItems: 'center', flexWrap: 'wrap' }}>
                      {user ? (
                        <span
                          className="badge"
                          style={item.collection
                            ? { color: 'var(--accent)', background: 'var(--accent-light)' }
                            : { color: 'var(--text-secondary)', background: 'var(--surface-elevated)' }}
                        >
                          {item.collection?.name || 'Unsorted'}
                        </span>
                      ) : (
                        <span className="badge" style={{ color: 'var(--text-secondary)', background: 'var(--surface-elevated)' }}>
                          Device only
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => { void handleRemove(item.id); }}
                        disabled={removeBusy}
                      >
                        {removeBusy ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: 'var(--space-2xl)',
            color: 'var(--text-tertiary)',
          }}>
            <BookmarkIcon size={48} />
            <p style={{ font: 'var(--font-h2)', marginTop: 'var(--space-base)' }}>
              {loadFailed ? 'Saved items unavailable' : 'Nothing saved yet'}
            </p>
            <p style={{ font: 'var(--font-body)' }}>
              {loadFailed
                ? 'Reconnect the live service or sign in again to load your real saved items.'
                : 'Tap the bookmark icon on any result to save it.'}
            </p>
          </div>
        )}

        {!loading && items.length > 0 && visibleItems.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: 'var(--space-2xl)',
            color: 'var(--text-tertiary)',
          }}>
            <p style={{ font: 'var(--font-h2)', marginBottom: 'var(--space-tight)' }}>No saved items match this view</p>
            <p style={{ font: 'var(--font-body)' }}>
              Try another collection or content filter, or refresh after you bring hidden items back in a new session.
            </p>
          </div>
        )}
      </>
    )}

        {subTab === 'jobs' && (
          <div>
            {statusMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', marginBottom: 'var(--space-medium)' }}>
                {statusMessage}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
              {savedOpportunities.filter(o => o.opportunity_type === 'job').map((o) => (
                <SavedJobCard
                  key={o.opportunity_id}
                  job={o.details}
                  onUnsave={() => handleRemoveOpportunity(o.opportunity_id, 'job')}
                />
              ))}
              {savedOpportunities.filter(o => o.opportunity_type === 'job').length === 0 && (
                <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
                  <p style={{ font: 'var(--font-h2)', marginBottom: 'var(--space-tight)' }}>No saved jobs</p>
                  <p style={{ font: 'var(--font-body)' }}>Browse matched jobs in the Opportunities screen and bookmark them to keep track.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {subTab === 'scholarships' && (
          <div>
            {statusMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', marginBottom: 'var(--space-medium)' }}>
                {statusMessage}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
              {savedOpportunities.filter(o => o.opportunity_type === 'scholarship').map((o) => (
                <SavedScholarshipCard
                  key={o.opportunity_id}
                  s={o.details}
                  onUnsave={() => handleRemoveOpportunity(o.opportunity_id, 'scholarship')}
                />
              ))}
              {savedOpportunities.filter(o => o.opportunity_type === 'scholarship').length === 0 && (
                <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
                  <p style={{ font: 'var(--font-h2)', marginBottom: 'var(--space-tight)' }}>No saved scholarships</p>
                  <p style={{ font: 'var(--font-body)' }}>Search and filter scholarships in the Opportunities screen and bookmark them to keep track.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        /* ── Sub-tabs ── */
        .saved-subtab-row {
          display: flex;
          gap: var(--space-tight);
          margin-bottom: var(--space-medium);
          border-bottom: 1px solid var(--border-soft);
          padding-bottom: 8px;
          flex-wrap: wrap;
        }
        .saved-subtab {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font: var(--font-body);
          font-weight: 600;
          padding: 8px 16px;
          cursor: pointer;
          position: relative;
          transition: color var(--duration-normal) var(--ease-out);
        }
        .saved-subtab::after {
          content: '';
          position: absolute;
          left: 16px;
          right: 16px;
          bottom: -9px;
          height: 2px;
          background: var(--accent);
          transform: scaleX(0);
          transition: transform var(--duration-normal) var(--ease-spring);
        }
        .saved-subtab:hover {
          color: var(--text-primary);
        }
        .saved-subtab--active {
          color: var(--accent);
        }
        .saved-subtab--active::after {
          transform: scaleX(1);
        }

        /* ── Cards ── */
        .saved-opp-card {
          background: var(--surface);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius-md);
          padding: var(--space-base);
          margin-bottom: var(--space-small);
          transition: all var(--duration-normal) var(--ease-out);
        }
        .saved-opp-card:hover {
          border-color: var(--border-strong);
        }
        .saved-opp-title {
          font: var(--font-h3);
          color: var(--text-primary);
          margin-bottom: 6px;
        }
        .saved-opp-meta {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }
        .saved-opp-tag {
          font-size: 11px;
          color: var(--text-secondary);
          background: var(--surface-muted);
          border-radius: 4px;
          padding: 2px 7px;
        }
        .saved-opp-tag.salary {
          color: var(--success);
          background: var(--success-light);
        }
        .saved-opp-desc {
          font-size: 12.5px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin: 8px 0;
        }
        .saved-opp-btn {
          display: inline-block;
          font-size: 12px;
          font-weight: 600;
          color: var(--accent);
          text-decoration: none;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 5px 12px;
          transition: all var(--duration-fast) var(--ease-out);
        }
        .saved-opp-btn:hover {
          background: var(--surface-muted);
          border-color: var(--accent);
        }
      ` }} />
    </div>
  );
}
