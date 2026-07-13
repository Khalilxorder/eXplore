import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service',
  description: 'Terms of service for eXplore — your personal intelligence feed.',
};

const EFFECTIVE_DATE = 'June 2025';

export default function TermsPage() {
  return (
    <main className="container" style={{ paddingTop: 'var(--space-xl)', paddingBottom: 'var(--space-2xl)' }}>
      <section className="card" style={{ display: 'grid', gap: 'var(--space-medium)' }}>
        <div>
          <p className="page-kicker">Terms of Service</p>
          <h1 style={{ font: 'var(--font-h1)', marginTop: 'var(--space-tight)' }}>Terms of Service</h1>
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginTop: 'var(--space-tight)' }}>
            Effective {EFFECTIVE_DATE}
          </p>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginTop: 'var(--space-small)', maxWidth: '70ch' }}>
            By using eXplore you agree to these terms. Please read them carefully.
          </p>
        </div>

        <div className="balanced-grid">
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>1. Acceptance</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              By accessing or using eXplore, you agree to be bound by these Terms. If you do not agree, do not use the service.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>2. Use of the service</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              eXplore is a personal intelligence filter. You may use it for lawful personal purposes only.
              Do not attempt to disrupt, reverse-engineer, or misuse the service.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>3. Account responsibility</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Keep your credentials secure. You are responsible for all activity under your account.
              Notify us immediately if you suspect unauthorized access.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>4. Third-party content</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Content previews and links come from external publishers and APIs with their own terms.
              eXplore is not responsible for the accuracy or availability of third-party content.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>5. Subscriptions and billing</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Paid plans are billed on the cycle selected at checkout. You may cancel anytime.
              Refunds are handled according to our 30-day satisfaction guarantee where applicable.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>6. Availability</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              The service may change, pause, or lose access to sources if upstream providers or hosting constraints change.
              We will provide reasonable notice where possible.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>7. Limitation of liability</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              eXplore is provided &quot;as is&quot;. We are not liable for decisions made based on information surfaced by the app.
              Always verify critical information from authoritative sources.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>8. Changes to terms</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              We may update these Terms from time to time. Continued use after changes means you accept the updated terms.
            </p>
          </div>
        </div>
      </section>

      <div style={{ marginTop: 'var(--space-medium)', display: 'flex', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
        <Link className="btn btn-secondary" href="/" prefetch={false}>Back home</Link>
        <Link className="btn btn-ghost" href="/privacy/" prefetch={false}>Privacy</Link>
        <Link className="btn btn-ghost" href="/contact/" prefetch={false}>Contact</Link>
      </div>
    </main>
  );
}
