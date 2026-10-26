import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { graphPage, servePullRequest, type RunningPullRequest } from './symbiote.js';

// `symbiote pr 7` on the detectors fixture: a click on a row picks the comment line, Ctrl/⌘+click
// opens it in VS Code, and `o` opens the picked line. `perimeter` is head's lines 11–13.
let symbiote: RunningPullRequest;
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
  symbiote = await servePullRequest('detectors', [], { SYMBIOTE_CODE: fake });
});

test.afterAll(() => {
  symbiote.stop();
  rmSync(dir, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(graphPage(symbiote.url));
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

const opened = (): string[][] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
    : [];

test('a click picks the comment line, Ctrl/⌘+click opens it, o opens the picked one', async ({
  page,
}) => {
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: 'perimeter' }).click();
  const body = panel.locator('.row-add', { hasText: 'return shape.size * 4' });
  await expect(body).toBeVisible();

  await body.click({ modifiers: ['ControlOrMeta'] });
  await expect(panel.getByRole('status')).toHaveText('Opened in VS Code at line 12');
  await expect(panel.locator('.comment-actions')).toContainText('on line 11 of src/shapes.ts');

  await body.click();
  await expect(panel.locator('.comment-actions')).toContainText('on line 12 of src/shapes.ts');
  await panel.locator('.row-add').first().getByRole('button', { name: '11' }).click();
  await expect(panel.locator('.comment-actions')).toContainText('on line 12 of src/shapes.ts');
  await page.keyboard.press('o');
  await expect.poll(() => opened().length).toBe(3);

  const file = join(symbiote.clone, 'src/shapes.ts');
  expect(opened()).toEqual([
    [symbiote.clone, '--goto', `${file}:12:1`],
    [symbiote.clone, '--goto', `${file}:11:1`],
    [symbiote.clone, '--goto', `${file}:12:1`],
  ]);
});
