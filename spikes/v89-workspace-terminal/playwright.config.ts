import { defineConfig } from '@playwright/test';
import base from '../../packages/viewer/playwright.config.js';

// The viewer's e2e config, over this folder: the same browser, viewport and timeouts.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'shoot.spec.ts',
});
