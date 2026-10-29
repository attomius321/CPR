import { expect, test, type Locator, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// A page agent's terminal fits its box (fix/scribe-terminal-problem): xterm's rows end inside the
// screen's padding, at every window height, and its size holds. The fit add-on counted the rows
// from the height of the box xterm opened in, padding included (border-box): up to 8 px too many.
// On Scout's page that cut the last row off; in Scribe's pane, which scrolls, it gave the pane
// scrollbars, which narrowed the terminal, which fitted it again without them, every frame.

// Real scrollbars, as Symbiote's window draws them: Playwright's headless Chromium hides them,
// and a scrollbar that takes no room cannot start the loop. Over the config's own options.
test.use({
  launchOptions: [
    async ({ launchOptions }, use) => {
      await use({ ...launchOptions, ignoreDefaultArgs: ['--hide-scrollbars'] });
    },
    { scope: 'worker' },
  ],
});

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

const POLL = { timeout: 15_000 };
/** One cycle of a 19 px row: every way the window's height can fall against the rows. */
const HEIGHTS = Array.from({ length: 19 }, (_, i) => 881 + i);

/**
 * A terminal's fit, read over 20 frames after 5 to settle: how far its rows reach past the
 * screen's content box (its padding off), and each size it was drawn at.
 */
const fitOf = (terminal: Locator) =>
  terminal.evaluate(async (root) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const box = root.querySelector('.agent-terminal-screen');
    const rows = root.querySelector('.xterm-screen');
    if (!box || !rows) throw new Error('no terminal');
    const reach = () => {
      const outer = box.getBoundingClientRect();
      const style = getComputedStyle(box);
      const drawn = rows.getBoundingClientRect();
      return {
        bottom: drawn.bottom - (outer.bottom - parseFloat(style.paddingBottom)),
        right: drawn.right - (outer.right - parseFloat(style.paddingRight)),
      };
    };
    for (let i = 0; i < 5; i++) await frame();
    const sizes = new Set<string>();
    let past = { bottom: -Infinity, right: -Infinity };
    for (let i = 0; i < 20; i++) {
      await frame();
      const { width, height } = rows.getBoundingClientRect();
      sizes.add(`${width}x${height}`);
      const now = reach();
      past = { bottom: Math.max(past.bottom, now.bottom), right: Math.max(past.right, now.right) };
    }
    return { past, sizes: [...sizes] };
  });

/** The rows the fake agent was last told it has: it prints `[<cols>x<rows>]` at each size. */
const toldRows = (terminal: Locator) =>
  terminal.evaluate((root) => {
    const sizes = root.querySelector('.xterm-rows')?.textContent?.match(/\[\d+x(\d+)\]/g) ?? [];
    return Number(sizes.at(-1)?.match(/x(\d+)/)?.[1]);
  });
const drawnRows = (terminal: Locator) =>
  terminal.evaluate((root) => root.querySelector('.xterm-rows')?.children.length ?? 0);

/**
 * At each of `HEIGHTS`, 1440 wide: one size, its rows and columns inside the screen's padding, the
 * agent told that size, and `also` there. Soft: every height that fails is listed.
 */
async function sweep(page: Page, terminal: Locator, also?: (at: string) => Promise<void>) {
  for (const height of HEIGHTS) {
    await page.setViewportSize({ width: 1440, height });
    const { past, sizes } = await fitOf(terminal);
    const at = `at 1440×${height}`;
    expect.soft(sizes, `${at}: one size`).toHaveLength(1);
    expect.soft(past.bottom, `${at}: its rows inside the padding`).toBeLessThanOrEqual(0.5);
    expect.soft(past.right, `${at}: its columns inside the padding`).toBeLessThanOrEqual(0.5);
    await expect.soft
      .poll(() => toldRows(terminal), { message: `${at}: the agent's rows`, timeout: 2_000 })
      .toBe(await drawnRows(terminal));
    await also?.(at);
  }
}

test("Scribe's terminal fits its pane at every height: no scrollbar comes and goes", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${symbiote.url}skills?scribe`);
  const pane = page.getByRole('region', { name: 'Scribe' });
  // Opened at once, with no request (V77).
  const terminal = pane.locator('.agent-terminal');
  await expect(terminal.locator('.xterm-rows')).toContainText('Fake Claude Code', POLL);
  // The pane's card scrolls for a skill's text; for Scribe's terminal it never has to.
  const scrolls = () =>
    page.locator('.skills-pane').evaluate((card) => ({
      down: card.scrollHeight - card.clientHeight,
      across: card.scrollWidth - card.clientWidth,
    }));
  await sweep(page, terminal, async (at) =>
    expect.soft(await scrolls(), `${at}: the pane scrolls`).toEqual({ down: 0, across: 0 }),
  );
});

test("Scout's terminal fits its card at every height: its last row whole", async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${symbiote.url}scout`);
  const terminal = page.locator('.scout-page .agent-terminal');
  await expect(terminal.locator('.xterm-rows')).toContainText('Fake Claude Code', POLL);
  await sweep(page, terminal);
});
