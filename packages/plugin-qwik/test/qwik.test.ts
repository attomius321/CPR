import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeDirectories,
  createTypescriptAdapter,
  type Analysis,
  type TsPlugin,
} from '@cpr/core';
import angular from '../../plugin-angular/src/index.js';
import qwik from '../src/index.js';

const fixture = (name: string, side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/${name}/${side}`, import.meta.url));
const analyzeAt = (base: string, head: string, plugins: TsPlugin[] = [qwik]) =>
  analyzeDirectories(base, head, { adapter: createTypescriptAdapter({ plugins }) });
const analyze = (name: string, plugins: TsPlugin[] = [qwik]) =>
  analyzeAt(fixture(name, 'base'), fixture(name, 'head'), plugins);

const rules = (analysis: Analysis) =>
  analysis.findings.map((f) => `${f.severity} ${f.rule} ${f.symbol}`);
const finding = (analysis: Analysis, symbol: string) =>
  analysis.findings.find((f) => f.symbol === symbol);
const signature = (analysis: Analysis, id: string) =>
  analysis.changes.find((c) => c.id === id)?.head?.signature;

/** The fixture without its `node_modules`: Qwik's typings not installed. */
function withoutTypings<T>(name: string, run: (base: string, head: string) => Promise<T>) {
  const dir = mkdtempSync(join(tmpdir(), 'cpr-qwik-'));
  for (const side of ['base', 'head'] as const) {
    cpSync(fixture(name, side), join(dir, side), {
      recursive: true,
      filter: (path) => !path.includes('node_modules'),
    });
  }
  return run(join(dir, 'base'), join(dir, 'head')).finally(() =>
    rmSync(dir, { recursive: true, force: true }),
  );
}

const V1 = {
  badge: 'src/components/badge.tsx#Badge',
  card: 'src/components/card.tsx#Card',
  cardProps: 'src/components/card.tsx#CardProps',
  pill: 'src/components/pill.tsx#Pill',
  tag: 'src/components/tag.tsx#default',
};

/** What stays with the plugin on: real orphans, and components whose users must change. */
const V1_FINDINGS = [
  `warning orphan-added src/components/widget/index.tsx#onGet`,
  `warning orphan-added src/loaders/cart.ts#cartTotal`,
  `warning orphan-added src/routes/about/index.tsx#formatTitle`,
  `warning orphan-added src/routes/plugin@auth.ts#secret`,
  `warning signature-changed ${V1.badge}`,
  `warning signature-changed ${V1.card}`,
  `warning signature-changed ${V1.tag}`,
  `info signature-changed ${V1.cardProps}`,
  `info signature-changed ${V1.pill}`,
];

describe('the qwik plugin, routes (Qwik 1)', () => {
  it('without it, what the router calls looks unused', async () => {
    const without = await analyze('qwik-v1', []);
    expect(rules(without)).toContain('warning orphan-added src/routes/about/index.tsx#useAbout');
    expect(rules(without)).toContain('info orphan-added src/routes/about/index.tsx#default');
    expect(rules(without).filter((r) => r.includes('orphan-added'))).toHaveLength(20);
  });

  it('knows what the router calls by name, loaders, actions and entries', async () => {
    const analysis = await analyze('qwik-v1');
    expect(rules(analysis)).toEqual(V1_FINDINGS);
    expect(analysis.warnings).toEqual([]);
  });

  it('keeps orphans the router does not read', async () => {
    const analysis = await analyze('qwik-v1');
    // A helper in a route module, a non-handler in a server plugin, a non-loader re-exported by
    // a route (`export *`), and a route-like export outside the routes folder.
    expect(finding(analysis, 'src/routes/about/index.tsx#formatTitle')?.message).toBe(
      'formatTitle is new and nothing references it',
    );
    expect(finding(analysis, 'src/components/widget/index.tsx#onGet')?.severity).toBe('warning');
  });

  it('knows loaders and actions by their callee when Qwik is not installed', async () => {
    const analysis = await withoutTypings('qwik-v1', (base, head) => analyzeAt(base, head));
    // A wrapper's action is only known by its type.
    expect(rules(analysis)).toEqual([
      `warning orphan-added src/components/widget/index.tsx#onGet`,
      `warning orphan-added src/loaders/cart.ts#cartTotal`,
      `warning orphan-added src/routes/about/index.tsx#formatTitle`,
      `warning orphan-added src/routes/login/index.tsx#useLogin`,
      `warning orphan-added src/routes/plugin@auth.ts#secret`,
      `warning signature-changed ${V1.badge}`,
      `warning signature-changed ${V1.card}`,
      `warning signature-changed ${V1.tag}`,
      `info signature-changed ${V1.cardProps}`,
      `info signature-changed ${V1.pill}`,
    ]);
  });
});

describe('the qwik plugin, components', () => {
  it('compares props from the caller’s side', async () => {
    const analysis = await analyze('qwik-v1');
    // A required prop added, one removed: users that do not change break.
    expect(finding(analysis, V1.badge)?.message).toBe(
      'Badge changed its props; 1 of 1 user not updated passes a changed prop or misses a new required one: default',
    );
    expect(finding(analysis, V1.tag)?.data).toMatchObject({ compatibility: 'breaking' });
    // An optional prop added: every user keeps working.
    expect(finding(analysis, V1.pill)?.message).toBe(
      'Pill changed its signature compatibly; existing users keep working (1 user, 1 untouched)',
    );
  });

  it('follows a named props type into the component', async () => {
    const analysis = await analyze('qwik-v1');
    // `CardProps` gained a required member: `Card`'s own code did not change, its contract did.
    expect(analysis.changes.find((c) => c.id === V1.card)).toMatchObject({
      status: 'modified',
      delta: { signature: true, body: false },
    });
    expect(finding(analysis, V1.card)?.message).toBe(
      'Card changed its props; 1 of 1 user not updated passes a changed prop or misses a new required one: default',
    );
  });

  it('shows a component’s props as its signature', async () => {
    const analysis = await analyze('qwik-v1');
    expect(signature(analysis, V1.badge)).toBe(
      'const Badge = component$<{ label: string; tone: string }>',
    );
    expect(signature(analysis, V1.card)).toBe(
      'const Card = component$<{ subtitle: string; title: string }>',
    );
    expect(signature(analysis, V1.pill)).toBe(
      'const Pill = component$<{ size?: number; text: string }>',
    );
    expect(signature(analysis, V1.tag)).toBe('default = component$<{ name: string }>');
  });

  it('reads props from their types when Qwik is not installed', async () => {
    const analysis = await withoutTypings('qwik-v1', (base, head) => analyzeAt(base, head));
    expect(signature(analysis, V1.card)).toBe(
      'const Card = component$<{ subtitle: string; title: string }>',
    );
    expect(finding(analysis, V1.pill)?.data).toMatchObject({ compatibility: 'compatible' });
  });
});

describe('the qwik plugin, Qwik 2 in a subfolder', () => {
  const SITE = 'apps/site/src';

  it('uses the routes folder from vite.config.ts and Qwik 2’s rules', async () => {
    const analysis = await analyze('qwik-v2');
    expect(rules(analysis)).toEqual([
      `warning orphan-added ${SITE}/app/index.tsx#helper`,
      // src/routes is not the routes folder here.
      `warning orphan-added ${SITE}/routes/index.tsx#onGet`,
      // Qwik 2 has no `500` page: a default export nothing imports, as without the plugin.
      `info orphan-added ${SITE}/app/500.tsx#default`,
      `info orphan-added ${SITE}/routes/index.tsx#default`,
      `info signature-changed ${SITE}/components/button.tsx#Button`,
    ]);
    expect(analysis.warnings).toEqual([]);
  });

  it('follows a renamed component$ import', async () => {
    const analysis = await analyze('qwik-v2');
    expect(signature(analysis, `${SITE}/components/button.tsx#Button`)).toBe(
      `const Button = c$<{ kind?: 'primary' | 'plain'; label: string }>`,
    );
  });
});

describe('the qwik plugin elsewhere', () => {
  const at = (path: string, side: 'base' | 'head') =>
    fileURLToPath(new URL(`../../${path}/${side}`, import.meta.url));
  const same = async (path: string, plugins: TsPlugin[], withQwik: TsPlugin[]) => {
    const strip = (analysis: Analysis) => ({ ...analysis, timings: {} });
    const [before, after] = await Promise.all([
      analyzeAt(at(path, 'base'), at(path, 'head'), plugins),
      analyzeAt(at(path, 'base'), at(path, 'head'), withQwik),
    ]);
    expect(strip(after)).toEqual(strip(before));
  };

  it.each(['callers', 'detectors', 'multi-project', 'public-api', 'service'])(
    'changes nothing in a project without Qwik (core fixture %s)',
    (name) => same(`core/test/fixtures/diff/${name}`, [], [qwik]),
  );

  it.each(['templates', 'libraries', 'multi-project'])(
    'changes nothing next to the Angular plugin (Angular fixture %s)',
    (name) => same(`plugin-angular/test/fixtures/${name}`, [angular], [angular, qwik]),
  );
});
