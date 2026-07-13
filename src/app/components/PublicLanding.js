'use client';

import Link from 'next/link';

export default function PublicLanding({ authenticated = false, loading = false, onOpenApp }) {
  const status = loading ? 'Loading' : authenticated ? 'Signed in' : 'Ready';
  const action = authenticated ? 'Open eXplore' : 'Continue';

  return (
    <section
      className="container page-enter"
      style={{
        minHeight: 'calc(100vh - 120px)',
        display: 'grid',
        placeItems: 'center',
        paddingTop: 'var(--space-xl)',
        paddingBottom: 'var(--space-xl)',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: 'var(--space-xl)',
          textAlign: 'center',
          background: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        <span className={`status-pill ${loading ? 'is-empty' : authenticated ? 'is-live' : 'is-partial'}`}>
          {status}
        </span>

        <h1
          style={{
            marginTop: 'var(--space-base)',
            fontSize: '2.7rem',
            lineHeight: 1,
            fontWeight: 800,
            color: 'var(--accent)',
            letterSpacing: 0,
          }}
        >
          eXplore
        </h1>

        <p
          style={{
            margin: 'var(--space-small) auto 0',
            maxWidth: '28ch',
            color: 'var(--text-secondary)',
            font: 'var(--font-caption)',
          }}
        >
          Sign in to sync. Continue to explore now.
        </p>

        <div style={{ display: 'grid', gap: 'var(--space-small)', marginTop: 'var(--space-large)' }}>
          <button type="button" className="btn btn-primary" onClick={onOpenApp} disabled={loading}>
            {action}
          </button>
          <Link className="btn btn-secondary" href="#auth-panel" prefetch={false}>
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
