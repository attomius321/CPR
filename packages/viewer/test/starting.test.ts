import { describe, expect, it, vi } from 'vitest';
import { beginStart, endStart, startsNow, subscribeStarts } from '../src/workspaces/starting.js';

// A workspace being made (V48): its card while the start runs, gone once it is listed or failed.
describe('starts under way (V48)', () => {
  it('holds each start until it ends, and tells its readers', () => {
    const told = vi.fn();
    const stop = subscribeStarts(told);
    beginStart({ branch: 'feature/a', name: 'A', agent: 'Claude Code' });
    expect(startsNow()).toEqual([{ branch: 'feature/a', name: 'A', agent: 'Claude Code' }]);
    const shown = startsNow();
    beginStart({ branch: 'feature/b', name: 'B' });
    expect(startsNow().map((s) => s.branch)).toEqual(['feature/a', 'feature/b']);
    expect(startsNow()).not.toBe(shown);
    endStart('feature/a');
    endStart('feature/b');
    expect(startsNow()).toEqual([]);
    expect(told).toHaveBeenCalledTimes(4);
    stop();
  });
});
