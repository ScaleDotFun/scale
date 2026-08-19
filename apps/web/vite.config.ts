import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  define: {
    'process.env': {},
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: Number(process.env.PORT) || 3000,
    proxy: {
      '/api': {
        target: process.env.DEV_API_PROXY || 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-motion': ['framer-motion'],
          'vendor-charts': ['lightweight-charts'],
        },
      },
    },
  },
});
