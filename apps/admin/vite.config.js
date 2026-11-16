import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:4900';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/auth': { target: API, changeOrigin: true },
      '/me': { target: API, changeOrigin: true },
    },
  },
  build: { outDir: '../../public/admin', emptyOutDir: true },
});
