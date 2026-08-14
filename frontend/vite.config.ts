import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Vite config for the new frontend.
//
// Build output goes to ../dist/public/new/ so it lives alongside the legacy
// bundle at dist/public/assets/. The Express server (dist/index.cjs) serves
// /app-v2/* from that directory.
//
// base='/app-v2/' means all asset URLs in the built HTML/JS are prefixed with
// /app-v2/ — required because that's the URL prefix Express mounts.

export default defineConfig({
  plugins: [react()],
  base: '/app-v2/',
  build: {
    outDir: resolve(__dirname, '../dist/public/new'),
    emptyOutDir: true,
    sourcemap: true,
    // Keep the manifest so the server can look up hashed filenames if we ever
    // need SSR or asset-preloading. Cheap insurance.
    manifest: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Local dev: proxy API calls to a locally-running Express instance.
      // In production the same-origin case handles this without proxy.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
