import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  directorySource,
  typescriptAdapter,
  type EdgeRef,
  type SymbolDecl,
  type TsRevision,
} from '../src/index.js';

const root = fileURLToPath(new URL('./fixtures/refs/app', import.meta.url));

let revision: TsRevision;
const symbols = new Map<string, SymbolDecl>();

beforeAll(async () => {
  const files = [
    'src/user.ts',
    'src/api.ts',
    'src/alias.ts',
    'src/dynamic.ts',
    'src/ext.ts',
    'src/view.tsx',
  ];
  revision = await typescriptAdapter.load(directorySource(root), { files });
  for (const symbol of typescriptAdapter.extract(revision, files)) symbols.set(symbol.id, symbol);
});

const get = (id: string) => {
  const symbol = symbols.get(id);
  if (!symbol) throw new Error(`no symbol ${id}; have ${[...symbols.keys()].join(', ')}`);
  return symbol;
};
const show = (refs: EdgeRef[], side: 'from' | 'to') =>
  refs.map((r) => `${r.kind} ${r[side]}${r.resolution === 'unknown' ? ' (unknown)' : ''}`).sort();

describe('incoming references', () => {
  it('finds method calls', () => {
    expect(
      show(typescriptAdapter.incoming(revision, get('src/user.ts#UserService.getUser')), 'from'),
    ).toEqual(['call src/api.ts#handler']);
  });

  it('follows barrels and renamed re-exports', () => {
    expect(
      show(typescriptAdapter.incoming(revision, get('src/user.ts#formatUser')), 'from'),
    ).toEqual(['call src/alias.ts#describe', 'call src/api.ts#handler']);
  });

  it('classifies extends, static calls, type references and top-level calls', () => {
    expect(
      show(typescriptAdapter.incoming(revision, get('src/user.ts#UserService')), 'from'),
    ).toEqual([
      'extends src/api.ts#AdminService',
      'new src/user.ts#UserService.static:create',
      'reference src/api.ts#handler',
      'type-reference src/user.ts#UserService.static:create',
    ]);
    expect(show(typescriptAdapter.incoming(revision, get('src/api.ts#handler')), 'from')).toEqual([
      'call src/api.ts#(module)',
    ]);
  });

  it('records the site of each reference', () => {
    const [ref] = typescriptAdapter.incoming(revision, get('src/user.ts#UserService.getUser'));
    expect(ref?.site).toEqual({ file: 'src/api.ts', line: 5, col: 22 });
  });
});

describe('outgoing references', () => {
  it('resolves calls through barrels and aliases to their declarations', () => {
    expect(show(typescriptAdapter.outgoing(revision, get('src/api.ts#handler')), 'to')).toEqual([
      'call src/user.ts#UserService.getUser',
      'call src/user.ts#UserService.static:create',
      'call src/user.ts#formatUser',
      'reference src/user.ts#UserService',
    ]);
  });

  it('includes type references from signatures', () => {
    expect(show(typescriptAdapter.outgoing(revision, get('src/user.ts#formatUser')), 'to')).toEqual(
      ['type-reference src/user.ts#User'],
    );
  });

  it('marks dynamic calls as unknown', () => {
    expect(show(typescriptAdapter.outgoing(revision, get('src/dynamic.ts#run')), 'to')).toEqual([
      'call unknown:target.go (unknown)',
      'call unknown:target[method] (unknown)',
    ]);
  });

  it('names unresolved package imports as externals', () => {
    const refs = typescriptAdapter.outgoing(revision, get('src/ext.ts#load'));
    expect(show(refs, 'to')).toEqual(['call node:fs#readFileSync', 'reference lodash#default']);
    expect(refs.every((r) => r.target === 'external')).toBe(true);
  });

  it('treats JSX elements as calls', () => {
    expect(show(typescriptAdapter.outgoing(revision, get('src/view.tsx#Card')), 'to')).toEqual([
      'call src/view.tsx#Badge',
    ]);
  });
});

describe('monorepos', () => {
  it('resolves workspace packages to their sources, not an unbuilt dist or a decoy', async () => {
    const mono = fileURLToPath(new URL('./fixtures/refs/monorepo', import.meta.url));
    const files = ['packages/a/src/index.ts'];
    const rev = await typescriptAdapter.load(directorySource(mono), { files });
    const [greet] = typescriptAdapter.extract(rev, files);
    expect(greet?.id).toBe('packages/a/src/index.ts#greet');
    expect(show(typescriptAdapter.incoming(rev, greet as SymbolDecl), 'from')).toEqual([
      'call packages/b/src/main.ts#main',
    ]);
  });
});
