import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Containers with a preinstalled Chromium (whose revision may not match this Playwright) use it
// directly; CI installs Playwright's own with `playwright install chromium`.
const preinstalled = '/opt/pw-browsers/chromium';

// No spec reads the developer's git config (fix-ci-green): a CI runner has none, so a spec that
// leaned on the developer's identity passed here and failed there. Workers inherit it.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // A state waited for gets 15 s, not Playwright's 5 (AR2): under other workspaces' checks (load
  // 13-16) merges and logs took longer than 5 s to show what they then showed.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    viewport: { width: 1440, height: 900 },
    launchOptions: existsSync(preinstalled) ? { executablePath: preinstalled } : {},
  },
});
