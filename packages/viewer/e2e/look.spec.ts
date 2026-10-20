import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './cpr.js';

// The look (V29b): dark by default, light or the system's chosen in Settings for this browser;
// the bundled fonts, served by CPR; compact cards in the sidenav.
let cpr: RunningWorkspaces;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  cpr.stop();
  expect(errors).toEqual([]);
});

const POLL = { timeout: 12_000 };
const DARK = 'rgb(11, 11, 12)';
const LIGHT = 'rgb(247, 247, 245)';
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const appearance = (page: Page) => page.getByRole('group', { name: 'Appearance (this browser)' });

test('dark by default; Appearance in Settings makes it light, kept for this browser and its diffs', async ({
  page,
}) => {
  cpr = await serveWorkspaces();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${cpr.url}history`);
  // Dark even where the system is light: the reference's (decision 179).
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background(page)).toBe(DARK);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(appearance(page).getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await appearance(page).getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe(LIGHT);

  // Set by the page's own script before React runs, as the document is parsed: no dark flash.
  await page.addInitScript(() => {
    const seen = () =>
      ((window as { cprFirstTheme?: string }).cprFirstTheme ??=
        document.documentElement.dataset.theme);
    document.addEventListener('readystatechange', seen, { once: true });
  });
  await page.reload();
  expect(await page.evaluate(() => (window as { cprFirstTheme?: string }).cprFirstTheme)).toBe(
    'light',
  );
  expect(await background(page)).toBe(LIGHT);

  // A diff's page and its graph follow.
  const [base, head] = cpr.shas;
  await page.goto(`${cpr.url}diff/${base}..${head}/`);
  await expect(page.locator('.react-flow')).toHaveClass(/\blight\b/, POLL);
  expect(await background(page)).toBe(LIGHT);
});

test("System follows the system's scheme", async ({ page }) => {
  cpr = await serveWorkspaces();
  await page.goto(`${cpr.url}settings`);
  await appearance(page).getByRole('button', { name: 'System' }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await background(page)).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await background(page)).toBe(DARK);
});

test("the fonts are CPR's: every request goes to its server, and History fetches at most 55 KB of them", async ({
  page,
}) => {
  cpr = await serveWorkspaces();
  const origin = new URL(cpr.url).origin;
  const requests: string[] = [];
  const fonts: Promise<number>[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => {
    if (response.url().endsWith('.woff2')) fonts.push(response.body().then((b) => b.length));
  });
  await page.goto(`${cpr.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
  );
  expect(new Set(loaded)).toEqual(new Set(['Geist Variable', 'Geist Mono Variable']));
  expect(await page.locator('body').evaluate((b) => getComputedStyle(b).fontFamily)).toBe(
    '"Geist Variable", monospace',
  );
  expect(
    await page
      .locator('.commit-sha')
      .first()
      .evaluate((c) => getComputedStyle(c).fontFamily),
  ).toBe('"Geist Mono Variable", monospace');
  expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
  const bytes = (await Promise.all(fonts)).reduce((sum, n) => sum + n, 0);
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThanOrEqual(55_000);
});

test('a card in the sidenav is at most 64 px high', async ({ page }) => {
  cpr = await serveWorkspaces();
  await page.goto(`${cpr.url}history`);
  await page.getByRole('button', { name: 'Start a workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a workspace' });
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Add a half function, with a test');
  await dialog.getByRole('textbox', { name: 'Goal' }).fill('Half of a number.');
  await dialog.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  const card = page.locator('.sidenav .workspace-row').first();
  await expect(card).toContainText('feature/add-a-half-function', POLL);
  expect((await card.boundingBox())?.height ?? 0).toBeLessThanOrEqual(64);
});

test("the Terminal tab joins the terminal's black and stays readable in light", async ({
  page,
}) => {
  cpr = await serveWorkspaces();
  await page.goto(`${cpr.url}history`);
  await page.evaluate(() => localStorage.setItem('cpr.viewer.theme', 'light'));
  await page.reload();
  await page.getByRole('button', { name: 'Start a workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a workspace' });
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await dialog.getByRole('textbox', { name: 'Goal' }).fill('Half of a number.');
  await dialog.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  const tab = page.getByRole('tab', { name: 'Terminal' });
  await expect(tab).toHaveAttribute('aria-selected', 'true', POLL);
  await expect(page.locator('.xterm-screen')).toBeVisible(POLL);
  const [color, under] = await tab.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.color, style.backgroundColor];
  });
  expect(under).toBe('rgb(0, 0, 0)');
  // WCAG's contrast of the label on the tab: at least 4.5:1.
  const luminance = (rgb: string) => {
    const [r = 0, g = 0, b = 0] = (rgb.match(/\d+/g) ?? []).map((c) => {
      const s = Number(c) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect((luminance(color) + 0.05) / (luminance(under) + 0.05)).toBeGreaterThanOrEqual(4.5);
});
