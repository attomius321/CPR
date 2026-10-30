import { describe, expect, it } from 'vitest';
import {
  changesText,
  checkoutText,
  closeTab,
  hashOf,
  nextTabs,
  selectedFrom,
  sinceText,
  symbiotesShown,
  titleOf,
  type Tab,
} from '../src/page/tabs.js';
import type { Pin } from '../src/pins.js';
import type { Symbiote } from '../src/symbiotes.js';

const listed = (name: string, over: Partial<Symbiote> = {}): Symbiote => ({
  url: `http://127.0.0.1:41${name.length}0/`,
  pid: 100,
  root: `/home/me/${name}`,
  name,
  started: '2026-10-28T10:00:00.000Z',
  branch: 'main',
  head: 'a1b2c3d4e5',
  changed: 0,
  ...over,
});

const tab = (symbiote: Symbiote, url: string | null = symbiote.url): Tab => ({
  root: symbiote.root,
  name: symbiote.name,
  branch: symbiote.branch,
  head: symbiote.head,
  changed: symbiote.changed,
  started: symbiote.started,
  url,
});

describe('nextTabs', () => {
  it('gives each running Symbiote a tab, by name', () => {
    expect(nextTabs([], [listed('zod'), listed('ky')], new Set())).toEqual([
      tab(listed('ky')),
      tab(listed('zod')),
    ]);
  });

  it("follows a Symbiote's checkout from read to read", () => {
    const before = nextTabs([], [listed('ky')], new Set());
    const after = nextTabs(before, [listed('ky', { branch: 'fix/x', changed: 2 })], new Set());
    expect(after).toEqual([tab(listed('ky', { branch: 'fix/x', changed: 2 }))]);
  });

  it('keeps an opened Symbiote that stopped, marked stopped; drops one never opened', () => {
    const before = nextTabs([], [listed('ky'), listed('zod')], new Set());
    const after = nextTabs(before, [], new Set(['/home/me/ky']));
    expect(after).toEqual([tab(listed('ky'), null)]);
  });

  it('takes a stopped Symbiote back at its new address: the same tab, by its folder', () => {
    const stopped = nextTabs(nextTabs([], [listed('ky')], new Set()), [], new Set(['/home/me/ky']));
    const back = nextTabs(
      stopped,
      [listed('ky', { url: 'http://127.0.0.1:4999/', pid: 2 })],
      new Set(),
    );
    expect(back).toEqual([tab(listed('ky', { url: 'http://127.0.0.1:4999/' }))]);
  });

  it('keeps stopped tabs in their place among the running ones', () => {
    const before = nextTabs([], [listed('a'), listed('m'), listed('z')], new Set());
    const after = nextTabs(before, [listed('a'), listed('z')], new Set(['/home/me/m']));
    expect(after.map((t) => [t.name, t.url !== null])).toEqual([
      ['a', true],
      ['m', false],
      ['z', true],
    ]);
  });
});

describe('closeTab', () => {
  it('removes a stopped tab; a running one stays, since it is listed', () => {
    const tabs = [tab(listed('ky'), null), tab(listed('zod'))];
    expect(closeTab(tabs, '/home/me/ky')).toEqual([tab(listed('zod'))]);
    expect(closeTab(tabs, '/home/me/zod')).toEqual(tabs);
  });
});

describe('the address', () => {
  it("keeps the open Symbiote's folder in its hash; none is the list", () => {
    expect(hashOf(null)).toBe('');
    expect(hashOf('/home/me/my repo#1')).toBe('#%2Fhome%2Fme%2Fmy%20repo%231');
    expect(selectedFrom('#%2Fhome%2Fme%2Fmy%20repo%231')).toBe('/home/me/my repo#1');
    expect(selectedFrom('')).toBeNull();
    expect(selectedFrom('#')).toBeNull();
    expect(selectedFrom('#%E0%A4%A')).toBeNull();
  });

  it('is Symbiotes for a folder browsed, and for an old Folders tab address (decision 626)', () => {
    expect(selectedFrom('#folders')).toBeNull();
    expect(selectedFrom('#folders:%2Fhome%2Fme%2Fprojects')).toBeNull();
  });
});

describe('words', () => {
  it('names the window by the open Symbiote and its checkout', () => {
    expect(titleOf(undefined)).toBe('Symbiote nexus');
    expect(titleOf(tab(listed('ky')))).toBe('ky · main — Symbiote nexus');
    expect(titleOf(tab(listed('ky'), null))).toBe('ky, stopped — Symbiote nexus');
  });

  it('says the checkout: its branch, a detached commit, or none yet', () => {
    expect(checkoutText(tab(listed('ky')))).toBe('main');
    expect(checkoutText(tab(listed('ky', { branch: null })))).toBe('detached at a1b2c3d');
    expect(checkoutText(tab(listed('ky', { branch: null, head: null })))).toBe('no commits');
  });

  it('counts the files changed and not committed', () => {
    expect(changesText(0)).toBe('no changes');
    expect(changesText(1)).toBe('1 file changed');
    expect(changesText(12)).toBe('12 files changed');
  });

  it('says since when it runs: the time today, else the day', () => {
    const now = new Date(2026, 9, 28, 20, 15);
    expect(sinceText(new Date(2026, 9, 28, 9, 5).toISOString(), now)).toBe('since 09:05');
    expect(sinceText(new Date(2026, 9, 27, 23, 59).toISOString(), now)).toBe('since Oct 27');
    expect(sinceText(new Date(2025, 11, 31, 8, 0).toISOString(), now)).toBe('since Dec 31, 2025');
    expect(sinceText('', now)).toBe('');
  });
});

describe('symbiotesShown', () => {
  const pin = (path: string, over: Partial<Pin> = {}): Pin => ({
    name: path.split('/').at(-1) ?? path,
    path,
    repository: true,
    ...over,
  });

  it('is the pinned repositories first, in the order pinned, then the other running ones (decision 627)', () => {
    const ky = tab(listed('ky'));
    const zod = tab(listed('zod'));
    const gone = tab(listed('gone'), null);
    const api = pin('/home/me/api', { branch: 'main' });
    const stopped = pin('/home/me/gone');
    expect(
      symbiotesShown(
        [gone, ky, zod],
        [
          pin('/home/me/zod'),
          // A folder is a place, and a pin whose folder is gone is drawn there (decision 628).
          pin('/home/me/projects', { repository: false }),
          api,
          pin('/home/me/old', { repository: false, missing: true }),
          stopped,
        ],
      ),
    ).toEqual([
      { kind: 'running', tab: zod, pinned: true },
      { kind: 'pinned', pin: api },
      // Its tab is open but it stopped: a pin with none running.
      { kind: 'pinned', pin: stopped },
      { kind: 'running', tab: ky, pinned: false },
    ]);
  });

  it('is the running ones alone without a pin, and nothing with none', () => {
    const ky = tab(listed('ky'));
    expect(symbiotesShown([ky], [])).toEqual([{ kind: 'running', tab: ky, pinned: false }]);
    expect(symbiotesShown([], [])).toEqual([]);
  });
});
