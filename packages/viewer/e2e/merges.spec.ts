import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveAgentBranch, type RunningAgent } from './symbiote.js';

// Symbiote's merger agent (V26c): a conflict answered region by region by a fake Claude Code,
// written by Symbiote, reviewed in the merge the sidenav opens, asked again, then approved and
// landed.
let symbiote: RunningAgent;
const errors: string[] = [];

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

const DOUBLE = 'export const double = (a: number) => a * 2;';
const SQUARE = 'export function square(a: number): number {\n  return a * a;\n}';
const CUBE = 'export function cube(a: number): number {\n  return a * a * a;\n}';

const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: symbiote.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Main',
      GIT_AUTHOR_EMAIL: 'main@example.com',
      GIT_COMMITTER_NAME: 'Main',
      GIT_COMMITTER_EMAIL: 'main@example.com',
    },
  }).trim();

/** Reviews `agent` from History and approves it. */
async function approve(page: Page) {
  await page.goto(`${symbiote.url}history`);
  const tip = page.locator('.commit', {
    has: page.locator('.commit-subject', { hasText: 'Agent: add cube' }),
  });
  await tip.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Review', exact: true }).hover();
  await page.getByRole('menu', { name: 'Review' }).getByRole('menuitem').first().click();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText('Approved');
}

test('a conflict: the merger agent answers, you ask again, then approve, and it lands', async ({
  page,
}) => {
  page.on('pageerror', (error) => errors.push(error.message));
  symbiote = await serveAgentBranch(
    {},
    {
      merger: [
        JSON.stringify({ regions: { '1': DOUBLE }, notes: { '1': "kept main's" } }),
        JSON.stringify({
          regions: { '1': `${DOUBLE}\n\n${SQUARE}\n\n${CUBE}` },
          notes: { '1': 'kept both: main first' },
        }),
      ],
    },
  );
  // main adds a function where the agent added its own: the merge conflicts.
  const math = join(symbiote.repo, 'src/math.ts');
  writeFileSync(math, `${readFileSync(math, 'utf8')}\n${DOUBLE}\n`);
  git('commit', '-q', '-am', 'Main: add double');
  const main = git('rev-parse', 'main');
  await approve(page);
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();

  // Resolved by the agent, written by Symbiote, waiting for review: main has not moved.
  // In the sidenav's Merging group; opened in the main area (V29a).
  await page.goto(`${symbiote.url}history`);
  await page.locator('.sidenav [data-merge="agent"]').getByRole('link').click();
  await expect(page).toHaveURL(`${symbiote.url}?merge=agent`);
  const entry = page.getByRole('region', { name: 'Merge of agent' });
  await expect(entry.locator('.merge-row-state')).toHaveText(
    /^Resolved 1 region \(sonnet, [\d.K]+ tokens\): review it$/,
  );
  const region = entry.getByRole('list', { name: 'Its resolution' }).getByRole('listitem');
  await expect(region.locator('.merge-region-where')).toContainText('src/math.ts:');
  await expect(region.locator('.merge-region-where')).toContainText("kept main's");
  await expect(region.locator('.merge-written pre')).toHaveText(DOUBLE);
  expect(git('rev-parse', 'main')).toBe(main);
  // Its prompt: the region, numbered, and the sides' titles; not the other files.
  const [first] = symbiote.mergerPrompts();
  expect(first).toContain('main (ours): Main: add double');
  expect(first).toContain('agent (theirs): Agent: add cube');
  expect(first).toContain('Region 1 (lines');
  expect(first).not.toContain('callers');

  // Asked again with your words: its earlier answer goes with them.
  await entry.getByRole('button', { name: 'Request changes' }).click();
  await entry.getByLabel('What to change in the resolution').fill("Keep the agent's functions.");
  await entry.getByRole('button', { name: 'Ask again' }).click();
  await expect(region.locator('.merge-written pre')).toHaveText(
    `${DOUBLE}\n\n${SQUARE}\n\n${CUBE}`,
  );
  expect(symbiote.mergerPrompts()[1]).toContain(
    "Your earlier answer was reviewed: Keep the agent's functions.",
  );

  await entry.getByRole('button', { name: 'Approve' }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(/^Landed: main is at [0-9a-f]{7}$/);
  const merged = readFileSync(math, 'utf8');
  for (const text of [DOUBLE, SQUARE, CUBE]) expect(merged).toContain(text);
  expect(merged).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
  expect(git('log', '-1', '--format=%s', 'main')).toBe('Merge agent: Agent: add cube');
  expect(git('status', '--porcelain', '--untracked-files=no')).toBe('');
});

test('the merger agent says you must decide: nothing is merged', async ({ page }) => {
  page.on('pageerror', (error) => errors.push(error.message));
  symbiote = await serveAgentBranch(
    {},
    { merger: [JSON.stringify({ needsYou: 'region 1: double or square first?' })] },
  );
  const math = join(symbiote.repo, 'src/math.ts');
  writeFileSync(math, `${readFileSync(math, 'utf8')}\n${DOUBLE}\n`);
  git('commit', '-q', '-am', 'Main: add double');
  const main = git('rev-parse', 'main');
  await approve(page);
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  // In the sidenav's Merging group; opened in the main area (V29a).
  await page.goto(`${symbiote.url}history`);
  await page.locator('.sidenav [data-merge="agent"]').getByRole('link').click();
  await expect(page).toHaveURL(`${symbiote.url}?merge=agent`);
  const entry = page.getByRole('region', { name: 'Merge of agent' });
  await expect(entry.locator('.merge-row-state')).toHaveText(
    'The merger agent: region 1: double or square first?',
  );
  await expect(entry.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(entry.locator('.merge-files li')).toHaveText(['src/math.ts']);
  expect(git('rev-parse', 'main')).toBe(main);
});
