import type { Metadata, Viewport } from 'next';

// A table exists only while people sit at it: nothing for search engines.
export const metadata: Metadata = {
  title: 'Online bord',
  alternates: { canonical: '/online/bord/' },
  robots: { index: false, follow: true },
};

// Same as the solo table: no accidental zoom while tapping cards.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0d1712',
};

export default function TableLayout({ children }: { children: React.ReactNode }) {
  return children;
}
