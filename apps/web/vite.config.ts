import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite exposes only VITE_* env vars to the client bundle — never server secrets.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
