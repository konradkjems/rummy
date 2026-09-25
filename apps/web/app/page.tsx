import type { Metadata } from 'next';
import Link from 'next/link';
import HomeScreen from '@/components/HomeScreen';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, absoluteUrl, jsonLd } from '@/lib/site';

// Title, description and share cards come from the root layout.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: absoluteUrl('/'),
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: 'da',
    },
    {
      '@type': ['VideoGame', 'WebApplication'],
      '@id': `${SITE_URL}/#game`,
      name: SITE_NAME,
      alternateName: 'Kontrakt-rommy',
      url: absoluteUrl('/'),
      description: SITE_DESCRIPTION,
      image: absoluteUrl('/opengraph-image.jpg'),
      inLanguage: 'da',
      isPartOf: { '@id': `${SITE_URL}/#website` },
      genre: ['Kortspil', 'Rommy'],
      gamePlatform: 'Webbrowser',
      applicationCategory: 'GameApplication',
      operatingSystem: 'Alle (kører i browseren)',
      playMode: 'SinglePlayer',
      numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 3, maxValue: 5 },
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'DKK' },
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(STRUCTURED_DATA)} />
      <HomeScreen>
        <section className="card-panel about">
          <h2>Om spillet</h2>
          <p>
            Løbere og Passere er den danske udgave af kontrakt-rommy for 3-5 spillere med to kortspil og fire jokere. Et
            parti går over 7 runder, og hver runde har sin egen kontrakt: en bestemt kombination af passere (3-4 ens) og
            løbere (mindst 4 i træk i samme kulør), som skal lægges ned på én gang. Den, der først slipper sine kort,
            lukker runden, og laveste pointsum efter 7 runder vinder.
          </p>
          <p>
            Her spiller du mod 2-4 computermodstandere direkte i browseren, uden login. På sværeste niveau tæller
            computeren kort, gætter på modstandernes hænder og simulerer tusindvis af fortsættelser før hvert træk.
            Efter hver runde kan du se, hvor dine valg kostede point.
          </p>
          <p>
            <Link href="/regler/">Læs de fulde regler for Løbere og Passere</Link>
          </p>
        </section>
      </HomeScreen>
    </>
  );
}
