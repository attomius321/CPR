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
    // macOS spawns processes several times slower, and these tests spawn git by the hundred: its
    // runner took 479 s for the suite (Ubuntu's 248 s), and Hive's runner tests passed 5 s there,
    // a different few each run (fix-ci-green).
    ...(process.platform === 'darwin' ? { testTimeout: 20_000 } : {}),
    // Fixtures are code under analysis, test files included.
    exclude: [...configDefaults.exclude, 'packages/*/test/fixtures/**'],
    env: {
      // Tests never write into the person's log folder (LG1): one that logs gives its own.
      SYMBIOTE_LOG: 'off',
      // No test reads the developer's git config (fix-ci-green): a CI runner has none, so a test
      // that leaned on the developer's user.email passed here and failed there.
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
  },
});
