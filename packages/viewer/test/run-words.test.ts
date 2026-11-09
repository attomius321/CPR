// The Run tab's small words (V92), as the tab drew them before they had a module of their own.
import { describe, expect, it } from 'vitest';
import { enc, hm, short } from '../src/workspaces/run-words.js';

describe('the Run tab’s words', () => {
  it('shortens a commit to its first seven characters', () => {
    expect(short('0123456789abcdef0123456789abcdef01234567')).toBe('0123456');
    expect(short('abc')).toBe('abc');
  });

  it('says a time of day as hours and minutes, both two digits, in local time', () => {
    expect(hm(new Date(2026, 10, 9, 9, 5).getTime())).toBe('09:05');
    expect(hm('2026-11-09T23:59:30')).toBe('23:59');
  });

  it('encodes an address part as encodeURIComponent does', () => {
    expect(enc('feature/a b&c')).toBe('feature%2Fa%20b%26c');
  });
});
