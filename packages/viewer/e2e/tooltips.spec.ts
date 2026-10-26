import { expect, test, type Locator, type Page } from '@playwright/test';
import { graphPage, serveFixture, serveWorkspaces, type Running } from './symbiote.js';

// V54: every tooltip is Symbiote's (decision 397). An element names its tip (`data-tip`), one
// `Tooltips` on the page draws it after a rest, in the form of its context: beside a page of the
// sidenav with its key, the whole of a cut text, a symbol's id. No `title` is left for the window
// system to draw.
let running: Running[] = [];
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  for (const served of running) served.stop();
  running = [];
  expect(errors).toEqual([]);
});

const tooltip = (page: Page) => page.locator('.tooltip');
const sidenav = (page: Page) => page.getByRole('complementary', { name: 'Pages and workspaces' });
const pages = (page: Page) => sidenav(page).getByRole('navigation', { name: 'Pages' });
/** Every tooltip the window system would draw. */
const native = (page: Page) => page.locator('[title], svg title');

/** The pointer on a spot with no tip: the status bar's middle. */
async function away(page: Page) {
  const view = page.viewportSize()!;
  await page.mouse.move(view.width / 2, view.height - 4);
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('not drawn');
  return found;
}

test('a page in the sidenav: its tip beside it after a rest, with its key; the next at once', async ({
  page,
}) => {
  const symbiote = await serveWorkspaces();
  running.push(symbiote);
  await page.goto(symbiote.url);
  const history = pages(page).getByRole('link', { name: 'History' });
  await history.hover();
  // Not at once: a pointer crossing the sidenav shows nothing.
  await page.waitForTimeout(150);
  await expect(tooltip(page)).toHaveCount(0);
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toHaveAttribute('role', 'tooltip');
  await expect(tooltip(page)).toContainText('History');
  await expect(tooltip(page)).toContainText("Every branch's commits");
  await expect(tooltip(page).locator('kbd')).toHaveText(['h']);
  // To the right of the item, its middle at the item's; its description for screen readers.
  const [link, tip] = [await box(history), await box(tooltip(page))];
  expect(tip.x).toBeGreaterThanOrEqual(link.x + link.width);
  expect(Math.abs(tip.y + tip.height / 2 - (link.y + link.height / 2))).toBeLessThan(2);
  const id = await tooltip(page).getAttribute('id');
  await expect(history).toHaveAttribute('aria-describedby', id!);

  // Along the sidenav the next tip shows without the wait.
  await pages(page).getByRole('link', { name: 'Monitor' }).hover();
  await page.waitForTimeout(150);
  expect(await tooltip(page).textContent()).toContain('Monitor');

  // Gone when the pointer leaves, on Escape, and when the pointer goes down.
  await away(page);
  await expect(tooltip(page)).toHaveCount(0);
  await expect(history).not.toHaveAttribute('aria-describedby');
  await history.hover();
  await expect(tooltip(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip(page)).toHaveCount(0);
  await away(page);
  await history.hover();
  await expect(tooltip(page)).toBeVisible();
  await page.mouse.down();
  await expect(tooltip(page)).toHaveCount(0);
  await page.mouse.up();
});

test('a tip shows for the keyboard’s focus, not for a click’s', async ({ page }) => {
  const symbiote = await serveWorkspaces();
  running.push(symbiote);
  await page.goto(symbiote.url);
  const history = pages(page).getByRole('link', { name: 'History' });
  await expect(history).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    if (await history.evaluate((link) => link === document.activeElement)) break;
  }
  await expect(history).toBeFocused();
  await expect(tooltip(page)).toContainText('History');
  await page.keyboard.press('Escape');
  await expect(tooltip(page)).toHaveCount(0);
  await expect(history).toBeFocused();

  // The workspaces' "+" clicked: a page opens, no tip follows its focus.
  await away(page);
  await sidenav(page).getByRole('link', { name: 'Start a workspace' }).click();
  await away(page);
  await page.waitForTimeout(700);
  await expect(tooltip(page)).toHaveCount(0);
});

test('a cut path shows its whole text in its own font; a path that fits shows none', async ({
  page,
}) => {
  const symbiote = await serveFixture('callers');
  running.push(symbiote);
  await page.goto(graphPage(symbiote.url));
  // The page opens on its findings: the changes list the files.
  await page.getByRole('tab', { name: /^Changes/ }).click();
  const name = page.locator('.list-file-name').first();
  await expect(name).toBeVisible();
  const path = (await name.textContent())!;
  await expect(name).toHaveAttribute('data-tip', path);
  await name.hover();
  await page.waitForTimeout(700);
  await expect(tooltip(page)).toHaveCount(0);

  await away(page);
  await page.addStyleTag({ content: '.list-file-name { max-width: 48px; }' });
  await name.hover();
  await expect(tooltip(page)).toHaveText(path);
  const font = await tooltip(page).evaluate((tip) => getComputedStyle(tip).fontFamily);
  expect(font).toContain('Geist Mono');
  // Its letters start where the cut ones do.
  const [cut, tip] = [await box(name), await box(tooltip(page))];
  const inset = (locator: Locator) =>
    locator.evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft));
  const [tipText, cutText] = [tip.x + (await inset(tooltip(page))), cut.x + (await inset(name))];
  expect(Math.abs(tipText - cutText)).toBeLessThan(2);
});

test('a symbol’s tip is its id, in mono; the canvas moving hides it', async ({ page }) => {
  const symbiote = await serveFixture('callers');
  running.push(symbiote);
  await page.goto(graphPage(symbiote.url));
  const symbol = page.locator('.react-flow__node-symbol .symbol').first();
  await expect(symbol).toBeVisible();
  const id = (await symbol.getAttribute('data-tip'))!;
  expect(id).toContain('#');
  await symbol.hover();
  await expect(tooltip(page)).toHaveText(id);
  const font = await tooltip(page).evaluate((tip) => getComputedStyle(tip).fontFamily);
  expect(font).toContain('Geist Mono');
  // In the tip's colours: a global `.code` (the diff's) once painted it the page's black.
  const [ground, own] = await tooltip(page).evaluate((tip) => {
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.background = 'var(--tip-bg)';
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(tip).backgroundColor, want];
  });
  expect(ground).toBe(own);
  await page.mouse.wheel(0, 120);
  await expect(tooltip(page)).toHaveCount(0);
});

test('the canvas’s buttons and the whole diff page: tips of Symbiote’s, no title left', async ({
  page,
}) => {
  const symbiote = await serveFixture('callers');
  running.push(symbiote);
  await page.goto(graphPage(symbiote.url));
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
  const zoomIn = page.locator('.react-flow__controls-zoomin');
  await expect(zoomIn).toHaveAccessibleName('Zoom in');
  await zoomIn.hover();
  await expect(tooltip(page)).toHaveText('Zoom in');
  await expect(native(page)).toHaveCount(0);
});

test('no page leaves a tooltip to the window system', async ({ page }) => {
  const symbiote = await serveWorkspaces();
  running.push(symbiote);
  const heading = (name: string) => page.getByRole('heading', { level: 1, name });
  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit-subject').first()).toBeVisible();
  await expect(native(page)).toHaveCount(0);
  for (const [path, name] of [
    ['start', 'Start a workspace'],
    ['scout', 'Scout'],
    ['skills', 'Skills'],
    ['monitor', 'Monitor'],
    ['settings', 'Settings'],
  ] as const) {
    await page.goto(`${symbiote.url}${path}`);
    await expect(heading(name)).toBeVisible();
    await page.waitForTimeout(300);
    expect([path, await native(page).count()]).toEqual([path, 0]);
  }

  // A workspace, its agent's terminal on.
  await page.goto(`${symbiote.url}start`);
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('textbox', { name: 'Title' }).fill('Tips');
  await form.getByRole('textbox', { name: 'Goal' }).fill('Tips');
  await form.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(form).toBeHidden();
  await expect(page.getByRole('region', { name: /^Workspace / })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(native(page)).toHaveCount(0);
});
