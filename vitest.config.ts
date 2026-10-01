import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against workspace sources, so no build is needed first.
    alias: {
      '@cpr/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@cpr/forge': fileURLToPath(new URL('./packages/forge/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
