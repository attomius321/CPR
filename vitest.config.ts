import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against workspace sources, so no build is needed first.
    alias: {
      '@symbiote/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@symbiote/forge': fileURLToPath(new URL('./packages/forge/src/index.ts', import.meta.url)),
      '@symbiote/monitor': fileURLToPath(
        new URL('./packages/monitor/src/index.ts', import.meta.url),
      ),
      '@symbiote/log': fileURLToPath(new URL('./packages/log/src/index.ts', import.meta.url)),
      '@symbiote/nexus/registry': fileURLToPath(
        new URL('./packages/nexus/src/registry.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Fixtures are code under analysis, test files included.
    exclude: [...configDefaults.exclude, 'packages/*/test/fixtures/**'],
    // Tests never write into the person's log folder (LG1): one that logs gives its own.
    env: { SYMBIOTE_LOG: 'off' },
  },
});
