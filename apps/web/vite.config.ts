import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  optimizeDeps: {
    exclude: ['@novnc/novnc']
  },
  esbuild: {
    target: 'esnext'
  },
  build: {
    target: 'esnext'
  },
  resolve: {
    alias: {
      '@keepalive/shared-types': path.resolve(__dirname, '../../packages/shared-types/src')
    }
  }
});
