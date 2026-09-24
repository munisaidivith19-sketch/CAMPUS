import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The shared packages publish built JS from `dist/` (what the server loads in production). The
 * web app bundles their TypeScript source instead, so dev hot-reloads package edits and the web
 * build never depends on a stale or missing package build.
 */
const packagesRoot = fileURLToPath(new URL('../../packages/', import.meta.url));
const workspaceAliases = [
  { find: /^@campusconnect\/ui\/tokens$/, replacement: `${packagesRoot}ui/src/tokens.ts` },
  {
    find: /^@campusconnect\/(types|config|security|validation|ui)$/,
    replacement: `${packagesRoot}$1/src/index.ts`,
  },
];

// Vite exposes only VITE_* env vars to the client bundle — never server secrets.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceAliases },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
