'use client';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { getNotificationState } from '../lib/notifications';
import { getPushNotificationState, loadRememberedPushDevice } from '../lib/pushNotifications';
import { fetchNotificationStatus, fetchSystemReadiness, apiFetch } from '../lib/api';

export default function AuthStatusScreen({ onBack }) {
  const { user, session } = useAuth();
  const [checkingBackend, setCheckingBackend] = useState(true);
  const [backendTokenAccepted, setBackendTokenAccepted] = useState(null);
  const [backendError, setBackendError] = useState('');
  const [deviceRegistered, setDeviceRegistered] = useState(null);
  const [notificationsAllowed, setNotificationsAllowed] = useState(null);
  const [pushSupport, setPushSupport] = useState(null);
  const [systemReadiness, setSystemReadiness] = useState(null);

  useEffect(() => {
    let active = true;

    async function checkStatus() {
      try {
        // 1. Check Notifications & Push state
        const notifState = await getNotificationState();
        const pushState = await getPushNotificationState();
        if (active) {
          setNotificationsAllowed(notifState?.permission || 'default');
          setPushSupport(pushState?.supported ? 'Supported' : 'Not supported');
        }

        // 2. Check Backend token and Device registration
        setCheckingBackend(true);
        const [readiness, notifStatus] = await Promise.all([
          fetchSystemReadiness().catch((err) => {
            console.error('Readiness check failed', err);
            return null;
          }),
          fetchNotificationStatus().catch((err) => {
            console.error('Notification status check failed', err);
            return { error: err.message || 'Unauthorized' };
          })
        ]);

        if (!active) return;

        if (readiness) {
          setSystemReadiness(readiness);
        }

        if (notifStatus && !notifStatus.error) {
          setBackendTokenAccepted(true);
          setDeviceRegistered(notifStatus.push_registered ? 'Registered' : 'Not Registered');
        } else {
          setBackendTokenAccepted(false);
          setBackendError(notifStatus?.error || 'Authentication token rejected or backend unreachable.');
          setDeviceRegistered('Unknown');
        }
      } catch (err) {
        if (active) {
          setBackendTokenAccepted(false);
          setBackendError(err.message || 'Failed to communicate with backend.');
          setDeviceRegistered('Unknown');
        }
      } finally {
        if (active) {
          setCheckingBackend(false);
        }
      }
    }

    void checkStatus();

    return () => {
      active = false;
    };
  }, [user]);

  const provider = user?.app_metadata?.provider || user?.identities?.[0]?.provider || 'N/A';
  const rememberedDevice = loadRememberedPushDevice();

  return (
    <div className="container page-enter" style={{ padding: 'var(--space-base) var(--space-base) var(--space-xl)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-small)', marginBottom: 'var(--space-large)' }}>
        <button
          onClick={onBack}
          className="btn btn-ghost btn-sm"
          style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          &larr; Back
        </button>
        <h1 style={{ font: 'var(--font-h2)', margin: 0 }}>Auth & Notification Status</h1>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
        {/* Section 1: Authentication */}
        <div className="card" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
          <h2 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-small)', color: 'var(--accent)' }}>
            🔑 Authentication Details
          </h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Status</span>
              <strong style={{ color: user ? 'var(--success)' : 'var(--error)' }}>
                {user ? 'Signed In' : 'Not Signed In'}
              </strong>
            </div>

            {user && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Account Email</span>
                  <span style={{ fontWeight: 600 }}>{user.email}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Provider</span>
                  <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{provider}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>User ID</span>
                  <span style={{ fontStyle: 'italic', fontSize: '12px' }}>{user.id}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Section 2: Session Details */}
        <div className="card" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
          <h2 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-small)', color: 'var(--accent)' }}>
            ⏱️ Supabase Session
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Session Active</span>
              <strong style={{ color: session ? 'var(--success)' : 'var(--error)' }}>
                {session ? 'Active' : 'No Session'}
              </strong>
            </div>

            {session && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Expires At</span>
                  <span style={{ fontSize: '13px' }}>
                    {new Date(session.expires_at * 1000).toLocaleString()}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Access Token (JWT)</span>
                  <span style={{
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    background: 'var(--chrome-bg)',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-soft)'
                  }}>
                    {session.access_token.slice(0, 30)}...{session.access_token.slice(-30)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Section 3: Backend Verification */}
        <div className="card" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
          <h2 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-small)', color: 'var(--accent)' }}>
            🖥️ Backend Verification
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Backend Token Accepted</span>
              {checkingBackend ? (
                <span style={{ color: 'var(--text-secondary)' }}>Verifying...</span>
              ) : (
                <strong style={{ color: backendTokenAccepted ? 'var(--success)' : 'var(--error)' }}>
                  {backendTokenAccepted ? 'Accepted (200 OK)' : 'Rejected / Unreachable'}
                </strong>
              )}
            </div>

            {!checkingBackend && !backendTokenAccepted && (
              <div style={{ color: 'var(--error)', fontSize: '13px', background: 'var(--error-light)', padding: '8px', borderRadius: '4px' }}>
                <strong>Error details:</strong> {backendError}
              </div>
            )}

            {systemReadiness && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Backend Environment</span>
                <span>{systemReadiness.runtime?.env || 'production'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Section 4: Notifications & Device */}
        <div className="card" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
          <h2 style={{ font: 'var(--font-h3)', marginBottom: 'var(--space-small)', color: 'var(--accent)' }}>
            📱 Notifications & Device Info
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Notifications Allowed</span>
              <strong style={{
                color: notificationsAllowed === 'granted' ? 'var(--success)' : notificationsAllowed === 'denied' ? 'var(--error)' : 'var(--warning)'
              }}>
                {notificationsAllowed ? notificationsAllowed.toUpperCase() : 'UNKNOWN'}
              </strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Push Support</span>
              <span>{pushSupport || 'Checking...'}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Device Registered (Backend)</span>
              <strong style={{ color: deviceRegistered === 'Registered' ? 'var(--success)' : 'var(--text-secondary)' }}>
                {deviceRegistered || 'Checking...'}
              </strong>
            </div>

            {rememberedDevice && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Registered Push Token</span>
                <span style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  background: 'var(--chrome-bg)',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-soft)'
                }}>
                  {rememberedDevice.token || 'No token stored'}
                </span>
                {rememberedDevice.device_id && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Device ID</span>
                    <span style={{ fontSize: '12px', fontFamily: 'monospace' }}>{rememberedDevice.device_id}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
