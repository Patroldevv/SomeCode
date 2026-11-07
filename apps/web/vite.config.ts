import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const server = process.env['SOMECODE_SERVER'] ?? 'http://127.0.0.1:5174';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': server,
      '/ws': { target: server, ws: true },
    },
  },
});
