import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  esbuild: mode === 'production' ? {
    legalComments: 'none',
    drop: ['debugger'],
  } : undefined,
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    assetsInlineLimit: 2_048,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react-router') || id.includes('react-router-dom')) return 'router-vendor';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:10000',
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
      },
    },
  },
}));
