// Alpha Ceph (decisions 682–687): Nucleus's name and icon while Hive mode is on; with it off,
// every word as before.
import type { BranchReviewList, McpAsk, PromptSetting } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { reviewMarks } from '../src/history/branchReviews.js';
import { otherNameText } from '../src/nucleus/page-agent.js';
import { askedBy } from '../src/shell/asks.js';
import { nucleusName } from '../src/shell/names.js';
import { routeTitle } from '../src/shell/pages.js';
import { agentName, promptGroups } from '../src/settings/settings.js';
import { iconCells, Mind } from '../src/ui/hive-art.js';
import { startedWith } from '../src/workspaces/workspaces.js';

describe('nucleusName', () => {
  it('is Alpha Ceph while Hive mode is on, Nucleus with it off', () => {
    expect(nucleusName(true)).toBe('Alpha Ceph');
    expect(nucleusName(false)).toBe('Nucleus');
  });
});

describe('the words that name Nucleus, both ways', () => {
  it("the page's and the window's title", () => {
    expect(routeTitle({ page: 'nucleus' }, 'symbiote', undefined, 'Alpha Ceph')).toBe(
      'Alpha Ceph · symbiote — Symbiote',
    );
    expect(routeTitle({ page: 'nucleus' }, 'symbiote', undefined, 'Nucleus')).toBe(
      'Nucleus · symbiote — Symbiote',
    );
    expect(routeTitle({ page: 'nucleus' }, 'symbiote')).toBe('Nucleus · symbiote — Symbiote');
  });

  it('who asks a Confirm', () => {
    const ask = { by: { via: 'nucleus' } } as McpAsk;
    expect(askedBy(ask, 'Alpha Ceph')).toBe('Alpha Ceph');
    expect(askedBy(ask)).toBe('Nucleus');
    // An agent through symbiote mcp is named as before.
    expect(
      askedBy({ by: { via: 'mcp', client: 'codex-mcp-client' } } as McpAsk, 'Alpha Ceph'),
    ).toBe('Codex');
  });

  it('who started a workspace', () => {
    const agent = { state: 'done', kind: 'claude' } as const;
    expect(startedWith(agent, 'nucleus', 'Alpha Ceph')).toBe(
      'Started through Alpha Ceph with Claude Code at its default effort.',
    );
    expect(startedWith(agent, 'nucleus')).toBe(
      'Started through Nucleus with Claude Code at its default effort.',
    );
    expect(startedWith(agent, 'mcp', 'Alpha Ceph')).toBe(
      'Started through symbiote mcp with Claude Code at its default effort.',
    );
  });

  it('who approved a branch', () => {
    const tip = 'a'.repeat(40);
    const list: BranchReviewList = {
      defaultBranch: 'main',
      reviewer: 'ada@example.com',
      place: 'repository',
      reviews: [
        {
          branch: 'feature/a',
          refs: [{ name: 'feature/a', tip, since: 0 }],
          added: [],
          verdict: { event: 'approve', head: tip, via: 'nucleus' },
        },
      ],
    } as unknown as BranchReviewList;
    expect(reviewMarks(list, 'Alpha Ceph').marks.get('feature/a')?.title).toBe(
      'Approved through Alpha Ceph',
    );
    expect(reviewMarks(list).marks.get('feature/a')?.title).toBe('Approved through Nucleus');
  });

  it('Settings: the prebuilt agent and its prompts, its key kept', () => {
    const prompt = { key: 'nucleus', group: 'Nucleus', title: 'Instructions' } as PromptSetting;
    const entry = (hive: boolean) => promptGroups([prompt], { hive })[0]?.entries[0];
    expect(entry(true)).toMatchObject({ key: 'nucleus', name: 'Alpha Ceph', agent: 'Nucleus' });
    expect(entry(false)).toMatchObject({ key: 'nucleus', name: 'Nucleus', agent: 'Nucleus' });
    expect(agentName('Nucleus', true)).toBe('Alpha Ceph');
    expect(agentName('Nucleus', false)).toBe('Nucleus');
    expect(agentName('Scribe', true)).toBe('Scribe');
  });
});

describe('a conversation started under the other name (decision 686)', () => {
  it('says so until New conversation; nothing when they agree', () => {
    expect(otherNameText({ name: 'Alpha Ceph' }, 'Nucleus')).toBe(
      'Started as Alpha Ceph: New conversation starts Nucleus.',
    );
    expect(otherNameText({}, 'Alpha Ceph')).toBe(
      'Started as Nucleus: New conversation starts Alpha Ceph.',
    );
    expect(otherNameText({}, 'Nucleus')).toBeNull();
    expect(otherNameText({ name: 'Alpha Ceph' }, 'Alpha Ceph')).toBeNull();
    expect(otherNameText(null, 'Alpha Ceph')).toBeNull();
  });
});

describe("Alpha Ceph's icon (decision 684)", () => {
  it("is the Mind's core and first ring, where the Mind puts them, inside lucide's grid", () => {
    const cells = iconCells();
    expect(cells).toHaveLength(7);
    // The Mind whose cells these are: a neighbour's centre is √3 cell radii from the core's.
    const out = cells.find((c) => !c.core);
    const mind = new Mind(
      12,
      12,
      Math.hypot((out?.x ?? 0) - 12, (out?.y ?? 0) - 12) / Math.sqrt(3),
    );
    for (const cell of cells) {
      const at = mind.cells.find((c) => Math.hypot(c.x - cell.x, c.y - cell.y) < 1e-9);
      expect(at?.ring).toBeLessThanOrEqual(1);
      // Every corner of its plate on the 24-unit grid.
      expect(cell.x - cell.plate).toBeGreaterThanOrEqual(0);
      expect(cell.x + cell.plate).toBeLessThanOrEqual(24);
      expect(cell.y - cell.plate).toBeGreaterThanOrEqual(0);
      expect(cell.y + cell.plate).toBeLessThanOrEqual(24);
    }
    // One core, at the middle, its chamber the larger.
    const cores = cells.filter((c) => c.core);
    expect(cores).toHaveLength(1);
    expect(cores[0]).toMatchObject({ x: 12, y: 12 });
    const ring = cells.find((c) => !c.core);
    expect(cores[0]?.chamber ?? 0).toBeGreaterThan(ring?.chamber ?? 0);
  });
});
