/** @type {import('next').NextConfig} */
const nextConfig = {
  // Solo play is fully client-side (engine and AI run in the browser) and
  // online play talks to the separate game server (apps/server), so the app
  // is exported as static files that any static host, e.g. Vercel, serves.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ['@kova/rummy-engine', '@kova/rummy-ai', '@kova/rummy-net'],
};

export default nextConfig;
