import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// As the viewer's: a preinstalled Chromium where a container has one, else Playwright's own.
const preinstalled = '/opt/pw-browsers/chromium';

// No spec reads the developer's git config (fix-ci-green): a CI runner has none, so a spec that
// leaned on the developer's identity passed here and failed there. Workers inherit it.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    viewport: { width: 1440, height: 900 },
    launchOptions: existsSync(preinstalled) ? { executablePath: preinstalled } : {},
  },
});
