import { describe, expect, it } from 'vitest';
import { cardKind, keptPick, movedPick } from '../src/page/pick.js';
import type { Row } from '../src/page/search.js';

const rows = ['/a', '/b', '/c', '/d'].map((path) => ({ path }));

const at = (path: string, place: number, nth = 0) => ({
  path,
  at: place,
  ...(nth > 0 ? { nth } : {}),
});

describe('keptPick (decisions 913, 926)', () => {
  it('is the same row while it is listed; the first at first', () => {
    expect(keptPick(rows, null)).toEqual(at('/a', 0));
    expect(keptPick(rows, at('/c', 2))).toEqual(at('/c', 2));
    expect(keptPick([{ path: '/x' }, ...rows], at('/c', 2))).toEqual(at('/c', 3));
  });

  it('is the row now at its place when it left, the last when the list got shorter, none for none', () => {
    expect(
      keptPick(
        ['/a', '/b', '/d'].map((path) => ({ path })),
        at('/c', 2),
      ),
    ).toEqual(at('/d', 2));
    expect(
      keptPick(
        ['/a', '/b'].map((path) => ({ path })),
        at('/d', 3),
      ),
    ).toEqual(at('/b', 1));
    expect(keptPick([], at('/a', 0))).toBeNull();
    expect(keptPick([], null)).toBeNull();
  });

  it('keeps the place of a path listed twice (a running repository in the tree too)', () => {
    const twice = ['/a', '/b', '/x', '/b'].map((path) => ({ path }));
    expect(keptPick(twice, at('/b', 3, 1))).toEqual(at('/b', 3, 1));
    expect(keptPick(twice, at('/b', 1))).toEqual(at('/b', 1));
    // A row came above: the same of its path's rows, one place down.
    expect(keptPick([{ path: '/y' }, ...twice], at('/b', 3, 1))).toEqual(at('/b', 4, 1));
    // Its second row gone (the tree closed): its first.
    expect(
      keptPick(
        ['/a', '/b'].map((path) => ({ path })),
        at('/b', 3, 1),
      ),
    ).toEqual(at('/b', 1));
  });
});

describe('movedPick', () => {
  it('moves by one with ↑↓, by ten with Page Up and Down, and stops at the ends', () => {
    expect(movedPick(rows, at('/b', 1), 'ArrowDown')).toEqual(at('/c', 2));
    expect(movedPick(rows, at('/b', 1), 'ArrowUp')).toEqual(at('/a', 0));
    expect(movedPick(rows, at('/a', 0), 'ArrowUp')).toEqual(at('/a', 0));
    expect(movedPick(rows, at('/d', 3), 'ArrowDown')).toEqual(at('/d', 3));
    expect(movedPick(rows, at('/a', 0), 'PageDown')).toEqual(at('/d', 3));
    expect(movedPick(rows, at('/d', 3), 'PageUp')).toEqual(at('/a', 0));
    expect(movedPick(rows, null, 'ArrowDown')).toEqual(at('/a', 0));
    expect(movedPick(rows, at('/gone', 1), 'ArrowDown')).toEqual(at('/a', 0));
    expect(movedPick([], at('/a', 0), 'ArrowDown')).toBeNull();
    expect(movedPick(rows, at('/b', 1), 'Enter')).toEqual(at('/b', 1));
  });

  it('moves on from the place of a path listed twice', () => {
    const twice = ['/a', '/b', '/x', '/b', '/z'].map((path) => ({ path }));
    expect(movedPick(twice, at('/b', 3, 1), 'ArrowDown')).toEqual(at('/z', 4));
    expect(movedPick(twice, at('/b', 1), 'ArrowDown')).toEqual(at('/x', 2));
    expect(movedPick(twice, at('/x', 2), 'ArrowDown')).toEqual(at('/b', 3, 1));
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
