// Exploring one change by hand: opens <url>, runs the steps file's default export
// (async ({ page, shot, shotBoth, readCanvas }) => …), for finding the shortest paths before the
// walk encodes them. Usage: node explore.mjs <url> <steps.mjs> [light]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { newPage, openBrowser, shot, shotBoth } from './lib.mjs';
import { readCanvas } from './read-canvas.mjs';

const [url, steps, theme] = process.argv.slice(2);
const browser = await openBrowser();
const page = await newPage(browser, theme ?? 'dark');
await page.goto(url);
try {
  const run = (await import(pathToFileURL(resolve(steps)).href)).default;
  await run({ page, shot, shotBoth, readCanvas });
} finally {
  if (page.errors.length) console.log('page errors', page.errors);
  await browser.close();
}
