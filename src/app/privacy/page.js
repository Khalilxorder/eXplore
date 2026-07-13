import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy',
  description: 'How eXplore handles your account data, preferences, alerts, and saved items.',
};

const EFFECTIVE_DATE = 'June 2025';
const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'hello@getexplore.app';

export default function PrivacyPage() {
  return (
    <main className="container" style={{ paddingTop: 'var(--space-xl)', paddingBottom: 'var(--space-2xl)' }}>
      <section className="card" style={{ display: 'grid', gap: 'var(--space-medium)' }}>
        <div>
          <p className="page-kicker">Privacy Policy</p>
          <h1 style={{ font: 'var(--font-h1)', marginTop: 'var(--space-tight)' }}>Privacy Policy</h1>
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-tertiary)', marginTop: 'var(--space-tight)' }}>
            Effective {EFFECTIVE_DATE}
          </p>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-secondary)', marginTop: 'var(--space-small)', maxWidth: '70ch' }}>
            eXplore uses account and preference data to personalize the feed, sync saved items, and deliver alerts.
            This policy explains what we collect, why, and your choices.
          </p>
        </div>

        <div className="balanced-grid">
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>Developer and contact</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              eXplore is responsible for this app and privacy policy. For privacy questions, support,
              or data requests, email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>What we collect</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Email address and password (for account holders), feed preferences, saved items, reading history,
              alert settings, and device identifiers needed for push notifications.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>How we use it</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              To rank signal, keep preferences in sync across devices, route alerts to your device,
              and improve the product experience over time.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>What we do not do</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              We do not sell personal data to third parties. We do not use your account data
              for unrelated advertising or profiling.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>Data storage</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              Account data is stored through Supabase and backend hosting providers used to run eXplore.
              Firebase may process device push tokens for notifications. Local preferences and cached feed
              items may also be stored in your browser or device storage.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>Your choices</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              You can browse in guest mode without an account. Signed-in users can clear local cache,
              adjust alert preferences, and sign out at any time from the You tab.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>Data deletion</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              To request deletion of your account and associated data, use the
              {' '}<Link href="/account-deletion/" prefetch={false}>account deletion page</Link>{' '}
              or email {supportEmail}. We will process requests within 30 days.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>Cookies and tracking</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              We use session cookies for authentication and localStorage for feed caching and preferences.
              We do not use third-party tracking cookies.
            </p>
          </div>
          <div className="subtle-panel">
            <h2 style={{ font: 'var(--font-h3)' }}>Policy updates</h2>
            <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
              We may update this policy from time to time. Significant changes will be communicated
              in the app. Continued use after changes constitutes acceptance.
            </p>
          </div>
        </div>
      </section>

      <div style={{ marginTop: 'var(--space-medium)', display: 'flex', gap: 'var(--space-small)', flexWrap: 'wrap' }}>
        <Link className="btn btn-secondary" href="/" prefetch={false}>Back home</Link>
        <Link className="btn btn-ghost" href="/terms/" prefetch={false}>Terms</Link>
        <Link className="btn btn-ghost" href="/contact/" prefetch={false}>Contact</Link>
        <Link className="btn btn-ghost" href="/account-deletion/" prefetch={false}>Delete account</Link>
      </div>
    </main>
  );
}
