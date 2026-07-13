import Link from 'next/link';

const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'hello@getexplore.app';

export const metadata = {
  title: 'Account Deletion',
  description: 'Request deletion of an eXplore account and associated account data.',
};

export default function AccountDeletionPage() {
  const mailtoHref = `mailto:${supportEmail}?subject=eXplore%20account%20deletion%20request`;

  return (
    <main className="container" style={{ paddingTop: 'var(--space-xl)', paddingBottom: 'var(--space-2xl)' }}>
      <section className="card" style={{ display: 'grid', gap: 'var(--space-medium)' }}>
        <div>
          <p className="page-kicker">Account Deletion</p>
          <h1 style={{ font: 'var(--font-h1)', marginTop: 'var(--space-tight)' }}>Delete your eXplore account</h1>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginTop: 'var(--space-small)', maxWidth: '70ch' }}>
            You can request deletion of your account, saved items, preferences, alert settings, and device notification tokens.
          </p>
        </div>

        <div className="balanced-grid">
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>How to request deletion</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Email <a href={mailtoHref}>{supportEmail}</a> from the email address connected to your account.
              Include the phrase &quot;delete my eXplore account&quot; so the request is routed correctly.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>What is deleted</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Account identity, saved content, collections, preferences, alert settings, and push notification tokens
              are deleted or anonymized where deletion is not technically possible.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>What may remain</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Security logs, billing records, and abuse-prevention records may be retained only when required for
              legal, accounting, security, or fraud-prevention reasons.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>Timing</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              We process deletion requests within 30 days and may ask for confirmation when the request cannot be
              safely matched to an account.
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
