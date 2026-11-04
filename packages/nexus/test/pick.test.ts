import { describe, expect, it } from 'vitest';
import { cardKind, keptPick, movedPick } from '../src/page/pick.js';
import type { Row } from '../src/page/search.js';

const rows = ['/a', '/b', '/c', '/d'].map((path) => ({ path }));

describe('keptPick (decision 913)', () => {
  it('is the same row while it is listed; the first at first', () => {
    expect(keptPick(rows, null)).toBe('/a');
    expect(keptPick(rows, { path: '/c', at: 2 })).toBe('/c');
    expect(keptPick([{ path: '/x' }, ...rows], { path: '/c', at: 2 })).toBe('/c');
  });

  it('is the row now at its place when it left, the last when the list got shorter, none for none', () => {
    expect(
      keptPick(
        ['/a', '/b', '/d'].map((path) => ({ path })),
        { path: '/c', at: 2 },
      ),
    ).toBe('/d');
    expect(
      keptPick(
        ['/a', '/b'].map((path) => ({ path })),
        { path: '/d', at: 3 },
      ),
    ).toBe('/b');
    expect(keptPick([], { path: '/a', at: 0 })).toBeNull();
    expect(keptPick([], null)).toBeNull();
  });
});

describe('movedPick', () => {
  it('moves by one with ↑↓, by ten with Page Up and Down, and stops at the ends', () => {
    expect(movedPick(rows, '/b', 'ArrowDown')).toBe('/c');
    expect(movedPick(rows, '/b', 'ArrowUp')).toBe('/a');
    expect(movedPick(rows, '/a', 'ArrowUp')).toBe('/a');
    expect(movedPick(rows, '/d', 'ArrowDown')).toBe('/d');
    expect(movedPick(rows, '/a', 'PageDown')).toBe('/d');
    expect(movedPick(rows, '/d', 'PageUp')).toBe('/a');
    expect(movedPick(rows, null, 'ArrowDown')).toBe('/a');
    expect(movedPick(rows, '/gone', 'ArrowDown')).toBe('/a');
    expect(movedPick([], '/a', 'ArrowDown')).toBeNull();
    expect(movedPick(rows, '/b', 'Enter')).toBe('/b');
  });
});

describe('cardKind', () => {
  const repository: Row = { name: 'ky', path: '/ky', repository: true };
  it("is what the picked row's card shows", () => {
    expect(cardKind(null, {})).toBe('none');
    expect(cardKind(repository, {})).toBe('repository');
    expect(
      cardKind(
        {
          ...repository,
          tab: {
            root: '/ky',
            name: 'ky',
            branch: 'main',
            head: null,
            changed: 0,
            started: '',
            url: 'http://127.0.0.1:1/',
          },
        },
        {},
      ),
    ).toBe('running');
    expect(cardKind(repository, { starting: true })).toBe('starting');
    expect(cardKind(repository, { failed: 'symbiote view exited with 1' })).toBe('failed');
    expect(cardKind({ name: 'acme', path: '/acme', repository: false }, {})).toBe('folder');
    expect(cardKind({ name: 'old', path: '/old', repository: false, missing: true }, {})).toBe(
      'gone',
    );
  });
});
