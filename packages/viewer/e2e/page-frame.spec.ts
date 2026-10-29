import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// One page frame (V72, decisions 507–509): every page of the shell and a review takes the whole
// main area; its head is one box, its title at one x, its cards from one y; the cards 16 px from
// the area's sides and bottom and 16 apart, at any window size. Before V72 there were three
// frames (8, 16 and 24 px), Start a workspace and Settings were centred at 1,312 and 1,400 px, and
// the titles stood anywhere from x 16 to 80.
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
const PAD = 16;
const GAP = 16;
/** The head: 16 px, its two lines (44 px), 16 px. */
const CARDS_FROM = 76;
/** The page's icon in a 32 px square 16 px in, 12 px before the title. */
const TITLE_AT = 60;
const SIZES = [
  [1440, 900],
  [1920, 1080],
] as const;

type Box = { x: number; y: number; width: number; height: number };
interface Frame {
  main: Box;
  title: Box | null;
  cards: (Box & { name: string })[];
}

/** The main area, the page head's title and each card's box (the first one shown of each). */
function frame(page: Page, cards: readonly string[]): Promise<Frame> {
  return page.evaluate((selectors) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const main = document.querySelector('.shell-main') ?? document.body;
    const title = main.querySelector('.page-head h1');
    return {
      main: box(main),
      title: title ? box(title) : null,
      cards: selectors.map((selector) => {
        const el = [...main.querySelectorAll(selector)].find(
          (c) => c.getBoundingClientRect().width > 0,
        );
        return { name: selector, ...(el ? box(el) : { x: 0, y: 0, width: 0, height: 0 }) };
      }),
    };
  }, cards);
}

/** Whether two boxes share some of their height (side by side) or width (one over the other). */
const rows = (a: Box, b: Box) => a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
const columns = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1;

/**
 * The frame's rules, said per page so a failure names the page and the measure; every page's
 * failures in one run (`expect.soft`).
 */
function expectFrame(f: Frame, page: string, { bottom = true } = {}) {
  const near = (what: string, value: number, expected: number) =>
    expect
      .soft(Math.abs(value - expected), `${page}: ${what} is ${Math.round(value)}`)
      .toBeLessThanOrEqual(1);
  for (const card of f.cards) expect(card.width, `${page}: ${card.name} shown`).toBeGreaterThan(0);
  const { main, cards } = f;
  near('the cards from the left', Math.min(...cards.map((c) => c.x)) - main.x, PAD);
  near(
    'the cards from the right',
    main.x + main.width - Math.max(...cards.map((c) => c.x + c.width)),
    PAD,
  );
  near('the cards from the top', Math.min(...cards.map((c) => c.y)) - main.y, CARDS_FROM);
  if (bottom) {
    near(
      'the cards from the bottom',
      main.y + main.height - Math.max(...cards.map((c) => c.y + c.height)),
      PAD,
    );
  }
  // Each card and its nearest neighbour to the right, or below: GAP apart.
  for (const a of cards) {
    const right = cards
      .filter((b) => b !== a && rows(a, b) && b.x >= a.x + a.width - 1)
      .sort((p, q) => p.x - q.x)[0];
    if (right) near(`${a.name} to ${right.name}`, right.x - (a.x + a.width), GAP);
    const under = cards
      .filter((b) => b !== a && columns(a, b) && b.y >= a.y + a.height - 1)
      .sort((p, q) => p.y - q.y)[0];
    if (under) near(`${a.name} over ${under.name}`, under.y - (a.y + a.height), GAP);
  }
  expect.soft(f.title, `${page}: its head's title`).not.toBeNull();
  near("the head's title", (f.title?.x ?? 0) - main.x, TITLE_AT);
}

/** A page of the shell, at each size: its frame. */
async function expectPage(
  page: Page,
  name: string,
  path: string,
  cards: readonly string[],
  options?: { bottom?: boolean },
) {
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.goto(`${symbiote.url}${path}`);
    await expect(page.locator(cards[0]!).first()).toBeVisible(POLL);
    await page.evaluate(() => document.fonts.ready);
    expectFrame(await frame(page, cards), `${name} at ${width}`, options);
  }
}

test("the shell's pages: the whole main area, one head, cards 16 px from its edges and 16 apart", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await expectPage(page, 'Git', 'git', ['.branches', '.commits-card', '.git-details']);
  // The brief and the run's seven cards, each 16 apart; the body scrolls when the run is taller.
  await expectPage(
    page,
    'Start a workspace',
    'start',
    [
      '.start-brief',
      '.start-run > .start-card:first-child',
      '.start-run > .start-card + .start-card',
    ],
    { bottom: false },
  );
  await expectPage(page, 'Scout', 'scout', ['.scout-card']);
  await expectPage(page, 'Skills', 'skills', ['.skills-list', '.skills-pane']);
  await expectPage(page, 'the Monitor', 'monitor', ['.monitor-map-card', '.monitor-side']);
  await expectPage(page, 'Settings', 'settings', ['.settings-list', '.settings-editor']);
  // History (V78): empty, one card; with a finished workspace, the list and the picked one.
  await expectPage(page, 'History, empty', 'workspace-history', ['.history-none']);
  const record = join(symbiote.repo, 'symbiote', 'workspaces', 'fix', 'old.json');
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(
    record,
    JSON.stringify({
      agent: null,
      base: symbiote.shas[0],
      branch: 'fix/old',
      brief: '# Fix: old\n',
      created: '2026-10-20T09:00:00.000Z',
      finished: '2026-10-20T10:00:00.000Z',
      planFirst: false,
      worktree: `${symbiote.repo}.worktrees/fix-old`,
    }),
  );
  await expectPage(page, 'History', 'workspace-history', ['.history-list', '.history-workspace']);
});

test("a workspace, its review's two views and its merge: the same frame", async ({ page }) => {
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}start`);
  const start = page.getByRole('region', { name: 'Start a workspace' });
  await start.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await start.getByRole('textbox', { name: 'Goal' }).fill('Return a / 2.');
  await start.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(start).toBeHidden();
  const branch = 'feature/add-a-half-function';
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.report(branch, 'Done: half() in src/half.ts.');
  await expect(page.locator(`.workspace-row[data-branch="${branch}"]`)).toContainText(
    'Ready for review',
    POLL,
  );
  const at = `?branch=${encodeURIComponent(branch)}`;
  await expectPage(page, 'A workspace', at, ['.workspace-main', '.changes']);
  const tabs = await head(page, '.workspace-main', '.workspace-views', 'text');
  expect.soft(tabs?.height, "A workspace: its tabs' height").toBe(48);
  expect.soft(Math.round(tabs?.inset ?? 0), 'A workspace: its first tab').toBe(17);

  // Its review: Files and Graph start and end at the same places (the Graph's bar wrapped at
  // 1440 and its legend sat under its card).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${symbiote.url}${at}`);
  const panel = page.getByRole('region', { name: `Workspace ${branch}` });
  await panel.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.locator('.file-view')).toBeVisible(POLL);
  const review = new URL(page.url()).pathname.slice(1);
  // Their cards' heads (V72e): 48 px, the first word 16 px in.
  for (const [name, card, part] of [
    ['A review: Files', '.files-side', '.tabs'],
    ['A review: Files', '.file-view', '.file-head'],
  ] as const) {
    const got = await head(page, card, part, 'text');
    expect.soft(got?.height, `${name}: ${part}'s height`).toBe(48);
    expect.soft(Math.round(got?.inset ?? 0), `${name}: ${part}'s first word`).toBe(17);
  }
  await expectPage(page, 'A review: Files', review, ['.files-side', '.file-view']);
  await expectPage(page, 'A review: Graph', `${review}?view=graph`, [
    'nav.sidebar',
    '.canvas-card',
  ]);
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.goto(`${symbiote.url}${review}`);
    await expect(page.locator('.file-view')).toBeVisible(POLL);
    const files = await frame(page, ['.files-side', '.file-view']);
    await page.keyboard.press('g');
    await expect(page.locator('.canvas-card')).toBeVisible(POLL);
    const graph = await frame(page, ['nav.sidebar', '.canvas-card']);
    const whole = (f: Frame) =>
      f.cards.map((c) => [c.x, c.y, c.width, c.height].map(Math.round).join(' '));
    expect(whole(graph), `Graph's cards at ${width} where Files' are`).toEqual(whole(files));
  }

  // Approved and merging: the merge's steps and log, cards in the same frame.
  await page.goto(`${symbiote.url}${review}`);
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText('Approved', POLL);
  await page.goto(`${symbiote.url}${at}`);
  await panel.getByRole('button', { name: 'Merge into', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Merging' })).toBeVisible(POLL);
  await expectPage(page, 'A merge', `?merge=${encodeURIComponent(branch)}`, [
    '.merge-steps',
    '.merge-terminal',
  ]);
});

/** A card's head: its height, and how far in its first word (or control) stands. */
function head(page: Page, card: string, part: string, first: 'text' | 'box') {
  return page.evaluate(
    ([card, part, first]) => {
      const box = document.querySelector(card)?.getBoundingClientRect();
      const strip = document.querySelector(`${card} ${part}`);
      if (!box || !strip) return null;
      let x: number | null = null;
      if (first === 'box') {
        const child = [...strip.children].find((c) => c.getBoundingClientRect().width > 0);
        x = child ? child.getBoundingClientRect().x : null;
      } else {
        const walker = document.createTreeWalker(strip, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => (n.textContent?.trim() ? 1 : 3),
        });
        const text = walker.nextNode();
        if (text) {
          const range = document.createRange();
          range.selectNodeContents(text);
          x = range.getBoundingClientRect().x;
        }
      }
      return { height: strip.getBoundingClientRect().height, inset: x === null ? null : x - box.x };
    },
    [card, part, first] as const,
  );
}

/** Each field's label over it, and the field to the next label: `--field-label-gap`, `--field-gap`. */
function rhythm(page: Page, fields: string) {
  return page.evaluate((selector) => {
    const all = [...document.querySelectorAll(selector)].filter(
      (f) => f.getBoundingClientRect().height > 0,
    );
    return all.map((field, i) => {
      const label = field.querySelector('.field-label')?.getBoundingClientRect();
      const control = field
        .querySelector('.field-label')
        ?.nextElementSibling?.getBoundingClientRect();
      const next = all[i + 1]?.getBoundingClientRect();
      return {
        over: label && control ? control.y - (label.y + label.height) : null,
        next: next
          ? next.y - (field.getBoundingClientRect().y + field.getBoundingClientRect().height)
          : null,
      };
    });
  }, fields);
}

// V72e (decision 508): inside the cards, one inset and one head — before it, a card's head was 40,
// 41, 48 or 64 px and its words 12 to 24 px in — and one form rhythm (a label 5, 9 or 13 px over
// its field, 13 or 21 px to the next).
test('inside the cards: heads 48 px, their words or controls 16 px in; a label 8 px over its field, 20 to the next', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ terminal: false });
  const heads: [string, string, string, string, 'text' | 'box'][] = [
    ['git', 'Git', '.git-details', '.git-details-head', 'text'],
    ['start', 'Start a workspace', '.start-brief', '.kind-row', 'box'],
    ['settings', 'Settings', '.settings-editor', '.settings-head', 'text'],
    ['scout', 'Scout', '.scout-card', '.scout-choices', 'box'],
    ['monitor', 'the Monitor', '.monitor-map-card', '.monitor-place', 'box'],
    ['monitor', 'the Monitor', '.monitor-side', '.tabs', 'text'],
  ];
  const near = (what: string, value: number | null | undefined, expected: number) =>
    expect
      .soft(Math.abs((value ?? -99) - expected), `${what} is ${value ?? 'missing'}`)
      .toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [path, name, card, part, first] of heads) {
    await page.goto(`${symbiote.url}${path}`);
    await expect(page.locator(`${card} ${part}`).first()).toBeVisible(POLL);
    const got = await head(page, card, part, first);
    near(`${name}: ${part}'s height`, got?.height, 48);
    // The card's 1 px edge, then 16 px.
    near(`${name}: ${part}'s first ${first === 'text' ? 'word' : 'control'}`, got?.inset, 17);
  }

  // Forms: the brief, a new skill, Scout's question, a dialog.
  const forms: [string, string, string][] = [
    ['start', 'Start a workspace', '.start-brief > .workspace-field'],
    ['skills', 'New skill', '.skills-new > .skills-field'],
    ['scout', "Scout's question", '.scout-ask'],
  ];
  for (const [path, name, fields] of forms) {
    await page.goto(`${symbiote.url}${path}`);
    await expect(page.locator(fields).first()).toBeVisible(POLL);
    const gaps = await rhythm(page, fields);
    gaps.forEach(({ over, next }, i) => {
      near(`${name}: field ${i + 1}'s label over it`, over, 8);
      if (next !== null) near(`${name}: field ${i + 1} to the next label`, next, 20);
    });
  }
  await page.goto(`${symbiote.url}git`);
  await page
    .locator('.commit')
    .first()
    .click({ button: 'right', position: { x: 120, y: 10 } });
  await page.getByRole('menuitem', { name: 'New branch here…' }).click();
  const dialog = await rhythm(page, '.dialog .git-field');
  expect(dialog.length).toBeGreaterThan(0);
  dialog.forEach(({ over, next }, i) => {
    near(`A dialog: field ${i + 1}'s label over it`, over, 8);
    if (next !== null) near(`A dialog: field ${i + 1} to the next label`, next, 20);
  });
  const box = await page.locator('.dialog').boundingBox();
  const heading = await page.locator('.dialog h2').boundingBox();
  near("A dialog's heading in", (heading?.x ?? 0) - (box?.x ?? 0), 17);
});
