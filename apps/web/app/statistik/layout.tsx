import type { Metadata } from 'next';

// Statistics live in the visitor's own browser storage, so the page is empty for crawlers.
export const metadata: Metadata = {
  title: 'Statistik',
  alternates: { canonical: '/statistik/' },
  robots: { index: false, follow: true },
};

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
