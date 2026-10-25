import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// Symbiote's logs (LG1): a page's errors reach the server's folder as `viewer` lines, beside the
// server's own. The page still sees its errors as before (the checks of every other spec).
let symbiote: RunningCommits;
const logs = mkdtempSync(join(tmpdir(), 'symbiote-e2e-logs-'));

test.beforeAll(async () => {
  symbiote = await serveCommits({ SYMBIOTE_LOG_DIR: logs });
});

test.afterAll(() => {
  symbiote.stop();
  rmSync(logs, { recursive: true, force: true });
});

/** Every line in the folder, parsed. */
const written = () =>
  readdirSync(logs).flatMap((name) =>
    readFileSync(join(logs, name), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );

test("a page's uncaught error and unhandled rejection are written as viewer lines", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit-subject').first()).toBeVisible();

  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e: thrown in a page');
    });
    void Promise.reject(new Error('e2e: rejected in a page'));
  });

  await expect
    .poll(() =>
      written()
        .filter((line) => line.process === 'viewer')
        .map((line) => line.msg),
    )
    .toEqual(expect.arrayContaining(['e2e: thrown in a page', 'e2e: rejected in a page']));
  const thrown = written().find((line) => line.msg === 'e2e: thrown in a page');
  expect(thrown).toMatchObject({ level: 'error', page: '/history', err: { type: 'Error' } });
  expect((thrown?.err as { stack: string }).stack).toContain('e2e: thrown in a page');
  // The server's own lines are in the same folder.
  expect(written()).toEqual(
    expect.arrayContaining([expect.objectContaining({ process: 'view', msg: 'view started' })]),
  );
  // The page still sees its error as without the reporter.
  expect(errors).toContain('e2e: thrown in a page');
});
