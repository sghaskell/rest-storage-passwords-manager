import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@splunk': path.resolve(__dirname, 'node_modules/@splunk/dashboard-ui'),
      react: path.resolve(__dirname, 'node_modules/react'),
    },
  },
  build: {
    outDir: 'appserver/static/react',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'appserver/static/react/entry.jsx'),
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
  server: {
    port: 5173,
  },
});
