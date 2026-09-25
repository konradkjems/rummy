import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTRACTS, describeContract } from '@kova/rummy-engine';
import { SITE_NAME, absoluteUrl, jsonLd, socialMetadata } from '@/lib/site';

const TITLE = 'Regler for Løbere og Passere (kontrakt-rommy)';
const DESCRIPTION =
  'Sådan spiller man Løbere og Passere: opstilling, passere og løbere, kontrakterne i de 7 runder, køb, point og husregler.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/regler/' },
  ...socialMetadata(TITLE, DESCRIPTION, '/regler/'),
};

const BREADCRUMBS = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: SITE_NAME, item: absoluteUrl('/') },
    { '@type': 'ListItem', position: 2, name: 'Regler', item: absoluteUrl('/regler/') },
  ],
};

export default function RulesPage() {
  return (
    <main className="page rules">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(BREADCRUMBS)} />
      <nav className="page-nav">
        <Link href="/">← Forsiden</Link>
      </nav>
      <h1>Regler for Løbere og Passere</h1>
      <p className="lead">
        Løbere og Passere er kontrakt-rommy på dansk: 7 runder, hvor hver runde har sin egen kontrakt af passere og
        løbere, der skal lægges ned, før man må komme af med resten af sine kort.
      </p>

      <section className="card-panel">
        <h2>Opstilling</h2>
        <p>
          3-5 spillere. To almindelige kortspil og alle fire jokere (108 kort). Hver spiller får 11 kort. Resten ligger
          som lukket bunke, og det øverste kort vendes som afsmidningsbunke.
        </p>
      </section>

      <section className="card-panel">
        <h2>Kombinationer</h2>
        <ul>
          <li>
            <strong>Passer:</strong> mindst 3 kort af samme værdi i forskellige kulører (højst 4, én af hver kulør).
          </li>
          <li>
            <strong>Løber:</strong> mindst 4 kort i træk i samme kulør. Es er enten højt (B-D-K-E) eller lavt (E-2-3-4),
            aldrig begge dele i samme løber.
          </li>
          <li>
            <strong>Joker:</strong> erstatter et hvilket som helst kort. En melding skal have mindst ét rigtigt kort.
          </li>
        </ul>
      </section>

      <section className="card-panel">
        <h2>De 7 runder</h2>
        <table className="score-table">
          <thead>
            <tr>
              <th>Runde</th>
              <th>Kontrakt</th>
            </tr>
          </thead>
          <tbody>
            {CONTRACTS.map((c, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{describeContract(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card-panel">
        <h2>En tur</h2>
        <ol>
          <li>
            <strong>Træk</strong> fra den lukkede bunke eller tag det øverste kort fra afsmidningsbunken.
          </li>
          <li>
            <strong>Læg ned</strong> (valgfrit). Første gang skal hele rundens kontrakt lægges på én gang – gerne med
            ekstra kort og ekstra kombinationer. Når man er åben, må man bygge videre på alle meldinger på bordet.
          </li>
          <li>
            <strong>Smid</strong> ét kort. Det er obligatorisk, medmindre du netop har lagt dit sidste kort.
          </li>
        </ol>
      </section>

      <section className="card-panel">
        <h2>Køb</h2>
        <p>
          Når et kort smides, har næste spiller første ret til at tage det som sit træk. Siger vedkommende nej, må alle
          andre råbe »Køb!« – den første vinder. Prisen er ét strafkort fra den lukkede bunke, så hånden vokser med to.
          Købte kort må først lægges ned i ens egen tur.
        </p>
      </section>

      <section className="card-panel">
        <h2>Rundens afslutning og point</h2>
        <p>
          Runden slutter i det øjeblik en spiller slipper sit sidste kort (lagt eller smidt). Lukkeren får 0 point. De
          andre tæller deres hånd: joker 25, es 15, 10/B/D/K 10, 2-9 kortets værdi. Laveste samlede sum efter 7 runder
          vinder.
        </p>
      </section>

      <section className="card-panel">
        <h2>Husregler (kan slås til og fra ved nyt parti)</h2>
        <ul>
          <li>
            <strong>Byg i åbningsturen</strong> (standard: fra): om man må lægge til andres meldinger i samme tur, som
            man åbner.
          </li>
          <li>
            <strong>Byt joker</strong> (standard: til): en åben spiller må bytte en joker på bordet med det kort, den
            står for.
          </li>
          <li>
            <strong>Tom bunke</strong> (standard: bland): afsmidningsbunken (undtagen øverste kort) blandes til ny
            bunke.
          </li>
          <li>
            <strong>Maks. køb pr. runde</strong> (standard: ubegrænset).
          </li>
          <li>
            <strong>Nye meldinger efter åbning</strong> (standard: til): en åben spiller må lægge nye passere og løbere
            i senere ture. Fordi en passer højst kan have fire kort, kan en runde ellers gå i hårdknude, når passerne på
            bordet er fyldt.
          </li>
        </ul>
      </section>

      <p className="rules-cta">
        <Link className="btn btn-primary big" href="/">
          Spil et parti mod computeren
        </Link>
      </p>
    </main>
  );
}
