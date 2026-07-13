'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react';
import ContentCard from './ContentCard';
import { ArrowLeftIcon, FileTextIcon, SparklesIcon } from './Icons';
import { fetchWrittenNewsBrief, saveItem, trackInteraction } from '../lib/api';
import { useAuth } from './AuthProvider';
import { saveGuestItem } from '../lib/guestPersistence';
import { getSourceTrustBadge } from '../lib/sourceTrust';
import { promoteImageUrlQuality } from '../lib/imageQuality';

function BulletGroup({ title, items }) {
  if (!items?.length) {
    return null;
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
      <h2 style={{ font: 'var(--font-h3)' }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
        {items.map((item) => (
          <div key={item} style={{ display: 'flex', gap: 'var(--space-tight)', alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--accent)', marginTop: '2px' }}>-</span>
            <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>{item}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildWrittenBriefStatusMessage(data) {
  if (data?.details) {
    return data.details;
  }

  if (data?.coverage?.message) {
    return data.coverage.message;
  }

  return 'The written brief could not be loaded right now.';
}

function LeadVisualSummary({ item, trustBadge }) {
  if (!item) {
    return null;
  }

  const imageSrc = promoteImageUrlQuality(String(item.image || item.thumbnail || item.coverImage || '').trim());
  const visualTitle = item.title || 'Lead coverage';
  const visualCopy = item.summary || item.reason || 'Open the source detail for the full written context.';

  return (
    <section
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--surface)) 0%, var(--chrome-bg-strong) 60%)',
        borderColor: 'rgba(30, 90, 168, 0.14)',
      }}
    >
      <div style={{ padding: 'var(--space-base) var(--space-base) 0', display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', color: 'var(--text-secondary)' }}>
          <SparklesIcon size={16} />
          <span style={{ font: 'var(--font-caption)', fontWeight: 600 }}>
            Lead coverage
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
          {item.source ? (
            <span className="badge" style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}>
              Lead source: {item.source}
            </span>
          ) : null}
          {trustBadge ? (
            <span className="badge" style={trustBadge.style} title={trustBadge.title}>
              {trustBadge.label}
            </span>
          ) : null}
        </div>
      </div>

      {imageSrc ? (
        <div style={{ position: 'relative', marginTop: 'var(--space-base)' }}>
          <img
            src={imageSrc}
            alt={visualTitle || item.title || ''}
            className="card-thumbnail"
            loading="lazy"
            style={{ borderRadius: 0, border: 'none', display: 'block' }}
          />
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(2, 6, 23, 0.04) 0%, rgba(2, 6, 23, 0.56) 100%)',
          }} />
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: 'var(--space-base)',
            color: '#fff',
          }}>
            <span className="badge badge-accent" style={{ width: 'fit-content', marginBottom: '8px' }}>
              Lead image
            </span>
            <strong style={{ font: '700 30px/1.08 var(--font-family)', marginBottom: '8px' }}>
              {visualTitle}
            </strong>
            <p style={{ margin: 0, maxWidth: '760px', color: 'rgba(255,255,255,0.88)', font: 'var(--font-body)', lineHeight: 1.5 }}>
              {visualCopy}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ padding: 'var(--space-base)', display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
          <span className="badge" style={{ width: 'fit-content', background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}>
            No lead image available
          </span>
          <strong style={{ font: '700 28px/1.1 var(--font-family)', color: 'var(--text-primary)' }}>
            {visualTitle}
          </strong>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {visualCopy}
          </p>
        </div>
      )}
    </section>
  );
}

export default function WrittenNewsBriefScreen({
  hiddenItemIds = [],
  onBack,
  onDismissItem,
  onNavigate,
}) {
  const { user } = useAuth();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const loadBrief = useCallback(async (forceRefresh = false, cancelledRef = { current: false }) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setStatusMessage('');

    try {
      const data = await fetchWrittenNewsBrief(forceRefresh);
      if (cancelledRef.current) {
        return;
      }

      setPayload(data || null);
      setStatusMessage(data?.success ? '' : buildWrittenBriefStatusMessage(data));
    } catch {
      if (!cancelledRef.current) {
        setStatusMessage('Written brief could not load right now.');
      }
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const cancelledRef = { current: false };

    void loadBrief(false, cancelledRef);

    return () => {
      cancelledRef.current = true;
    };
  }, [loadBrief]);

  const handleSave = async (item) => {
    try {
      if (!user?.id) {
        saveGuestItem(item);
        setStatusMessage('Saved on this device only. Sign in to back it up.');
        return;
      }

      const result = await saveItem(item.id);
      setStatusMessage(result?.success ? 'Saved for later.' : 'Sign in to save items.');
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
      // Keep the brief responsive even if the interaction write fails.
    }
    onDismissItem?.(item);
    setPayload((current) => ({
      ...current,
      items: (current?.items || []).filter((entry) => entry.id !== item.id),
    }));
    setStatusMessage('Removed from the current brief view.');
  };

  const handleCardClick = (item) => {
    if (user?.id) {
      void trackInteraction(item.id, 'click').catch(() => {});
    }
    onNavigate?.('detail', item);
  };

  if (loading) {
    return (
      <div className="page-enter" style={{ padding: 'var(--space-base) 0' }}>
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
          <div className="skeleton" style={{ height: '180px' }} />
          <div className="skeleton" style={{ height: '140px' }} />
          <div className="skeleton" style={{ height: '240px' }} />
        </div>
      </div>
    );
  }

  const brief = payload?.brief || null;
  const sourceItems = payload?.items || [];
  const hiddenIdSet = new Set(hiddenItemIds);
  const items = sourceItems.filter((item) => !hiddenIdSet.has(item.id));
  const coverage = payload?.coverage || null;
  const leadItem = items[0] || sourceItems[0] || null;
  const leadTrustBadge = getSourceTrustBadge(leadItem);
  const allCurrentItemsHidden = sourceItems.length > 0 && items.length === 0;
  const briefState = statusMessage && !brief
    ? 'Partial / setup needed'
    : items.length
      ? 'Live'
      : allCurrentItemsHidden
        ? 'Hidden in this session'
        : 'No live data yet';

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0 var(--space-large)' }}>
      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-medium)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-small)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-small)' }}>
            <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
              <ArrowLeftIcon size={22} />
            </button>
            <div>
              <h1 style={{ font: 'var(--font-h1)', display: 'flex', alignItems: 'center', gap: 'var(--space-tight)' }}>
                <FileTextIcon size={22} />
                Written Brief
              </h1>
              <div style={{ marginTop: '6px' }}>
                <span
                  className={`status-pill ${briefState === 'Live' ? 'is-live' : briefState === 'Partial / setup needed' ? 'is-partial' : 'is-empty'}`}
                >
                  Written brief status: {briefState}
                </span>
              </div>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Live written coverage compressed into one usable brief.
              </p>
            </div>
          </div>

          <button className="btn btn-secondary" onClick={() => { void loadBrief(true); }} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <section
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-medium)',
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            borderColor: 'var(--border)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
            <span className="badge badge-accent">
              <SparklesIcon size={14} />
              Written Brief
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
              {leadItem?.source ? (
                <span className="badge" style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}>
                  Lead source: {leadItem.source}
                </span>
              ) : null}
              {leadTrustBadge ? (
                <span className="badge" style={leadTrustBadge.style} title={leadTrustBadge.title}>
                  {leadTrustBadge.label}
                </span>
              ) : null}
              <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                {payload?.article_count || items.length} written items considered
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            <h2 style={{ font: '700 28px/1.15 var(--font-family)' }}>
              {brief?.headline || 'No written brief is available yet.'}
            </h2>
            <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              {brief?.summary || (
                allCurrentItemsHidden
                  ? 'You hid every written item in this batch. Refresh to load a fresh set.'
                  : 'No live written coverage is available yet. Refresh once written sources are active.'
              )}
            </p>
            {leadTrustBadge ? (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                The current lead source is flagged as {leadTrustBadge.label.toLowerCase()}.
              </p>
            ) : null}
          </div>

          {brief?.themes?.length ? (
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              {brief.themes.map((theme) => (
                <span
                  key={theme}
                  className="badge"
                  style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
                >
                  {theme}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {statusMessage ? (
          <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>{statusMessage}</p>
        ) : null}

        <LeadVisualSummary item={leadItem} trustBadge={leadTrustBadge} />

        {coverage ? (
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
            Feed health: {coverage.reachable_feed_count || 0}/{coverage.feed_count || 0} written feeds reachable.
            {coverage.failure_count ? ` ${coverage.failure_count} feed checks failed on the last refresh.` : ''}
          </p>
        ) : null}

        {brief?.whyNow ? (
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
            <h2 style={{ font: 'var(--font-h3)' }}>Why now</h2>
            <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {brief.whyNow}
            </p>
          </section>
        ) : null}

        <BulletGroup title="Watch For" items={brief?.watchFor || []} />
        <BulletGroup title="Action Signals" items={brief?.actionSignals || []} />

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'baseline' }}>
            <h2 style={{ font: 'var(--font-h2)' }}>Source items</h2>
            {payload?.generated_at ? (
              <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                Generated {new Date(payload.generated_at).toLocaleString()}
              </span>
            ) : null}
          </div>

          {items.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
              {items.map((item) => (
                <ContentCard
                  key={item.id}
                  item={item}
                  variant="featured"
                  onSave={handleSave}
                  onDismiss={handleDismiss}
                  onClick={handleCardClick}
                />
              ))}
            </div>
          ) : (
            <div className="card" style={{ color: 'var(--text-secondary)' }}>
              {allCurrentItemsHidden
                ? 'You hid every written source item in this batch. Refresh to load a fresh set or wait for the next written update.'
                : coverage?.all_feeds_failed
                ? 'All configured written feeds failed on the last check, so there is no live written coverage to show yet.'
                : 'No live written articles are ready yet. Please check back later.'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
