import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// The viewer's own config, pointed at this spike's specs.
const preinstalled = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  fullyParallel: false,
  reporter: 'line',
  use: {
    viewport: { width: 1440, height: 900 },
    launchOptions: existsSync(preinstalled) ? { executablePath: preinstalled } : {},
  },
});
