import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Løbere og Passere',
    short_name: 'Løbere',
    description: 'Kontrakt-rommy mod en statistisk optimal computer.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0d1712',
    theme_color: '#0d1712',
    lang: 'da',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
