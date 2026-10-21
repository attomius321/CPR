import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// The look (V29b): dark by default, light or the system's chosen in Settings for this browser;
// the bundled fonts, served by Symbiote; compact cards in the sidenav. Symbiote's style since V31.
let symbiote: RunningWorkspaces;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

const POLL = { timeout: 12_000 };
const DARK = 'rgb(10, 10, 10)';
const LIGHT = 'rgb(255, 255, 255)';
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const appearance = (page: Page) => page.getByRole('group', { name: 'Appearance (this browser)' });

test('dark by default; Appearance in Settings makes it light, kept for this browser and its diffs', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${symbiote.url}history`);
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
      ((window as { symbioteFirstTheme?: string }).symbioteFirstTheme ??=
        document.documentElement.dataset.theme);
    document.addEventListener('readystatechange', seen, { once: true });
  });
  await page.reload();
  expect(
    await page.evaluate(() => (window as { symbioteFirstTheme?: string }).symbioteFirstTheme),
  ).toBe('light');
  expect(await background(page)).toBe(LIGHT);

  // A diff's page and its graph follow.
  const [base, head] = symbiote.shas;
  await page.goto(`${symbiote.url}diff/${base}..${head}/`);
  await expect(page.locator('.react-flow')).toHaveClass(/\blight\b/, POLL);
  expect(await background(page)).toBe(LIGHT);
});

test("System follows the system's scheme", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}settings`);
  await appearance(page).getByRole('button', { name: 'System' }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await background(page)).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await background(page)).toBe(DARK);
});

test("the fonts are Symbiote's: every request goes to its server, and History fetches at most 55 KB of them", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const origin = new URL(symbiote.url).origin;
  const requests: string[] = [];
  const fonts: Promise<number>[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => {
    if (response.url().endsWith('.woff2')) fonts.push(response.body().then((b) => b.length));
  });
  await page.goto(`${symbiote.url}history`);
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

test('the chrome is lifted above the content: the sidenav and the status bar', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  const colour = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await background(page)).toBe(DARK);
  expect(await colour('.sidenav')).toBe('rgb(23, 23, 23)');
  expect(await colour('.statusbar')).toBe('rgb(23, 23, 23)');
  // The current page is a neutral wash, not a colour.
  const current = page.getByRole('link', { name: 'History' });
  expect(await current.evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(
    /^(rgba?\(250, 250, 250|color\(srgb 0\.98)/,
  );
});

test("History in Symbiote's style: names in the text's font, HEAD a tint, menus and dialogs that float", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  const head = page.locator('.commit.head');
  await expect(head).toBeVisible();
  const style = (selector: string, property: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), property);
  // A branch's name is a name, not code: the text's font, in the panel and on the row.
  expect(await style('.branches-name', 'font-family')).toBe('"Geist Variable", monospace');
  expect(await style('.commit .ref', 'font-family')).toBe('"Geist Variable", monospace');
  // HEAD stands out by a tint of its colour, not a solid fill.
  /** A computed colour's opacity: `rgba(r, g, b, a)` or `color(srgb r g b / a)`; 1 without. */
  const alpha = (colour: string) => {
    const slash = colour.match(/\/\s*([\d.]+)\)$/);
    const rgba = colour.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
    return Number(slash?.[1] ?? rgba?.[1] ?? 1);
  };
  expect(alpha(await style('.commit.head .ref-head', 'background-color'))).toBeLessThan(0.5);

  // The row's menu floats over the page: a blurred, rounded glass.
  await head.click({ button: 'right', position: { x: 120, y: 10 } });
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await style('.checkout-menu', 'border-radius')).toBe('11px');
  const glass = await page
    .locator('.checkout-menu')
    .first()
    .evaluate((e) => getComputedStyle(e, '::before').backdropFilter);
  expect(glass).toContain('blur');
  await page.keyboard.press('Escape');
});

// V32: text one can read. Every text shown, on every page: 12 px at least, 11 px for uppercase
// labels and one-glyph marks; 14 px for the body and the terminal.
test('no text under 12 px on any page; the body and the terminal at 14 px', async ({ page }) => {
  symbiote = await serveWorkspaces();
  const small = () =>
    page.evaluate(() => {
      const under: string[] = [];
      for (const element of document.body.querySelectorAll('*')) {
        const text = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join('')
          .trim();
        // The terminal draws its own text at its own size, checked below.
        if (!text || element.closest('.xterm') || element.getClientRects().length === 0) continue;
        const style = getComputedStyle(element);
        const size = Number.parseFloat(style.fontSize);
        const mark = style.textTransform === 'uppercase' || [...text].length === 1;
        if (size < (mark ? 11 : 12)) under.push(`${element.className}: "${text}" ${size}px`);
      }
      return under;
    });

  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible(POLL);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('14px');
  expect(await small()).toEqual([]);
  await page.locator('.commit.head').click({ button: 'right', position: { x: 120, y: 10 } });
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await small()).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(appearance(page)).toBeVisible();
  expect(await small()).toEqual([]);

  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('textbox', { name: 'Title' }).fill('Add a half function, with a test');
  expect(await small()).toEqual([]);
  await form.getByRole('textbox', { name: 'Goal' }).fill('Half of a number.');
  await form.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  const here = page.getByRole('region', { name: 'Workspace feature/add-a-half-function' });
  await expect(here.locator('.xterm-rows')).toContainText(/\[\d+x\d+\]/, POLL);
  expect(
    await here.locator('.xterm-rows').evaluate((rows) => getComputedStyle(rows).fontSize),
  ).toBe('14px');
  expect(await small()).toEqual([]);
  await here.getByRole('tab', { name: 'Brief' }).click();
  expect(await small()).toEqual([]);

  const [base, head] = symbiote.shas;
  await page.goto(`${symbiote.url}diff/${base}..${head}/`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible(POLL);
  expect(await small()).toEqual([]);
  await page.keyboard.press('j');
  await expect(page.locator('.panel-title')).toBeVisible();
  expect(await small()).toEqual([]);
  await page.getByRole('tab', { name: /Findings/ }).click();
  expect(await small()).toEqual([]);
});

test('a card in the sidenav is at most 64 px high', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('textbox', { name: 'Title' }).fill('Add a half function, with a test');
  await form.getByRole('textbox', { name: 'Goal' }).fill('Half of a number.');
  await form.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  const card = page.locator('.sidenav .workspace-row').first();
  await expect(card).toContainText('feature/add-a-half-function', POLL);
  expect((await card.boundingBox())?.height ?? 0).toBeLessThanOrEqual(64);
});

test("the Terminal tab joins the terminal's black and stays readable in light", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await page.evaluate(() => localStorage.setItem('symbiote.viewer.theme', 'light'));
  await page.reload();
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await form.getByRole('textbox', { name: 'Goal' }).fill('Half of a number.');
  await form.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
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
