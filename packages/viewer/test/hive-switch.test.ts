import { describe, expect, it } from 'vitest';
import { hiveReadiness, nameOf, offWords, onRefusal } from '../src/settings/hive-switch.js';

describe("Hive's switch, in words (HV4, decisions 771, 772)", () => {
  it('says what Hive off does to each step in flight, and what on again does', () => {
    expect(offWords('writing')).toBe('its agent is stopped; on again, Hive tells it to continue');
    expect(offWords('checking')).toBe('its check is stopped; on again, the check runs again');
    expect(offWords('reviewing')).toBe(
      'its review is stopped and its copy deleted; on again, a new review',
    );
    expect(offWords('landing')).toMatch(/^its landing goes on: the merge queue checks, lands/);
  });

  it('refuses to turn on while a workspace is in normal mode, and says what to do', () => {
    expect(onRefusal({ normal: [] })).toBeNull();
    expect(onRefusal({ normal: [{ branch: 'feature/a' }] })).toBe(
      'Hive cannot turn on while a workspace is in normal mode. Land it or clean it up first:',
    );
    expect(onRefusal({ normal: [{ branch: 'a' }, { branch: 'b' }] })).toMatch(
      /^Hive cannot turn on while these workspaces are in normal mode\. Land them/,
    );
  });

  it('names a workspace by its title, else its branch', () => {
    expect(nameOf({ branch: 'feature/a', title: 'A' })).toBe('A');
    expect(nameOf({ branch: 'feature/a' })).toBe('feature/a');
  });
});

describe('Hive lands by (HV8)', () => {
  it('Hive off leaves a request open on the forge, and reads it again once on', () => {
    expect(offWords('landing', { forge: 'github', number: 12 })).toBe(
      'its pull request #12 stays open on GitHub: merge it there; Hive reads it again once on',
    );
    expect(offWords('landing', { forge: 'gitlab', number: 3 })).toBe(
      'its merge request !3 stays open on GitLab: merge it there; Hive reads it again once on',
    );
  });
});

describe("Hive's readiness, before it turns on (V92, decision 872)", () => {
  const pacing = { pauseAt: 90 as const, budget: 5, read: true };
  const ready = hiveReadiness({
    state: {
      normal: [],
      check: { commands: ['npm test'], source: 'symbiote/config.json (merge.checks)' },
    },
    pacing,
    rounds: 3,
  });

  it('passes with a check set and no normal-mode workspace open; full access is a warning', () => {
    expect(ready.ready).toBe(true);
    expect(ready.items).toEqual([
      { key: 'check', mark: 'ok', text: 'A check is set', detail: 'npm test, from merge.checks' },
      { key: 'normal', mark: 'ok', text: 'No workspace in normal mode is open', detail: '' },
      {
        key: 'limits',
        mark: 'ok',
        text: 'Limits',
        detail: 'pauses at 90 % · $5.00 a workspace · 3 rounds',
      },
      {
        key: 'access',
        mark: 'warn',
        text: 'Full access',
        detail: 'its agents can run anything on this machine',
      },
    ]);
  });

  it('blocks with no check set, and says so', () => {
    const none = hiveReadiness({ state: { normal: [] }, pacing, rounds: 3 });
    expect(none.ready).toBe(false);
    expect(none.items[0]).toEqual({
      key: 'check',
      mark: 'fail',
      text: 'No check is set',
      detail: 'set merge.checks in symbiote/config.json',
    });
  });

  it('blocks while workspaces are in normal mode, and names them', () => {
    const open = hiveReadiness({
      state: {
        normal: [{ branch: 'feature/cart', title: 'Save a cart for later' }, { branch: 'fix/x' }],
        check: { commands: ['npm test'], source: 'symbiote/config.json (merge.checks)' },
      },
      pacing,
      rounds: 3,
    });
    expect(open.ready).toBe(false);
    expect(open.items[1]).toEqual({
      key: 'normal',
      mark: 'fail',
      text: '2 workspaces in normal mode are open',
      detail: 'finish or clean them up first',
      names: ['Save a cart for later', 'fix/x'],
    });
  });

  it('says the limits as they are: no pause, no budget; several commands joined', () => {
    const loose = hiveReadiness({
      state: {
        normal: [],
        check: {
          commands: ['npm install', 'npm run test'],
          source: 'package.json (scripts.test), after an install',
        },
      },
      pacing: { pauseAt: false, budget: null, read: true },
      rounds: 3,
    });
    expect(loose.items[0]?.detail).toBe(
      'npm install, npm run test, from package.json (scripts.test), after an install',
    );
    expect(loose.items[2]?.detail).toBe('no pause · no budget · 3 rounds');
    // Not read yet: nothing passes, nothing turns on.
    expect(hiveReadiness({ state: null, pacing: null, rounds: 3 }).ready).toBe(false);
  });
});
