import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const server = process.env['SOMECODE_SERVER'] ?? 'http://127.0.0.1:5174';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The largest chunk is Shiki's lazily loaded C++ grammar (~800 kB raw, ~61 kB gzip), fetched only for a
    // ```cpp block. The main chunk is far smaller; raise this only after checking which chunk grew.
    chunkSizeWarningLimit: 850,
  },
  server: {
    proxy: {
      '/api': server,
      '/ws': { target: server, ws: true },
    },
  },
});
