import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cacheFolder,
  homeFolder,
  recorded,
  runNexus,
  settingsFolder,
  startNexus,
  stopRecorded,
  type Served,
} from './nexus.js';

// NX6 (decisions 923–929): a selected folder opened, a plain one made a repository with
// `git init` after the person's yes, the guards' refusals; the nexus's port taken by a nexus or by
// another program. Real `symbiote view`s started by the nexus, in a throwaway home.

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const field = (page: Page) => page.getByRole('combobox', { name: 'Find a repository' });
const list = (page: Page) => page.getByRole('listbox', { name: 'Repositories' });
const rowNames = (page: Page) => list(page).locator('.nexus-row-name');
const picked = (page: Page) => list(page).locator('[role="option"][aria-selected="true"]');
const card = (page: Page) => page.locator('.nexus-detail');
const tab = (page: Page, name: string | RegExp) =>
  page.locator('.nexus-tabs').getByRole('tab', { name });
const frameOf = (page: Page, name: string) =>
  page.frameLocator(`iframe.nexus-frame[title="${name}"]`);

test.describe('Symbiote nexus: selecting a folder (NX6)', () => {
  const cleanup: (() => unknown)[] = [];
  test.afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  function setUp(pinned: (home: string) => string[] = () => []) {
    const home = homeFolder(['alpha'], ['notes']);
    const cache = cacheFolder();
    const settings = settingsFolder({ pinned: pinned(home.dir) });
    cleanup.push(
      () => home.remove(),
      () => cache.remove(),
      () => settings.remove(),
      () => stopRecorded(cache.dir),
    );
    return { home, cache: cache.dir, settings };
  }

  async function nexus(cache: string, home: string, config: string): Promise<Served> {
    const served = await startNexus(cache, home, config);
    cleanup.push(() => served.stop());
    return served;
  }

  test('a plain folder: Enter asks, Cancel leaves it as it was; yes runs git init and opens it', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, settings } = setUp();
    const served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);
    const notes = join(home.projects, 'notes');

    await field(page).press('ArrowRight');
    await expect(rowNames(page)).toHaveText(['projects/', 'alpha', 'notes/']);
    await field(page).press('ArrowDown');
    await field(page).press('ArrowDown');
    await expect(picked(page).locator('.nexus-row-name')).toHaveText('notes/');
    await expect(card(page)).toContainText('No git repository here. Open Symbiote asks first');

    // Enter asks; Cancel is the default, Escape cancels: nothing written, nothing started.
    await field(page).press('Enter');
    const question = page.getByRole('alertdialog', { name: 'Make notes a git repository?' });
    await expect(question).toContainText('Symbiote runs git init in ~/projects/notes');
    await expect(question.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    expect(readdirSync(notes)).toEqual([]);
    expect(recorded(cache)).toEqual([]);
    await field(page).press('Enter');
    await question.getByRole('button', { name: 'Cancel' }).click();
    expect(readdirSync(notes)).toEqual([]);

    // Yes: a repository with no commit, its Symbiote open in its tab.
    await field(page).press('Enter');
    await question.getByRole('button', { name: 'Make it a repository' }).click();
    await expect(tab(page, /^notes/)).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await expect(frameOf(page, 'notes').locator('.overview')).toBeVisible();
    expect(readdirSync(notes)).toEqual(['.git']);
    expect(() =>
      execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: notes, stdio: 'pipe' }),
    ).toThrow();
    expect(recorded(cache)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('a repository opens with Enter, asked nothing', async ({ page }) => {
    const { home, cache, settings } = setUp();
    const served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);
    await field(page).fill('alpha');
    await field(page).press('Enter');
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('refuses home itself: no question, the card says why', async ({ page }) => {
    const { home, cache, settings } = setUp((dir) => [dir]);
    const served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);
    const name = home.dir.split('/').at(-1) ?? '';
    await expect(picked(page).locator('.nexus-row-name')).toHaveText(`${name}/`);
    await expect(card(page)).toContainText(
      'Your home folder cannot be made a repository: pick a folder in it.',
    );
    await expect(card(page).getByRole('button', { name: /^Open Symbiote/ })).toHaveCount(0);
    await field(page).press('Enter');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(existsSync(join(home.dir, '.git'))).toBe(false);
    expect(recorded(cache)).toEqual([]);
  });
});

test.describe('Symbiote nexus: its port (NX6, decisions 923, 924)', () => {
  test('a second nexus on the port of a running one opens it, and serves none', async () => {
    const cache = cacheFolder();
    const first = await startNexus(cache.dir);
    try {
      const port = new URL(first.url).port;
      const second = await runNexus(['--no-open', '--port', port], cache.dir);
      expect(second).toEqual({
        code: 0,
        out: `Symbiote nexus already runs at ${first.url}\n`,
        err: '',
      });
      // The first serves on.
      expect((await fetch(new URL('api/nexus', first.url))).status).toBe(200);
    } finally {
      await first.stop();
      cache.remove();
    }
  });

  test('another program on the port: says so, names --port, and ends', async () => {
    const cache = cacheFolder();
    const other = createServer();
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const address = other.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      const result = await runNexus(['--no-open', '--port', String(port)], cache.dir);
      expect(result.code).toBe(1);
      expect(result.err).toBe(
        `symbiote-nexus: port ${port} is in use by another program: choose another with --port <n>\n`,
      );
    } finally {
      other.close();
      cache.remove();
    }
  });
});
