import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', paddingTop: 'var(--space-xl)', paddingBottom: 'var(--space-xl)' }}>
      <section className="card" style={{ width: 'min(560px, 100%)', textAlign: 'center', display: 'grid', gap: 'var(--space-medium)' }}>
        <div>
          <p className="page-kicker">404</p>
          <h1 style={{ font: 'var(--font-h1)', marginTop: 'var(--space-tight)' }}>Page not found</h1>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginTop: 'var(--space-small)' }}>
            The page you requested does not exist, or the link is out of date.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-small)', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link className="btn btn-primary" href="/">Go home</Link>
          <Link className="btn btn-secondary" href="/#auth-panel">Open the app</Link>
        </div>
      </section>
    </main>
  );
}
