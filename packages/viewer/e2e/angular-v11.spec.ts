import { expect, test, type Locator, type Page } from '@playwright/test';
import { serveFixture, type Running } from './cpr.js';

// `cpr view --plugin angular` on an Angular 11 app (NgModule, `templateUrl`, `*ngFor`, `*ngIf`):
// HeroService.getHeroes takes a limit, HeroesComponent.onSelect became select() but the
// template still calls onSelect, and a new button calls add(). What the analysis found is what
// the viewer draws: the header's counts, each symbol in its file's box in its status colour with
// its kind, signature and findings, and the template's own diff, `@` in its text included (plain
// text before Angular 17's blocks).
let cpr: Running;
const errors: string[] = [];

const SERVICE = 'src/app/hero.service.ts';
const HTML = 'src/app/heroes.component.html';
const HEROES = 'src/app/heroes.component.ts';

interface Changed {
  id: string;
  label: string;
  kind: string;
  tone: 'added' | 'removed' | 'modified';
  /** The node's second line: its head signature, or its base one when removed. */
  signature: string;
  /** What changed in a modified symbol. */
  delta: string[];
  /** Severity of its one finding. */
  finding?: 'error' | 'warning' | 'info';
}

/** Every changed symbol, in the change list's reading order. */
const CHANGED: Changed[] = [
  {
    id: `${SERVICE}#HeroService.getHeroes`,
    label: 'HeroService.getHeroes',
    kind: 'method',
    tone: 'modified',
    signature: 'getHeroes(limit: number): Hero[]',
    delta: ['signature', 'body'],
    finding: 'info',
  },
  {
    id: `${HTML}#(template)`,
    label: 'heroes.component.html',
    kind: 'template',
    tone: 'modified',
    signature: 'template of HeroesComponent',
    delta: ['body'],
  },
  {
    id: `${HEROES}#HeroesComponent`,
    label: 'HeroesComponent',
    kind: 'class',
    tone: 'modified',
    signature: 'class HeroesComponent implements OnInit',
    delta: ['body'],
  },
  {
    id: `${HEROES}#HeroesComponent.ngOnInit`,
    label: 'HeroesComponent.ngOnInit',
    kind: 'method',
    tone: 'modified',
    signature: 'ngOnInit(): void',
    delta: ['body'],
  },
  {
    id: `${HEROES}#HeroesComponent.onSelect`,
    label: 'HeroesComponent.onSelect',
    kind: 'method',
    tone: 'removed',
    signature: 'onSelect(hero: Hero): void',
    delta: [],
    finding: 'error',
  },
  {
    id: `${HEROES}#HeroesComponent.select`,
    label: 'HeroesComponent.select',
    kind: 'method',
    tone: 'added',
    signature: 'select(hero: Hero): void',
    delta: [],
    finding: 'warning',
  },
  {
    id: `${HEROES}#HeroesComponent.add`,
    label: 'HeroesComponent.add',
    kind: 'method',
    tone: 'added',
    signature: 'add(name: string): void',
    delta: [],
  },
];

const fileOf = (id: string) => id.slice(0, id.indexOf('#'));
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const box = (page: Page, file: string) => node(page, `group:file:${file}`);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Symbol detail' });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Review' });

/** Opens a symbol from the change list; the canvas zooms to it. */
async function open(page: Page, label: string): Promise<void> {
  await page.getByRole('tab', { name: /Changes/ }).click();
  await sidebar(page).getByRole('button', { name: label, exact: true }).click();
  await expect(panel(page).locator('.panel-title')).toHaveText(label);
}

/** The colour a status is drawn in: the legend's swatch for it. */
const swatch = (page: Page, tone: string) =>
  page
    .locator(`.legend-item.tone-${tone}`)
    .evaluate((el) => getComputedStyle(el, '::before').backgroundColor);

/** A symbol's colour on the canvas: its left edge. */
const colourOf = (symbol: Locator) =>
  symbol.locator('.symbol').evaluate((el) => getComputedStyle(el).borderLeftColor);

async function rect(locator: Locator) {
  const r = await locator.boundingBox();
  expect(r, 'drawn on the page').not.toBeNull();
  return r!;
}

test.beforeAll(async () => {
  cpr = await serveFixture('packages/plugin-angular/test/fixtures/ng11', ['--plugin', 'angular']);
});

test.afterAll(() => cpr.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(cpr.url);
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

test('the header counts the change and its findings', async ({ page }) => {
  const summary = page.locator('.summary');
  await expect(summary.locator('.revisions')).toHaveText(
    /^HEAD~1 \([0-9a-f]{7}\) → HEAD \([0-9a-f]{7}\)$/,
  );
  await expect(summary.locator('.chip')).toHaveText(['3 files', '+2', '−1', '~4']);
  // The info finding has no badge of its own.
  await expect(summary.locator('.badge')).toHaveText(['1 error', '1 warning']);
});

test('findings open first, worst first, and lead to their symbol', async ({ page }) => {
  await expect(page.getByRole('tab', { name: /Findings/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: /Findings/ })).toContainText('3');
  const rows = page.locator('.finding-row');
  await expect(rows.locator('.badge')).toHaveText(['error', 'warning', 'info']);
  await expect(rows.locator('.finding-row-rule')).toHaveText([
    'removed-still-referenced',
    'orphan-added',
    'signature-changed',
  ]);
  await expect(rows.locator('.finding-row-message')).toHaveText([
    'HeroesComponent.onSelect was removed but is still used by 1 symbol: heroes.component.html',
    'HeroesComponent.select is new and nothing references it',
    'HeroService.getHeroes changed its signature; its only user was updated',
  ]);

  // The error opens the removed method: the template that still calls it is its user.
  await rows.first().click();
  const detail = panel(page);
  await expect(detail.locator('.panel-title')).toHaveText('HeroesComponent.onSelect');
  await expect(detail.locator('.panel-kind')).toHaveText('method · removed');
  await expect(detail.locator('.panel-kind .tag')).toHaveCount(0);
  await expect(detail.locator('.finding')).toContainText('removed-still-referenced');
  await expect(detail.locator('.sig')).toHaveText('onSelect(hero: Hero): void');
  const usedBy = detail.locator('section', { has: page.getByRole('heading', { name: /Used by/ }) });
  await expect(usedBy.locator('li')).toHaveText(['heroes.component.html call · removed']);
  await expect(node(page, CHANGED[4]!.id).locator('.symbol')).toHaveClass(/selected/);
});

test('the change list holds every changed symbol, by file, in its colour', async ({ page }) => {
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.getByRole('tab', { name: /Changes/ })).toContainText(`0/${CHANGED.length}`);
  await expect(sidebar(page).locator('.list-file-name')).toHaveText([SERVICE, HTML, HEROES]);
  await expect(sidebar(page).locator('.list-link')).toHaveText(CHANGED.map((s) => s.label));
  const items = sidebar(page).locator('.list-item');
  for (const [i, symbol] of CHANGED.entries()) {
    await expect(items.nth(i)).toHaveClass(new RegExp(`\\btone-${symbol.tone}\\b`));
  }
});

test('the canvas draws each symbol in its file box, in its status colour', async ({ page }) => {
  const canvas = await rect(page.locator('.react-flow'));
  await test.info().attach('overview', { body: await page.screenshot(), contentType: 'image/png' });

  // A box per changed file, marked changed; the files around them as context.
  for (const file of [SERVICE, HTML, HEROES]) {
    await expect(box(page, file).locator('.file-box')).toHaveClass(/\bchanged\b/);
  }
  for (const file of ['src/app/hero-detail.component.ts', 'src/app/app.module.ts']) {
    await expect(box(page, file)).toBeAttached();
    await expect(box(page, file).locator('.file-box')).not.toHaveClass(/\bchanged\b/);
  }

  // The legend's colours are distinct, and each symbol is drawn in its status's.
  const colours = {
    added: await swatch(page, 'added'),
    removed: await swatch(page, 'removed'),
    modified: await swatch(page, 'modified'),
  };
  expect(new Set(Object.values(colours)).size).toBe(3);

  for (const symbol of CHANGED) {
    const drawn = node(page, symbol.id);
    await expect(drawn.locator('.symbol')).toHaveClass(new RegExp(`\\btone-${symbol.tone}\\b`));
    expect(await colourOf(drawn), symbol.label).toBe(colours[symbol.tone]);

    // Inside its file's box, and on screen: the first view fits the whole change.
    const r = await rect(drawn);
    const outer = await rect(box(page, fileOf(symbol.id)));
    expect(r.x, `${symbol.label} in its box`).toBeGreaterThanOrEqual(outer.x - 1);
    expect(r.y, `${symbol.label} in its box`).toBeGreaterThanOrEqual(outer.y - 1);
    expect(r.x + r.width, `${symbol.label} in its box`).toBeLessThanOrEqual(
      outer.x + outer.width + 1,
    );
    expect(r.y + r.height, `${symbol.label} in its box`).toBeLessThanOrEqual(
      outer.y + outer.height + 1,
    );
    expect(r.x, `${symbol.label} on screen`).toBeGreaterThanOrEqual(canvas.x);
    expect(r.y, `${symbol.label} on screen`).toBeGreaterThanOrEqual(canvas.y);
    expect(r.x + r.width, `${symbol.label} on screen`).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(r.y + r.height, `${symbol.label} on screen`).toBeLessThanOrEqual(
      canvas.y + canvas.height,
    );
  }

  // No symbol covers another.
  const all = page.locator('.react-flow__node-symbol');
  const rects = await Promise.all((await all.all()).map(rect));
  for (const [i, a] of rects.entries()) {
    for (const b of rects.slice(i + 1)) {
      const overlap =
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
      expect(overlap, 'symbols overlap').toBe(false);
    }
  }
});

test('zoomed in, each symbol reads as what changed in it', async ({ page }) => {
  for (const symbol of CHANGED) {
    await open(page, symbol.label);
    const drawn = node(page, symbol.id);
    // Close enough to read: not the map.
    await expect(page.locator('.react-flow.map')).toHaveCount(0);
    await expect(drawn.locator('.symbol')).toHaveClass(/\bselected\b/);
    await expect(drawn.locator('.symbol-kind')).toHaveText(symbol.kind);
    await expect(drawn.locator('.symbol-name')).toHaveText(symbol.label);
    await expect(drawn.locator('.symbol-name')).toBeVisible();
    await expect(drawn.locator('.symbol-file')).toContainText(symbol.signature);
    await expect(drawn.locator('.symbol-file .tag')).toHaveText(symbol.delta);
    await expect(drawn.locator('.badge')).toHaveText(symbol.finding ? ['1'] : []);
    if (symbol.finding) {
      await expect(drawn.locator('.badge')).toHaveClass(new RegExp(`badge-${symbol.finding}`));
    }
    const decoration = await drawn
      .locator('.symbol-name')
      .evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(decoration, `${symbol.label} struck through`).toBe(
      symbol.tone === 'removed' ? 'line-through' : 'none',
    );

    const detail = panel(page);
    await expect(detail.locator('.panel-kind')).toHaveText(
      `${symbol.kind} · ${symbol.tone}${symbol.delta.join('')}`,
    );
    await expect(detail.locator('.panel-kind .status')).toHaveClass(
      new RegExp(`\\btone-${symbol.tone}\\b`),
    );
    await expect(detail.locator('.panel-file')).toHaveText(fileOf(symbol.id));
  }
  await test
    .info()
    .attach('zoomed-in', { body: await page.screenshot(), contentType: 'image/png' });
});

test('a changed signature reads old against new, with the line diff', async ({ page }) => {
  await open(page, 'HeroService.getHeroes');
  const detail = panel(page);
  await expect(detail.locator('.sig-del')).toHaveText('getHeroes(): Hero[]');
  await expect(detail.locator('.sig-add')).toHaveText('getHeroes(limit: number): Hero[]');
  await expect(detail.locator('.row-del .text')).toHaveText([
    '  getHeroes(): Hero[] {',
    '    return this.heroes;',
  ]);
  await expect(detail.locator('.row-add .text')).toHaveText([
    '  getHeroes(limit: number): Hero[] {',
    '    return this.heroes.slice(0, limit);',
  ]);
  const usedBy = detail.locator('section', { has: page.getByRole('heading', { name: /Used by/ }) });
  await expect(usedBy.locator('li')).toHaveText(['HeroesComponent.ngOnInit call']);
});

test('an Angular 11 template opens with its own diff and what it uses', async ({ page }) => {
  await open(page, 'heroes.component.html');
  const detail = panel(page);
  await expect(detail.locator('.panel-kind .status')).toHaveText('modified');
  await expect(detail.locator('.panel-kind .tag')).toHaveText(['body']);
  await expect(detail.locator('.sig')).toHaveText('template of HeroesComponent');

  // Lines added and removed, in the file's own numbering; `@` in text is text in Angular 11.
  const row = (type: string, text: string) => detail.locator(`.row-${type}`, { hasText: text });
  await expect(detail.locator('.row-add .text')).toHaveText([
    '<input #heroName placeholder="New hero" />',
    '<button (click)="add(heroName.value)">Add</button>',
    '<p>Questions? Mail team@heroes.example</p>',
  ]);
  await expect(detail.locator('.row-del .text')).toHaveText([
    '<p>Questions? Mail heroes@example.com</p>',
  ]);
  await expect(row('add', 'add(heroName.value)').locator('.ln')).toHaveText(['', '3']);
  await expect(row('del', 'heroes@example.com').locator('.ln')).toHaveText(['8', '']);
  // Unchanged: the `*ngFor` row still calls onSelect.
  await expect(row('same', '(click)="onSelect(hero)"').locator('.ln')).toHaveText(['3', '5']);

  // The error on the method it still calls is mentioned here too.
  await expect(detail.locator('.finding')).toContainText(
    'HeroesComponent.onSelect was removed but is still used by 1 symbol: heroes.component.html',
  );

  // What the template places, binds and calls: onSelect is gone, so its call no longer resolves.
  const uses = detail.locator('section', { has: page.getByRole('heading', { name: /^Uses/ }) });
  await expect(uses.locator('li')).toHaveText([
    'HeroDetailComponent call',
    'HeroDetailComponent.hero reference',
    'HeroesComponent.add call · new',
    'HeroesComponent.heroes reference',
    'HeroesComponent.onSelect call · removed',
    'HeroesComponent.selectedHero reference',
    'this.onSelect call · new',
  ]);
  await test.info().attach('template', { body: await page.screenshot(), contentType: 'image/png' });
});
