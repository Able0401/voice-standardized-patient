import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single page, single build to dist/.
// Locally, /api/demo is proxied to functions/dev.js on port 8788.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    port: 5173,
    proxy: { '/api/demo': { target: 'http://localhost:8788', changeOrigin: true } },
  },
});
