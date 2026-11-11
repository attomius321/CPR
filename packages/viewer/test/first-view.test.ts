import { readFileSync } from 'node:fs';
import type { Finding, Project } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  FIRST_VIEW_KEY,
  firstViewOf,
  riskiest,
  viewAfterF,
  symbolOpened,
} from '../src/diff/first-view.js';
import { foldFindings } from '../src/diff/review.js';

/** A finding of `severity` on `symbol`. */
const finding = (
  id: string,
  symbol: string,
  severity: Finding['severity'],
  rule: Finding['rule'] = 'orphan-added',
): Finding => ({ id, rule, severity, symbol, related: [], message: id, data: {} });

/** The graph's symbols, as `riskiest` reads them: their IDs. */
const nodes = (...ids: string[]) => ids.map((id) => ({ id }));

describe('riskiest (V109, decision 986)', () => {
  // As `callers`: legacy removed and still used, triple added and unused, add changed compatibly.
  const callers = [
    finding('f1', 'src/math.ts#add', 'info', 'signature-changed'),
    finding('f2', 'src/math.ts#triple', 'warning'),
    finding('f3', 'src/math.ts#legacy', 'error', 'removed-still-referenced'),
  ];
  const drawn = nodes('src/math.ts#add', 'src/math.ts#triple', 'src/math.ts#legacy');

  it('is the first error, before any warning', () => {
    expect(riskiest(callers, drawn)).toBe('src/math.ts#legacy');
  });

  it('is the first warning when there is no error, in the order listed', () => {
    const warnings = [
      finding('f1', 'src/a.ts#a', 'info'),
      finding('f2', 'src/b.ts#b', 'warning'),
      finding('f3', 'src/c.ts#c', 'warning'),
    ];
    expect(riskiest(warnings, nodes('src/a.ts#a', 'src/b.ts#b', 'src/c.ts#c'))).toBe('src/b.ts#b');
  });

  it('is none for a change with only infos, or no finding', () => {
    expect(riskiest([finding('f1', 'src/a.ts#a', 'info')], nodes('src/a.ts#a'))).toBeNull();
    expect(riskiest([], drawn)).toBeNull();
  });

  it('skips a finding whose symbol the graph does not hold', () => {
    expect(riskiest(callers, nodes('src/math.ts#triple'))).toBe('src/math.ts#triple');
    expect(riskiest(callers, nodes('src/math.ts#add'))).toBeNull();
  });

  /** A walked change's findings and projects (`test/fixtures/findings/`: the spike's five, V100). */
  const walked = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`./fixtures/findings/${name}.json`, import.meta.url), 'utf8'),
    ) as { projects: Project[]; findings: Finding[] };

  // The spike's walked changes, as the Findings tab lists them (`foldFindings`): the feature's merge
  // opens on `Route`, the refactor's on `version`; the small fix, infos only, as before.
  it.each([
    ['issues', 'packages/viewer/src/shell/pages.ts#Route'],
    ['refactor', 'packages/cli/src/command-context.ts#version'],
    ['flakes', null],
  ])('%s opens on %s', (name, symbol) => {
    const { findings, projects } = walked(name);
    const { shown } = foldFindings(findings, projects);
    expect(riskiest(shown, nodes(...findings.map((f) => f.symbol)))).toBe(symbol);
  });
});

describe('the kept choice (V109)', () => {
  it('is the riskiest finding unless the whole change was chosen', () => {
    expect(firstViewOf(null)).toBe('risk');
    expect(firstViewOf('risk')).toBe('risk');
    expect(firstViewOf('whole')).toBe('whole');
    expect(firstViewOf('anything else')).toBe('risk');
  });

  it('F shows the whole change from any pick, and the riskiest finding from the whole', () => {
    expect(viewAfterF('src/math.ts#legacy')).toBe('whole');
    expect(viewAfterF('src/app.ts#old')).toBe('whole');
    expect(viewAfterF(null)).toBe('risk');
  });

  it('is kept under its own key', () => {
    expect(FIRST_VIEW_KEY).toBe('symbiote.viewer.first-view');
  });
});

describe('symbolOpened (V109)', () => {
  it('is the riskiest symbol when the person keeps that view and nothing is picked', () => {
    expect(symbolOpened('risk', 'src/math.ts#legacy', null)).toBe('src/math.ts#legacy');
  });

  it('is nothing when the whole change is chosen, a pick was carried, or there is no risk', () => {
    expect(symbolOpened('whole', 'src/math.ts#legacy', null)).toBeNull();
    // A line clicked on Files, then g (V104): the person's pick, not the risk.
    expect(symbolOpened('risk', 'src/math.ts#legacy', 'src/math.ts#triple')).toBeNull();
    expect(symbolOpened('risk', null, null)).toBeNull();
  });
});
