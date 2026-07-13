'use client';

import { useEffect, useState } from 'react';
import { clearBrowserAuthParams, finishAuthFromUrl } from '../../lib/supabase';

export default function AuthCallbackPage() {
  const [message, setMessage] = useState('Completing sign-in...');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const complete = async () => {
      const result = await finishAuthFromUrl(window.location.href);
      if (cancelled) {
        return;
      }

      if (result?.error) {
        setMessage(result.error);
        setFailed(true);
        clearBrowserAuthParams();
        return;
      }

      setMessage('Signed in. Opening eXplore...');
      setFailed(false);
      clearBrowserAuthParams();
      window.setTimeout(() => {
        window.location.replace('/');
      }, 250);
    };

    void complete();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--bg)',
        color: 'var(--text-primary)',
      }}
    >
      <section
        className="card"
        style={{
          width: 'min(420px, 100%)',
          textAlign: 'center',
        }}
      >
        <h1 style={{ marginTop: 0 }}>eXplore</h1>
        <p style={{ marginBottom: failed ? 20 : 0, color: 'var(--text-secondary)' }}>{message}</p>
        {failed ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              window.location.replace('/');
            }}
          >
            Restart sign-in
          </button>
        ) : null}
      </section>
    </main>
  );
}
