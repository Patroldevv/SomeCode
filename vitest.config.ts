import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects, one `vitest run`:
//  - node:  every pure `*.test.ts` (server, protocol, web libs, i18n)
//  - jsdom: React component tests `apps/web/src/**/*.test.tsx` (setup in test-setup.ts)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.tsx'],
          setupFiles: ['apps/web/src/test-setup.ts'],
        },
      },
    ],
  },
});
