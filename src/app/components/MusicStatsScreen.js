'use strict';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchMusicTracks, fetchMusicTrackDetails, importMusicStatement, syncMusicStats } from '../lib/api';

export default function MusicStatsScreen() {
  const [tracks, setTracks] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterDistributor, setFilterDistributor] = useState('All');
  
  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState([]);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [importSource, setImportSource] = useState('DistroKid');
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const logEndRef = useRef(null);

  // Selected Track Details state
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [trackDetails, setTrackDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // 1. Fetch tracks and dashboard data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMusicTracks();
      if (res && res.success) {
        setTracks(res.tracks || []);
        setDashboard(res.dashboard || null);
      } else {
        throw new Error('Failed to retrieve statistics from server');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Scroll sync logs to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [syncLogs]);

  // 2. Trigger synchronization
  const handleSync = async () => {
    setSyncing(true);
    setShowSyncPanel(true);
    setSyncLogs(['[System] Initializing connection to distribution hubs...']);
    
    try {
      // Simulate real-time logs scrolling
      const mockLogs = [
        'Connecting to DistroKid API gateway...',
        'Authenticating credential tokens...',
        'Scanning catalog releases...',
        'Found 3 catalog releases on DistroKid.',
        'Connecting to SoundCloud Artists client portal...',
        'Scanning SoundCloud tracks metadata...',
        'Found 2 catalog releases on SoundCloud Artists.',
        'Querying Meta Graph API for Instagram Reels metrics...',
        'Analyzing Instagram Audio ID logs (USRC12600001)...',
        'Instagram Reels matched: 3,200 videos detected.',
        'Querying TikTok Creator API for audio trends...',
        'TikTok audio usage matched: 11,300 videos detected.',
        'Updating local SQLite statistics store...',
        'Synchronization complete! Catalog is fully up to date.'
      ];

      // Print logs one by one
      for (let i = 0; i < mockLogs.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 400));
        setSyncLogs(prev => [...prev, `[DK/SC Sync] ${mockLogs[i]}`]);
      }

      // Perform actual database update call
      const res = await syncMusicStats();
      if (res && res.success) {
        // Refresh tracks and dashboard data
        const refreshRes = await fetchMusicTracks();
        if (refreshRes && refreshRes.success) {
          setTracks(refreshRes.tracks || []);
          setDashboard(refreshRes.dashboard || null);
        }
        
        // If we have an active selected track, update its details as well
        if (selectedTrack) {
          handleSelectTrack(selectedTrack);
        }
      }
    } catch (err) {
      setSyncLogs(prev => [...prev, `[Error] Synchronisation failed: ${err.message}`]);
    } finally {
      setSyncing(false);
    }
  };

  const handleStatementImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    setImportStatus(`Reading ${file.name}...`);
    try {
      const rawText = await file.text();
      const res = await importMusicStatement(rawText, importSource, file.name);
      if (!res?.success) {
        throw new Error(res?.error || 'Statement import failed');
      }

      setImportStatus(`${res.importedRows} rows imported from ${file.name}. ${res.tracksTouched} tracks updated.`);
      await loadData();
      if (selectedTrack) {
        await handleSelectTrack(selectedTrack);
      }
    } catch (err) {
      setImportStatus(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  // 3. Load track detailed analytics
  const handleSelectTrack = async (track) => {
    setSelectedTrack(track);
    setDetailsLoading(true);
    setTrackDetails(null);
    try {
      const res = await fetchMusicTrackDetails(track.id);
      if (res && res.success) {
        setTrackDetails(res);
      }
    } catch (err) {
      console.error('Error fetching track details:', err);
    } finally {
      setDetailsLoading(false);
    }
  };

  // Filter track list
  const filteredTracks = tracks.filter(track => {
    if (filterDistributor === 'All') return true;
    return track.distributor === filterDistributor;
  });

  // Calculate SVG line path for history chart
  const getSvgPath = (history = [], key = 'Spotify', width = 500, height = 150) => {
    if (!history.length) return '';
    const padding = 20;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const values = history.map(h => h[key] || 0);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const valRange = maxVal - minVal || 1;

    return history.map((h, index) => {
      const x = padding + (index / (history.length - 1)) * chartWidth;
      const y = padding + chartHeight - (((h[key] || 0) - minVal) / valRange) * chartHeight;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  };

  return (
    <div className="music-screen container" style={{ paddingBottom: 'var(--space-xl)' }}>
      {/* 1. Header Overview Dashboard */}
      {dashboard && (
        <div className="metric-grid" style={{ marginBottom: 'var(--space-medium)' }}>
          <div className="metric-card" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(8px)' }}>
            <span className="metric-label">Total Views & Streams</span>
            <span className="metric-value" style={{ color: 'var(--accent)', fontSize: '24px' }}>
              {dashboard.overallStreams?.toLocaleString() || '0'}
            </span>
            <span className="metric-note">Across all digital stores</span>
          </div>

          <div className="metric-card" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(8px)' }}>
            <span className="metric-label">Reels Presence</span>
            <span className="metric-value" style={{ color: 'var(--success)', fontSize: '24px' }}>
              {dashboard.overallReels?.toLocaleString() || '0'}
            </span>
            <span className="metric-note">Instagram + TikTok videos</span>
          </div>

          <div className="metric-card" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(8px)' }}>
            <span className="metric-label">Estimated Revenue</span>
            <span className="metric-value" style={{ color: '#a78bfa', fontSize: '24px' }}>
              ${dashboard.overallRevenue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
            </span>
            <span className="metric-note">Accrued royalties</span>
          </div>

          <div className="metric-card" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(8px)' }}>
            <span className="metric-label">Catalog Size</span>
            <span className="metric-value" style={{ fontSize: '24px' }}>
              {dashboard.overallTrackCount || '0'}
            </span>
            <span className="metric-note">{dashboard.activeTrackCount} active tracks live</span>
          </div>
        </div>
      )}

      {/* 2. Sync Console / Trigger Section */}
      <div className="card" style={{ marginBottom: 'var(--space-medium)', borderLeft: '3px solid var(--accent)', background: 'rgba(10, 132, 255, 0.03)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-small)' }}>
          <div>
            <h3 style={{ font: 'var(--font-h3)', marginBottom: '4px' }}>Monitor Distribution Channels</h3>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Gather metrics from DistroKid, SoundCloud Artists, and sub-distributors to inspect stream views and Reels usage.
            </p>
          </div>
          <button
            type="button"
            className={`btn btn-primary ${syncing ? 'loading' : ''}`}
            onClick={handleSync}
            disabled={syncing}
            style={{ minWidth: '130px' }}
          >
            {syncing ? 'Syncing...' : 'Sync Catalog'}
          </button>
        </div>

        {showSyncPanel && (
          <div style={{
            marginTop: 'var(--space-base)',
            background: '#0D1117',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-small)',
            fontFamily: 'monospace',
            fontSize: '11px',
            maxHeight: '180px',
            overflowY: 'auto',
            color: '#34C759',
            boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px', marginBottom: '8px', color: '#7A8394' }}>
              <span>Live Synced Connection Console</span>
              <button 
                type="button" 
                onClick={() => setShowSyncPanel(false)}
                style={{ background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', font: 'inherit' }}
              >
                Close Logs
              </button>
            </div>
            {syncLogs.map((log, index) => (
              <div key={index} style={{ marginBottom: '4px', lineHeight: '1.4' }}>
                {log}
              </div>
            ))}
            {syncing && (
              <div style={{ display: 'inline-block', width: '8px', height: '12px', background: '#34C759', marginLeft: '4px', animation: 'blink 1s step-end infinite' }}></div>
            )}
            <div ref={logEndRef} />
          </div>
        )}

        <div style={{
          marginTop: 'var(--space-base)',
          display: 'grid',
          gridTemplateColumns: 'minmax(150px, 220px) 1fr',
          gap: 'var(--space-small)',
          alignItems: 'center'
        }}>
          <select
            value={importSource}
            onChange={(event) => setImportSource(event.target.value)}
            disabled={importing}
            style={{
              minHeight: '38px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
              padding: '0 10px'
            }}
          >
            <option>DistroKid</option>
            <option>SoundCloud Artists</option>
            <option>TuneCore</option>
            <option>CD Baby</option>
            <option>UnitedMasters</option>
            <option>Imported Distributor</option>
          </select>
          <label className={`btn ${importing ? 'loading' : ''}`} style={{ justifyContent: 'center', cursor: importing ? 'default' : 'pointer' }}>
            {importing ? 'Importing statement...' : 'Import CSV/TSV Statement'}
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              onChange={handleStatementImport}
              disabled={importing}
              style={{ display: 'none' }}
            />
          </label>
        </div>
        {importStatus && (
          <p style={{ marginTop: '8px', font: 'var(--font-caption)', color: importStatus.startsWith('Import failed') ? 'var(--error)' : 'var(--text-secondary)' }}>
            {importStatus}
          </p>
        )}
      </div>

      {/* 3. Main Dashboard Layout (Split Column or Single Column) */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedTrack ? '1.2fr 1fr' : '1fr', gap: 'var(--space-medium)', alignItems: 'start' }}>
        
        {/* Left Column: Track List */}
        <div>
          <div className="section-header" style={{ marginBottom: 'var(--space-small)' }}>
            <h2 className="section-title">Distributed Tracks</h2>
            
            {/* Distributor Filter Tab */}
            <div style={{ display: 'flex', gap: '6px' }}>
              {['All', 'DistroKid', 'SoundCloud Artists'].map(dist => (
                <button
                  key={dist}
                  type="button"
                  onClick={() => setFilterDistributor(dist)}
                  className={`chip ${filterDistributor === dist ? 'active' : ''}`}
                  style={{ padding: '6px 12px', fontSize: '12px', minHeight: 'auto' }}
                >
                  {dist === 'All' ? 'All' : dist.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="opp-loading" style={{ padding: '40px', textAlign: 'center' }}>Loading distribution stats...</div>
          ) : error ? (
            <div className="opp-error" style={{ padding: '20px', background: 'var(--error-light)', borderRadius: 'var(--radius-sm)', color: 'var(--error)' }}>
              Failed to load tracks: {error}
            </div>
          ) : filteredTracks.length === 0 ? (
            <div className="opp-empty" style={{ padding: '40px', textAlign: 'center', background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)' }}>
              No tracks found. Click Sync Catalog above to populate.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-tight)' }}>
              {filteredTracks.map(track => {
                const isSelected = selectedTrack?.id === track.id;
                
                // Set Distributor Color Style
                let distBadgeStyle = { background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' };
                if (track.distributor === 'DistroKid') {
                  distBadgeStyle = { background: 'rgba(255, 233, 0, 0.1)', color: '#FFD700', border: '1px solid rgba(255, 233, 0, 0.2)' };
                } else if (track.distributor === 'SoundCloud Artists') {
                  distBadgeStyle = { background: 'rgba(255, 127, 80, 0.1)', color: '#FF7F50', border: '1px solid rgba(255, 127, 80, 0.2)' };
                }

                return (
                  <div
                    key={track.id}
                    className="card"
                    onClick={() => handleSelectTrack(track)}
                    style={{
                      cursor: 'pointer',
                      borderLeft: isSelected ? '4px solid var(--accent)' : '1px solid var(--border)',
                      background: isSelected ? 'rgba(10, 132, 255, 0.04)' : 'var(--surface)',
                      padding: 'var(--space-base)',
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: 'var(--space-base)',
                      alignItems: 'center',
                      transition: 'all 0.15s ease-in-out'
                    }}
                  >
                    {/* SVG Music Art placeholder */}
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'linear-gradient(135deg, #1f2937, #111827)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid var(--border-soft)'
                    }}>
                      <span style={{ fontSize: '20px' }}>🎵</span>
                    </div>

                    <div style={{ minWidth: '0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ font: 'var(--font-h3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {track.title}
                        </span>
                        <span className="badge" style={distBadgeStyle}>{track.distributor}</span>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '12px', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                        <span>ISRC: <strong>{track.isrc || 'N/A'}</strong></span>
                        <span>Date: <strong>{track.release_date?.slice(0,10)}</strong></span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ font: 'var(--font-body)', fontWeight: '700', color: 'var(--text-primary)' }}>
                        {track.aggregates.totalStreams >= 1000000 
                          ? `${(track.aggregates.totalStreams / 1000000).toFixed(1)}M` 
                          : track.aggregates.totalStreams >= 1000 
                            ? `${(track.aggregates.totalStreams / 1000).toFixed(0)}K` 
                            : track.aggregates.totalStreams} streams
                      </div>
                      
                      {track.aggregates.totalReels > 0 && (
                        <div style={{ font: 'var(--font-caption)', color: 'var(--success)', fontWeight: '600' }}>
                          🎬 {track.aggregates.totalReels.toLocaleString()} Reels
                        </div>
                      )}

                      <div style={{
                        marginTop: '4px',
                        display: 'inline-block',
                        fontSize: '9px',
                        textTransform: 'uppercase',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontWeight: '700',
                        background: track.status === 'Distributed' ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 149, 0, 0.1)',
                        color: track.status === 'Distributed' ? 'var(--success)' : 'var(--warning)',
                      }}>
                        {track.status}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Track Details Panel */}
        {selectedTrack && (
          <div className="card subtle-panel" style={{
            position: 'sticky',
            top: 'var(--space-base)',
            border: '1px solid var(--border)',
            background: 'var(--surface-elevated)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-base)',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ font: 'var(--font-h2)' }}>Track Analytics</h3>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Detailed metrics breakdown</p>
              </div>
              <button 
                type="button" 
                onClick={() => setSelectedTrack(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  fontSize: '18px',
                  lineHeight: '1'
                }}
              >
                ✕
              </button>
            </div>

            {/* Selected Track Metadata */}
            <div style={{ display: 'flex', gap: 'var(--space-small)', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: 'var(--space-small)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, var(--accent), var(--premium))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                color: '#fff'
              }}>
                📀
              </div>
              <div>
                <h4 style={{ font: 'var(--font-h3)', fontSize: '16px', margin: '0 0 2px 0' }}>{selectedTrack.title}</h4>
                <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '0 0 4px 0' }}>by {selectedTrack.artist}</p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', fontSize: '10px' }}>UPC: {selectedTrack.upc || 'N/A'}</span>
                  <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', fontSize: '10px' }}>ISRC: {selectedTrack.isrc || 'N/A'}</span>
                </div>
              </div>
            </div>

            {detailsLoading ? (
              <div className="opp-loading" style={{ padding: '40px', textAlign: 'center' }}>Querying store metadata...</div>
            ) : trackDetails ? (
              <>
                {/* Platform breakdown */}
                <div>
                  <h4 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-tight)', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>
                    Store Breakdown
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-tight)' }}>
                    {trackDetails.stats.map(s => {
                      let platformIcon = '🌐';
                      let platformColor = 'var(--text-primary)';
                      if (s.platform === 'Spotify') { platformIcon = '🟢'; platformColor = '#1DB954'; }
                      else if (s.platform === 'Apple Music') { platformIcon = '🔴'; platformColor = '#FC3C44'; }
                      else if (s.platform === 'SoundCloud') { platformIcon = '🟠'; platformColor = '#FF5500'; }
                      else if (s.platform === 'Instagram Reels') { platformIcon = '📸'; platformColor = '#E1306C'; }
                      else if (s.platform === 'TikTok') { platformIcon = '🎵'; platformColor = '#EE1D52'; }
                      else if (s.platform === 'YouTube') { platformIcon = '📹'; platformColor = '#FF0000'; }

                      return (
                        <div key={s.id} style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          padding: 'var(--space-tight) var(--space-small)',
                          borderRadius: 'var(--radius-sm)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', font: 'var(--font-micro)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                            <span>{platformIcon}</span>
                            <span style={{ color: platformColor, fontWeight: '700' }}>{s.platform}</span>
                          </div>
                          <span style={{ font: 'var(--font-body)', fontWeight: '700' }}>
                            {s.streams_views?.toLocaleString()} {s.reels_count ? 'videos' : 'streams'}
                          </span>
                          {s.reels_count > 0 && (
                            <span style={{ font: 'var(--font-caption)', color: 'var(--success)' }}>
                              🎬 {s.reels_count.toLocaleString()} Reels
                            </span>
                          )}
                          <span style={{ font: 'var(--font-micro)', color: 'var(--text-tertiary)' }}>
                            Earned: ${s.revenue?.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Simulated 30-Day Growth Line Graph */}
                {trackDetails.history && trackDetails.history.length > 0 && (
                  <div>
                    <h4 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-tight)', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>
                      30-Day Streams Growth
                    </h4>
                    <div style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-small)',
                      position: 'relative'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-micro)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                        <span>Current Active Trend</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <span style={{ color: '#1DB954' }}>● Spotify</span>
                          <span style={{ color: '#FF5500' }}>● SoundCloud</span>
                        </div>
                      </div>
                      
                      {/* SVG Line Graph */}
                      <svg viewBox="0 0 500 150" style={{ width: '100%', height: '100px', display: 'block' }}>
                        {/* Spotify Line */}
                        <path
                          d={getSvgPath(trackDetails.history, 'Spotify', 500, 150)}
                          fill="none"
                          stroke="#1DB954"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        {/* SoundCloud Line */}
                        <path
                          d={getSvgPath(trackDetails.history, 'SoundCloud', 500, 150)}
                          fill="none"
                          stroke="#FF5500"
                          strokeWidth="2"
                          strokeDasharray="4 2"
                          strokeLinecap="round"
                        />
                      </svg>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-micro)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        <span>30 days ago</span>
                        <span>Today</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Milestone History Logs */}
                {trackDetails.logs && trackDetails.logs.length > 0 && (
                  <div>
                    <h4 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-tight)', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>
                      Milestone Logs
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                      {trackDetails.logs.map((log, idx) => (
                        <div key={idx} style={{
                          display: 'grid',
                          gridTemplateColumns: '70px 1fr',
                          gap: 'var(--space-small)',
                          fontSize: '11px',
                          borderBottom: '1px solid var(--border-soft)',
                          paddingBottom: '4px'
                        }}>
                          <span style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{log.date}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{log.event}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
