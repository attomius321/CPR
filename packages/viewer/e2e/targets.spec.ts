import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';
import { collectTargets, crowded } from './targets.js';

// WCAG 2.2's 2.5.8, level AA (V87b, decision 766): every button, link, field, tab, option and row a
// pointer can take is 24 × 24 px, or spaced so it cannot be missed for its neighbour. V85's 22 px
// rows and icon buttons failed it unseen; checked here on every page, at each text size.
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

/** The page's targets that fail 2.5.8, said per page (`expect.soft`: every page in one run). */
async function expectTargets(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const failing = crowded(await page.evaluate(collectTargets));
  expect.soft(failing, `${name}: targets under 24 px and too near another`).toEqual([]);
}

/** A page of the shell, opened and checked once `ready` shows. */
async function visit(page: Page, name: string, path: string, ready: string) {
  await page.goto(`${symbiote.url}${path}`);
  await expect(page.locator(ready).first()).toBeVisible(POLL);
  await expectTargets(page, name);
}

for (const size of ['default', 'compact', 'large'] as const) {
  test(`every page's targets are 24 px or spaced (WCAG 2.2, 2.5.8), the text ${size}`, async ({
    page,
  }) => {
    symbiote = await serveWorkspaces({ terminal: false });
    await page.addInitScript((size) => {
      try {
        localStorage.setItem('symbiote.viewer.text-size', size);
      } catch {
        // The default.
      }
    }, size);
    await page.setViewportSize({ width: 1440, height: 900 });

    await visit(page, 'Git', 'git', '.commit');
    await page.locator('.commit').nth(1).click();
    await expect(page.locator('.git-details')).toBeVisible(POLL);
    await expectTargets(page, 'Git, a commit picked');
    await page.locator('.commit').nth(1).click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expectTargets(page, "Git, a commit's menu");
    await page.keyboard.press('Escape');

    await visit(page, 'Start a workspace', 'start', '.start-brief');
    await visit(page, 'Nucleus', 'nucleus', '.nucleus-card');
    await visit(page, 'Skills', 'skills', '.skills-list');
    await visit(page, 'the Monitor', 'monitor', '.monitor-side');
    await visit(page, 'History', 'workspace-history', '.history-none');
    await visit(page, 'Settings', 'settings', '.settings-list');
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: 'Appearance' })
      .click();
    await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible();
    await expectTargets(page, "Settings' Appearance");

    // A workspace and its review.
    await page.goto(`${symbiote.url}start`);
    const start = page.getByRole('region', { name: 'Start a workspace' });
    await start.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
    await start.getByRole('textbox', { name: 'Goal' }).fill('Return a / 2.');
    await start.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
    await expect(start).toBeHidden();
    const branch = 'feature/add-a-half-function';
    symbiote.commit(
      branch,
      'src/half.ts',
      'export const half = (a: number) => a / 2;\n',
      'Add half',
    );
    symbiote.report(branch, 'Done: half() in src/half.ts.');
    const card = page.locator(`.workspace-row[data-branch="${branch}"]`);
    await expect(card).toContainText('Ready for review', POLL);
    await visit(page, 'A workspace', `?branch=${encodeURIComponent(branch)}`, '.workspace-main');
    const panel = page.getByRole('region', { name: `Workspace ${branch}` });
    await panel.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.locator('.file-view')).toBeVisible(POLL);
    await expectTargets(page, "A workspace's review, Files");
  });
}
