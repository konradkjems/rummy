/** @type {import('next').NextConfig} */
const nextConfig = {
  // The MVP is fully client-side (engine and AI run in the browser), so the
  // app is exported as static files that any static host, e.g. Vercel, serves.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ['@kova/rummy-engine', '@kova/rummy-ai'],
};

export default nextConfig;
