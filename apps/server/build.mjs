// Bundles the server and its bot worker (workspace packages included) into
// dist/, so the production image needs nothing but Node.
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/main.ts', 'bot-worker': 'src/bot-worker.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // ws probes for optional native add-ons inside try/catch; keep them out of the bundle.
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
