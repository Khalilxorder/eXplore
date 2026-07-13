'use client';
import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';
import { buildPublicUrl, getGoogleAuthRedirectUrl } from '../lib/mobile';

export default function AuthScreen({ onSkip, embedded = false }) {
  const {
    authError,
    clearAuthError,
    googleAuthChecked,
    googleAuthEnabled,
    hasSupabase,
    signIn,
    signInWithGoogle,
    signUp,
  } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const displayError = error || authError;
  const googleButtonDisabled = loading || !hasSupabase || !googleAuthChecked || googleAuthEnabled === false;
  const showGoogleSignIn = true;
  const googleRedirectUrl = getGoogleAuthRedirectUrl();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setInfo('');
    clearAuthError();

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError('Enter your email address.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      const fn = mode === 'login' ? signIn : signUp;
      const result = await fn(normalizedEmail, password);
      const nextError = result?.error;

      if (nextError) {
        setError(nextError);
      } else if (mode === 'register' && result?.confirmationRequired) {
        setInfo('Check your email to confirm your account, then sign in.');
      } else if (mode === 'register') {
        setInfo('Account created. Signing you in now.');
      } else {
        setInfo('Signed in.');
      }
    } catch (submitError) {
      setError(submitError?.message || 'Sign-in failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setInfo('');
    clearAuthError();
    setLoading(true);

    try {
      const result = await signInWithGoogle();
      if (result?.error) {
        setError(result.error);
      } else {
        setInfo('Opening Google sign-in.');
      }
    } catch (googleError) {
      setError(googleError?.message || 'Google sign-in failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Enter your email address above, then click forgot password.');
      return;
    }
    setResetLoading(true);
    setError('');
    setInfo('');
    try {
      if (supabase) {
        await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: buildPublicUrl('/auth/callback'),
        });
      }
      setResetSent(true);
    } catch (resetError) {
      setError(resetError?.message || 'Could not send reset email right now. Try again shortly.');
    } finally {
      setResetLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
    setInfo('');
    setResetSent(false);
    clearAuthError();
  };

  return (
    <div className="page-enter" style={{
      minHeight: embedded ? 'auto' : '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: embedded ? 'flex-start' : 'center',
      padding: embedded ? 'var(--space-large) var(--space-base)' : 'var(--space-xl) var(--space-base)',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 'var(--space-base)' }}>
        <h1 style={{
          fontSize: '2.5rem',
          fontWeight: 800,
          color: 'var(--accent)',
          letterSpacing: 0,
          marginBottom: 0,
        }}>
          eXplore
        </h1>
      </div>

      <div style={{
        width: '100%',
        maxWidth: embedded ? '420px' : '360px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-large)',
      }}>
        <h2 style={{ font: 'var(--font-h2)', marginBottom: 'var(--space-medium)', textAlign: 'center' }}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
          <div>
            <label style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Email
            </label>
            <div className="search-bar">
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Password
              </label>
              {mode === 'login' && hasSupabase && (
                <button
                  type="button"
                  style={{ font: 'var(--font-caption)', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                >
                  {resetLoading ? 'Sending...' : 'Forgot password?'}
                </button>
              )}
            </div>
            <div className="search-bar">
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>
          </div>

          {resetSent && (
            <p style={{ font: 'var(--font-caption)', color: 'var(--success)', textAlign: 'center' }}>
              Password reset email sent.
            </p>
          )}

          {displayError && (
            <p style={{ font: 'var(--font-caption)', color: 'var(--error)', textAlign: 'center' }}>
              {displayError}
            </p>
          )}

          {info && !displayError && (
            <p style={{ font: 'var(--font-caption)', color: 'var(--success)', textAlign: 'center' }}>
              {info}
            </p>
          )}

          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading || !hasSupabase}
            style={{ marginTop: 'var(--space-tight)', width: '100%' }}
          >
            {loading ? 'Loading...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {showGoogleSignIn ? (
          <>
            <div className="divider" style={{ margin: 'var(--space-base) 0' }} />
            
            {!hasSupabase && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--error)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-small)',
                marginBottom: 'var(--space-small)',
                fontSize: '13px',
                color: 'var(--text-primary)'
              }}>
                <strong style={{ color: 'var(--error)', display: 'block', marginBottom: '4px' }}>⚠️ Supabase Not Configured</strong>
                eXplore requires a Supabase connection. Please verify that <code style={{ background: 'var(--chrome-bg)', padding: '2px 4px', borderRadius: '3px' }}>NEXT_PUBLIC_SUPABASE_URL</code> and <code style={{ background: 'var(--chrome-bg)', padding: '2px 4px', borderRadius: '3px' }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set in your <code style={{ background: 'var(--chrome-bg)', padding: '2px 4px', borderRadius: '3px' }}>.env.local</code>.
                <div style={{ marginTop: '6px', fontStyle: 'italic', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Tip: Sync machine config using <code style={{ background: 'var(--chrome-bg)', padding: '1px 3px' }}>npm run config:sync</code>
                </div>
              </div>
            )}

            {hasSupabase && googleAuthEnabled === false && (
              <div style={{
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid var(--warning)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-small)',
                marginBottom: 'var(--space-small)',
                fontSize: '13px',
                color: 'var(--text-primary)'
              }}>
                <strong style={{ color: 'var(--warning)', display: 'block', marginBottom: '4px' }}>⚠️ Google Sign-In Disabled</strong>
                Google provider is not enabled in your Supabase project. To enable it:
                <ol style={{ margin: '6px 0', paddingLeft: '20px', lineHeight: '1.4' }}>
                  <li>Go to your <strong>Supabase Dashboard</strong> &rarr; <strong>Authentication</strong> &rarr; <strong>Providers</strong> &rarr; <strong>Google</strong>.</li>
                  <li>Toggle <strong>Enable Google</strong> to ON.</li>
                  <li>Enter your Google Client ID and Secret.</li>
                  <li>Add this redirect URI in Google Cloud Console:
                    <div style={{
                      fontFamily: 'monospace',
                      background: 'var(--chrome-bg)',
                      padding: '4px',
                      borderRadius: '3px',
                      wordBreak: 'break-all',
                      marginTop: '4px',
                      fontSize: '11px'
                    }}>
                      {googleRedirectUrl}
                    </div>
                  </li>
                </ol>
              </div>
            )}

            <button
              className="btn btn-secondary"
              type="button"
              style={{ width: '100%', marginBottom: 'var(--space-small)' }}
              onClick={handleGoogleSignIn}
              disabled={googleButtonDisabled}
            >
              {!hasSupabase
                ? 'Google Sign-in Unavailable'
                : !googleAuthChecked
                  ? 'Checking Google...'
                  : googleAuthEnabled === false
                    ? 'Google sign-in disabled'
                  : mode === 'login' ? 'Sign in with Google' : 'Sign up with Google'}
            </button>

            {displayError && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-small)',
                marginBottom: 'var(--space-small)',
                fontSize: '12px',
                textAlign: 'left',
                color: 'var(--text-secondary)'
              }}>
                <strong style={{ color: 'var(--error)', display: 'block', marginBottom: '4px' }}>💡 Troubleshooting OAuth Issues:</strong>
                {/pkce|code verifier/i.test(displayError) ? (
                  <span>
                    <strong>Security Verifier (PKCE) Mismatch:</strong> This happens if the OAuth flow was interrupted or completed in an external/different browser window. Please click the <strong>Google Sign-in</strong> button above to restart the session cleanly.
                  </span>
                ) : (
                  <span>
                    Error: {displayError}. Ensure you are not using an aggressive ad-blocker or private browsing mode that blocks redirect cookies.
                  </span>
                )}
              </div>
            )}

            {googleAuthEnabled === true && (
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', textAlign: 'center', margin: '0 0 var(--space-small)' }}>
                Redirect URI: <code style={{ fontSize: '10px' }}>{googleRedirectUrl}</code>
              </p>
            )}
          </>
        ) : null}

        <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            className="btn-ghost"
            style={{ color: 'var(--accent)', fontWeight: 600, padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={toggleMode}
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>

      <div style={{ marginTop: 'var(--space-base)', textAlign: 'center', maxWidth: embedded ? '420px' : '360px' }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onSkip}
          style={{ color: 'var(--text-secondary)' }}
        >
          Continue without account
        </button>
      </div>
    </div>
  );
}
