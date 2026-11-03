import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  // The kits' 16 px page icons (V93; 18 px before).
  await expect(alpha.locator('.hive-mind-icon')).toHaveCSS('width', '16px');
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

test('a conversation at work keeps the name it started with as Hive goes off and on; its activity still opens', async ({
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
  // Answering: Hive going off or on leaves it be (V86, decision 750).
  symbiote.setSession('fake0', { state: 'working', status: 'busy' });
  await expect(link(page, 'Alpha Ceph')).toHaveAttribute('data-state', 'working', POLL);

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

/** A Symbiote whose repository has a check: Hive turns on only with one (V92, decision 872). */
async function serveWithCheck(): Promise<RunningWorkspaces> {
  const running = await serveWorkspaces();
  mkdirSync(join(running.repo, 'symbiote'), { recursive: true });
  writeFileSync(join(running.repo, 'symbiote', 'config.json'), '{"merge":{"checks":["true"]}}');
  return running;
}

// V86 (decisions 750–752): Nucleus's conversation follows Hive, told what Hive does as Alpha Ceph;
// the question says so.
const hiveText = "Hive mode is on. Every workspace you start now is Hive's";

test('turning Hive on, a conversation at rest ends and Alpha Ceph starts, told what Hive does; off, Nucleus again; the question says so', async ({
  page,
}) => {
  symbiote = await serveWithCheck();
  await page.goto(`${symbiote.url}nucleus`);
  await expect.poll(() => starts().length, POLL).toBe(1);
  expect(instructions(0)).toMatch(/^You are Nucleus, /);
  expect(instructions(0)).not.toContain('Hive mode is on');

  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  await page
    .getByRole('region', { name: 'Hive mode' })
    .getByRole('button', { name: 'Turn on Hive mode' })
    .click();
  const question = page.getByRole('alertdialog', { name: 'Turn on Hive mode' });
  await expect(question).toContainText(
    'Nucleus becomes Alpha Ceph and is told what Hive does: its conversation starts again, unless it is answering or waiting on you.',
  );
  await question.getByRole('button', { name: 'Turn on Hive', exact: true }).click();
  await expect.poll(() => starts().length, POLL).toBe(2);
  expect(symbiote.removed()).toEqual(['fake0']);
  expect(instructions(1)).toMatch(/^You are Alpha Ceph, /);
  expect(instructions(1)).toContain(hiveText);
  expect(instructions(1)).toContain('for up to 3 rounds');
  await expect.poll(recorded, POLL).toMatchObject({ name: 'Alpha Ceph' });
  await link(page, 'Alpha Ceph').click();
  await expect(
    region(page, 'Alpha Ceph').getByRole('heading', { name: 'Alpha Ceph' }),
  ).toBeVisible();
  await expect(region(page, 'Alpha Ceph').getByRole('note')).toHaveCount(0);

  // Off: Nucleus again, without Hive's text.
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  await page
    .getByRole('region', { name: 'Hive mode' })
    .getByRole('button', { name: 'Turn off Hive', exact: true })
    .click();
  await expect.poll(() => starts().length, POLL).toBe(3);
  expect(instructions(2)).toMatch(/^You are Nucleus, /);
  expect(instructions(2)).not.toContain('Hive mode is on');
  await expect.poll(recorded, POLL).not.toHaveProperty('name');
});

test("turning Hive on, a conversation that is answering is kept: its page says how to start Alpha Ceph's", async ({
  page,
}) => {
  symbiote = await serveWithCheck();
  await page.goto(`${symbiote.url}nucleus`);
  await expect.poll(() => starts().length, POLL).toBe(1);
  await expect(region(page, 'Nucleus').getByRole('status')).toHaveText(
    'Ready: ask in its terminal',
    POLL,
  );
  symbiote.setSession('fake0', { state: 'working', status: 'busy' });
  await expect(link(page, 'Nucleus')).toHaveAttribute('data-state', 'working', POLL);
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  await page
    .getByRole('region', { name: 'Hive mode' })
    .getByRole('button', { name: 'Turn on Hive mode' })
    .click();
  await page
    .getByRole('alertdialog', { name: 'Turn on Hive mode' })
    .getByRole('button', { name: 'Turn on Hive', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-hive', 'on');
  await link(page, 'Alpha Ceph').click();
  await expect(region(page, 'Alpha Ceph').getByRole('note')).toHaveText(
    'Started as Nucleus: New conversation starts Alpha Ceph.',
  );
  expect(starts()).toHaveLength(1);
  expect(symbiote.removed()).toEqual([]);
});

// V86 (decisions 730–734): Nucleus becomes Alpha Ceph in the sidenav once Hive's arrival is still;
// only in the window that turned Hive on, never at load, at once with reduced motion.

/** One moment of the sidenav's Nucleus link and of the arrival, as the page changed. */
interface Moment {
  hive: boolean;
  arriving: boolean;
  label: string;
  mind: boolean;
  becoming: boolean;
}

/** From the page's first script on, every change of the link or the arrival kept in order. */
const watch = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { moments: Moment[] };
    w.moments = [];
    const take = () => {
      const link = document.querySelector('.sidenav-pages a[href="/nucleus"]');
      if (!link) return;
      const root = document.documentElement;
      const moment: Moment = {
        hive: root.dataset.hive === 'on',
        arriving: 'hiveArriving' in root.dataset || 'hiveArrival' in root.dataset,
        label: link.querySelector('.sidenav-label')?.textContent ?? '',
        mind: !!link.querySelector('.hive-mind-icon'),
        becoming: !!link.querySelector('.hive-mind-icon.becoming'),
      };
      const last = w.moments.at(-1);
      if (!last || JSON.stringify(last) !== JSON.stringify(moment)) w.moments.push(moment);
    };
    new MutationObserver(take).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-hive', 'data-hive-arriving', 'class'],
    });
  });
const moments = (page: Page) =>
  page.evaluate(() => (window as unknown as { moments: Moment[] }).moments);
const hiveEditor = (page: Page) => page.getByRole('region', { name: 'Hive mode' });
/** Turns Hive on as the person does: Settings' button, then the question's. */
const turnOn = async (page: Page) => {
  await hiveEditor(page).getByRole('button', { name: 'Turn on Hive mode' }).click();
  await page
    .getByRole('alertdialog', { name: 'Turn on Hive mode' })
    .getByRole('button', { name: 'Turn on Hive', exact: true })
    .click();
};
/** The sidenav's link, either name. */
const nucleusLink = (page: Page) => pages(page).locator('a[href="/nucleus"]');
/** Animations still running in the sidenav. */
const moving = (page: Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            !!(animation.effect as KeyframeEffect | null)?.target?.closest('.sidenav'),
        ).length,
  );

test('turning Hive on, Nucleus becomes Alpha Ceph in the sidenav once the arrival is still, open and folded; Hive off, Nucleus at once', async ({
  page,
}) => {
  symbiote = await serveWithCheck();
  await watch(page);
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  await expect(link(page, 'Nucleus')).toBeVisible();

  await turnOn(page);
  const icon = nucleusLink(page).locator('.hive-mind-icon');
  await expect(icon).toHaveClass(/becoming/, { timeout: 6_000 });
  // While it plays, the link is Alpha Ceph's to a reader, and it stays usable.
  await expect(link(page, 'Alpha Ceph')).toBeVisible();
  await expect(icon).not.toHaveClass(/becoming/, { timeout: 3_000 });
  await expect(link(page, 'Alpha Ceph').locator('.sidenav-label')).toHaveText('Alpha Ceph');
  await expect(icon.locator('.plate')).toHaveCount(7);
  await expect(icon.locator('.was-ring, .was-dot, .flare')).toHaveCount(0);
  expect(await moving(page)).toBe(0);

  const seen = await moments(page);
  // Nucleus through the arrival, the look Hive's around it: held, not changed under the cover.
  const swapped = seen.findIndex((moment) => moment.hive);
  expect(swapped).toBeGreaterThan(-1);
  expect(seen[swapped]).toMatchObject({ label: 'Nucleus', mind: false });
  // It plays only once all is still, and never before.
  const played = seen.findIndex((moment) => moment.becoming);
  expect(played).toBeGreaterThan(swapped);
  expect(seen.slice(swapped, played).every((moment) => moment.label === 'Nucleus')).toBe(true);
  expect(seen.filter((moment) => moment.becoming).every((moment) => !moment.arriving)).toBe(true);
  // The name changes over: other letters between the two names.
  const during = seen.filter((moment) => moment.becoming).map((moment) => moment.label);
  expect(during.some((label) => label !== 'Nucleus' && label !== 'Alpha Ceph')).toBe(true);
  expect(seen.at(-1)).toMatchObject({ label: 'Alpha Ceph', mind: true, becoming: false });

  // Off: Nucleus at once, nothing plays.
  await hiveEditor(page).getByRole('button', { name: 'Turn off Hive', exact: true }).click();
  await expect(link(page, 'Nucleus')).toBeVisible();
  await expect(nucleusLink(page).locator('.hive-mind-icon')).toHaveCount(0);

  // Folded: the icon plays on the rail.
  await page.getByRole('button', { name: 'Fold the sidenav' }).click();
  await expect(page.locator('.shell')).toHaveClass(/folded/);
  await turnOn(page);
  await expect(icon).toHaveClass(/becoming/, { timeout: 6_000 });
  await expect(icon).toBeVisible();
  await expect(icon).not.toHaveClass(/becoming/, { timeout: 3_000 });
  await expect(link(page, 'Alpha Ceph')).toBeVisible();
});

test('with Hive already on, a reload and a new tab show Alpha Ceph still', async ({ page }) => {
  symbiote = await serveWithCheck();
  await watch(page);
  await page.goto(`${symbiote.url}git`);
  await hive(page, true);
  await expect(link(page, 'Alpha Ceph').locator('.hive-mind-icon')).toBeVisible();
  const other = await page.context().newPage();
  await watch(other);
  await other.goto(`${symbiote.url}nucleus`);
  await expect(link(other, 'Alpha Ceph').locator('.hive-mind-icon')).toBeVisible();
  // Longer than an arrival and the play: nothing ever played.
  await page.waitForTimeout(1_500);
  for (const shown of [page, other]) {
    const seen = await moments(shown);
    expect(seen.some((moment) => moment.becoming || moment.label === 'Nucleus')).toBe(false);
    expect(await moving(shown)).toBe(0);
  }
  await other.close();
});

test('with reduced motion, Nucleus is Alpha Ceph at once as Hive turns on', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  symbiote = await serveWithCheck();
  await watch(page);
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  await turnOn(page);
  await expect(link(page, 'Alpha Ceph').locator('.hive-mind-icon')).toBeVisible();
  await page.waitForTimeout(1_500);
  const seen = await moments(page);
  expect(seen.some((moment) => moment.becoming)).toBe(false);
  // The name and the look changed together.
  const swapped = seen.find((moment) => moment.hive);
  expect(swapped).toMatchObject({ label: 'Alpha Ceph', mind: true });
});
