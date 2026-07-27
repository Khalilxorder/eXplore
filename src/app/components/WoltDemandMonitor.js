'use client';

import React, { useState, useEffect } from 'react';

// Native foreground service bridge (no-op on web/desktop)
let WoltBridge = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Plugins } = require('@capacitor/core');
  WoltBridge = Plugins.WoltBridge || null;
} catch (_) {
  // Running on web — no native bridge available
}

async function applyNativeForegroundService(enabled, apiBaseUrl, intervalMinutes) {
  if (!WoltBridge) return;
  try {
    if (enabled) {
      await WoltBridge.start({ backendUrl: apiBaseUrl, intervalMinutes });
    } else {
      await WoltBridge.stop();
    }
  } catch (err) {
    console.warn('[WoltDemandMonitor] native bridge call failed:', err);
  }
}

const SUPPLY_STATE_META = {
  SUPPLY_STATE_OFFERS_FLYING: { label: 'Offers Flying', sub: 'High Courier Demand', color: '#ff3b30', bg: 'rgba(255, 59, 48, 0.15)', border: '#ff3b30', badge: '🔥' },
  SUPPLY_STATE_EXPECT_SOON:   { label: 'Expect Soon',   sub: 'Medium Demand',       color: '#ff9500', bg: 'rgba(255, 149, 0, 0.15)', border: '#ff9500', badge: '⚡' },
  SUPPLY_STATE_SLOWER:        { label: 'Slower Demand', sub: 'Low Courier Demand',  color: '#34c759', bg: 'rgba(52, 199, 89, 0.15)', border: '#34c759', badge: '🐢' },
  SUPPLY_STATE_HIDE:          { label: 'Hidden / Off',  sub: 'Demand Hidden',       color: '#8e8e93', bg: 'rgba(142, 142, 147, 0.15)', border: '#8e8e93', badge: '🙈' },
};

export default function WoltDemandMonitor({ apiBaseUrl = '', authToken = '' }) {
  const [config, setConfig] = useState({
    enabled: false,
    auth_token: '',
    city_id: '',
    venue_id: '',
    check_interval_minutes: 2,
    min_notify_level: 'SUPPLY_STATE_EXPECT_SOON',
    notify_hotspots: true,
    sound_enabled: true,
    vibration_enabled: true,
  });

  const [latestSnapshot, setLatestSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const headers = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBaseUrl}/api/v1/wolt/status`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig(data.config);
        }
        if (data.latestSnapshot) {
          setLatestSnapshot(data.latestSnapshot);
        }
      }
    } catch (err) {
      console.error('Failed to load Wolt monitor status:', err);
    } finally {
      setLoading(false);
    }
  };

  // Re-run whenever the API base or auth token changes so headers stay fresh
  useEffect(() => {
    loadStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, authToken]);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/wolt/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setConfig(data.config);
        setStatusMessage({ type: 'success', text: 'Wolt Demand Monitor settings saved successfully.' });
      } else {
        setStatusMessage({ type: 'error', text: data.error || 'Failed to save settings.' });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: `Save error: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/wolt/test-fetch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          authToken: config.auth_token,
          cityId: config.city_id,
          venueId: config.venue_id,
        }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.ok && data.result?.ok) {
        setStatusMessage({ type: 'success', text: 'Connection successful! Mapped live demand data below.' });
        loadStatus();
      } else {
        setStatusMessage({
          type: 'error',
          text: data.result?.error || data.error || 'Connection test failed. Verify your courier token.',
        });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: `Test request failed: ${err.message}` });
    } finally {
      setTesting(false);
    }
  };

  const currentStateKey = latestSnapshot?.supply_state || testResult?.result?.supplyState || 'SUPPLY_STATE_SLOWER';
  const stateMeta = SUPPLY_STATE_META[currentStateKey] || SUPPLY_STATE_META.SUPPLY_STATE_SLOWER;
  const hotspotsCount = latestSnapshot?.hotspots_count !== undefined
    ? latestSnapshot.hotspots_count
    : (testResult?.result?.hotspotsCount || 0);

  return (
    <div className="wolt-demand-card glass-panel card-glow">
      <div className="wolt-card-header">
        <div className="wolt-header-title">
          <span className="wolt-badge-icon">🚴</span>
          <div>
            <h3>Wolt Demand Monitor</h3>
            <p className="wolt-subtitle">Intraday courier supply forecast & hotspot alerts</p>
          </div>
        </div>
        <label className="wolt-toggle-switch">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => {
              const updated = { ...config, enabled: e.target.checked };
              setConfig(updated);
              // Auto-save toggle status — catch to prevent unhandled rejection
              fetch(`${apiBaseUrl}/api/v1/wolt/config`, {
                method: 'POST',
                headers,
                body: JSON.stringify(updated),
              }).catch((err) => console.error('Wolt toggle auto-save failed:', err));
              // Start / stop the Android foreground service when running natively
              applyNativeForegroundService(e.target.checked, apiBaseUrl, updated.check_interval_minutes);
            }}
          />
          <span className="wolt-slider" />
        </label>
      </div>

      {/* Live Status Display Banner */}
      <div className="wolt-status-banner" style={{ background: stateMeta.bg, borderColor: stateMeta.border }}>
        <div className="wolt-status-main">
          <span className="wolt-state-badge">{stateMeta.badge}</span>
          <div>
            <div className="wolt-state-title" style={{ color: stateMeta.color }}>
              {stateMeta.label}
            </div>
            <div className="wolt-state-sub">{stateMeta.sub}</div>
          </div>
        </div>

        <div className="wolt-status-metrics">
          <div className="wolt-metric-pill">
            <span className="wolt-metric-val">{hotspotsCount}</span>
            <span className="wolt-metric-lbl">Hotspots</span>
          </div>
          {latestSnapshot?.fetched_at && (
            <div className="wolt-metric-pill">
              <span className="wolt-metric-val">
                {new Date(latestSnapshot.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="wolt-metric-lbl">Last Check</span>
            </div>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className={`wolt-alert-msg ${statusMessage.type}`}>
          {statusMessage.type === 'success' ? '✅' : '⚠️'} {statusMessage.text}
        </div>
      )}

      {/* Configuration Form */}
      <form onSubmit={handleSave} className="wolt-config-form">
        <div className="wolt-form-group">
          <label htmlFor="wolt_token_input">
            Courier Bearer Token <span className="req">*</span>
          </label>
          <div className="wolt-input-with-button">
            <input
              id="wolt_token_input"
              type={showToken ? 'text' : 'password'}
              placeholder="Paste Wolt authorization token..."
              value={config.auth_token}
              onChange={(e) => setConfig({ ...config, auth_token: e.target.value })}
              className="wolt-input"
            />
            <button
              type="button"
              className="wolt-btn-secondary"
              onClick={() => setShowToken(!showToken)}
            >
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
          <span className="wolt-hint">Found in app requests to courier-gateway.wolt.com</span>
        </div>

        <div className="wolt-form-row">
          <div className="wolt-form-group half">
            <label htmlFor="wolt_city_id">City / Team ID (Optional)</label>
            <input
              id="wolt_city_id"
              type="text"
              placeholder="e.g. 60a... or Helsinki"
              value={config.city_id}
              onChange={(e) => setConfig({ ...config, city_id: e.target.value })}
              className="wolt-input"
            />
          </div>

          <div className="wolt-form-group half">
            <label htmlFor="wolt_venue_id">Venue ID (Optional)</label>
            <input
              id="wolt_venue_id"
              type="text"
              placeholder="e.g. venue_123"
              value={config.venue_id}
              onChange={(e) => setConfig({ ...config, venue_id: e.target.value })}
              className="wolt-input"
            />
          </div>
        </div>

        <div className="wolt-form-row">
          <div className="wolt-form-group half">
            <label htmlFor="wolt_check_interval">Polling Interval</label>
            <select
              id="wolt_check_interval"
              value={config.check_interval_minutes}
              onChange={(e) => setConfig({ ...config, check_interval_minutes: Number(e.target.value) })}
              className="wolt-select"
            >
              <option value={1}>1 Minute (Active Foreground)</option>
              <option value={2}>2 Minutes (Recommended)</option>
              <option value={3}>3 Minutes</option>
              <option value={5}>5 Minutes</option>
              <option value={10}>10 Minutes</option>
            </select>
          </div>

          <div className="wolt-form-group half">
            <label htmlFor="wolt_min_level">Notify Minimum Level</label>
            <select
              id="wolt_min_level"
              value={config.min_notify_level}
              onChange={(e) => setConfig({ ...config, min_notify_level: e.target.value })}
              className="wolt-select"
            >
              <option value="SUPPLY_STATE_EXPECT_SOON">⚡ Expect Soon (Medium+)</option>
              <option value="SUPPLY_STATE_OFFERS_FLYING">🔥 Offers Flying (High Only)</option>
            </select>
          </div>
        </div>

        <div className="wolt-form-checkboxes">
          <label className="wolt-checkbox-lbl">
            <input
              type="checkbox"
              checked={config.notify_hotspots}
              onChange={(e) => setConfig({ ...config, notify_hotspots: e.target.checked })}
            />
            <span>Notify on Hotspot Appearances</span>
          </label>

          <label className="wolt-checkbox-lbl">
            <input
              type="checkbox"
              checked={config.sound_enabled}
              onChange={(e) => setConfig({ ...config, sound_enabled: e.target.checked })}
            />
            <span>Sound Alert</span>
          </label>

          <label className="wolt-checkbox-lbl">
            <input
              type="checkbox"
              checked={config.vibration_enabled}
              onChange={(e) => setConfig({ ...config, vibration_enabled: e.target.checked })}
            />
            <span>Vibration Alert</span>
          </label>
        </div>

        <div className="wolt-action-buttons">
          <button
            type="button"
            className="wolt-btn-test"
            onClick={handleTestConnection}
            disabled={testing || !config.auth_token}
          >
            {testing ? 'Testing Endpoint...' : '⚡ Test Connection'}
          </button>
          <button
            type="submit"
            className="wolt-btn-primary"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>

      {/* Raw Diagnostic Output Console when testing */}
      {testResult && (
        <div className="wolt-test-console">
          <div className="wolt-console-title">Diagnostic Test Result</div>
          <pre className="wolt-code-block">
            {JSON.stringify(testResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
