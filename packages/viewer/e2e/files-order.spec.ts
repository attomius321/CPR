import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { serveFixture, type RunningFixture } from './symbiote.js';

// V102: the Files page in order of risk (decisions 973–974). The fixture's two warnings are in
// src/zoo.ts, the last of git's five paths; then code, a test and two docs files.
let symbiote: RunningFixture;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveFixture('packages/viewer/test/fixtures/files-by-risk');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const GIT_ORDER = ['README.md', 'docs/notes.md', 'src/area.test.ts', 'src/area.ts', 'src/zoo.ts'];
const RISK_ORDER = ['src/zoo.ts', 'src/area.ts', 'src/area.test.ts', 'README.md', 'docs/notes.md'];

const rows = (page: Page) => page.locator('.files-list .changes-file');
const row = (page: Page, path: string) =>
  page.getByRole('button', { name: `Show the changes to ${path}` });
/** The list's paths, top to bottom, from each row's label. */
const listed = (page: Page) =>
  rows(page).evaluateAll((buttons) =>
    buttons.map((b) => /^Show the changes to (\S+)/.exec(b.getAttribute('aria-label') ?? '')?.[1]),
  );

test('opens on the file of the worst findings, its count on its row; j and k walk the order', async ({
  page,
}) => {
  await page.goto(symbiote.url);
  await expect(page.locator('.page-switch .scope.active')).toHaveText('Files');
  await expect(rows(page)).toHaveCount(5);
  expect(await listed(page)).toEqual(RISK_ORDER);

  // The page opens on it.
  await expect(row(page, 'src/zoo.ts')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.file-path')).toHaveText('src/zoo.ts');
  await expect(page.locator('.file-position')).toHaveText('1 of 5');

  // Its row counts its findings in the worst one's colour, as a graph card does; the rows
  // without findings count none.
  const count = row(page, 'src/zoo.ts').locator('.files-findings');
  await expect(count).toHaveText('2');
  await expect(count).toHaveClass(/count-warning/);
  await expect(count).toHaveAttribute('data-tip', '2 warnings');
  await expect(row(page, 'src/zoo.ts')).toHaveAccessibleName(
    'Show the changes to src/zoo.ts (2 warnings)',
  );
  await expect(page.locator('.files-findings')).toHaveCount(1);
  const colours = await count.evaluate((element) => {
    const style = getComputedStyle(element);
    const warning = getComputedStyle(document.documentElement).getPropertyValue('--warning');
    const probe = document.createElement('span');
    probe.style.color = warning;
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { background: style.backgroundColor, expected };
  });
  expect(colours.background).toBe(colours.expected);

  // j and k walk the list as it is drawn.
  for (const path of RISK_ORDER.slice(1)) {
    await page.keyboard.press('j');
    await expect(page.locator('.file-path')).toHaveText(path);
    await expect(row(page, path)).toHaveAttribute('aria-current', 'true');
  }
  await page.keyboard.press('k');
  await expect(page.locator('.file-path')).toHaveText('README.md');
  // The arrows in the file's head too.
  await page.getByRole('button', { name: 'The file before' }).click();
  await expect(page.locator('.file-path')).toHaveText('src/area.test.ts');
  await expect(page.locator('.file-position')).toHaveText('3 of 5');
});

const pair = () => {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: symbiote.repo, encoding: 'utf8' }).trim();
  return { base: git('rev-parse', 'HEAD~1'), head: git('rev-parse', 'HEAD') };
};

/**
 * Opens the Files page while the pair is "analyzed": `api/graph` answers 202 until the returned
 * function lets the server's own answer through.
 */
async function openAnalyzing(page: Page): Promise<() => Promise<void>> {
  await page.route('**/api/graph', (route) =>
    route.fulfill({
      status: 202,
      json: { ...pair(), phase: 'references', queued: 0, elapsedMs: 1_000 },
    }),
  );
  await page.goto(symbiote.url);
  await expect(page.locator('.analysis-state')).toBeVisible();
  // The Files page meanwhile, as the steps offer it (V90).
  await page.getByRole('button', { name: 'Read the files' }).click();
  await expect(rows(page)).toHaveCount(5);
  return () => page.unroute('**/api/graph');
}

/** The graph has arrived: its findings are counted on their row. */
const graphShown = (page: Page) =>
  expect(row(page, 'src/zoo.ts').locator('.files-findings')).toHaveText('2');

test("keeps git's order while the change is analyzed, and the file picked open when it reorders", async ({
  page,
}) => {
  const release = await openAnalyzing(page);
  // Git's order meanwhile (decision 847), its first file open; no count yet.
  expect(await listed(page)).toEqual(GIT_ORDER);
  await expect(page.locator('.file-path')).toHaveText('README.md');
  await expect(page.locator('.files-findings')).toHaveCount(0);
  await row(page, 'src/area.test.ts').click();
  await expect(page.locator('.file-path')).toHaveText('src/area.test.ts');

  await release();
  await graphShown(page);
  expect(await listed(page)).toEqual(RISK_ORDER);
  // The file picked stays open, now third; j goes on from it in the new order.
  await expect(page.locator('.file-path')).toHaveText('src/area.test.ts');
  await expect(row(page, 'src/area.test.ts')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.file-position')).toHaveText('3 of 5');
  await page.keyboard.press('j');
  await expect(page.locator('.file-path')).toHaveText('README.md');
});

test('keeps the first file of git’s order open when the graph arrives, if none was picked', async ({
  page,
}) => {
  const release = await openAnalyzing(page);
  await expect(page.locator('.file-path')).toHaveText('README.md');

  await release();
  await graphShown(page);
  expect(await listed(page)).toEqual(RISK_ORDER);
  await expect(page.locator('.file-path')).toHaveText('README.md');
  await expect(row(page, 'README.md')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.file-position')).toHaveText('4 of 5');
  await page.keyboard.press('k');
  await expect(page.locator('.file-path')).toHaveText('src/area.test.ts');
  // A reload opens the change as it is now: on its riskiest file.
  await page.goto(symbiote.url);
  await expect(page.locator('.file-path')).toHaveText('src/zoo.ts');
});
