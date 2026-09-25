/**
 * Site-wide SEO settings. Everything is resolved at build time (static export).
 *
 * SITE_URL: NEXT_PUBLIC_SITE_URL for a custom domain, otherwise Vercel's
 * production domain, otherwise rummy-dusky.vercel.app.
 */
import type { Metadata } from 'next';

export const SITE_NAME = 'Løbere og Passere';

export const HOME_TITLE = 'Løbere og Passere: spil kontrakt-rommy online mod computeren';

export const SITE_DESCRIPTION =
  'Spil det danske kortspil Løbere og Passere (kontrakt-rommy) gratis i browseren mod en computer, der træffer det statistisk bedste valg hver gang.';

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://rummy-dusky.vercel.app')
).replace(/\/+$/, '');

/** Absolute URL for a path on the site ("/regler/" -> "https://.../regler/"). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * app/opengraph-image.jpg. The file convention only fills og:image on pages
 * that inherit the root layout's block, so pages with their own block (and
 * every Twitter card) reference it explicitly. Alt text = opengraph-image.alt.txt.
 */
const SHARE_IMAGE = {
  url: '/opengraph-image.jpg',
  width: 1200,
  height: 630,
  type: 'image/jpeg',
  alt: 'Løbere og Passere: en løber i hjerter (9, 10, knægt, dame og en joker) på et grønt spillebord, et orange »KØB?«-skilt og teksten »Spil mod en computer, der træffer det statistisk bedste valg hver eneste gang.«',
};

/**
 * Open Graph and Twitter blocks for a page. A page that sets either key
 * replaces the layout's block entirely, so every page gets the full set.
 */
export function socialMetadata(
  title: string,
  description: string,
  path: string,
): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    openGraph: {
      type: 'website',
      locale: 'da_DK',
      siteName: SITE_NAME,
      url: path,
      title,
      description,
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [SHARE_IMAGE],
    },
  };
}

/** Serialize JSON-LD for a <script type="application/ld+json"> tag. */
export function jsonLd(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') };
}
