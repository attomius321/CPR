import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Alpha Ceph (decisions 682–687): while Hive mode is on, Nucleus is called Alpha Ceph and its icon
// is the Hive Mind; with it off, everything as before. A fake Claude Code, never a real one.
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
const pages = (page: Page) => page.getByRole('navigation', { name: 'Pages' });
const link = (page: Page, name: string) => pages(page).getByRole('link', { name, exact: true });
const region = (page: Page, name: string) => page.getByRole('region', { name });
const record = () => join(symbiote.repo, 'symbiote', 'nucleus.json');
/** Nucleus's record, or null while it is not written. */
const recorded = (): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(record(), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};
/** The fake's starts of Nucleus's session: its session's name stays Nucleus (decision 682). */
const starts = () => symbiote.calls().filter((call) => call.args.includes('Nucleus'));
const instructions = (at: number) => starts()[at]?.args.at(-1) ?? '';
/** Hive mode turned on or off as Settings writes it (its custom header), without its arrival. */
const keep = (page: Page, on: boolean) =>
  page.request.post(`${symbiote.url}api/hive`, {
    data: { on },
    headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
  });
/** Turns Hive mode on or off; the page read again. */
const hive = async (page: Page, on: boolean) => {
  expect((await keep(page, on)).ok()).toBe(true);
  await page.reload();
  if (on) await expect(page.locator('html')).toHaveAttribute('data-hive', 'on');
  else await expect(page.locator('html')).not.toHaveAttribute('data-hive');
};

test('Hive on: Alpha Ceph in the sidenav (open and folded), its page, the title and Settings; the Hive Mind its icon', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  // Off: Nucleus, lucide's circle-dot, as before.
  await expect(link(page, 'Nucleus')).toBeVisible();
  await expect(link(page, 'Nucleus').locator('.hive-mind-icon')).toHaveCount(0);
  await expect(link(page, 'Nucleus').locator('circle')).toHaveCount(2);

  await hive(page, true);
  const alpha = link(page, 'Alpha Ceph');
  await expect(alpha).toBeVisible();
  await expect(link(page, 'Nucleus')).toHaveCount(0);
  await expect(alpha.locator('.sidenav-label')).toHaveText('Alpha Ceph');
  await expect(alpha).toHaveAttribute('data-tip', /^Alpha Ceph\n/);
  // The Mind: 7 cells, the core's chamber white-hot.
  await expect(alpha.locator('.hive-mind-icon .plate')).toHaveCount(7);
  await expect(alpha.locator('.hive-mind-icon .chamber')).toHaveCount(7);
  await expect(alpha.locator('.hive-mind-icon')).toHaveCSS('width', '18px');
  // Folded, the rail keeps it.
  await page.getByRole('button', { name: 'Fold the sidenav' }).click();
  await expect(page.locator('.shell')).toHaveClass(/folded/);
  await expect(alpha.locator('.hive-mind-icon')).toBeVisible();
  await page.getByRole('button', { name: 'Open the sidenav' }).first().click();
  await expect(page.locator('.shell')).not.toHaveClass(/folded/);

  // Its page: the head, the tabs, the window's title; its agent told its name.
  await alpha.click();
  await expect(page).toHaveURL(`${symbiote.url}nucleus`);
  const own = region(page, 'Alpha Ceph');
  await expect(own.getByRole('heading', { name: 'Alpha Ceph' })).toBeVisible();
  await expect(own.locator('.page-icon .hive-mind-icon')).toBeVisible();
  await expect(own.getByRole('tablist', { name: 'Alpha Ceph' })).toBeVisible();
  await expect(page).toHaveTitle(/^Alpha Ceph · /);
  await expect.poll(() => starts().length, POLL).toBe(1);
  expect(instructions(0)).toMatch(/^You are Alpha Ceph, /);
  expect(instructions(0)).not.toContain('Nucleus');
  // Written once the session is found, a moment after the start.
  await expect.poll(recorded, POLL).toMatchObject({ name: 'Alpha Ceph' });

  // Settings: the prebuilt agent, its page and its prompt's group.
  await page.goto(`${symbiote.url}settings`);
  const agents = page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('region', { name: 'Prebuilt agents' });
  await expect(agents.getByRole('button')).toHaveText(['Merger', 'Alpha Ceph', 'Scribe']);
  await expect(
    agents.getByRole('button', { name: 'Alpha Ceph' }).locator('.hive-mind-icon'),
  ).toBeVisible();
  await agents.getByRole('button', { name: 'Alpha Ceph' }).click();
  await expect(page.locator('.settings-editor').getByRole('heading').first()).toHaveText(
    'Alpha Ceph',
  );
  await expect(page.getByText("Alpha Ceph's system prompt")).toBeVisible();
  await expect(page.getByText("Nucleus's system prompt")).toHaveCount(0);
});

test('a conversation keeps the name it started with as Hive goes off and on; its activity still opens', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  await hive(page, true);
  await link(page, 'Alpha Ceph').click();
  await expect.poll(() => starts().length, POLL).toBe(1);
  await expect.poll(recorded, POLL).toMatchObject({ name: 'Alpha Ceph' });
  await expect(region(page, 'Alpha Ceph').getByRole('status')).toHaveText(
    'Ready: ask in its terminal',
    POLL,
  );

  // Hive off: the page says Nucleus, and that this conversation is Alpha Ceph's.
  await hive(page, false);
  const nucleus = region(page, 'Nucleus');
  await expect(nucleus.getByRole('heading', { name: 'Nucleus' })).toBeVisible();
  await expect(nucleus.locator('.hive-mind-icon')).toHaveCount(0);
  await expect(nucleus.getByRole('note')).toHaveText(
    'Started as Alpha Ceph: New conversation starts Nucleus.',
  );
  await expect(page).toHaveTitle(/^Nucleus · /);
  // Its activity opens as before.
  await nucleus.getByRole('tab', { name: 'Activity' }).click();
  await expect(nucleus.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(nucleus.locator('.workspace-activity')).toBeVisible();
  await nucleus.getByRole('tab', { name: 'Terminal' }).click();

  // Hive on again: the names agree, no note.
  await hive(page, true);
  await expect(region(page, 'Alpha Ceph').getByRole('note')).toHaveCount(0);
  await hive(page, false);

  // New conversation, Hive off: Nucleus, as before Alpha Ceph.
  await region(page, 'Nucleus').getByRole('button', { name: 'New conversation' }).click();
  await expect.poll(() => starts().length, POLL).toBe(2);
  await expect(region(page, 'Nucleus').getByRole('note')).toHaveCount(0, POLL);
  expect(instructions(1)).toMatch(/^You are Nucleus, /);
  // The new conversation's record, once written: no name, as before Alpha Ceph (the old one
  // had one).
  const kind = () => {
    const now = recorded();
    return now ? ('name' in now ? 'named' : 'plain') : 'none';
  };
  await expect.poll(kind, POLL).toBe('plain');
});
