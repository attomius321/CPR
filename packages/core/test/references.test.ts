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
    'src/namespace.ts',
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
    ).toEqual([
      'call src/alias.ts#describe',
      'call src/api.ts#handler',
      'call src/namespace.ts#describeUser',
    ]);
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

  it('resolves members of namespace imports', () => {
    // Regression: `users` resolves to the module (a SourceFile without a parent) and crashed.
    expect(
      show(typescriptAdapter.outgoing(revision, get('src/namespace.ts#describeUser')), 'to'),
    ).toEqual(['call src/user.ts#formatUser', 'type-reference src/user.ts#User']);
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

describe('class families', () => {
  // A base class, an overriding class, its subclass, a sibling and users through each type:
  // what the language service returns for renaming is not what uses a member.
  const familyRoot = fileURLToPath(new URL('./fixtures/refs/family', import.meta.url));
  const files = ['src/base.ts', 'src/cbs.ts', 'src/rent-cars.ts', 'src/host.ts'];
  let family: TsRevision;
  const members = new Map<string, SymbolDecl>();

  beforeAll(async () => {
    family = await typescriptAdapter.load(directorySource(familyRoot), { files });
    for (const s of typescriptAdapter.extract(family, files)) members.set(s.id, s);
  });

  const member = (id: string) => members.get(id) as SymbolDecl;
  const users = (id: string) =>
    typescriptAdapter
      .incoming(family, member(id))
      .map((r) => `${r.kind} ${r.from}${r.possible ? ' (possible)' : ''}`)
      .sort();
  const uses = (id: string) =>
    typescriptAdapter
      .outgoing(family, member(id))
      .map((r) => `${r.kind} ${r.to}`)
      .sort();

  it('counts only code that can run on an instance of the member’s class', () => {
    expect(users('src/cbs.ts#CbsComponent.panelDisplayType')).toEqual([
      // A subclass override must stay compatible with it.
      'overrides src/cbs.ts#SpecialCbsComponent.panelDisplayType',
      // Through the base type: when the object is a CbsComponent.
      'reference src/base.ts#ResourceBase.describe (possible)',
      'reference src/cbs.ts#CbsComponent.ngOnInit',
      'reference src/host.ts#HostComponent.show',
      'reference src/host.ts#modes (possible)',
      // Not: the sibling RentCarsResourceComponent, a RentCars-typed value, the base and
      // interface declarations.
    ]);
  });

  it('links a member to what it overrides or implements', () => {
    expect(uses('src/cbs.ts#CbsComponent.panelDisplayType')).toEqual([
      'overrides src/base.ts#ResourceBase.panelDisplayType',
    ]);
    expect(uses('src/base.ts#ResourceBase.panelDisplayType')).toEqual([
      'overrides src/base.ts#Panel',
    ]);
  });

  it('does not count siblings implementing the same interface method', () => {
    // Every Angular component's ngOnInit implements OnInit; none uses another's.
    expect(users('src/cbs.ts#CbsComponent.ngOnInit')).toEqual([]);
    expect(uses('src/cbs.ts#CbsComponent.ngOnInit')).toEqual([
      'overrides src/base.ts#OnInit',
      'reference src/cbs.ts#CbsComponent.panelDisplayType',
    ]);
  });

  it('keeps every user of the base member, the whole family included', () => {
    expect(users('src/base.ts#ResourceBase.panelDisplayType')).toEqual([
      'overrides src/cbs.ts#CbsComponent.panelDisplayType',
      'reference src/base.ts#ResourceBase.describe',
      'reference src/cbs.ts#CbsComponent.ngOnInit',
      'reference src/host.ts#HostComponent.rentMode',
      'reference src/host.ts#HostComponent.show',
      'reference src/host.ts#modes',
      'reference src/rent-cars.ts#RentCarsResourceComponent.isPanelOverlay',
      'reference src/rent-cars.ts#RentCarsResourceComponent.onAddItem',
    ]);
  });
});
