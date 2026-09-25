import type { Metadata, Viewport } from 'next';
import './globals.css';

const description = 'Kontrakt-rommy mod en computer, der træffer det statistisk bedste valg hver gang.';

/**
 * Absolute base for the share image URL (og:image must be absolute). Set
 * NEXT_PUBLIC_SITE_URL for a custom domain; on Vercel the production domain
 * is picked up from the system environment.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://rummy-dusky.vercel.app');

// The share image itself is app/opengraph-image.jpg (with its .alt.txt), added by Next.js automatically.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Løbere og Passere',
  description,
  applicationName: 'Løbere og Passere',
  icons: { icon: '/icon.svg' },
  openGraph: {
    type: 'website',
    locale: 'da_DK',
    url: '/',
    siteName: 'Løbere og Passere',
    title: 'Løbere og Passere',
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Løbere og Passere',
    description,
    images: [
      { url: '/opengraph-image.jpg', alt: 'Løbere og Passere: kontrakt-rommy mod en statistisk optimal computer' },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0d1712',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
