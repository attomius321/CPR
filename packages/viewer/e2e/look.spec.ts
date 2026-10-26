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
const DARK = 'rgb(9, 11, 14)';
const LIGHT = 'rgb(255, 255, 255)';
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
// Settings' Appearance (V51: an entry of its own, no longer in the head) and its Theme.
const appearance = (page: Page) => page.getByRole('group', { name: 'Theme' });
const openAppearance = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'Appearance' })
    .click();

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
  await openAppearance(page);
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
  await page.goto(`${symbiote.url}diff/${base}..${head}/?view=graph`);
  await expect(page.locator('.react-flow')).toHaveClass(/\blight\b/, POLL);
  expect(await background(page)).toBe(LIGHT);
});

test("System follows the system's scheme", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}settings?prompt=appearance`);
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
  expect(await colour('.sidenav')).toBe('rgb(13, 16, 21)');
  expect(await colour('.statusbar')).toBe('rgb(13, 16, 21)');
  // The current page is a wash of the accent, the new S's violet (V61).
  const current = page.getByRole('link', { name: 'History' });
  expect(await current.evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(
    /^(rgba?\(152, 134, 255|color\(srgb 0\.596)/,
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

// V32: text one can read. V61: a pixel more, still too small for the person's eyes. Every text
// shown, on every page: 13 px at least, 12 px for uppercase labels and one-glyph marks; 15 px for
// the body and the terminal. The graph keeps V32's (decision 438): 12 and 11 px there.
test('no text under 13 px on any page but the graph; the body and the terminal at 15 px', async ({
  page,
}) => {
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
        const least = (mark ? 12 : 13) - (element.closest('.react-flow') ? 1 : 0);
        if (size < least) under.push(`${element.className}: "${text}" ${size}px`);
      }
      return under;
    });

  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible(POLL);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('15px');
  expect(await small()).toEqual([]);
  await page.locator('.commit.head').click({ button: 'right', position: { x: 120, y: 10 } });
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await small()).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Settings' }).click();
  await openAppearance(page);
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
  ).toBe('15px');
  expect(await small()).toEqual([]);
  await here.getByRole('tab', { name: 'Brief' }).click();
  expect(await small()).toEqual([]);

  const [base, head] = symbiote.shas;
  await page.goto(`${symbiote.url}diff/${base}..${head}/?view=graph`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible(POLL);
  expect(await small()).toEqual([]);
  await page.keyboard.press('j');
  await expect(page.locator('.panel-title')).toBeVisible();
  expect(await small()).toEqual([]);
  await page.getByRole('tab', { name: /Findings/ }).click();
  expect(await small()).toEqual([]);
  // The Files page (V60): the list and a file's diff, a fold.
  await page.keyboard.press('g');
  await expect(page.locator('.file-code .row').first()).toBeVisible(POLL);
  expect(await small()).toEqual([]);
});

// V37: the page and its fields in one text. Chromium gives form controls `letter-spacing: normal`
// whatever the page's (`font: inherit` does not reset it), and the chrome's 0.01em rounded into
// uneven gaps at 1× on Linux ("n o commits"). Text fields in the text's font: Geist Mono is for what
// is literal, and buttons drawn as code (a symbol's name, a placeholder to insert) keep it.
test("fields and buttons take the page's font and spacing on every page", async ({ page }) => {
  symbiote = await serveWorkspaces();
  const unlike = () =>
    page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const off: string[] = [];
      if (!['0px', 'normal'].includes(body.letterSpacing)) off.push(`body: ${body.letterSpacing}`);
      const controls = 'input:not([type=checkbox], [type=radio], [type=range]), textarea, select';
      for (const element of document.querySelectorAll(`${controls}, button`)) {
        if (element.closest('.xterm') || element.getClientRects().length === 0) continue;
        const style = getComputedStyle(element);
        const name = `${element.tagName.toLowerCase()}.${element.className}`;
        if (style.letterSpacing !== body.letterSpacing) {
          off.push(`${name}: letter-spacing ${style.letterSpacing}`);
        }
        if (element.matches(controls) && style.fontFamily !== body.fontFamily) {
          off.push(`${name}: ${style.fontFamily}`);
        }
      }
      return off;
    });

  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible(POLL);
  expect(await unlike()).toEqual([]);

  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await form.getByRole('button', { name: /^More:/ }).click();
  expect(await unlike()).toEqual([]);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Feature', exact: true }).click();
  await expect(page.locator('.settings-editor textarea')).toBeVisible();
  expect(await unlike()).toEqual([]);

  await page.getByRole('link', { name: 'Scout' }).click();
  // Its terminal (V50), drawn by xterm.js: its own look, not the page's.
  await expect(page.locator('.scout-page .agent-terminal .xterm-rows')).toContainText(
    'Fake Claude Code',
    POLL,
  );
  expect(await unlike()).toEqual([]);

  const [base, head] = symbiote.shas;
  await page.goto(`${symbiote.url}diff/${base}..${head}/?view=graph`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible(POLL);
  await page.keyboard.press('j');
  await expect(page.locator('.panel-title')).toBeVisible();
  expect(await unlike()).toEqual([]);
  // The Files page (V60): its switch, its rows, a fold.
  await page.keyboard.press('g');
  await expect(page.locator('.file-code .row').first()).toBeVisible(POLL);
  expect(await unlike()).toEqual([]);
});

// V37 (decision 246): a field's edge is quiet at rest, the 3:1 edge on hover, the focus colour and a
// ring on focus; fields and selects one height; no resize grip, a textarea grows with its text.
test('text fields: a quiet edge, a stronger one on hover, a ring on focus, one height', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  const title = form.getByRole('textbox', { name: 'Title' });
  const goal = form.getByRole('textbox', { name: 'Goal' });
  await expect(title).toBeVisible();
  const style = (field: typeof title, property: string) =>
    field.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), property);
  const EDGE = 'rgb(92, 99, 115)';
  await page.mouse.move(0, 0);
  expect(await style(goal, 'border-top-color')).not.toBe(EDGE);
  await goal.hover();
  await expect.poll(() => style(goal, 'border-top-color')).toBe(EDGE);
  await title.focus();
  expect(await style(title, 'outline-style')).toBe('none');
  await expect.poll(() => style(title, 'box-shadow')).toContain('0px 0px 0px 3px');
  for (const field of [title, form.getByRole('textbox', { name: 'Branch' })]) {
    expect((await field.boundingBox())?.height).toBe(32);
  }
  for (const select of await form.getByRole('combobox').all()) {
    expect((await select.boundingBox())?.height).toBe(32);
  }
  expect(await style(goal, 'resize')).toBe('none');
  const before = (await goal.boundingBox())?.height ?? 0;
  await goal.fill('One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight\nNine\nTen');
  expect((await goal.boundingBox())?.height ?? 0).toBeGreaterThan(before);
});

// V37: help behind a "?" on every page: hidden at rest, a tooltip on hover or focus, inside the
// window wherever its button is, the button described by it for screen readers.
test('help texts wait behind a "?": a tooltip on hover, inside the window', async ({ page }) => {
  symbiote = await serveWorkspaces();
  const inside = async (tip: ReturnType<Page['getByRole']>) => {
    const box = await tip.boundingBox();
    const view = page.viewportSize();
    expect(box && view).toBeTruthy();
    if (!box || !view) return;
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.y).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width - 8);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height - 8);
  };
  const tip = page.getByRole('tooltip');

  // A diff's keys and how to read its canvas: behind the bar's "?", at the window's right edge.
  const [base, head] = symbiote.shas;
  await page.goto(`${symbiote.url}diff/${base}..${head}/?view=graph`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible(POLL);
  await expect(page.getByText('next/previous')).toBeHidden();
  await expect(page.getByText('a group to show its symbols')).toBeHidden();
  const keys = page.getByRole('button', { name: "This page's keys" });
  await keys.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('next/previous');
  await expect(tip).toContainText('a group to show its symbols');
  await inside(tip);
  const described = await keys.getAttribute('aria-describedby');
  expect(await tip.getAttribute('id')).toBe(described);
  await page.mouse.move(700, 600);
  await expect(tip).toBeHidden();

  // Scout's: what it is, behind the "?" by its title.
  await page.goto(`${symbiote.url}scout`);
  await expect(page.getByRole('heading', { name: 'Scout' })).toBeVisible();
  await expect(page.getByText('changes no file')).toBeHidden();
  await page.getByRole('button', { name: 'About Scout' }).focus();
  await expect(tip).toContainText('changes no file');
  await inside(tip);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();

  // A prompt's description in Settings, by its title.
  await page.goto(`${symbiote.url}settings`);
  await page.getByRole('button', { name: 'Feature', exact: true }).click();
  await expect(page.getByText("What a Feature workspace's agent is told")).toBeHidden();
  await page.getByRole('button', { name: 'About Workspaces: Feature' }).click();
  await expect(tip).toContainText("What a Feature workspace's agent is told");
  await inside(tip);
});

// 72 px since V61's bigger type (64 before): its name at 15 px, its lines at 14.
test('a card in the sidenav is at most 72 px high', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('textbox', { name: 'Title' }).fill('Add a half function, with a test');
  await form.getByRole('textbox', { name: 'Goal' }).fill('Half of a number.');
  await form.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  const card = page.locator('.sidenav .workspace-row').first();
  await expect(card).toContainText('feature/add-a-half-function', POLL);
  expect((await card.boundingBox())?.height ?? 0).toBeLessThanOrEqual(72);
});

// V37: Terminal, Thread and Brief are flat buttons on the chrome's strip, the picked one a wash of
// the text (they were folder tabs, the picked one joining the terminal's black: a black block on
// light chrome).
test("a workspace's views: the picked one a wash on the chrome, readable in light", async ({
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
  const strip = await page
    .getByRole('tablist', { name: 'Talk to the agent' })
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(strip).toBe('rgb(246, 248, 252)');
  const [color, under] = await tab.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.color, style.backgroundColor];
  });
  expect(under).not.toBe('rgb(0, 0, 0)');
  // WCAG's contrast of the label on the strip: at least 4.5:1 (the wash only darkens it a little).
  const luminance = (rgb: string) => {
    const [r = 0, g = 0, b = 0] = (rgb.match(/\d+/g) ?? []).map((c) => {
      const s = Number(c) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect((luminance(strip) + 0.05) / (luminance(color) + 0.05)).toBeGreaterThanOrEqual(4.5);
});
