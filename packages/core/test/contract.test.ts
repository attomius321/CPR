import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeDirectories,
  createTypescriptAdapter,
  type Analysis,
  type TsPlugin,
} from '../src/index.js';
import { tempDir } from './helpers/git-repo.js';

/**
 * A made-up framework whose `make$((props: P) => …)` makes a component: its contract is `P`,
 * which JSX-like callers (`use(Comp, { … })`) pass. What `src/pages/` holds is loaded by it.
 */
const makePlugin: TsPlugin = {
  name: 'make',
  apiVersion: 1,
  applies: () => true,
  contract: (revision, declaration) => {
    const { ts, checker } = revision;
    const value = ts.isVariableDeclaration(declaration)
      ? declaration.initializer
      : declaration.expression;
    if (!value || !ts.isCallExpression(value) || value.expression.getText() !== 'make$') {
      return undefined;
    }
    const render = value.arguments[0];
    if (!render || !ts.isArrowFunction(render)) return undefined;
    const props = render.parameters[0];
    if (!props) return { label: 'make$', inputs: undefined };
    return props.type
      ? { label: 'make$', inputs: checker.getTypeFromTypeNode(props.type) }
      : undefined;
  },
  exposure: (_, symbol) => (symbol.file.startsWith('src/pages/') ? 'framework' : undefined),
};

const FRAMEWORK = `export declare function make$<P>(render: (props: P) => unknown): (props: P) => unknown;
export declare function use<P>(component: (props: P) => unknown, props: P): unknown;
`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(files: Record<string, string>): string {
  const root = tempDir();
  roots.push(root);
  for (const [path, text] of Object.entries({ 'src/framework.ts': FRAMEWORK, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const analyze = (
  base: Record<string, string>,
  head: Record<string, string>,
  plugins: TsPlugin[] = [makePlugin],
) =>
  analyzeDirectories(write(base), write(head), {
    adapter: createTypescriptAdapter({ plugins }),
  });

const change = (analysis: Analysis, id: string) => analysis.changes.find((c) => c.id === id);
const compat = (analysis: Analysis, id: string) =>
  analysis.findings.find((f) => f.symbol === id)?.data.compatibility;

/** `src/badge.ts` with the given props, and a page in another file using it unchanged. */
const badge = (props: string) => ({
  'src/badge.ts': `import { make$ } from './framework';\nexport const Badge = make$((props: ${props}) => props);\n`,
  'src/page.ts': `import { use } from './framework';\nimport { Badge } from './badge';\nexport const page = () => use(Badge, { label: 'a' } as never);\n`,
});

describe('contracts', () => {
  it.each([
    ['optional input added', '{ label: string }', '{ label: string; size?: number }', 'compatible'],
    ['input made optional', '{ label: string }', '{ label?: string }', 'compatible'],
    ['required input added', '{ label: string }', '{ label: string; tone: string }', 'breaking'],
    ['input removed', '{ label: string; size?: number }', '{ label: string }', 'breaking'],
    ['input retyped', '{ label: string }', '{ label: number }', 'breaking'],
    [
      'input made required',
      '{ label: string; size?: number }',
      '{ label: string; size: number }',
      'breaking',
    ],
  ])('compares inputs from the callers’ side: %s → %s', async (_, before, after, expected) => {
    const analysis = await analyze(badge(before), badge(after));
    expect(compat(analysis, 'src/badge.ts#Badge')).toBe(expected);
  });

  it('shows the inputs as the signature, and ignores how they are written', async () => {
    const analysis = await analyze(
      badge('{ label: string; size?: number }'),
      badge('{\n  size?: number,\n  label: string, // the text\n}'),
    );
    expect(change(analysis, 'src/badge.ts#Badge')).toMatchObject({
      status: 'modified',
      delta: { signature: false, body: true },
      head: { signature: 'const Badge = make$<{ label: string; size?: number }>' },
    });
  });

  it('follows a named inputs type: its change is the component’s', async () => {
    const card = (props: string) => ({
      'src/card.ts': `import { make$ } from './framework';\nexport interface CardProps ${props}\nexport const Card = make$((props: CardProps) => props);\n`,
    });
    const analysis = await analyze(
      card('{ title: string }'),
      card('{ title: string; sub: string }'),
    );
    expect(change(analysis, 'src/card.ts#Card')).toMatchObject({
      status: 'modified',
      delta: { signature: true, body: false },
    });
    // Without the plugin the variable's type is `(props: CardProps) => unknown`: unchanged.
    const without = await analyze(
      card('{ title: string }'),
      card('{ title: string; sub: string }'),
      [],
    );
    expect(change(without, 'src/card.ts#Card')?.status).toBe('unchanged');
  });

  it('gives a component without inputs an empty contract', async () => {
    const files = (render: string) => ({
      'src/icon.ts': `import { make$ } from './framework';\nexport default make$(${render});\n`,
    });
    const analysis = await analyze(files('() => 1'), files('(props: { size?: number }) => props'));
    expect(change(analysis, 'src/icon.ts#default')?.head?.signature).toBe(
      'default = make$<{ size?: number }>',
    );
    expect(change(analysis, 'src/icon.ts#default')?.base?.signature).toBe('default = make$<{}>');
  });

  describe('at each JSX use', () => {
    /** `Badge` with the given props, rendered by a page in another file that does not change. */
    const jsx = (props: string, element: string) => ({
      'src/badge.ts': `import { make$ } from './framework';\nexport const Badge = make$((props: ${props}) => props);\n`,
      'src/page.tsx': `import { Badge } from './badge';\nexport const page = (rest: object) => ${element};\n`,
    });
    const run = async (before: string, after: string, element: string) => {
      const analysis = await analyze(jsx(before, element), jsx(after, element));
      const found = analysis.findings.find((f) => f.symbol === 'src/badge.ts#Badge');
      return `${found?.severity}: ${found?.message}`;
    };

    it('lets users that do not pass a removed or retyped prop be', async () => {
      expect(await run('{ a: string; b?: number }', '{ a: string }', '<Badge a="x" />')).toBe(
        'info: Badge changed its props; the user not updated passes props that still fit',
      );
      expect(
        await run('{ a: string; b?: number }', '{ a: string; b?: string }', '<Badge a="x" />'),
      ).toBe('info: Badge changed its props; the user not updated passes props that still fit');
    });

    it('names users that pass a removed prop or miss a required one', async () => {
      expect(await run('{ a: string; b?: number }', '{ a: string }', '<Badge a="x" b={1} />')).toBe(
        'warning: Badge changed its props; 1 of 1 user not updated passes a changed prop or misses a new required one: page',
      );
      expect(
        await run('{ a: string; b?: number }', '{ a: string; b: number }', '<Badge a="x" />'),
      ).toBe(
        'warning: Badge changed its props; 1 of 1 user not updated passes a changed prop or misses a new required one: page',
      );
      // Children are passed as `children`.
      expect(await run('{ children?: string }', '{}', '<Badge>text</Badge>')).toMatch(/^warning:/);
    });

    it('reads a reference in a doc comment as no JSX use', async () => {
      // `{@link Badge}` in JSDoc before a top-level statement: the reference has no parent node.
      const files = (props: string) => ({
        ...jsx(props, '<Badge a="x" />'),
        'src/notes.ts':
          "import { Badge } from './badge';\n/** See {@link Badge}. */\nexport const note = 1;\n",
      });
      const analysis = await analyze(
        files('{ a: string; b?: number }'),
        files('{ a: string; b: number }'),
      );
      expect(analysis.findings.map((f) => `${f.severity} ${f.symbol}`)).toContain(
        'warning src/badge.ts#Badge',
      );
    });

    it('assumes the worst where it cannot see what is passed', async () => {
      expect(
        await run('{ a: string; b?: number }', '{ a: string }', '<Badge a="x" {...rest} />'),
      ).toMatch(/^warning: .*: page$/);
      expect(await run('{ a: string; b?: number }', '{ a: string }', 'Badge')).toMatch(/^warning:/);
    });
  });

  it('lets a plugin say a default export is used, where the adapter guesses', async () => {
    const page = { 'src/pages/home.ts': 'export default function home() { return 1; }\n' };
    const other = { 'src/other.ts': 'export default function other() { return 1; }\n' };
    const analysis = await analyze({}, { ...page, ...other });
    expect(analysis.findings.map((f) => `${f.severity} ${f.rule} ${f.symbol}`)).toEqual([
      'info orphan-added src/other.ts#other',
    ]);
  });
});
