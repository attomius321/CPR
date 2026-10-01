import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { directorySource, typescriptAdapter } from '../src/index.js';
import { extractSources, pair } from './helpers/extract.js';

const fixture = (name: string) =>
  directorySource(fileURLToPath(new URL(`./fixtures/extract/${name}`, import.meta.url)));

describe('typescriptAdapter.extract', () => {
  it('extracts declarations with stable IDs', async () => {
    const revision = await typescriptAdapter.load(fixture('basics'));
    const symbols = typescriptAdapter.extract(revision, ['src/user.ts']);
    const lines = symbols.map(
      (s) =>
        `${s.kind.padEnd(11)} ${s.exported ? 'export' : '      '} ${s.id} ` +
        `@${s.range.start.line}:${s.range.start.col}-${s.range.end.line}:${s.range.end.col}` +
        `${s.hashes.body ? '' : ' (no body)'}\n    ${s.signature}`,
    );
    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot('./__snapshots__/extract-basics.txt');
  });

  it('skips missing, declaration and non-source files', async () => {
    const revision = await typescriptAdapter.load(fixture('basics'));
    expect(
      typescriptAdapter.extract(revision, ['src/missing.ts', 'src/types.d.ts', 'README.md']),
    ).toEqual([]);
  });

  it('loads TS 4-style configs without deprecation errors', async () => {
    const revision = await typescriptAdapter.load(fixture('legacy-config'));
    const messages = revision.project
      .getPreEmitDiagnostics()
      .map((d) => d.getMessageText())
      .map((m) => (typeof m === 'string' ? m : m.getMessageText()));
    expect(messages).toEqual([]);
    const ids = typescriptAdapter.extract(revision, ['src/app.ts']).map((s) => s.signature);
    // The path alias resolves, so the inferred type is known.
    expect(ids).toEqual(['run(): string']);
  });

  it('follows tsconfig references', async () => {
    const source = fixture('solution');
    const revision = await typescriptAdapter.load(source);
    expect(revision.project.getSourceFile(`${source.root}/packages/a/src/index.ts`)).toBeDefined();
  });

  it('loads plain JS repos without a tsconfig', async () => {
    const revision = await typescriptAdapter.load(fixture('plain-js'));
    const symbols = typescriptAdapter.extract(revision, ['lib/math.js']);
    expect(symbols.map((s) => `${s.kind} ${s.id}`)).toEqual([
      'function lib/math.js#add',
      'class lib/math.js#Counter',
      'property lib/math.js#Counter.count',
      'method lib/math.js#Counter.increment',
    ]);
  });

  it('extracts TS and JS files outside the tsconfig', async () => {
    // Regression: a JS file in a project without allowJs crashed the checker.
    const files = ['packages/x/src/a.ts', 'packages/x/src/b.js'];
    const revision = await typescriptAdapter.load(fixture('esm-outside-config'), { files });
    const symbols = typescriptAdapter.extract(revision, files);
    expect(symbols.map((s) => s.signature)).toEqual(['f(n: number): number', 'g(n): number']);
  });

  it('rejects a missing --project file', async () => {
    await expect(
      typescriptAdapter.load(fixture('basics'), { project: 'nope.json' }),
    ).rejects.toThrow('project file not found: nope.json');
  });

  it('prints inferred types without checkout paths', async () => {
    const symbols = await extractSources({
      'src/user.ts': 'export class User { id = 1 }\n',
      'src/make.ts':
        "import { User } from './user';\nexport function make() {\n  return [new User()];\n}\n",
      'src/use.ts': "import { make } from './make';\nexport const first = () => make()[0];\n",
    });
    const first = symbols.get('src/use.ts#first');
    expect(first?.signature).toBe('first(): User');
    expect(first?.signature).not.toContain('/');
  });
});

describe('change hashes', () => {
  it('ignore formatting, comments, quotes, trailing commas and semicolons', async () => {
    const result = await pair(
      'greet',
      `export function greet(name: string, greeting = 'hi') {\n  return [greeting, name].join(' ');\n}\n`,
      `/** Greets. */\nexport function greet(\n  name: string,\n  greeting = "hi", // default\n) {\n  return [greeting, name,].join(" ")\n}\n`,
    );
    expect(result).toMatchObject({ signatureChanged: false, bodyChanged: false });
  });

  it('ignore parentheses around a single arrow parameter', async () => {
    const result = await pair(
      'f',
      'export const f = (x: number) => x;',
      'export const f = x => x as number;',
    );
    expect(result.signatureChanged).toBe(true); // the parameter lost its type
    const same = await pair(
      'g',
      'export const g = (x) => x;',
      'export const g = x => x;',
      'src/a.js',
    );
    expect(same).toMatchObject({ signatureChanged: false, bodyChanged: false });
  });

  it('separate body changes from signature changes', async () => {
    const body = await pair(
      'add',
      'export function add(a: number, b: number): number { return a + b; }',
      'export function add(a: number, b: number): number { return b + a; }',
    );
    expect(body).toMatchObject({ signatureChanged: false, bodyChanged: true });

    const signature = await pair(
      'add',
      'export function add(a: number, b: number): number { return a + b; }',
      'export function add(a: number, b?: number): number { return a + (b ?? 0); }',
    );
    expect(signature).toMatchObject({ signatureChanged: true, bodyChanged: true });
  });

  it('count an inferred return type change as a signature change', async () => {
    const inferred = await pair(
      'load',
      'export function load() { return 1; }',
      'export function load() { return "1"; }',
    );
    expect(inferred).toMatchObject({ signatureChanged: true, bodyChanged: true });
    expect(inferred.after.signature).toBe('load(): string');

    const annotated = await pair(
      'load',
      'export function load(): unknown { return 1; }',
      'export function load(): unknown { return "1"; }',
    );
    expect(annotated).toMatchObject({ signatureChanged: false, bodyChanged: true });
  });

  it('treat a new constant value as a body change, not a new type', async () => {
    const result = await pair('LIMIT', 'export const LIMIT = 10;', 'export const LIMIT = 20;');
    expect(result).toMatchObject({ signatureChanged: false, bodyChanged: true });
    expect(result.after.signature).toBe('const LIMIT: number');
  });

  it('count exporting and un-exporting as a signature change', async () => {
    const result = await pair('f', 'export function f() {}', 'function f() {}');
    expect(result).toMatchObject({ signatureChanged: true, bodyChanged: false });
    const viaList = await pair('f', 'export function f() {}', 'function f() {}\nexport { f };');
    expect(viaList).toMatchObject({ signatureChanged: false, bodyChanged: false });
  });

  it('treat the whole interface as its signature', async () => {
    const result = await pair(
      'Dto',
      'export interface Dto { id: string; name: string }',
      'export interface Dto {\n  id: string,\n  name?: string,\n}',
    );
    expect(result).toMatchObject({ signatureChanged: true, bodyChanged: false });
    expect(result.after.hashes.body).toBe('');
  });

  it('keep class hashes when only a method body changes', async () => {
    const base = 'export class C { run() { return 1; } }';
    const cls = await pair('C', base, 'export class C { run() { return 2; } }');
    expect(cls).toMatchObject({ signatureChanged: false, bodyChanged: false });
    const added = await pair('C', base, 'export class C { run() { return 1; } stop() {} }');
    expect(added).toMatchObject({ signatureChanged: false, bodyChanged: true });
  });

  it('count decorators and static as part of a method signature', async () => {
    const result = await pair(
      'C.run',
      'export class C { run() {} }',
      'declare const log: any;\nexport class C { @log run() {} }',
    );
    expect(result.signatureChanged).toBe(true);
  });
});
