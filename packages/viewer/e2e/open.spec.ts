import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixtureFile, serveFixture, type RunningFixture } from './symbiote.js';

// The callers fixture's src/math.ts: add modified (head lines 1–3), legacy removed (base 5–7),
// triple added (head 5–7). `SYMBIOTE_CODE` is a stand-in for VS Code that writes what it was given.
let symbiote: RunningFixture;
const dir = mkdtempSync(join(tmpdir(), 'symbiote-e2e-code-'));
const log = join(dir, 'opened.jsonl');
const fake = join(dir, 'code');
const errors: string[] = [];

test.beforeAll(async () => {
  writeFileSync(
    fake,
    '#!/usr/bin/env node\n' +
      `require('node:fs').appendFileSync(${JSON.stringify(log)}, ` +
      "JSON.stringify(process.argv.slice(2)) + '\\n');\n",
  );
  chmodSync(fake, 0o755);
  symbiote = await serveFixture('callers', [], { SYMBIOTE_CODE: fake });
});

test.afterAll(() => {
  symbiote.stop();
  rmSync(dir, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  rmSync(log, { force: true });
  writeFileSync(join(symbiote.repo, 'src/math.ts'), fixtureFile('callers', 'src/math.ts'));
  await page.goto(symbiote.url);
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

/** What the stand-in was asked to open, one list of arguments per run. */
const opened = (): string[][] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
    : [];
const goto = (line: number) => [
  symbiote.repo,
  '--goto',
  `${join(symbiote.repo, 'src/math.ts')}:${line}:1`,
];

async function select(page: Page, name: string, { code = true } = {}) {
  await page
    .locator('.react-flow__node-symbol', { has: page.locator('.symbol-name', { hasText: name }) })
    .click();
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });
  await expect(panel.locator('.panel-title')).toHaveText(name);
  if (code) await expect(panel.locator('.row').first()).toBeVisible();
  return panel;
}

test('opens the symbol in VS Code: the repository’s folder, at its first line', async ({
  page,
}) => {
  const panel = await select(page, 'add');
  await panel.getByRole('button', { name: 'Open in VS Code' }).click();
  await expect(panel.getByRole('status')).toHaveText('Opened in VS Code at line 1');
  expect(opened()).toEqual([goto(1)]);
});

test('opens a row’s line with Ctrl/⌘+click, or a line number', async ({ page }) => {
  const panel = await select(page, 'triple');
  await panel.locator('.row', { hasText: 'return add(a, a, a)' }).click({
    modifiers: ['ControlOrMeta'],
  });
  await expect(panel.getByRole('status')).toHaveText('Opened in VS Code at line 6');

  // A removed line is not in the working copy (head): it opens where it was.
  const legacy = await select(page, 'legacy');
  await legacy.locator('.row-del').first().getByRole('button', { name: '5' }).click();
  await expect(legacy.getByRole('status')).toHaveText(
    'Line 5 of base is not in your working copy: opened at line 5, where it was',
  );
  expect(opened()).toEqual([goto(6), goto(5)]);
});

test('o opens the selected symbol where it is in the working copy now', async ({ page }) => {
  writeFileSync(
    join(symbiote.repo, 'src/math.ts'),
    `// one\n// two\n${fixtureFile('callers', 'src/math.ts')}`,
  );
  await select(page, 'add');
  await page.keyboard.press('o');
  await expect(page.getByRole('status')).toHaveText(
    'Opened in VS Code at line 3 (1 at head: moved in your working copy)',
  );
  expect(opened()).toEqual([goto(3)]);
});

test('says when the working copy has no such file, and opens nothing', async ({ page }) => {
  rmSync(join(symbiote.repo, 'src/math.ts'));
  const panel = await select(page, 'add');
  await panel.getByRole('button', { name: 'Open in VS Code' }).click();
  await expect(panel.getByRole('status')).toHaveText('src/math.ts is not in your working copy');
  expect(opened()).toEqual([]);
});

test('offers nothing for a graph file opened without symbiote (?graph=)', async ({ page }) => {
  await page.goto(`${symbiote.url}?graph=api/graph`);
  const panel = await select(page, 'add', { code: false });
  await expect(panel.getByRole('button', { name: 'Open in VS Code' })).toHaveCount(0);
  await expect(panel.locator('.ln-open')).toHaveCount(0);
  await page.keyboard.press('o');
  expect(opened()).toEqual([]);
});
