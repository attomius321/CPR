import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// As the viewer's: a preinstalled Chromium where a container has one, else Playwright's own.
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
