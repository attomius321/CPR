import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Containers with a preinstalled Chromium (whose revision may not match this Playwright) use it
// directly; CI installs Playwright's own with `playwright install chromium`.
const preinstalled = '/opt/pw-browsers/chromium';

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
