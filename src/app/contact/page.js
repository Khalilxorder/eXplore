import Link from 'next/link';

const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'hello@getexplore.app';

export const metadata = {
  title: 'Contact',
  description: 'Ways to reach the eXplore team for support, feedback, or press inquiries.',
};

export default function ContactPage() {
  return (
    <main className="container" style={{ paddingTop: 'var(--space-xl)', paddingBottom: 'var(--space-2xl)' }}>
      <section className="card" style={{ display: 'grid', gap: 'var(--space-medium)' }}>
        <div>
          <p className="page-kicker">Contact</p>
          <h1 style={{ font: 'var(--font-h1)', marginTop: 'var(--space-tight)' }}>Get in touch</h1>
                    <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginTop: 'var(--space-small)', maxWidth: '70ch' }}>
            Use this page for support, feedback, partnerships, or press questions.
          </p>
        </div>

        <div className="subtle-panel">
          <h2 style={{ font: 'var(--font-h3)' }}>Email</h2>
          <a href={`mailto:${supportEmail}`} style={{ font: 'var(--font-body)' }}>{supportEmail}</a>
        </div>

        <div className="subtle-panel">
          <h2 style={{ font: 'var(--font-h3)' }}>Best for</h2>
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
            Account issues, product feedback, deployment questions, and launch follow-up.
          </p>
        </div>
      </section>

      <div style={{ marginTop: 'var(--space-medium)', display: 'flex', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
        <Link className="btn btn-secondary" href="/" prefetch={false}>Back home</Link>
        <Link className="btn btn-ghost" href="/privacy/" prefetch={false}>Privacy</Link>
        <Link className="btn btn-ghost" href="/terms/" prefetch={false}>Terms</Link>
      </div>
    </main>
  );
}
