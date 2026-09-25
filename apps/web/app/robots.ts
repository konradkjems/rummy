import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site';

export const dynamic = 'force-static';

// Everything stays crawlable: /spil/ and /statistik/ opt out with a noindex meta tag,
// which crawlers can only see if they are allowed to fetch the page.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
