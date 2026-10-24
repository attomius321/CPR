import { describe, expect, it } from 'vitest';
import {
  combineAdapters,
  directorySource,
  type Dangling,
  type LanguageAdapter,
  type SymbolDecl,
} from '../src/index.js';

/** A fake language for files ending in `ext`, recording what it is asked. */
function fakeAdapter(id: string, ext: string) {
  const calls: string[] = [];
  const adapter: LanguageAdapter<{ id: string }> = {
    id,
    matches: (path) => path.endsWith(ext),
    load: (_source, options) => {
      calls.push(`load ${(options?.files ?? []).join(',')}`);
      return Promise.resolve({ id });
    },
    extract: (revision, files) => {
      calls.push(`extract ${files.join(',')}`);
      return files.map((file) => symbol(`${file}#${revision.id}`));
    },
    incoming: (_revision, s) => {
      calls.push(`incoming ${s.id}`);
      return [];
    },
    outgoing: (_revision, s) => {
      calls.push(`outgoing ${s.id}`);
      return [];
    },
    dangling: (_revision, removed): Dangling[] => {
      calls.push(`dangling ${removed.map((s) => s.id).join(',')}`);
      return [];
    },
    exposure: (_revision, s) => (s.file.endsWith(ext) ? 'framework' : undefined),
    publicApi: () => id === 'a',
    languageOf: (path) => (path.endsWith(ext) ? id : undefined),
    warnings: () => [`${id} warns`],
  };
  return { adapter, calls };
}

function symbol(id: string): SymbolDecl {
  const file = id.slice(0, id.indexOf('#'));
  return {
    id,
    kind: 'variable',
    name: id.slice(id.indexOf('#') + 1),
    container: null,
    exported: true,
    file,
    range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
    signature: '',
    hashes: { signature: '', body: '' },
    bodySize: 0,
  };
}

describe('combineAdapters', () => {
  it('gives each adapter only the files and symbols it reads', async () => {
    const a = fakeAdapter('a', '.ts');
    const b = fakeAdapter('b', '.css');
    const both = combineAdapters([a.adapter, b.adapter]);

    expect(both.matches('x.ts') && both.matches('y.css')).toBe(true);
    expect(both.matches('z.md')).toBe(false);

    const revision = await both.load(directorySource('.'), { files: ['x.ts', 'y.css', 'w.ts'] });
    const symbols = both.extract(revision, ['x.ts', 'y.css', 'w.ts']);
    expect(symbols.map((s) => s.id)).toEqual(['x.ts#a', 'w.ts#a', 'y.css#b']);

    for (const s of symbols) {
      both.incoming(revision, s);
      both.outgoing(revision, s);
    }
    both.dangling(revision, symbols, revision);

    expect(a.calls).toEqual([
      'load x.ts,w.ts',
      'extract x.ts,w.ts',
      'incoming x.ts#a',
      'outgoing x.ts#a',
      'incoming w.ts#a',
      'outgoing w.ts#a',
      'dangling x.ts#a,w.ts#a',
    ]);
    expect(b.calls).toEqual([
      'load y.css',
      'extract y.css',
      'incoming y.css#b',
      'outgoing y.css#b',
      'dangling y.css#b',
    ]);
  });

  it('answers for a symbol from the adapter of its file', async () => {
    const both = combineAdapters([
      fakeAdapter('a', '.ts').adapter,
      fakeAdapter('b', '.css').adapter,
    ]);
    const revision = await both.load(directorySource('.'));
    expect(both.publicApi(revision, symbol('x.ts#f'))).toBe(true);
    expect(both.publicApi(revision, symbol('y.css#f'))).toBe(false);
    expect(both.exposure(revision, symbol('y.css#f'))).toBe('framework');
    expect(both.languageOf?.('y.css')).toBe('b');
    expect(both.languageOf?.('z.md')).toBeUndefined();
    expect(both.warnings(revision)).toEqual(['a warns', 'b warns']);
  });

  it('skips an adapter with no changed file of its own when extracting', async () => {
    const a = fakeAdapter('a', '.ts');
    const b = fakeAdapter('b', '.css');
    const both = combineAdapters([a.adapter, b.adapter]);
    const revision = await both.load(directorySource('.'), { files: ['x.ts'] });
    both.extract(revision, ['x.ts']);
    expect(b.calls).toEqual(['load ']);
  });
});
