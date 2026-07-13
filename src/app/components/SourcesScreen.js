'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon } from './Icons';
import { useAuth } from './AuthProvider';
import {
  addTopicMonitor,
  addTrackedChannel,
  fetchDiscoverySourceHealth,
  fetchDiscoveryStatus,
  fetchSourcesStatus,
  fetchTopicMonitors,
  fetchTrackedChannels,
  importInstagramUrl,
  importPodcastFeed,
  importRedditSource,
  refreshDiscovery,
  importXSource,
  importYouTubeUrl,
  updateTopicMonitor,
  updateTrackedChannel,
  fetchMonitoredSites,
  addMonitoredSite,
  deleteMonitoredSite,
  checkAllMonitoredSites,
  seedSpiderWebSites,
  fetchSourcePacks,
  addSourcePack,
  updateSourcePack,
} from '../lib/api';

function getBadgeStyle(source) {
  if (source.readiness === 'live' || source.status === 'configured') {
    return {
      label: 'Ready',
      color: 'var(--success)',
      background: 'var(--success-light)',
    };
  }

  if (source.readiness === 'partial' || source.status === 'partial') {
    return {
      label: 'Partial',
      color: 'var(--warning)',
      background: 'var(--warning-light)',
    };
  }

  return {
    label: 'Unavailable',
    color: 'var(--error)',
    background: 'var(--error-light)',
  };
}

function renderImportMessage(message) {
  if (!message) {
    return null;
  }

  return (
    <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
      {message}
    </p>
  );
}

export default function SourcesScreen({ onBack }) {
  const { user } = useAuth();
  const [sources, setSources] = useState([]);
  const [discoveryStatus, setDiscoveryStatus] = useState(null);
  const [trackedChannels, setTrackedChannels] = useState([]);
  const [topicMonitors, setTopicMonitors] = useState([]);
  const [sourceHealth, setSourceHealth] = useState([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [summary, setSummary] = useState({
    total: 0,
    configured: 0,
    partial: 0,
    planned_ready: 0,
  });
  const [statusMessage, setStatusMessage] = useState('');
  const [statusTone, setStatusTone] = useState('muted');
  const [statusBusy, setStatusBusy] = useState(false);
  const [channelQuery, setChannelQuery] = useState('');
  const [topicQuery, setTopicQuery] = useState('');
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState('');
  const [youtubeUrl, setYouTubeUrl] = useState('');
  const [youtubeMessage, setYouTubeMessage] = useState('');
  const [youtubeBusy, setYouTubeBusy] = useState(false);
  const [instagramUrl, setInstagramUrl] = useState('');
  const [instagramMessage, setInstagramMessage] = useState('');
  const [instagramBusy, setInstagramBusy] = useState(false);
  const [podcastUrl, setPodcastUrl] = useState('');
  const [podcastMessage, setPodcastMessage] = useState('');
  const [podcastBusy, setPodcastBusy] = useState(false);
  const [redditSource, setRedditSource] = useState('');
  const [redditMessage, setRedditMessage] = useState('');
  const [redditBusy, setRedditBusy] = useState(false);
  const [xSource, setXSource] = useState('');
  const [xMessage, setXMessage] = useState('');
  const [xBusy, setXBusy] = useState(false);

  // Monitored Sites states (Module C)
  const [monitoredSites, setMonitoredSites] = useState([]);
  const [siteFindings, setSiteFindings] = useState([]);
  const [siteUrlInput, setSiteUrlInput] = useState('');
  const [siteLabelInput, setSiteLabelInput] = useState('');
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteMessage, setSiteMessage] = useState('');
  const [checkingSites, setCheckingSites] = useState(false);
  const [siteSubTab, setSiteSubTab] = useState('standard');

  // Source Packs states
  const [sourcePacks, setSourcePacks] = useState([]);
  const [sourcePackTopic, setSourcePackTopic] = useState('');
  const [sourcePackBusy, setSourcePackBusy] = useState(false);
  const [sourcePackMessage, setSourcePackMessage] = useState('');

  const loadSourcesRef = useRef(null);
  const discoveryErrorCount = sourceHealth.filter((source) => Boolean(source.last_error)).length;
  const discoveryStatusLabel = !user
    ? 'Sign in required'
    : discoveryStatus?.candidate_count
      ? 'Live'
      : (trackedChannels.length || topicMonitors.length || sourcePacks.length)
        ? 'Partial / setup needed'
        : 'No live data yet';

  const loadSources = async (options = {}) => {
    const { silent = false } = options;
    if (!silent) {
      setStatusBusy(true);
      setStatusMessage('');
    }
    if (!silent || !sources.length) {
      setLoadingSources(true);
    }

    try {
      const [data, discovery, channelsPayload, monitorsPayload, healthPayload, sitesPayload, sourcePacksPayload] = await Promise.all([
        fetchSourcesStatus(),
        user ? fetchDiscoveryStatus() : Promise.resolve(null),
        user ? fetchTrackedChannels() : Promise.resolve(null),
        user ? fetchTopicMonitors() : Promise.resolve(null),
        user ? fetchDiscoverySourceHealth() : Promise.resolve(null),
        user ? fetchMonitoredSites() : Promise.resolve(null),
        user ? fetchSourcePacks() : Promise.resolve(null),
      ]);
      if (data?.sources?.length) {
        setSources(data.sources);
        setSummary(
          data.summary || {
            total: data.sources.length,
            configured: 0,
            partial: 0,
            planned_ready: 0,
          },
        );
        if (!silent) {
          setStatusTone('success');
          setStatusMessage('Source status is live.');
        }
      } else {
        setSources([]);
        if (!silent) {
          setStatusTone('error');
          setStatusMessage('Could not load live source status right now.');
        }
      }

      if (discovery) {
        setDiscoveryStatus(discovery);
      } else {
        setDiscoveryStatus(null);
        setTrackedChannels([]);
        setTopicMonitors([]);
        setSourceHealth([]);
        setMonitoredSites([]);
        setSiteFindings([]);
        setSourcePacks([]);
      }

      if (channelsPayload?.channels) {
        setTrackedChannels(channelsPayload.channels);
      }

      if (monitorsPayload?.monitors || monitorsPayload?.queries) {
        setTopicMonitors(monitorsPayload.monitors || monitorsPayload.queries || []);
      }

      if (healthPayload?.sources) {
        setSourceHealth(healthPayload.sources);
      }

      if (sitesPayload?.success) {
        setMonitoredSites(sitesPayload.sites || []);
        setSiteFindings(sitesPayload.findings || []);
      }

      if (sourcePacksPayload?.packs) {
        setSourcePacks(sourcePacksPayload.packs);
      } else {
        setSourcePacks([]);
      }

      if (!discovery && !silent) {
        setDiscoveryMessage(user
          ? 'Best Feed discovery details are unavailable right now.'
          : 'Sign in to manage tracked channels, topic monitors, and Best Feed source health.');
      }
    } catch (error) {
      if (!silent) {
        setStatusTone('error');
        setStatusMessage('Could not load live source status right now.');
      }
    } finally {
      setLoadingSources(false);
      if (!silent) {
        setStatusBusy(false);
      }
    }
  };

  const handleAddMonitoredSite = async () => {
    if (!siteUrlInput.trim()) {
      setSiteMessage('Paste a website URL first.');
      return;
    }
    const isSpiderWeb = siteSubTab === 'spiderweb';
    setSiteBusy(true);
    setSiteMessage('');
    try {
      const result = await addMonitoredSite(siteUrlInput.trim(), siteLabelInput.trim(), { isSpiderWeb });
      if (result?.success) {
        setSiteUrlInput('');
        setSiteLabelInput('');
        setSiteMessage(isSpiderWeb ? 'SPIDER NET URL saved.' : 'Standard monitored website saved.');
        await loadSources({ silent: true });
      } else {
        setSiteMessage(result?.error || 'Could not save monitored website.');
      }
    } catch (err) {
      setSiteMessage(err.message || 'Error saving monitored website.');
    } finally {
      setSiteBusy(false);
    }
  };

  const handleDeleteMonitoredSite = async (id) => {
    setSiteBusy(true);
    setSiteMessage('');
    try {
      const result = await deleteMonitoredSite(id);
      if (result?.success) {
        setSiteMessage('Monitored website removed.');
        await loadSources({ silent: true });
      } else {
        setSiteMessage(result?.error || 'Could not remove monitored website.');
      }
    } catch (err) {
      setSiteMessage(err.message || 'Error removing monitored website.');
    } finally {
      setSiteBusy(false);
    }
  };

  const handleCheckAllSites = async (siteType = 'all') => {
    setCheckingSites(true);
    setSiteMessage('');
    try {
      const result = await checkAllMonitoredSites(siteType);
      if (result?.success) {
        if (result.findings) {
          setSiteFindings(result.findings);
        }
        const changedCount = result.results?.filter(r => r.changed).length || 0;
        const errorCount = result.results?.filter(r => r.error).length || 0;
        const filteredCount = result.results?.filter(r => r.filtered).length || 0;
        const baselineCount = result.results?.filter(r => r.baseline).length || 0;
        const scopeLabel = { spider: 'SPIDER NET', standard: 'Standard site' }[siteType] || 'Site';
        setSiteMessage(`${scopeLabel} check complete. ${baselineCount} baseline(s), ${changedCount} changed (${filteredCount} without a finding), ${errorCount} error(s).`);
        await loadSources({ silent: true });
      } else {
        setSiteMessage(result?.error || 'Could not check monitored websites.');
      }
    } catch (err) {
      setSiteMessage(err.message || 'Error checking monitored websites.');
    } finally {
      setCheckingSites(false);
    }
  };

  const handleSeedSpiderWeb = async () => {
    setSiteBusy(true);
    setSiteMessage('Extracting up to 100 reference pages from Chrome history...');
    try {
      const result = await seedSpiderWebSites();
      if (result?.success) {
        if (result.sites) {
          setMonitoredSites(result.sites);
        }
        if (result.findings) {
          setSiteFindings(result.findings);
        }
        const selectedCount = result.seed?.selected;
        setSiteMessage(selectedCount === undefined
          ? 'Chrome history references synced into your SPIDER NET.'
          : `${selectedCount} Chrome history reference page(s) synced into your SPIDER NET.`);
        await loadSources({ silent: true });
      } else {
        setSiteMessage(result?.error || 'Could not seed SPIDER NET.');
      }
    } catch (err) {
      setSiteMessage(err.message || 'Error seeding SPIDER NET.');
    } finally {
      setSiteBusy(false);
    }
  };

  loadSourcesRef.current = loadSources;

  useEffect(() => {
    void loadSourcesRef.current?.({ silent: true });
  }, [user]);

  const handleTrackedChannelSave = async () => {
    if (!channelQuery.trim()) {
      setDiscoveryMessage('Add a YouTube channel name, handle, or URL first.');
      return;
    }

    setDiscoveryBusy(true);
    setDiscoveryMessage('');

    try {
      const result = await addTrackedChannel({ channel_query: channelQuery.trim(), trust_tier: 4 });
      if (result?.channels) {
        setTrackedChannels(result.channels);
        setChannelQuery('');
        setDiscoveryMessage('Tracked channel saved.');
        await loadSources({ silent: true });
      } else {
        setDiscoveryMessage('Could not save that tracked channel right now.');
      }
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const handleTopicMonitorSave = async () => {
    if (!topicQuery.trim()) {
      setDiscoveryMessage('Add a discovery query first.');
      return;
    }

    setDiscoveryBusy(true);
    setDiscoveryMessage('');

    try {
      const result = await addTopicMonitor({ query: topicQuery.trim(), intent: 'personal_match', weight: 0.72 });
      if (result?.monitors || result?.queries) {
        setTopicMonitors(result.monitors || result.queries || []);
        setTopicQuery('');
        setDiscoveryMessage('Topic monitor saved.');
        await loadSources({ silent: true });
      } else {
        setDiscoveryMessage('Could not save that topic monitor right now.');
      }
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const handleTrackedChannelToggle = async (channel, active) => {
    setDiscoveryBusy(true);
    setDiscoveryMessage('');

    try {
      const result = await updateTrackedChannel(channel.id, { active });
      if (result?.channels) {
        setTrackedChannels(result.channels);
        setDiscoveryMessage(active ? 'Tracked channel restored.' : 'Tracked channel removed from Best Feed.');
        await loadSources({ silent: true });
      } else {
        setDiscoveryMessage('Could not update that tracked channel right now.');
      }
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const handleTopicMonitorToggle = async (monitor, active) => {
    setDiscoveryBusy(true);
    setDiscoveryMessage('');

    try {
      const result = await updateTopicMonitor(monitor.id, { active });
      if (result?.monitors || result?.queries) {
        setTopicMonitors(result.monitors || result.queries || []);
        setDiscoveryMessage(active ? 'Topic monitor restored.' : 'Topic monitor removed from Best Feed.');
        await loadSources({ silent: true });
      } else {
        setDiscoveryMessage('Could not update that topic monitor right now.');
      }
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const handleSaveSourcePack = async () => {
    if (!sourcePackTopic.trim()) {
      setSourcePackMessage('Add a topic first.');
      return;
    }
    setSourcePackBusy(true);
    setSourcePackMessage('');
    try {
      const result = await addSourcePack({ topic: sourcePackTopic.trim() });
      if (result?.success) {
        setSourcePackTopic('');
        setSourcePackMessage('Source pack saved.');
        if (result.packs) {
          setSourcePacks(result.packs);
        } else {
          await loadSources({ silent: true });
        }
      } else {
        setSourcePackMessage('Could not save source pack.');
      }
    } catch (err) {
      setSourcePackMessage(err.message || 'Error saving source pack.');
    } finally {
      setSourcePackBusy(false);
    }
  };

  const handleToggleSourcePack = async (pack) => {
    setSourcePackBusy(true);
    setSourcePackMessage('');
    try {
      const result = await updateSourcePack(pack.id, { active: !pack.active });
      if (result?.success) {
        setSourcePackMessage(pack.active ? 'Source pack disabled.' : 'Source pack enabled.');
        if (result.packs) {
          setSourcePacks(result.packs);
        } else {
          await loadSources({ silent: true });
        }
      } else {
        setSourcePackMessage('Could not update source pack.');
      }
    } catch (err) {
      setSourcePackMessage(err.message || 'Error updating source pack.');
    } finally {
      setSourcePackBusy(false);
    }
  };

  const handleRemoveSourcePack = async (id) => {
    setSourcePackBusy(true);
    setSourcePackMessage('');
    try {
      const result = await updateSourcePack(id, { active: false });
      if (result?.success) {
        setSourcePackMessage('Source pack removed.');
        if (result.packs) {
          setSourcePacks(result.packs);
        } else {
          await loadSources({ silent: true });
        }
      } else {
        setSourcePackMessage('Could not remove source pack.');
      }
    } catch (err) {
      setSourcePackMessage(err.message || 'Error removing source pack.');
    } finally {
      setSourcePackBusy(false);
    }
  };

  const handleRateSourcePack = async (pack, rating) => {
    setSourcePackBusy(true);
    setSourcePackMessage('');
    try {
      const result = await updateSourcePack(pack.id, {
        final_theory_feedback: {
          rating,
          note: rating >= 8 ? 'Strong fit with my direction.' : rating >= 5 ? 'Useful but not central.' : 'Lower fit; suppress similar items.',
        },
      });
      if (result?.success) {
        setSourcePackMessage(`Final Theory rating saved: ${rating}/10.`);
        if (result.packs) {
          setSourcePacks(result.packs);
        } else {
          await loadSources({ silent: true });
        }
      } else {
        setSourcePackMessage('Could not save rating.');
      }
    } catch (err) {
      setSourcePackMessage(err.message || 'Error saving rating.');
    } finally {
      setSourcePackBusy(false);
    }
  };

  const handleRefreshDiscovery = async () => {
    setDiscoveryBusy(true);
    setDiscoveryMessage('');

    try {
      const result = await refreshDiscovery();
      if (result?.status) {
        setDiscoveryStatus(result.status);
      }

      await loadSources({ silent: true });
      setDiscoveryMessage('Best Feed discovery refreshed.');
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const handleYouTubeImport = async () => {
    if (!youtubeUrl.trim()) {
      setYouTubeMessage('Paste a YouTube URL first.');
      return;
    }

    setYouTubeBusy(true);
    setYouTubeMessage('');

    try {
      const result = await importYouTubeUrl(youtubeUrl.trim());
      if (result?.item) {
        setYouTubeMessage(result.created ? 'Imported into your feed.' : 'That video is already in your feed.');
        if (result.created) {
          setYouTubeUrl('');
        }
      } else {
        setYouTubeMessage('Import failed. Check the live service and try again.');
      }
    } finally {
      setYouTubeBusy(false);
    }
  };

  const handleInstagramImport = async () => {
    if (!instagramUrl.trim()) {
      setInstagramMessage('Paste an Instagram profile or post URL first.');
      return;
    }

    setInstagramBusy(true);
    setInstagramMessage('');

    try {
      const result = await importInstagramUrl(instagramUrl.trim());
      if (!result) {
        setInstagramMessage('Import failed. Check the live service and try again.');
        return;
      }

      const createdCount = Number(result.createdCount || 0);
      const existingCount = Number(result.existingCount || 0);

      if (createdCount > 0) {
        setInstagramMessage(`Imported ${createdCount} Instagram post${createdCount === 1 ? '' : 's'} into your feed.`);
        setInstagramUrl('');
      } else if (existingCount > 0) {
        setInstagramMessage(`That Instagram source is already in your feed. ${existingCount} post${existingCount === 1 ? '' : 's'} matched existing items.`);
      } else {
        setInstagramMessage('Import finished, but there were no usable Instagram posts to add.');
      }
    } finally {
      setInstagramBusy(false);
    }
  };

  const handlePodcastImport = async () => {
    if (!podcastUrl.trim()) {
      setPodcastMessage('Paste a podcast RSS feed URL first.');
      return;
    }

    setPodcastBusy(true);
    setPodcastMessage('');

    try {
      const result = await importPodcastFeed(podcastUrl.trim());
      if (!result) {
        setPodcastMessage('Import failed. Check the live service and try again.');
        return;
      }

      const createdCount = Number(result.createdCount || 0);
      const existingCount = Number(result.existingCount || 0);

      if (createdCount > 0) {
        setPodcastMessage(`Imported ${createdCount} podcast episode${createdCount === 1 ? '' : 's'} into your feed.`);
        setPodcastUrl('');
      } else if (existingCount > 0) {
        setPodcastMessage(`That podcast feed is already in your library. ${existingCount} episode${existingCount === 1 ? '' : 's'} matched existing items.`);
      } else {
        setPodcastMessage('Import finished, but the feed did not expose usable episodes.');
      }
    } finally {
      setPodcastBusy(false);
    }
  };

  const handleRedditImport = async () => {
    if (!redditSource.trim()) {
      setRedditMessage('Paste a subreddit name or Reddit URL first.');
      return;
    }

    setRedditBusy(true);
    setRedditMessage('');

    try {
      const result = await importRedditSource(redditSource.trim());
      if (!result) {
        setRedditMessage('Import failed. Check your Reddit credentials and live service.');
        return;
      }

      const createdCount = Number(result.createdCount || 0);
      const existingCount = Number(result.existingCount || 0);

      if (createdCount > 0) {
        setRedditMessage(`Imported ${createdCount} Reddit post${createdCount === 1 ? '' : 's'} into your feed.`);
        setRedditSource('');
      } else if (existingCount > 0) {
        setRedditMessage(`That Reddit source is already in your feed. ${existingCount} post${existingCount === 1 ? '' : 's'} matched existing items.`);
      } else {
        setRedditMessage('Import finished, but there were no usable Reddit posts to add.');
      }
    } finally {
      setRedditBusy(false);
    }
  };

  const handleXImport = async () => {
    if (!xSource.trim()) {
      setXMessage('Paste an X profile URL or username first.');
      return;
    }

    setXBusy(true);
    setXMessage('');

    try {
      const result = await importXSource(xSource.trim());
      if (!result) {
        setXMessage('Import failed. Check your X bearer token and live service.');
        return;
      }

      const createdCount = Number(result.createdCount || 0);
      const existingCount = Number(result.existingCount || 0);

      if (createdCount > 0) {
        setXMessage(`Imported ${createdCount} X post${createdCount === 1 ? '' : 's'} into your feed.`);
        setXSource('');
      } else if (existingCount > 0) {
        setXMessage(`That X source is already in your feed. ${existingCount} post${existingCount === 1 ? '' : 's'} matched existing items.`);
      } else {
        setXMessage('Import finished, but there were no usable X posts to add.');
      }
    } finally {
      setXBusy(false);
    }
  };

  return (
    <div className="page-enter" style={{ padding: 'var(--space-base) 0', width: '100%' }}>
      <div className="container" style={{ marginBottom: 'var(--space-medium)', display: 'flex', alignItems: 'center' }}>
        <button className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon size={22} />
        </button>
        <h1 style={{ font: 'var(--font-h2)', marginLeft: 'var(--space-tight)' }}>Sources</h1>
      </div>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-large)' }}>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ font: 'var(--font-h3)' }}>Platform Status</h2>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                {summary.configured} ready, {summary.partial} partial, {summary.planned_ready || 0} credential-only states.
              </p>
            </div>
            <button className="btn btn-secondary" onClick={() => { void loadSources(); }} disabled={statusBusy}>
              {statusBusy ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
            Unfinished integrations are marked unavailable instead of pretending they are live.
          </p>

          {statusMessage && (
            <p style={{ font: 'var(--font-caption)', color: statusTone === 'error' ? 'var(--error)' : 'var(--accent)' }}>
              {statusMessage}
            </p>
          )}
        </section>

        {loadingSources && (
          <section className="card" style={{ display: 'grid', gap: 'var(--space-small)' }}>
            <div className="skeleton" style={{ width: '160px', height: '18px' }} />
            <div className="skeleton" style={{ width: '100%', height: '16px' }} />
            <div className="skeleton" style={{ width: '86%', height: '16px' }} />
          </section>
        )}

        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ font: 'var(--font-h3)' }}>Best Feed Discovery</h2>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                {user
                  ? 'YouTube-first discovery is driven by tracked channels, topic monitors, and source health.'
                  : 'Sign in to manage the tracked channels and topic monitors that shape your Best Feed.'}
              </p>
            </div>
            <button className="btn btn-secondary" onClick={handleRefreshDiscovery} disabled={discoveryBusy || !user}>
              {discoveryBusy ? 'Refreshing...' : 'Refresh discovery'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
            <span className={`status-pill ${discoveryStatusLabel === 'Live' ? 'is-live' : discoveryStatusLabel === 'No live data yet' ? 'is-empty' : 'is-partial'}`}>
              Discovery status: {discoveryStatusLabel}
            </span>
            {discoveryErrorCount > 0 ? (
              <span style={{ font: 'var(--font-caption)', color: 'var(--warning)' }}>
                {discoveryErrorCount} source lane{discoveryErrorCount === 1 ? '' : 's'} need attention.
              </span>
            ) : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-tight)' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-small)', background: 'var(--surface-elevated)' }}>
              <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Tracked channels</p>
              <p style={{ font: 'var(--font-h3)' }}>{discoveryStatus?.tracked_channel_count || 0}</p>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-small)', background: 'var(--surface-elevated)' }}>
              <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Topic monitors</p>
              <p style={{ font: 'var(--font-h3)' }}>{discoveryStatus?.topic_monitor_count || 0}</p>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-small)', background: 'var(--surface-elevated)' }}>
              <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Source packs</p>
              <p style={{ font: 'var(--font-h3)' }}>{discoveryStatus?.source_pack_count ?? sourcePacks.filter((pack) => pack.active).length}</p>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-small)', background: 'var(--surface-elevated)' }}>
              <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Fresh candidates</p>
              <p style={{ font: 'var(--font-h3)' }}>{discoveryStatus?.candidate_count || 0}</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-tight)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Add a tracked YouTube channel</p>
              <div className="search-bar">
                <input
                  type="text"
                  placeholder="Channel name, @handle, or channel URL"
                  value={channelQuery}
                  onChange={(event) => setChannelQuery(event.target.value)}
                />
              </div>
              <button className="btn btn-primary" onClick={handleTrackedChannelSave} disabled={discoveryBusy || !user}>
                Save tracked channel
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {!trackedChannels.length && (
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                    {user ? 'No tracked channels yet.' : 'Sign in to manage tracked channels.'}
                  </p>
                )}
                {trackedChannels.slice(0, 5).map((channel) => (
                  <div key={channel.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'var(--surface-elevated)' }}>
                    <p style={{ font: 'var(--font-body)', fontWeight: 600 }}>{channel.channel_name || channel.channel_query}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-tight)', alignItems: 'center', flexWrap: 'wrap' }}>
                      <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>
                        Trust {channel.trust_tier || 3}/5
                      </p>
                      <button className="btn btn-ghost btn-sm" onClick={() => { void handleTrackedChannelToggle(channel, false); }} disabled={discoveryBusy}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Add a recurring topic monitor</p>
              <div className="search-bar">
                <input
                  type="text"
                  placeholder="Example: OpenAI model release"
                  value={topicQuery}
                  onChange={(event) => setTopicQuery(event.target.value)}
                />
              </div>
              <button className="btn btn-primary" onClick={handleTopicMonitorSave} disabled={discoveryBusy || !user}>
                Save topic monitor
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {!topicMonitors.length && (
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                    {user ? 'No topic monitors yet.' : 'Sign in to manage topic monitors.'}
                  </p>
                )}
                {topicMonitors.slice(0, 5).map((monitor) => (
                  <div key={monitor.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'var(--surface-elevated)' }}>
                    <p style={{ font: 'var(--font-body)', fontWeight: 600 }}>{monitor.query}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-tight)', alignItems: 'center', flexWrap: 'wrap' }}>
                      <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>
                        {monitor.intent || 'personal_match'}
                      </p>
                      <button className="btn btn-ghost btn-sm" onClick={() => { void handleTopicMonitorToggle(monitor, false); }} disabled={discoveryBusy}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Source health</p>
            {!sourceHealth.length && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                {user ? 'Source health appears after discovery has run.' : 'Sign in to see Best Feed source health.'}
              </p>
            )}
            {sourceHealth.slice(0, 6).map((source) => (
              <div key={`${source.platform}-${source.source_key}-${source.lane}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'var(--surface-elevated)' }}>
                <div>
                  <p style={{ font: 'var(--font-body)', fontWeight: 600 }}>{source.source_label || source.source_key}</p>
                  <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>
                    {source.lane}
                    {source.last_success_at ? ` | Last success: ${new Date(source.last_success_at).toLocaleString()}` : ''}
                  </p>
                  {source.last_error ? (
                    <p style={{ font: 'var(--font-micro)', color: 'var(--warning)' }}>
                      Needs attention: {source.last_error}
                    </p>
                  ) : null}
                </div>
                <span className="badge">
                  {source.status}
                </span>
              </div>
            ))}
          </div>

          {discoveryMessage && (
            <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
              {discoveryMessage}
            </p>
          )}
        </section>

        {/* Source Packs Section */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
          <div>
            <h2 style={{ font: 'var(--font-h3)', marginBottom: '4px' }}>Source Packs</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Generate monitored source groups and watch questions from a topic or question.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Add a topic or question</p>
            <div style={{ display: 'flex', gap: 'var(--space-tight)', alignItems: 'center' }}>
              <div className="search-bar" style={{ flex: 1, margin: 0 }}>
                <input
                  type="text"
                  placeholder="e.g. cheap AI tools that give me an edge"
                  value={sourcePackTopic}
                  onChange={(event) => setSourcePackTopic(event.target.value)}
                  disabled={sourcePackBusy}
                />
              </div>
              <button className="btn btn-primary" onClick={handleSaveSourcePack} disabled={sourcePackBusy || !user || !sourcePackTopic.trim()}>
                {sourcePackBusy ? 'Generating...' : 'Save Pack'}
              </button>
            </div>
            {sourcePackMessage && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--accent)' }}>
                {sourcePackMessage}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Your Source Packs</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {!sourcePacks.length && (
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                  {user ? 'No source packs yet.' : 'Sign in to view source packs.'}
                </p>
              )}
              {sourcePacks.map((pack) => (
                <div
                  key={pack.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px',
                    background: 'var(--surface-elevated)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    opacity: pack.active ? 1 : 0.6
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ font: 'var(--font-body)', fontWeight: 600 }}>{pack.topic}</p>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                        <span className="badge" style={{ font: 'var(--font-micro)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                          Lane: {pack.lane}
                        </span>
                        <span className="badge" style={{ font: 'var(--font-micro)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                          Priority: {pack.priority}
                        </span>
                        <span className="badge" style={{ font: 'var(--font-micro)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                          Sources: {pack.generated_sources?.length || 0}
                        </span>
                        {pack.spider_policy && (
                          <span className="badge" style={{ font: 'var(--font-micro)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                            Spider: {pack.spider_policy.cadence_hours || 24}h
                          </span>
                        )}
                        {pack.final_theory_feedback?.rating ? (
                          <span className="badge" style={{ font: 'var(--font-micro)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                            Fit: {pack.final_theory_feedback.rating}/10
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void handleToggleSourcePack(pack)}
                        disabled={sourcePackBusy}
                      >
                        {pack.active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--error)' }}
                        onClick={() => void handleRemoveSourcePack(pack.id)}
                        disabled={sourcePackBusy}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {pack.why && (
                    <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                      <em>Why it matters:</em> {pack.why}
                    </p>
                  )}

                  {pack.spider_policy && (
                    <div className="subtle-panel" style={{ gap: '6px', background: 'var(--surface)' }}>
                      <strong style={{ font: 'var(--font-micro)', color: 'var(--text-primary)' }}>
                        Reference net
                      </strong>
                      <p style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)', margin: 0 }}>
                        {pack.spider_policy.trigger_rule}
                      </p>
                      <div className="scroll-row" style={{ gap: '6px' }}>
                        {(pack.spider_policy.trigger_words || []).slice(0, 8).map((word) => (
                          <span key={word} className="badge" style={{ font: 'var(--font-micro)', background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
                            {word}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {pack.interpretation_lenses && pack.interpretation_lenses.length > 0 && (
                    <details style={{ marginTop: '4px' }}>
                      <summary style={{ font: 'var(--font-micro)', fontWeight: 600, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                        Interpretation Lenses ({pack.interpretation_lenses.length})
                      </summary>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                        {pack.interpretation_lenses.map((lens) => (
                          <div key={lens.id} style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>
                            <strong style={{ color: 'var(--text-primary)' }}>{lens.label}:</strong> {lens.readsFor}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {pack.gap_awareness && pack.gap_awareness.length > 0 && (
                    <details style={{ marginTop: '4px' }}>
                      <summary style={{ font: 'var(--font-micro)', fontWeight: 600, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                        Gaps ({pack.gap_awareness.length})
                      </summary>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                        {pack.gap_awareness.map((gap) => (
                          <div key={gap.id} style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>
                            <strong style={{ color: 'var(--text-primary)' }}>{gap.label}:</strong> {gap.detail}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <details style={{ marginTop: '4px' }}>
                    <summary style={{ font: 'var(--font-micro)', fontWeight: 600, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                      Final Theory
                    </summary>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                      <div className="scroll-row" style={{ gap: '4px' }}>
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((rating) => (
                          <button
                            key={rating}
                            type="button"
                            className={`chip ${pack.final_theory_feedback?.rating === rating ? 'active' : ''}`}
                            onClick={() => void handleRateSourcePack(pack, rating)}
                            disabled={sourcePackBusy}
                            style={{ minWidth: '36px', justifyContent: 'center' }}
                          >
                            {rating}
                          </button>
                        ))}
                      </div>
                      {pack.final_theory_feedback?.note ? (
                        <p style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)', margin: 0 }}>
                          {pack.final_theory_feedback.note}
                        </p>
                      ) : null}
                    </div>
                  </details>

                  {pack.watch_questions && pack.watch_questions.length > 0 && (
                    <details style={{ marginTop: '4px' }}>
                      <summary style={{ font: 'var(--font-micro)', fontWeight: 600, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                        Watch Questions ({pack.watch_questions.length})
                      </summary>
                      <ul style={{ paddingLeft: 'var(--space-base)', margin: '4px 0 0 0', font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>
                        {pack.watch_questions.map((q, idx) => (
                          <li key={idx}>{q}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {pack.generated_sources && pack.generated_sources.length > 0 && (
                    <details style={{ marginTop: '4px' }}>
                      <summary style={{ font: 'var(--font-micro)', fontWeight: 600, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                        References ({pack.generated_sources.length})
                      </summary>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                        {pack.generated_sources.map((src) => (
                          <a
                            key={src.id}
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ font: 'var(--font-micro)', color: 'var(--accent)', textDecoration: 'underline' }}
                            title={src.watchFor?.length ? `Watch for: ${src.watchFor.join(', ')}` : ''}
                          >
                            {src.label}
                          </a>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
          <div>
            <h2 style={{ font: 'var(--font-h3)', marginBottom: '6px' }}>Manual import</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Use these only when you want to force a specific source into the feed. The normal product path is tracked discovery above.
            </p>
          </div>
          {!loadingSources && !sources.length && (
            <div className="card" style={{ color: 'var(--text-secondary)' }}>
              Live platform status is unavailable right now. Refresh after the service is reachable to see real source readiness.
            </div>
          )}
          {sources.map((source) => {
            const badge = getBadgeStyle(source);
            const isYouTube = source.id === 'youtube' && source.status === 'configured';
            const isInstagram = source.id === 'instagram' && (source.status === 'configured' || source.status === 'partial');
            const isPodcast = source.id === 'podcasts' && source.status === 'configured';
            const isReddit = source.id === 'reddit' && source.status === 'configured';
            const isX = source.id === 'x' && source.status === 'configured';

            return (
              <div
                key={source.id}
                className="card"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-small)' }}>
                  <div>
                    <h2 style={{ font: 'var(--font-h3)' }}>{source.name}</h2>
                    <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                      {source.category} | {source.coverage}
                    </p>
                  </div>
                  <span className="badge" style={{ color: badge.color, background: badge.background }}>
                    {badge.label}
                  </span>
                </div>

                <p style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                  {source.notes}
                </p>

                {isYouTube && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                    <div className="search-bar">
                      <input
                        type="url"
                        placeholder="Paste a YouTube video URL"
                        value={youtubeUrl}
                        onChange={(event) => setYouTubeUrl(event.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" onClick={handleYouTubeImport} disabled={youtubeBusy}>
                        {youtubeBusy ? 'Importing...' : 'Import to feed'}
                      </button>
                    </div>
                    {renderImportMessage(youtubeMessage)}
                  </div>
                )}

                {isInstagram && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                    <div className="search-bar">
                      <input
                        type="url"
                        placeholder="Paste an Instagram profile or post URL"
                        value={instagramUrl}
                        onChange={(event) => setInstagramUrl(event.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" onClick={handleInstagramImport} disabled={instagramBusy}>
                        {instagramBusy ? 'Importing...' : 'Import to feed'}
                      </button>
                    </div>
                    {renderImportMessage(instagramMessage)}
                  </div>
                )}

                {isPodcast && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                    <div className="search-bar">
                      <input
                        type="url"
                        placeholder="Paste a podcast RSS feed URL"
                        value={podcastUrl}
                        onChange={(event) => setPodcastUrl(event.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" onClick={handlePodcastImport} disabled={podcastBusy}>
                        {podcastBusy ? 'Importing...' : 'Import to feed'}
                      </button>
                    </div>
                    {renderImportMessage(podcastMessage)}
                  </div>
                )}

                {isReddit && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                    <div className="search-bar">
                      <input
                        type="text"
                        placeholder="Paste r/subreddit or a Reddit URL"
                        value={redditSource}
                        onChange={(event) => setRedditSource(event.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" onClick={handleRedditImport} disabled={redditBusy}>
                        {redditBusy ? 'Importing...' : 'Import to feed'}
                      </button>
                    </div>
                    {renderImportMessage(redditMessage)}
                  </div>
                )}

                {isX && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                    <div className="search-bar">
                      <input
                        type="text"
                        placeholder="Paste an X profile URL or username"
                        value={xSource}
                        onChange={(event) => setXSource(event.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-tight)', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" onClick={handleXImport} disabled={xBusy}>
                        {xBusy ? 'Importing...' : 'Import to feed'}
                      </button>
                    </div>
                    {renderImportMessage(xMessage)}
                  </div>
                )}

                {source.envKeys?.length > 0 && (
                  <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>
                    Env: {source.envKeys.join(', ')}
                  </p>
                )}
              </div>
            );
          })}
        </section>

        {/* Monitored Websites Section (Module C) */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-small)', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
            <div>
              <h2 style={{ font: 'var(--font-h3)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Change Monitors
              </h2>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Monitor web pages for updates and analyze them for semantic significance.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-tight)' }}>
              <button 
                className={`btn btn-sm ${siteSubTab === 'standard' ? 'btn-primary' : 'btn-ghost'}`} 
                onClick={() => setSiteSubTab('standard')}
              >
                Standard
              </button>
              <button 
                className={`btn btn-sm ${siteSubTab === 'spiderweb' ? 'btn-primary' : 'btn-ghost'}`} 
                onClick={() => setSiteSubTab('spiderweb')}
              >
                SPIDER NET ({monitoredSites.filter(s => s.is_spider_web === 1).length})
              </button>
            </div>
          </div>

          {siteSubTab === 'spiderweb' && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', background: 'rgba(124, 58, 237, 0.05)', display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '4px solid var(--accent)' }}>
              <h3 style={{ font: 'var(--font-h4)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                SPIDER NET monitoring
              </h3>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                Sync up to 100 reference pages from your Chrome history or add URLs manually. The first scan stores a baseline only.{' '}
                Later text changes are sent to a configured live LLM, and only a valid high-scoring analysis can create a finding.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={handleSeedSpiderWeb} disabled={siteBusy || !user}>
                  {siteBusy ? 'Syncing...' : 'Sync Chrome History (up to 100)'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => void handleCheckAllSites('spider')} disabled={checkingSites || !user || !monitoredSites.filter(s => s.is_spider_web === 1).length}>
                  {checkingSites ? 'Scanning...' : 'Scan SPIDER NET now'}
                </button>
              </div>
            </div>
          )}

          {siteSubTab === 'standard' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => void handleCheckAllSites('standard')} disabled={checkingSites || !user || !monitoredSites.filter(s => s.is_spider_web !== 1).length}>
                {checkingSites ? 'Checking...' : 'Check standard sites now'}
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-tight)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                {siteSubTab === 'spiderweb' ? 'Add a SPIDER NET reference URL' : 'Add standard website to monitor'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div className="search-bar">
                  <input
                    type="url"
                    placeholder="Website URL (e.g. https://example.com/blog)"
                    value={siteUrlInput}
                    onChange={(event) => setSiteUrlInput(event.target.value)}
                  />
                </div>
                <div className="search-bar">
                  <input
                    type="text"
                    placeholder="Label / Title (optional)"
                    value={siteLabelInput}
                    onChange={(event) => setSiteLabelInput(event.target.value)}
                  />
                </div>
              </div>
              <button 
                className="btn btn-primary" 
                onClick={() => void handleAddMonitoredSite()} 
                disabled={siteBusy || !user}
              >
                Save {siteSubTab === 'spiderweb' ? 'SPIDER NET URL' : 'Standard Website'}
              </button>
              
              {siteMessage && (
                <p style={{ font: 'var(--font-caption)', color: 'var(--accent)', marginTop: '4px' }}>
                  {siteMessage}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                {siteSubTab === 'spiderweb' ? 'SPIDER NET reference pages' : 'Monitored websites'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
                {monitoredSites.filter(site => siteSubTab === 'spiderweb' ? site.is_spider_web === 1 : site.is_spider_web !== 1).length === 0 && (
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)' }}>
                    {user 
                      ? (siteSubTab === 'spiderweb' ? 'No SPIDER NET pages yet. Sync Chrome history or add a reference URL.' : 'No standard websites monitored yet.') 
                      : 'Sign in to manage monitored websites.'
                    }
                  </p>
                )}
                {monitoredSites
                  .filter(site => siteSubTab === 'spiderweb' ? site.is_spider_web === 1 : site.is_spider_web !== 1)
                  .map((site) => (
                    <div key={site.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'var(--surface-elevated)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-small)' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p style={{ font: 'var(--font-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                            {site.label?.replace(/^\[(?:Spider Web|SPIDER NET)\]\s*/i, '') || site.url}
                          </p>
                          <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.url}</p>
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => void handleDeleteMonitoredSite(site.id)} disabled={siteBusy}>
                          Remove
                        </button>
                      </div>
                      <p style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>
                        Checked: {site.last_checked_at ? new Date(site.last_checked_at).toLocaleString() : 'Never'}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {siteFindings.filter(f => siteSubTab === 'spiderweb' ? f.is_spider_web_finding === 1 : f.is_spider_web_finding !== 1).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'var(--space-small)' }}>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                {siteSubTab === 'spiderweb' ? 'SPIDER NET findings' : 'Latest change findings'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
                {siteFindings
                  .filter(f => siteSubTab === 'spiderweb' ? f.is_spider_web_finding === 1 : f.is_spider_web_finding !== 1)
                  .map((finding) => (
                    <div key={finding.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px', background: 'var(--surface-elevated)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', alignItems: 'center' }}>
                        <p style={{ font: 'var(--font-body)', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {finding.is_spider_web_finding === 1 && (
                            <span style={{ font: 'var(--font-micro)', background: 'rgba(124, 58, 237, 0.15)', color: 'var(--accent)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(124, 58, 237, 0.3)' }}>
                              SPIDER NET
                            </span>
                          )}
                          {finding.title
                            ?.replace(/^SPIDER NET alert:\s*/i, '')
                            .replace(/^[^A-Za-z0-9]*Spider Web Alert:\s*/i, '')}
                        </p>
                        <span className="badge" style={{ color: 'var(--accent)', background: 'var(--accent-light)', font: 'var(--font-micro)' }}>
                          Fit: {Math.round(finding.fit_score * 100)}%
                        </span>
                      </div>

                      {finding.is_spider_web_finding === 1 && (
                        <div style={{ display: 'flex', gap: '12px', margin: '6px 0', background: 'rgba(255, 255, 255, 0.02)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                          <span style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>
                            Novelty Score: <strong style={{ color: 'var(--success)' }}>{Math.round(finding.novelty_score * 100)}%</strong>
                          </span>
                          <span style={{ font: 'var(--font-micro)', color: 'var(--text-secondary)' }}>
                            Importance: <strong style={{ color: 'var(--accent)' }}>{Math.round(finding.importance_score * 100)}%</strong>
                          </span>
                        </div>
                      )}

                      <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '4px 0', lineHeight: 1.4 }}>
                        {finding.summary}
                      </p>

                      {finding.is_spider_web_finding === 1 && finding.novel_elements && (() => {
                        try {
                          const els = JSON.parse(finding.novel_elements);
                          if (Array.isArray(els) && els.length > 0) {
                            return (
                              <div style={{ marginTop: '8px', borderTop: '1px dashed var(--border)', paddingTop: '8px' }}>
                                <p style={{ font: 'var(--font-micro)', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 4px 0' }}>
                                  Novel Elements Caught:
                                </p>
                                <ul style={{ margin: '0 0 0 16px', padding: 0, font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                  {els.map((el, idx) => (
                                    <li key={idx} style={{ listStyleType: 'square' }}>{el}</li>
                                  ))}
                                </ul>
                              </div>
                            );
                          }
                        } catch (e) {}
                        return null;
                      })()}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                        <a href={finding.url} target="_blank" rel="noopener noreferrer" style={{ font: 'var(--font-micro)', color: 'var(--accent)', textDecoration: 'underline' }}>
                          Visit Site Reference
                        </a>
                        <p style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>
                          Scanned: {new Date(finding.found_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
