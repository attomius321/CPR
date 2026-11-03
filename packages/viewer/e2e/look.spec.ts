import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// The look (V29b): dark by default, light or the system's chosen in Settings for this browser;
// the bundled fonts, served by Symbiote; the sidenav's cards. Symbiote's style since V31.
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
const DARK = 'rgb(9, 10, 13)';
const LIGHT = 'rgb(243, 244, 247)';
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
  await page.goto(`${symbiote.url}git`);
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

// V87c (decision 763): the text a step smaller or larger, in Settings' Appearance, for this
// browser; only the text: a row, the graph's labels and the terminal keep their sizes.
test('Appearance sets the text size: Compact, Default, Large, kept for this browser before the first paint', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const body = () => page.evaluate(() => getComputedStyle(document.body).fontSize);
  const textSize = () => page.getByRole('group', { name: 'Text size' });
  await page.goto(`${symbiote.url}git`);
  await expect(page.locator('.commit').first()).toBeVisible(POLL);
  expect(await body()).toBe('15px');
  const row = await page.locator('.commit').first().boundingBox();

  await page.getByRole('link', { name: 'Settings' }).click();
  await openAppearance(page);
  await expect(textSize().getByRole('button', { name: 'Default' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await textSize().getByRole('button', { name: 'Large' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
  expect(await body()).toBe('16px');
  await textSize().getByRole('button', { name: 'Compact' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'compact');
  expect(await body()).toBe('14px');
  await textSize().getByRole('button', { name: 'Large' }).click();

  // Set by the page's own script before React runs: no step from 15 to 16 px after the paint.
  await page.addInitScript(() => {
    const seen = () =>
      ((window as { symbioteFirstSize?: string }).symbioteFirstSize ??=
        document.documentElement.dataset.textSize);
    document.addEventListener('readystatechange', seen, { once: true });
  });
  await page.goto(`${symbiote.url}git`);
  expect(
    await page.evaluate(() => (window as { symbioteFirstSize?: string }).symbioteFirstSize),
  ).toBe('large');
  await expect(page.locator('.commit').first()).toBeVisible(POLL);
  expect(await body()).toBe('16px');
  expect((await page.locator('.commit').first().boundingBox())!.height).toBe(row!.height);

  // The graph keeps its own scale (decision 438): its labels' widths are estimated from it.
  const [base, head] = symbiote.shas;
  await page.goto(`${symbiote.url}diff/${base}..${head}/?view=graph`);
  await expect(page.locator('.react-flow')).toBeVisible(POLL);
  expect(
    await page
      .locator('.react-flow')
      .evaluate((flow) => getComputedStyle(flow).getPropertyValue('--size-body').trim()),
  ).toBe('14px');

  // Default takes the mark away.
  await page.goto(`${symbiote.url}settings`);
  await openAppearance(page);
  await textSize().getByRole('button', { name: 'Default' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-text-size');
  expect(await body()).toBe('15px');
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
  await page.goto(`${symbiote.url}git`);
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
  await page.goto(`${symbiote.url}git`);
  await expect(page.locator('.commit').first()).toBeVisible();
  const colour = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await background(page)).toBe(DARK);
  expect(await colour('.sidenav')).toBe('rgb(13, 15, 19)');
  expect(await colour('.statusbar')).toBe('rgb(13, 15, 19)');
  // The current page is a wash of the accent, the new S's violet (V61).
  const current = page.getByRole('link', { name: 'Git' });
  expect(await current.evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(
    /^(rgba?\(152, 134, 255|color\(srgb 0\.596)/,
  );
});

test("History in Symbiote's style: names in the text's font, HEAD a tint, menus and dialogs that float", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
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

// V32: text one can read. V61: a pixel more. V85 (decision 708): VS Code's sizes, as the person
// asked. V87 (decision 760): their design B: every text shown, on every page, 12 px at least
// (Windows' minimum); 15 px for the body, 14 px for the terminal. The graph keeps V32's (decision
// 438): 12 and 11 px there, and zooms.
test('no text under 12 px on any page; the body at 15 px and the terminal at 14 px', async ({
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
        if (
          !text ||
          element.closest('.xterm, .react-flow') ||
          element.getClientRects().length === 0
        )
          continue;
        const style = getComputedStyle(element);
        const size = Number.parseFloat(style.fontSize);
        if (size < 12) under.push(`${element.className}: "${text}" ${size}px`);
      }
      return under;
    });

  await page.goto(`${symbiote.url}git`);
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
  ).toBe('14px');
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
        // A branch's name is literal: Start's in the code's font, as proof 06 draws it (V93); so
        // are the check's commands (fix/settings-page).
        if (
          element.matches(controls) &&
          !element.matches('#start-branch, .checks-command') &&
          style.fontFamily !== body.fontFamily
        ) {
          off.push(`${name}: ${style.fontFamily}`);
        }
      }
      return off;
    });

  await page.goto(`${symbiote.url}git`);
  await expect(page.locator('.commit').first()).toBeVisible(POLL);
  expect(await unlike()).toEqual([]);

  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await form.getByRole('button', { name: /^More:/ }).click();
  expect(await unlike()).toEqual([]);

  await page.getByRole('link', { name: 'Settings' }).click();
  // The check's commands first (fix/settings-page), then a prompt in its folded group.
  await expect(page.locator('.checks-command').first()).toBeVisible();
  expect(await unlike()).toEqual([]);
  await page.getByRole('button', { name: /^Workspaces/ }).click();
  await page.getByRole('button', { name: 'Feature', exact: true }).click();
  await expect(page.locator('.settings-editor textarea')).toBeVisible();
  expect(await unlike()).toEqual([]);

  await page.getByRole('link', { name: 'Nucleus' }).click();
  // Its terminal (V50), drawn by xterm.js: its own look, not the page's.
  await expect(page.locator('.nucleus-page .agent-terminal .xterm-rows')).toContainText(
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
// ring on focus; fields and selects their row's height; no resize grip, a textarea grows with its
// text.
test('text fields: a quiet edge, a stronger one on hover, a ring on focus, one height', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
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
  // V93 (proof 06): the brief's fields 32 px, the run's rows 30 (28 on the page before).
  expect((await title.boundingBox())?.height).toBe(32);
  expect((await form.getByRole('textbox', { name: 'Branch name' }).boundingBox())?.height).toBe(30);
  for (const select of await form.getByRole('combobox').all()) {
    expect((await select.boundingBox())?.height).toBe(30);
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

  // Nucleus's: what it is, behind the "?" by its title.
  await page.goto(`${symbiote.url}nucleus`);
  await expect(page.getByRole('heading', { name: 'Nucleus' })).toBeVisible();
  await expect(page.getByText('changes no file')).toBeHidden();
  await page.getByRole('button', { name: 'About Nucleus' }).focus();
  await expect(tip).toContainText('changes no file');
  await inside(tip);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});

// V93 (decision 876; the proofs' `.ws`): a row of two lines — its icon and its title, cut with
// "…", whole in its tip; its state's word and the rest — 6 × 10 px in, the rows touching. V79's
// card of four rows (V83: five) on 20 px lines, 6 px apart, it replaces.
test('a row in the sidenav: two lines, the title cut with its tip whole, the rows touching (V93)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  const long = 'feature/add-a-half-function-with';
  for (const [title, branch] of [
    ['Add a half function, with a test and its docs', long],
    ['Add a double function', 'feature/add-a-double-function'],
  ] as const) {
    await page.getByRole('link', { name: 'Start a workspace' }).click();
    const form = page.getByRole('region', { name: 'Start a workspace' });
    await form.getByRole('textbox', { name: 'Title' }).fill(title);
    await form.getByRole('textbox', { name: 'Goal' }).fill('Half of a number.');
    await form.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
    // Started: the page goes, and the card is the workspace's, no longer the one starting.
    await expect(form).toBeHidden(POLL);
    await expect(
      page.locator(`.sidenav .workspace-row[data-branch="${branch}"]:not(.starting)`),
    ).toBeVisible(POLL);
  }
  const row = page.locator(`.sidenav .workspace-row[data-branch="${long}"]`);
  // The title on one line, cut at its end; the whole of it in the row's tip.
  const title = row.locator('.ws-row-title');
  expect(
    await title.evaluate((e) => [
      e.scrollWidth > e.clientWidth,
      getComputedStyle(e).textOverflow,
      e.getBoundingClientRect().height,
    ]),
  ).toEqual([true, 'ellipsis', 21]);
  await expect(row).toHaveAttribute('data-tip', /Add a half function, with a test and its docs/);
  // 6 × 10 px in; the state's line 18 px: 6 + 21 + 18 + 7.
  expect(
    await row.evaluate((e) => [getComputedStyle(e).paddingTop, getComputedStyle(e).paddingLeft]),
  ).toEqual(['6px', '10px']);
  await expect(row.locator('.ws-row-state')).toHaveCSS('line-height', '18px');
  expect(Math.round((await row.boundingBox())?.height ?? 0)).toBe(52);
  // The next row of its group, right under it.
  const next = page.locator('.sidenav .workspace-row[data-branch="feature/add-a-double-function"]');
  const [above, below] = [await row.boundingBox(), await next.boundingBox()];
  expect(Math.round(below!.y - (above!.y + above!.height))).toBe(0);
});

// V37: Terminal, Thread and Brief are flat buttons on the chrome's strip, the picked one a wash of
// the text (they were folder tabs, the picked one joining the terminal's black: a black block on
// light chrome).
test("a workspace's views: the picked one a wash on the chrome, readable in light", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  await page.evaluate(() => localStorage.setItem('symbiote.viewer.theme', 'light'));
  await page.reload();
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await form.getByRole('textbox', { name: 'Goal' }).fill('Half of a number.');
  await form.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  const tab = page.getByRole('tab', { name: 'Claude Code' });
  await expect(tab).toHaveAttribute('aria-selected', 'true', POLL);
  await expect(page.locator('.xterm-screen')).toBeVisible(POLL);
  // The tabs' card head (V89: the tablist inside it, beside Split and Focus).
  const strip = await page
    .locator('.workspace-views')
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  // V88: the card's ground, white in the light theme.
  expect(strip).toBe('rgb(255, 255, 255)');
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
