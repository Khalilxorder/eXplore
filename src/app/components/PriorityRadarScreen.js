'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, BellIcon, ExternalLinkIcon } from './Icons';
import { fetchEventSourceMap, fetchNotificationPreferences, fetchPriorityRadarReferences } from '../lib/api';
import {
  fetchPriorityAlerts,
  getPriorityRadarDirectNewsReason,
  getPriorityRadarDirectNewsSources,
  getPriorityRadarReleaseWatchSummary,
  loadPriorityRadarSettings,
  PRIORITY_RADAR_REFERENCE_POINTS,
  PRIORITY_RADAR_EVENT,
} from '../lib/alertRadar';
import { openExternalUrl } from '../lib/external';
import { PRIORITY_RADAR_REFRESH_EVENT } from '../lib/priorityRadarRouting';
import { useAuth } from './AuthProvider';

function formatPublishedTime(value) {
  if (!value) {
    return 'Just now';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Just now';
  }

  const deltaMs = Date.now() - parsed.getTime();
  const deltaHours = Math.round(deltaMs / (1000 * 60 * 60));

  if (deltaHours <= 1) {
    return 'Within the last hour';
  }

  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  if (deltaDays <= 7) {
    return `${deltaDays}d ago`;
  }

  return parsed.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getSignalLabel(alert) {
  if (alert.category === 'geo') {
    return alert.threatLevel || 'Elevated';
  }

  return (alert.importance || 'important').toUpperCase();
}

function getSignalTone(alert) {
  if (alert.category === 'geo') {
    if (alert.threatLevel === 'Critical') {
      return '#dc2626';
    }

    if (alert.threatLevel === 'High') {
      return '#ea580c';
    }

    return 'var(--accent)';
  }

  return alert.importance === 'major' ? 'var(--accent)' : 'var(--text-tertiary)';
}

function describeRadarSource(value) {
  if (value === 'live') {
    return 'Fresh worker results';
  }

  if (value === 'stored') {
    return 'Cached fallback';
  }

  if (value === 'user-feed') {
    return 'Stored user feed';
  }

  return 'Unknown';
}

function buildEmptyMessage(settings) {
  if (settings.categories.ai && !settings.categories.geo) {
    return 'No qualifying AI radar alerts are live right now.';
  }

  if (!settings.categories.ai && settings.categories.geo) {
    return 'No qualifying Iran/Qatar radar alerts are live right now.';
  }

  return 'No qualifying radar alerts are cached right now.';
}

function filterAlertsBySettings(alerts, settings) {
  return (alerts || []).filter((alert) => {
    if (alert.category === 'ai') {
      return settings.categories.ai;
    }

    if (alert.category === 'geo') {
      return settings.categories.geo;
    }

    return false;
  });
}

function buildSourceMapSummary(sourceMap) {
  const lanes = Array.isArray(sourceMap?.lanes) ? sourceMap.lanes : [];
  return {
    laneCount: lanes.length,
    sourceCount: lanes.reduce((sum, lane) => sum + (Array.isArray(lane.sources) ? lane.sources.length : 0), 0),
    lanes: lanes.map((lane) => ({
      id: lane.id,
      label: lane.label,
      sourceCount: Array.isArray(lane.sources) ? lane.sources.length : 0,
      sources: Array.isArray(lane.sources) ? lane.sources : [],
    })),
  };
}

export default function PriorityRadarScreen({ onBack, onNavigate }) {
  const { user } = useAuth();
  const [radarSettings, setRadarSettings] = useState(() => loadPriorityRadarSettings());
  const aiAlertsEnabled = Boolean(radarSettings.categories.ai);
  const geoAlertsEnabled = Boolean(radarSettings.categories.geo);
  const radarEnabled = Boolean(radarSettings.enabled);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState([]);
  const [message, setMessage] = useState('');
  const [feedState, setFeedState] = useState('partial');
  const [checkedAt, setCheckedAt] = useState('');
  const [workerSource, setWorkerSource] = useState('unknown');
  const [phoneAlertStatus, setPhoneAlertStatus] = useState('Check Preferences');
  const [secondsSinceRefresh, setSecondsSinceRefresh] = useState(0);
  const [newAlertCount, setNewAlertCount] = useState(0);
  const [prevAlertIds, setPrevAlertIds] = useState(new Set());
  const [referencePoints, setReferencePoints] = useState(PRIORITY_RADAR_REFERENCE_POINTS);
  const [eventSourceMap, setEventSourceMap] = useState(null);
  const [directNotificationRules, setDirectNotificationRules] = useState([]);
  const tickerRef = useRef(null);
  const releaseWatchSummary = getPriorityRadarReleaseWatchSummary(radarSettings);
  const directNewsSources = getPriorityRadarDirectNewsSources(radarSettings);
  const directNewsReason = getPriorityRadarDirectNewsReason(radarSettings);
  const sourceMapSummary = buildSourceMapSummary(eventSourceMap);
  const directSourceMix = `${directNewsSources.length}/${referencePoints.length}`;
  const radarSettingsKey = JSON.stringify({
    ai: aiAlertsEnabled,
    geo: geoAlertsEnabled,
    enabled: radarSettings.releaseWatch?.enabled,
    companies: radarSettings.releaseWatch?.companies || {},
  });
  const description = aiAlertsEnabled && !geoAlertsEnabled
    ? `${releaseWatchSummary} are monitored.`
    : !aiAlertsEnabled && geoAlertsEnabled
      ? 'Elevated or higher Iran/Qatar risk changes are monitored.'
      : `${releaseWatchSummary} and elevated Iran/Qatar risk changes are monitored.`;

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setMessage('');

    try {
      const payload = await fetchPriorityAlerts(20);
      const visibleAlerts = filterAlertsBySettings(payload?.alerts || [], {
        categories: {
          ai: aiAlertsEnabled,
          geo: geoAlertsEnabled,
        },
      });
      if (user) {
        const prefs = await fetchNotificationPreferences().catch(() => null);
        if (prefs?.alerts_enabled) {
          if (prefs.push_enabled && prefs.push_registered) {
            setPhoneAlertStatus('On for this account');
          } else if (prefs.local_fallback_enabled && !prefs.push_enabled) {
            setPhoneAlertStatus('Fallback only');
          } else {
            setPhoneAlertStatus('Enabled, no registered phone yet');
          }
        } else {
          setPhoneAlertStatus('Off');
        }
      } else {
        setPhoneAlertStatus(radarEnabled ? 'Local device only' : 'Off on this device');
      }

      if (payload?.success) {
        // Detect new items that weren't in the previous load
        setPrevAlertIds((currentIds) => {
          if (currentIds.size > 0) {
            const freshCount = visibleAlerts.filter((a) => !currentIds.has(a.id)).length;
            if (freshCount > 0) setNewAlertCount(freshCount);
          }
          return new Set(visibleAlerts.map((a) => a.id));
        });
        setAlerts(visibleAlerts);
        setCheckedAt(payload.checkedAt || '');
        setWorkerSource(payload.source || 'live');
        setMessage(visibleAlerts.length ? '' : buildEmptyMessage({
          categories: {
            ai: aiAlertsEnabled,
            geo: geoAlertsEnabled,
          },
        }));
        setFeedState(
          visibleAlerts.length
            ? (payload.source === 'live' ? 'live' : 'partial')
            : 'empty'
        );
      } else {
        setAlerts([]);
        setMessage('Priority Radar could not load right now.');
        setFeedState('partial');
      }
    } catch {
      setAlerts([]);
      setMessage('Priority Radar could not load right now.');
      setFeedState('partial');
      setPhoneAlertStatus(user ? 'Check Preferences' : (radarEnabled ? 'Local device only' : 'Off on this device'));
    } finally {
      setLoading(false);
    }
  }, [aiAlertsEnabled, geoAlertsEnabled, user, radarEnabled]);

  // Live refresh every 60 s + seconds-since-refresh ticker
  useEffect(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = setInterval(() => {
      setSecondsSinceRefresh((s) => {
        if (s >= 59) {
          void loadFeed();
          return 0;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(tickerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarSettingsKey]);

  useEffect(() => {
    let cancelled = false;
    const loadInitialFeed = async () => {
      setLoading(true);
      try {
        const payload = await fetchPriorityAlerts(20);
        const visibleAlerts = filterAlertsBySettings(payload?.alerts || [], {
          categories: {
            ai: aiAlertsEnabled,
            geo: geoAlertsEnabled,
          },
        });
        if (cancelled) {
          return;
        }

        if (payload?.success) {
          if (user) {
            const prefs = await fetchNotificationPreferences().catch(() => null);
            if (prefs?.alerts_enabled) {
              if (prefs.push_enabled && prefs.push_registered) {
                setPhoneAlertStatus('On for this account');
              } else if (prefs.local_fallback_enabled && !prefs.push_enabled) {
                setPhoneAlertStatus('Fallback only');
              } else {
                setPhoneAlertStatus('Enabled, no registered phone yet');
              }
            } else {
              setPhoneAlertStatus('Off');
            }
          } else {
            setPhoneAlertStatus(radarEnabled ? 'Local device only' : 'Off on this device');
          }
          setAlerts(visibleAlerts);
          setCheckedAt(payload.checkedAt || '');
          setWorkerSource(payload.source || 'live');
          // Seed prevAlertIds on first load so subsequent refreshes can detect new items
          setPrevAlertIds(new Set(visibleAlerts.map((a) => a.id)));
          setMessage(visibleAlerts.length ? '' : buildEmptyMessage({
            categories: {
              ai: aiAlertsEnabled,
              geo: geoAlertsEnabled,
            },
          }));
          setFeedState(
            visibleAlerts.length
              ? (payload.source === 'live' ? 'live' : 'partial')
              : 'empty'
          );
        } else {
          setAlerts([]);
          setMessage('Priority Radar could not load right now.');
          setFeedState('partial');
        }
      } catch {
        if (!cancelled) {
          setAlerts([]);
          setMessage('Priority Radar could not load right now.');
          setFeedState('partial');
          setPhoneAlertStatus(user ? 'Check Preferences' : (radarEnabled ? 'Local device only' : 'Off on this device'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadInitialFeed();
    void fetchPriorityRadarReferences().then((payload) => {
      if (cancelled || !payload?.success) {
        return;
      }

      if (Array.isArray(payload.referencePoints) && payload.referencePoints.length) {
        setReferencePoints(payload.referencePoints);
      }

      if (Array.isArray(payload.directNotificationRules)) {
        setDirectNotificationRules(payload.directNotificationRules);
      }
    });
    void fetchEventSourceMap().then((payload) => {
      if (cancelled || !payload?.success || !payload?.sourceMap) {
        return;
      }

      setEventSourceMap(payload.sourceMap);
    }).catch(() => {});
    const handleSettingsChanged = () => {
      setRadarSettings(loadPriorityRadarSettings());
    };
    const handleForegroundPush = () => {
      void loadFeed();
    };
    window.addEventListener(PRIORITY_RADAR_EVENT, handleSettingsChanged);
    window.addEventListener(PRIORITY_RADAR_REFRESH_EVENT, handleForegroundPush);

    return () => {
      cancelled = true;
      window.removeEventListener(PRIORITY_RADAR_EVENT, handleSettingsChanged);
      window.removeEventListener(PRIORITY_RADAR_REFRESH_EVENT, handleForegroundPush);
    };
  }, [user, radarSettingsKey, aiAlertsEnabled, geoAlertsEnabled, radarEnabled, loadFeed]);

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0' }}>
      <div className="container page-shell">
        <div className="page-header">
          <div className="page-header-main">
            <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
              <ArrowLeftIcon size={22} />
            </button>
            <div className="page-header-copy">
              <span className="page-kicker">Live signal surface</span>
              <h1 style={{ font: 'var(--font-h1)' }}>Priority Radar</h1>
              <p className="page-subtitle">
                {description}
              </p>
            </div>
          </div>

          <button className="btn btn-secondary" onClick={() => { void loadFeed(); }}>
            Refresh
          </button>
        </div>

        <div className="card" style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-base)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)' }}>
            <BellIcon size={18} />
            <span className={`status-pill ${feedState === 'live' ? 'is-live' : feedState === 'empty' ? 'is-empty' : 'is-partial'}`}>
              {feedState === 'live' ? 'Live feed' : feedState === 'empty' ? 'No live data yet' : 'Cached or partial'}
            </span>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <p className="metric-label">Last updated</p>
              <p className="metric-value" style={{ fontSize: '16px' }}>{checkedAt ? formatPublishedTime(checkedAt) : 'Unknown'}</p>
            </div>
            <div className="metric-card" style={{ background: secondsSinceRefresh >= 50 ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : undefined }}>
              <p className="metric-label">Refreshing in</p>
              <p className="metric-value" style={{ fontSize: '16px', color: secondsSinceRefresh >= 50 ? 'var(--accent)' : undefined }}>
                {60 - secondsSinceRefresh}s
              </p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Feed source</p>
              <p className="metric-value" style={{ fontSize: '16px' }}>{describeRadarSource(workerSource)}</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Direct rules</p>
              <p className="metric-value" style={{ fontSize: '16px' }}>{directSourceMix}</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Phone alerts</p>
              <p className="metric-value" style={{ fontSize: '16px' }}>{phoneAlertStatus}</p>
            </div>
          </div>
        </div>


        <div className="subtle-panel" style={{ gap: 'var(--space-tight)' }}>
          <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Release watch
          </p>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)', fontWeight: 700 }}>
            {releaseWatchSummary}
          </p>
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
            Official vendor posts are prioritized first. Anthropic, OpenAI, Google, and xAI are monitored by default. Auto-refreshes every 60 seconds.
          </p>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
          <div>
            <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Reference points
            </p>
            <h2 style={{ font: 'var(--font-h3)', color: 'var(--text-primary)' }}>Always monitored</h2>
          </div>

          <div style={{ display: 'grid', gap: 'var(--space-tight)' }}>
            {referencePoints.map((reference) => (
              <div
                key={reference.id}
                className="subtle-panel"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--space-small)',
                  flexDirection: 'row',
                }}
              >
                <div>
                  <strong style={{ display: 'block', font: 'var(--font-body)', color: 'var(--text-primary)' }}>
                    {reference.publisher || reference.label}
                  </strong>
                  <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                    Official source
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-icon btn-ghost"
                  aria-label={`Open ${reference.publisher || reference.label}`}
                  onClick={() => { void openExternalUrl(reference.url); }}
                >
                  <ExternalLinkIcon size={17} />
                </button>
              </div>
            ))}
          </div>

          {sourceMapSummary.laneCount > 0 && (
            <div className="subtle-panel" style={{ gap: 'var(--space-tight)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'center' }}>
                <div>
                  <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Watched sources
                  </p>
                  <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>
                    {sourceMapSummary.sourceCount} references
                  </strong>
                </div>
                <span className="status-pill is-live">
                  {sourceMapSummary.laneCount} lanes
                </span>
              </div>

              <div
                aria-label="Event source map lanes"
                style={{
                  display: 'flex',
                  gap: 'var(--space-tight)',
                  overflowX: 'auto',
                  paddingBottom: '2px',
                  scrollSnapType: 'x proximity',
                }}
              >
                {sourceMapSummary.lanes.map((lane) => (
                  <div
                    key={lane.id}
                    style={{
                      minWidth: '210px',
                      maxWidth: '230px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-small)',
                      background: 'var(--surface-elevated)',
                      scrollSnapAlign: 'start',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-tight)', alignItems: 'center' }}>
                      <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                        {lane.label}
                      </strong>
                      <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>
                        {lane.sourceCount}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gap: '6px',
                        marginTop: 'var(--space-tight)',
                        maxHeight: '156px',
                        overflowY: 'auto',
                        paddingRight: '2px',
                      }}
                    >
                      {lane.sources.map((source) => (
                        source.url ? (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() => { void openExternalUrl(source.url); }}
                            style={{
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              textAlign: 'left',
                              color: 'var(--text-secondary)',
                              font: 'var(--font-caption)',
                              background: 'transparent',
                              border: 0,
                              padding: 0,
                              cursor: 'pointer',
                            }}
                          >
                            {source.label}
                          </button>
                        ) : (
                          <span
                            key={source.id}
                            style={{
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--text-secondary)',
                              font: 'var(--font-caption)',
                            }}
                          >
                            {source.label}
                          </span>
                        )
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="subtle-panel" style={{ gap: 'var(--space-tight)' }}>
            <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Direct notification
            </p>
            <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>
              Investable shares
            </strong>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              {directNewsReason}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
              {directNewsSources.map((source) => (
                <span key={`direct-news-${source.key}`} className="chip active">{source.label}</span>
              ))}
            </div>
            {directNotificationRules.length > 0 && (
              <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>
                {directNotificationRules.length} precise source rules active
              </span>
            )}
          </div>
        </div>

        {newAlertCount > 0 && (
          <div
            className="subtle-panel"
            style={{ background: 'color-mix(in srgb, var(--accent) 12%, var(--surface))', borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--border))', cursor: 'pointer', gap: 'var(--space-tight)' }}
            onClick={() => { setNewAlertCount(0); }}
          >
            <p style={{ font: 'var(--font-body)', color: 'var(--accent)', fontWeight: 700 }}>
              {newAlertCount} new {newAlertCount === 1 ? 'item' : 'items'} since last check
            </p>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Tap to dismiss</p>
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            {[1, 2, 3].map((item) => (
              <div key={item} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                <div className="skeleton" style={{ width: '110px', height: '18px' }} />
                <div className="skeleton" style={{ width: '85%', height: '22px' }} />
                <div className="skeleton" style={{ width: '100%', height: '16px' }} />
                <div className="skeleton" style={{ width: '75%', height: '16px' }} />
              </div>
            ))}
          </div>
        )}

        {!loading && Boolean(message) && (
          <div className="card" style={{ color: 'var(--text-secondary)' }}>
            {message}
          </div>
        )}

        {!loading && alerts.map((alert) => (
          <div
            key={alert.id}
            className="card"
            onClick={() => onNavigate?.('priority-radar-detail', alert)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 'var(--space-small)',
              textAlign: 'left',
              borderColor: alert.unread ? getSignalTone(alert) : 'var(--border)',
              borderLeft: `4px solid ${getSignalTone(alert)}`,
              boxShadow: alert.unread ? `0 0 0 1px ${getSignalTone(alert)}14` : 'none',
              cursor: 'pointer',
              background: 'var(--surface)',
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onNavigate?.('priority-radar-detail', alert);
              }
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '72px',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${getSignalTone(alert)}33`,
                  background: `${getSignalTone(alert)}18`,
                  color: getSignalTone(alert),
                  font: 'var(--font-micro)',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}>
                  {alert.category === 'geo' ? 'Geo' : 'AI'}
                </span>
                <span style={{ color: 'var(--text-secondary)', font: 'var(--font-caption)', fontWeight: 600 }}>
                  {getSignalLabel(alert)}
                </span>
                {alert.unread && (
                  <span className="status-pill is-partial">
                    Unread
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {alert.source || 'Unknown source'}
                </span>
                <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                  {formatPublishedTime(alert.publishedAt)}
                </span>
              </div>
            </div>

            <h2 style={{ font: 'var(--font-h2)', color: 'var(--text-primary)', lineHeight: 1.22, maxWidth: '42ch' }}>{alert.title}</h2>
            <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', maxWidth: '68ch' }}>{alert.summary}</p>
            <div className="subtle-panel" style={{ gap: 'var(--space-tight)' }}>
              <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Why it matters
              </span>
              <p style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>{alert.whyItMatters}</p>
            </div>
            {(alert.why_notified || alert.whyNotified) && (
              <div className="subtle-panel" style={{ gap: 'var(--space-tight)' }}>
                <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Why notified
                </span>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                  {alert.why_notified || alert.whyNotified}
                </p>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                {alert.source_type === 'official' ? 'Official source' : alert.source_type === 'press' ? 'Press source' : 'Source'}
              </span>

              {alert.url && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void openExternalUrl(alert.url);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: 'var(--accent)',
                    font: 'var(--font-caption)',
                    fontWeight: 600,
                    background: 'transparent',
                    border: 0,
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  Open source
                  <ExternalLinkIcon size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
