import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Grafana dashboard that reads this package's lines (LG1, LG2): checked here without Docker.
// `pnpm logs:check` runs its queries through Grafana.

interface Target {
  expr: string;
  datasource?: { uid?: string };
}
interface Override {
  matcher: { id: string; options: unknown };
  properties: { id: string; value: unknown }[];
}
interface Panel {
  id: number;
  type: string;
  title: string;
  collapsed?: boolean;
  gridPos: { x: number; y: number; w: number; h: number };
  datasource?: { uid?: string };
  targets?: Target[];
  panels?: Panel[];
  fieldConfig?: {
    defaults?: {
      thresholds?: { steps: { color: string; value: number | null }[] };
      mappings?: { type: string; options: Record<string, { color?: string }> }[];
    };
    overrides?: Override[];
  };
}
interface Dashboard {
  uid: string;
  panels: Panel[];
  templating: { list: { name: string }[] };
}

const dashboard = JSON.parse(
  readFileSync(
    new URL('../../../ops/logs/grafana/dashboards/symbiote.json', import.meta.url),
    'utf8',
  ),
) as Dashboard;

/** Every panel, those in a collapsed row included. */
const allPanels = dashboard.panels.flatMap((panel) => [panel, ...(panel.panels ?? [])]);
const rows = dashboard.panels.filter((panel) => panel.type === 'row');
const queried = allPanels.filter((panel) => panel.targets);
const logsPanels = allPanels.filter((panel) => panel.type === 'logs');

/** The colour each level has in Grafana 13's logs panel: the charts and tiles use the same. */
const LEVEL_COLOURS: Record<string, string> = { fatal: 'purple', error: 'red', warn: 'orange' };

function overlaps(panels: Panel[]): string[] {
  const found: string[] = [];
  panels.forEach((a, i) => {
    for (const b of panels.slice(i + 1)) {
      const p = a.gridPos;
      const q = b.gridPos;
      if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h)
        found.push(`${a.title} / ${b.title}`);
    }
  });
  return found;
}

describe("Symbiote's dashboard", () => {
  it('keeps its uid, and every panel its own id', () => {
    expect(dashboard.uid).toBe('symbiote');
    const ids = allPanels.map((panel) => panel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is in sections, in the order they are asked; the server folded', () => {
    expect(rows.map((row) => row.title)).toEqual([
      'At a glance',
      'Problems',
      'Activity',
      'Server',
      'Lines',
    ]);
    expect(rows.map((row) => row.collapsed ?? false)).toEqual([false, false, false, true, false]);
  });

  it('lays every panel inside 24 columns, none over another', () => {
    for (const panel of allPanels) {
      expect(panel.gridPos.x + panel.gridPos.w, panel.title).toBeLessThanOrEqual(24);
    }
    // Shown at once: the top level; a folded row's panels when it is opened, below it.
    expect(overlaps(dashboard.panels)).toEqual([]);
    for (const row of rows) {
      expect(overlaps(row.panels ?? [])).toEqual([]);
      for (const panel of row.panels ?? []) expect(panel.gridPos.y).toBeGreaterThan(row.gridPos.y);
    }
  });

  it('reads Loki only, through variables it defines', () => {
    const variables = new Set(dashboard.templating.list.map((variable) => variable.name));
    for (const panel of queried) {
      expect(panel.datasource?.uid, panel.title).toBe('symbiote-loki');
      for (const target of panel.targets ?? []) {
        expect(target.datasource?.uid, panel.title).toBe('symbiote-loki');
        for (const [, name] of target.expr.matchAll(/\$\{?(\w+)/g)) {
          // `$__range` is Grafana's; `$1` a regular expression's group in a row's template.
          if (!name?.startsWith('__') && !/^\d+$/.test(name ?? ''))
            expect(variables, `${panel.title}: $${name}`).toContain(name);
        }
      }
    }
  });

  it('gives a level one colour in every panel', () => {
    const pairs: [string, string, unknown][] = [];
    for (const panel of allPanels) {
      for (const override of panel.fieldConfig?.overrides ?? []) {
        const name = override.matcher.options;
        if (typeof name !== 'string' || !(name in LEVEL_COLOURS)) continue;
        const colour = override.properties.find((property) => property.id === 'color')?.value;
        pairs.push([panel.title, name, (colour as { fixedColor?: string })?.fixedColor]);
      }
      for (const mapping of panel.fieldConfig?.defaults?.mappings ?? []) {
        for (const [name, result] of Object.entries(mapping.options)) {
          if (name in LEVEL_COLOURS) pairs.push([panel.title, name, result.color]);
        }
      }
    }
    expect(pairs.map(([, name]) => name)).toEqual(
      expect.arrayContaining(Object.keys(LEVEL_COLOURS)),
    );
    for (const [title, name, colour] of pairs)
      expect(colour, `${title}: ${name}`).toBe(LEVEL_COLOURS[name]);
  });

  it("shows a count of 0 in the text's colour; crashes, errors and warnings in their level's above", () => {
    const tiles = allPanels.filter((panel) => panel.type === 'stat');
    expect(tiles.map((tile) => tile.title)).toEqual(
      expect.arrayContaining(['Crashes', 'Errors', 'Warnings']),
    );
    const levelOf: Record<string, string> = { Crashes: 'fatal', Errors: 'error', Warnings: 'warn' };
    for (const tile of tiles) {
      const steps = tile.fieldConfig?.defaults?.thresholds?.steps ?? [];
      expect(steps[0]?.color, tile.title).toBe('text');
      const level = levelOf[tile.title];
      if (level)
        expect(steps.at(-1), tile.title).toEqual({ color: LEVEL_COLOURS[level], value: 1 });
      else expect(steps, tile.title).toHaveLength(1);
    }
  });

  it('writes every row of every line list with one template', () => {
    expect(logsPanels.length).toBeGreaterThanOrEqual(4);
    const templates = logsPanels.map(
      (panel) => /\| line_format (".*")$/.exec(panel.targets?.[0]?.expr ?? '')?.[1],
    );
    expect(templates[0]).toBeDefined();
    for (const [i, template] of templates.entries())
      expect(template, logsPanels[i]?.title).toBe(templates[0]);
  });

  it('lists requests in the server section only', () => {
    const server = rows.find((row) => row.title === 'Server');
    const requests = server?.panels?.find((panel) => panel.type === 'logs');
    expect(requests?.targets?.[0]?.expr).toContain('msg=~"request|request failed"');
    const every = allPanels.find((panel) => panel.title === 'Every line but requests');
    expect(every?.targets?.[0]?.expr).toContain('msg!="request"');
  });
});
