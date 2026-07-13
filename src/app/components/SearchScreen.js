'use client';
import { useState } from 'react';
import { SearchIcon, ArrowLeftIcon } from './Icons';
import ContentCard from './ContentCard';
import { saveItem, searchContent, trackInteraction } from '../lib/api';
import { useAuth } from './AuthProvider';
import { saveGuestItem } from '../lib/guestPersistence';

const FILTERS = ['All', 'Newest', 'Timeless', 'Rare', 'Deep'];

export default function SearchScreen({
  hiddenItemIds = [],
  onBack,
  onDismissItem,
  onNavigate,
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [searchUnavailable, setSearchUnavailable] = useState(false);

  const doSearch = async (q, filter) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    setStatusMessage('');

    try {
      const data = await searchContent(q, filter);
      if (data?.results) {
        setResults(data.results);
        setSearchUnavailable(false);
      } else {
        setResults([]);
        setSearchUnavailable(true);
        setStatusMessage('Search is unavailable right now.');
      }
    } catch {
      setResults([]);
      setSearchUnavailable(true);
      setStatusMessage('Search is unavailable right now.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (item) => {
    try {
      if (!user?.id) {
        saveGuestItem(item);
        setStatusMessage('Saved on this device only. Sign in to back it up.');
        return;
      }

      const payload = await saveItem(item.id);
      setStatusMessage(payload?.success ? 'Saved for later.' : 'Sign in to save items.');
    } catch {
      setStatusMessage('Could not save this item right now.');
    }
  };

  const handleDismiss = async (item) => {
    try {
      if (user?.id) {
        await trackInteraction(item.id, 'dismiss');
      }
    } catch {
      // Hide locally even if the interaction write fails.
    }
    onDismissItem?.(item);
    setResults((current) => current.filter((entry) => entry.id !== item.id));
    setStatusMessage('Result hidden from this search.');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    void doSearch(query, activeFilter);
  };

  const handleFilterChange = (f) => {
    setActiveFilter(f);
    if (query.trim()) {
      void doSearch(query, f);
    }
  };

  const searchState = searchUnavailable
    ? 'Partial / setup needed'
    : searched && results.length === 0
      ? 'No live data yet'
      : 'Live';
  const hiddenIdSet = new Set(hiddenItemIds);
  const visibleResults = results.filter((item) => !hiddenIdSet.has(item.id));

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0' }}>
      {/* Search Header */}
      <div className="container" style={{ marginBottom: 'var(--space-base)' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 'var(--space-tight)', alignItems: 'center' }}>
          <button type="button" className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
            <ArrowLeftIcon size={22} />
          </button>
          <div className="search-bar" style={{ flex: 1 }}>
            <SearchIcon size={20} className="search-icon" />
            <input
              type="text"
              placeholder="Search eXplore..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
        </form>
      </div>

      {/* Filter Chips */}
      <div className="container" style={{ marginBottom: 'var(--space-medium)' }}>
        <span
          className={`status-pill ${searchState === 'Live' ? 'is-live' : searchState === 'Partial / setup needed' ? 'is-partial' : 'is-empty'}`}
          style={{ marginBottom: 'var(--space-small)' }}
        >
          Search status: {searchState}
        </span>
        <div className="scroll-row" style={{ gap: 'var(--space-tight)' }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`chip ${activeFilter === f ? 'active' : ''}`}
              onClick={() => handleFilterChange(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="container">
        {searched && (
          <div style={{ marginBottom: 'var(--space-base)' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              {visibleResults.length} results for <strong>{query}</strong>
            </p>
            {statusMessage ? (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', marginTop: '6px' }}>
                {statusMessage}
              </p>
            ) : null}
          </div>
        )}

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
            {visibleResults.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                variant="featured"
                onSave={handleSave}
                onDismiss={handleDismiss}
                onClick={(item) => onNavigate?.('detail', item)}
              />
            ))}
          </div>
        )}

        {!loading && searched && visibleResults.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: 'var(--space-2xl) var(--space-base)',
            color: 'var(--text-tertiary)',
          }}>
            <p style={{ font: 'var(--font-h2)', marginBottom: 'var(--space-tight)' }}>
              {searchUnavailable ? 'Search unavailable' : results.length > 0 ? 'Everything here is hidden' : 'No results found'}
            </p>
            <p style={{ font: 'var(--font-body)' }}>
              {searchUnavailable
                ? 'Try again after the backend is reachable.'
                : results.length > 0
                  ? 'Refresh or search again to bring in a different set of results.'
                  : 'Try adjusting your search or filters.'}
            </p>
          </div>
        )}

        {!searched && (
          <div style={{
            textAlign: 'center',
            padding: 'var(--space-2xl) var(--space-base)',
            color: 'var(--text-tertiary)',
          }}>
            <SearchIcon size={48} className="search-icon" />
            <p style={{ font: 'var(--font-h2)', marginTop: 'var(--space-base)', marginBottom: 'var(--space-tight)' }}>
              Search for anything
            </p>
            <p style={{ font: 'var(--font-body)' }}>
              Try {'"Steve Jobs rare interviews"'} or {'"best explanation of attention mechanism"'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
