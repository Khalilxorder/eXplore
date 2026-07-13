import './globals.css';
import { getSiteUrl } from './lib/siteUrl';

const siteUrl = getSiteUrl();

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'eXplore',
    template: '%s | eXplore',
  },
  description: 'A sharp-edged personal intelligence filter for news, signal, and meaning.',
  keywords: [
    'content discovery',
    'news filtering',
    'AI releases',
    'signal over noise',
    'written brief',
    'priority radar',
  ],
  applicationName: 'eXplore',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'eXplore - Reach what matters',
    description: 'A sharp-edged personal intelligence filter over the web.',
    url: '/',
    siteName: 'eXplore',
    type: 'website',
    images: [
      {
        url: '/brand-hawk-1024.png',
        width: 1024,
        height: 1024,
        alt: 'eXplore brand mark',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'eXplore - Reach what matters',
    description: 'A sharp-edged personal intelligence filter over the web.',
    images: ['/brand-hawk-1024.png'],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F8FAFD',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
