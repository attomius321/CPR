import { describe, expect, it } from 'vitest';
import { backTrail, pushTrail, trailBack } from '../src/diff/review.js';

describe('the panel’s trail (V107, decision 982)', () => {
  it('pushes the pick a link is followed from', () => {
    const one = pushTrail(null, 'a', 'b');
    expect(one).toEqual({ at: 'b', before: ['a'] });
    expect(pushTrail(one, 'b', 'c')).toEqual({ at: 'c', before: ['a', 'b'] });
  });

  it('starts a new trail when the pick moved elsewhere since', () => {
    // Followed a → b, then picked x from the sidebar: following x → y starts again from x.
    expect(pushTrail({ at: 'b', before: ['a'] }, 'x', 'y')).toEqual({ at: 'y', before: ['x'] });
  });

  it('goes back one step, and to no trail at its start', () => {
    const two = { at: 'c', before: ['a', 'b'] };
    expect(backTrail(two)).toEqual({ pick: 'b', trail: { at: 'b', before: ['a'] } });
    expect(backTrail({ at: 'b', before: ['a'] })).toEqual({ pick: 'a', trail: null });
    expect(backTrail(null)).toBeNull();
  });

  it('offers Back only while the trail is at the pick', () => {
    const one = { at: 'b', before: ['a'] };
    expect(trailBack(one, 'b')).toBe('a');
    expect(trailBack(one, 'x')).toBeNull();
    expect(trailBack(one, null)).toBeNull();
    expect(trailBack(null, 'b')).toBeNull();
  });
});
