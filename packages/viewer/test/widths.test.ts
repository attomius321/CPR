import { describe, expect, it } from 'vitest';
import { readWidths, withWidth } from '../src/widths.js';

describe('readWidths', () => {
  it('reads every panel the reviewer gave a width', () => {
    expect(readWidths('{"sidebar":400,"panel":670,"sidenav":320,"changes":300}')).toEqual({
      sidebar: 400,
      panel: 670,
      sidenav: 320,
      changes: 300,
    });
  });

  it('keeps what the diff stored before V34', () => {
    expect(readWidths('{"sidebar":400}')).toEqual({ sidebar: 400 });
  });

  it('leaves out what is not a width', () => {
    expect(readWidths('{"sidenav":-4,"changes":"wide","panel":null,"other":300}')).toEqual({});
    expect(readWidths('{"sidebar":1e999}')).toEqual({});
  });

  it('reads nothing from nothing, or from what is not an object', () => {
    expect(readWidths(null)).toEqual({});
    expect(readWidths('not json')).toEqual({});
    expect(readWidths('[300]')).toEqual({});
    expect(readWidths('300')).toEqual({});
  });
});

describe('withWidth', () => {
  it("changes one panel's width and keeps the others", () => {
    expect(withWidth({ sidebar: 400, panel: 670 }, 'sidenav', 320)).toEqual({
      sidebar: 400,
      panel: 670,
      sidenav: 320,
    });
  });

  it('forgets a width restored to the default', () => {
    expect(withWidth({ sidebar: 400, changes: 300 }, 'changes', null)).toEqual({ sidebar: 400 });
  });
});
