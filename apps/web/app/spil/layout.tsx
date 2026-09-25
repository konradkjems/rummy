import type { Metadata, Viewport } from 'next';

// The game table is an app screen with no content of its own: keep it out of the index.
export const metadata: Metadata = {
  title: 'Spil',
  alternates: { canonical: '/spil/' },
  robots: { index: false, follow: true },
};

// Lock zoom so double taps and pinches on cards don't rescale the table.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0d1712',
};

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
