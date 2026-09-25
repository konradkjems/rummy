import type { Metadata, Viewport } from 'next';
import { HOME_TITLE, SITE_DESCRIPTION, SITE_NAME, SITE_URL, socialMetadata } from '@/lib/site';
import './globals.css';

// Share image: app/opengraph-image.jpg (+ .alt.txt). Icons: app/icon.svg, app/apple-icon.png, app/favicon.ico.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: HOME_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: 'games',
  keywords: [
    'løbere og passere',
    'kontrakt-rommy',
    'kontraktrommy',
    'rommy',
    'kortspil',
    'kortspil online',
    'passer',
    'løber',
    'regler',
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  // Google Search Console: set GOOGLE_SITE_VERIFICATION in Vercel to the value of the "HTML tag" method.
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
  formatDetection: { telephone: false, email: false, address: false },
  ...socialMetadata(HOME_TITLE, SITE_DESCRIPTION, '/'),
};

// Pages stay zoomable; the game table (app/spil/layout.tsx) locks zoom for touch play.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
