import { describe, expect, it } from 'vitest';
import { diffSymbols, type SymbolChange, type SymbolDecl, type SymbolKind } from '../src/index.js';

let line = 0;

/** A synthetic symbol: `sig` and `body` stand in for hashes, `size` for body tokens. */
function decl(
  id: string,
  {
    kind = 'function',
    sig = 's',
    body = 'b',
    size = 20,
  }: Partial<{ kind: SymbolKind; sig: string; body: string; size: number }> = {},
): SymbolDecl {
  const [file = '', qualified = ''] = id.split('#');
  const dot = qualified.lastIndexOf('.');
  line += 1;
  return {
    id,
    kind,
    name: qualified.slice(dot + 1),
    container: dot === -1 ? null : `${file}#${qualified.slice(0, dot)}`,
    exported: true,
    file,
    range: { start: { line, col: 1 }, end: { line, col: 2 } },
    signature: id,
    hashes: { signature: sig, body },
    bodySize: size,
  };
}

const summary = (changes: SymbolChange[]) =>
  changes.map((c) => {
    const flags = c.delta
      ? Object.entries(c.delta)
          .filter(([, on]) => on)
          .map(([name]) => name)
      : [];
    return `${c.status} ${c.id}${c.previousId ? ` ← ${c.previousId}` : ''}${flags.length ? ` [${flags.join(',')}]` : ''}`;
  });

describe('diffSymbols', () => {
  it('classifies added, removed, modified and unchanged symbols', () => {
    const changes = diffSymbols({
      base: [
        decl('a.ts#same'),
        decl('a.ts#body', { body: 'b1' }),
        decl('a.ts#sig', { sig: 's1' }),
        decl('a.ts#gone', { body: 'gone' }),
      ],
      head: [
        decl('a.ts#same'),
        decl('a.ts#body', { body: 'b2' }),
        decl('a.ts#sig', { sig: 's2' }),
        decl('a.ts#fresh', { body: 'fresh' }),
      ],
    });
    expect(summary(changes).sort()).toEqual([
      'added a.ts#fresh',
      'modified a.ts#body [body]',
      'modified a.ts#sig [signature]',
      'removed a.ts#gone',
      'unchanged a.ts#same',
    ]);
  });

  it('follows file renames, even when the symbol changed', () => {
    const changes = diffSymbols({
      base: [decl('old.ts#f', { body: 'b1' })],
      head: [decl('new.ts#f', { body: 'b2' })],
      renames: new Map([['old.ts', 'new.ts']]),
    });
    expect(summary(changes)).toEqual(['modified new.ts#f ← old.ts#f [body,moved]']);
  });

  it('matches an identical declaration moved to another file, including types', () => {
    const changes = diffSymbols({
      base: [decl('a.ts#Dto', { kind: 'interface', body: '', size: 0 })],
      head: [decl('b.ts#Dto', { kind: 'interface', body: '', size: 0 })],
    });
    expect(summary(changes)).toEqual(['modified b.ts#Dto ← a.ts#Dto [moved]']);
  });

  it('matches a renamed function by its body', () => {
    const changes = diffSymbols({
      base: [decl('a.ts#oldName', { sig: 's1', body: 'long' })],
      head: [decl('a.ts#newName', { sig: 's2', body: 'long' })],
    });
    expect(summary(changes)).toEqual(['modified a.ts#newName ← a.ts#oldName [signature,moved]']);
  });

  it('does not match tiny bodies', () => {
    const changes = diffSymbols({
      base: [decl('a.ts#x', { sig: 's1', body: '{}', size: 2 })],
      head: [decl('a.ts#y', { sig: 's2', body: '{}', size: 2 })],
    });
    expect(summary(changes).sort()).toEqual(['added a.ts#y', 'removed a.ts#x']);
  });

  it('does not guess between identical candidates', () => {
    const changes = diffSymbols({
      base: [decl('a.ts#one', { sig: '1' }), decl('a.ts#two', { sig: '2' })],
      head: [decl('a.ts#three', { sig: '3' })],
    });
    expect(summary(changes).sort()).toEqual([
      'added a.ts#three',
      'removed a.ts#one',
      'removed a.ts#two',
    ]);
  });

  it('moves members with their container', () => {
    const changes = diffSymbols({
      base: [
        decl('a.ts#Old', { kind: 'class', sig: 'old', body: 'members' }),
        decl('a.ts#Old.run', { kind: 'method', body: '{}', size: 2 }),
        decl('a.ts#Old.stop', { kind: 'method', body: 'stop1' }),
      ],
      head: [
        decl('b.ts#New', { kind: 'class', sig: 'new', body: 'members' }),
        decl('b.ts#New.run', { kind: 'method', body: '{}', size: 2 }),
        decl('b.ts#New.stop', { kind: 'method', body: 'stop2' }),
      ],
    });
    expect(summary(changes)).toEqual([
      'modified b.ts#New ← a.ts#Old [signature,moved]',
      'modified b.ts#New.run ← a.ts#Old.run [moved]',
      'modified b.ts#New.stop ← a.ts#Old.stop [body,moved]',
    ]);
  });

  it('requires the same kind to match', () => {
    const changes = diffSymbols({
      base: [decl('old.ts#x', { kind: 'variable' })],
      head: [decl('new.ts#x', { kind: 'function' })],
      renames: new Map([['old.ts', 'new.ts']]),
    });
    expect(summary(changes).sort()).toEqual(['added new.ts#x', 'removed old.ts#x']);
  });
});
