import { readFileSync } from 'node:fs';
import type { Graph } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  diffRows,
  excerpt,
  hangOf,
  neighbourGroups,
  signatureDiff,
  symbolDetail,
} from '../src/diff/detail.js';

const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
    'utf8',
  ),
) as Graph;

describe('neighbourGroups (V90, decision 841)', () => {
  const groups = (id: string) =>
    neighbourGroups(symbolDetail(graph, id)!).map(
      (g) => `${g.title}: ${g.items.map((i) => i.id.slice(i.id.indexOf('#') + 1)).join(', ')}`,
    );

  it('says who still uses a removed symbol, by its finding, apart from who used it before', () => {
    expect(groups('src/math.ts#legacy')).toEqual(['Still used by: old', 'No longer uses: add']);
  });

  it("splits a symbol's users and uses by side: before the change only, or still", () => {
    expect(groups('src/math.ts#add')).toEqual(['Used by: total, triple', 'Used before by: legacy']);
    expect(groups('src/math.ts#triple')).toEqual(['Uses: add']);
  });
});

describe('symbolDetail', () => {
  it('lists users, callees and findings', () => {
    const add = symbolDetail(graph, 'src/math.ts#add');
    expect(add?.users.map((u) => `${u.id} ${u.side}`)).toEqual([
      'src/app.ts#total both',
      'src/math.ts#legacy base',
      'src/math.ts#triple head',
    ]);
    expect(add?.callees).toEqual([]);
    expect(add?.findings.map((f) => f.rule)).toEqual(['signature-changed']);
  });

  it('shows findings that mention a symbol', () => {
    const old = symbolDetail(graph, 'src/app.ts#old');
    expect(old?.mentions.map((f) => `${f.rule} ${f.symbol}`)).toEqual([
      'removed-still-referenced src/math.ts#legacy',
    ]);
  });

  it('is undefined for unknown IDs', () => {
    expect(symbolDetail(graph, 'nope')).toBeUndefined();
  });
});

describe('excerpt', () => {
  it('removes common indentation', () => {
    const source = 'class A {\n\tf() {\n\t\treturn 1;\n\t}\n}\n';
    expect(excerpt(source, { start: { line: 2, col: 2 }, end: { line: 4, col: 3 } }).text).toBe(
      'f() {\n\treturn 1;\n}',
    );
  });

  it('cuts the lines a range covers', () => {
    const source = 'a\nb\nc\nd\n';
    expect(excerpt(source, { start: { line: 2, col: 1 }, end: { line: 3, col: 2 } })).toEqual({
      firstLine: 2,
      text: 'b\nc',
    });
  });
});

describe('diffRows', () => {
  it('numbers lines on both sides', () => {
    const rows = diffRows(
      { firstLine: 10, text: 'function f(a) {\n  return a;\n}' },
      { firstLine: 12, text: 'function f(a, b = 0) {\n  return a;\n}' },
    );
    expect(rows).toEqual([
      { type: 'del', text: 'function f(a) {', base: 10 },
      { type: 'add', text: 'function f(a, b = 0) {', head: 12 },
      { type: 'same', text: '  return a;', base: 11, head: 13 },
      { type: 'same', text: '}', base: 12, head: 14 },
    ]);
  });

  it('shows added and removed symbols as one side', () => {
    expect(diffRows(undefined, { firstLine: 1, text: 'x\ny' }).map((r) => r.type)).toEqual([
      'add',
      'add',
    ]);
    expect(diffRows({ firstLine: 5, text: 'x' }, undefined)).toEqual([
      { type: 'del', text: 'x', base: 5 },
    ]);
  });
});

describe('signatureDiff (V103, decision 976)', () => {
  const runs = (before: string, after: string) =>
    signatureDiff(before, after)?.map(
      (run) => `${{ same: '=', del: '-', add: '+' }[run.type]}${run.text}`,
    );

  it("strikes the parameter Bitwarden's constructor removed", () => {
    const kept = [
      'private cipherService: CipherService',
      'private i18nService: I18nService',
      'private organizationService: OrganizationService',
      'private collectionService: CollectionService',
      'private formBuilder: FormBuilder',
      'private toastService: ToastService',
      'private accountService: AccountService',
    ].join(', ');
    expect(
      runs(`constructor(${kept}, private configService: ConfigService)`, `constructor(${kept})`),
    ).toEqual([`=constructor(${kept}`, '-, private configService: ConfigService', '=)']);
  });

  it('marks an added parameter', () => {
    expect(runs('getHeroes(): Hero[]', 'getHeroes(limit: number): Hero[]')).toEqual([
      '=getHeroes(',
      '+limit: number',
      '=): Hero[]',
    ]);
  });

  it('strikes a renamed type and marks its new name, the rest kept', () => {
    expect(
      runs('load(id: UserId, opts: Options): User', 'load(id: AccountId, opts: Options): User'),
    ).toEqual(['=load(id: ', '-UserId', '+AccountId', '=, opts: Options): User']);
  });

  it('keeps an identical signature as one run', () => {
    expect(runs('area(shape: Shape): number', 'area(shape: Shape): number')).toEqual([
      '=area(shape: Shape): number',
    ]);
  });

  it('merges changes split only by spaces or punctuation into one removed and one added run', () => {
    expect(
      runs(
        'draw(x: number, y: number, color: string): void',
        'draw(point: Point, color: string): void',
      ),
    ).toEqual(['=draw(', '-x: number, y: number', '+point: Point', '=, color: string): void']);
  });

  it('gives up when more than half differs: the two signatures are shown whole', () => {
    expect(signatureDiff('const LIMIT: number', 'function limit(n: number): string')).toBeNull();
  });
});

describe('hangOf (V103, decision 975)', () => {
  it("is a line's own indent, a tab two columns as the panel draws it", () => {
    expect(hangOf('return a;')).toBe(0);
    expect(hangOf('    const header = `${title}`;')).toBe(4);
    expect(hangOf('\t\treturn a;')).toBe(4);
    expect(hangOf('   ')).toBe(0);
  });

  it('stops at 8 columns, so a deep line still has room to wrap', () => {
    expect(hangOf(`${' '.repeat(20)}deep();`)).toBe(8);
  });
});
