// Renders the app's icon, packages/desktop/icons/symbiote.svg, to the 512 px PNG the window and the
// launcher use: `node scripts/desktop/icon.mjs` (after `pnpm install`).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const icons = new URL('../../packages/desktop/icons/', import.meta.url);
const svg = readFileSync(new URL('symbiote.svg', icons), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
await page
  .locator('svg')
  .screenshot({ path: new URL('symbiote.png', icons).pathname, omitBackground: true });
await browser.close();
