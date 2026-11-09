// V93 (decisions 876, 877): normal mode's sidenav rows as the proofs' `.ws` — the state's icon and
// the title, then the state's word, its facts and its time — and Done today apart from Earlier.
import type { MergeEntry, WorkspaceSummary } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { doneGroups, mergeRowWords, rowWords } from '../src/workspaces/row-words.js';
import { type WorkspaceRow } from '../src/workspaces/workspace-groups.js';
import { workspaceNext } from '../src/workspaces/workspace-next.js';

const TIP = 'c'.repeat(40);
// 3 November 2026, 14:00 local time.
const NOW = new Date(2026, 10, 3, 14, 0).getTime();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const summary = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  branch: 'feature/saved-carts',
  title: 'Save a cart for later',
  kind: 'feature',
  base: 'a'.repeat(40),
  from: 'main',
  created: ago(60),
  planFirst: false,
  brief: '# Save a cart for later',
  worktree: { path: '/w/saved-carts', exists: true, changed: 0 },
  tip: TIP,
  ahead: 0,
  merged: false,
  agent: { state: 'working', kind: 'claude', id: 's1' },
  ...over,
});
const row = (workspace: WorkspaceSummary): WorkspaceRow => ({
  workspace,
  next: workspaceNext(workspace, undefined, NOW),
});

describe('rowWords', () => {
  it('a plan ready: the bell, violet, "Plan ready" and how long it has waited', () => {
    const words = rowWords(
      row(summary({ agent: { state: 'plan-ready', kind: 'claude' }, activity: { since: ago(4) } })),
      NOW,
    );
    expect(words).toMatchObject({ icon: 'bell', tone: 'you', word: 'Plan ready', time: '4m' });
    expect(words.detail).toEqual([]);
  });

  it('a question: the speech bubble, "Asked a question"', () => {
    const words = rowWords(
      row(
        summary({
          agent: { state: 'needs-you', kind: 'claude' },
          activity: {
            since: ago(1),
            asks: {
              kind: 'asks',
              tool: 'AskUserQuestion',
              questions: [{ question: 'Tax shipping for EU orders only?', options: ['Yes', 'No'] }],
            } as never,
          },
        }),
      ),
      NOW,
    );
    expect(words).toMatchObject({
      icon: 'question',
      tone: 'you',
      word: 'Asked a question',
      time: '1m',
    });
    expect(words.tip).toContain('Tax shipping for EU orders only?');
  });

  it('a permission: the bell, "Asks permission", the command in its tip', () => {
    const words = rowWords(
      row(
        summary({
          agent: { state: 'needs-you', kind: 'claude' },
          activity: {
            since: ago(2),
            asks: { kind: 'asks', tool: 'Bash', input: '{"command":"npm install pg"}' } as never,
          },
        }),
      ),
      NOW,
    );
    expect(words).toMatchObject({ icon: 'bell', word: 'Asks permission', time: '2m' });
    expect(words.tip).toContain('Permission to run npm install pg');
  });

  it('interrupted: waits for the person', () => {
    const words = rowWords(
      row(summary({ agent: { state: 'needs-you', kind: 'claude', interrupted: true } })),
      NOW,
    );
    expect(words).toMatchObject({ icon: 'bell', tone: 'you', word: 'Interrupted' });
  });

  it('commits to review: the eye, the commits as the word', () => {
    const words = rowWords(
      row(
        summary({
          ahead: 3,
          agent: { state: 'done', kind: 'claude' },
          activity: { since: ago(6) },
        }),
      ),
      NOW,
    );
    // No time on a row of commits (the proof's "3 commits · 1 error · 2 warnings").
    expect(words).toMatchObject({ icon: 'eye', tone: 'you', word: '3 commits' });
    expect(words.time).toBeUndefined();
  });

  it('findings join a review row when known', () => {
    const words = rowWords(
      row(summary({ ahead: 3, agent: { state: 'done', kind: 'claude' } })),
      NOW,
      { findings: { errors: 1, warnings: 2 } },
    );
    expect(words.detail).toEqual(['1 error', '2 warnings']);
    expect(words.findings).toEqual({ errors: 1, warnings: 2 });
  });

  it('an answered spike: "Answered", its kind', () => {
    const words = rowWords(
      row(
        summary({
          kind: 'spike',
          branch: 'spike/catalog-search',
          agent: { state: 'done', kind: 'claude' },
          activity: { since: ago(2), report: { at: ago(2), text: 'Use Meilisearch' } },
        }),
      ),
      NOW,
    );
    expect(words).toMatchObject({ icon: 'eye', word: 'Answered', time: '2m' });
    expect(words.detail).toEqual(['spike']);
  });

  it('a review asked again, approved, changes requested', () => {
    const base = summary({ ahead: 2, agent: { state: 'done', kind: 'claude' } });
    const again = rowWords(
      {
        workspace: base,
        next: workspaceNext(base, {
          branch: base.branch,
          base: base.base,
          head: 'd'.repeat(40),
          updated: ago(30),
          marks: 0,
          refs: [{ name: base.branch, since: 2 } as never],
          added: [],
        }),
      },
      NOW,
    );
    expect(again.word).toBe('Review again');
    expect(again.detail).toEqual(['2 commits since']);
  });

  it('working: the spinner, the tool as the word, its subject short, the turn as a clock', () => {
    const editing = rowWords(
      row(
        summary({
          activity: {
            since: new Date(NOW - 460_000).toISOString(),
            doing: { tool: 'Edit', subject: 'src/orders/list.ts' } as never,
          },
        }),
      ),
      NOW,
    );
    // Its subject joins the verb, no dot between: "Editing list.ts · 7:40".
    expect(editing).toMatchObject({
      icon: 'spin',
      tone: 'run',
      word: 'Editing',
      object: 'list.ts',
      time: '7:40',
    });
    expect(editing.detail).toEqual([]);
    const running = rowWords(
      row(
        summary({
          activity: {
            since: new Date(NOW - 185_000).toISOString(),
            doing: { tool: 'Bash', subject: 'npm test' } as never,
          },
        }),
      ),
      NOW,
    );
    expect(running).toMatchObject({ word: 'Running', object: 'npm test', time: '3:05' });
    const thinking = rowWords(row(summary({ activity: { doing: { thinking: true } } })), NOW);
    expect(thinking).toMatchObject({ word: 'Thinking' });
    expect(thinking.time).toBeUndefined();
    expect(rowWords(row(summary()), NOW).word).toBe('Working');
  });

  it('stopped, failed, not started, no agent, branch gone', () => {
    expect(
      rowWords(row(summary({ agent: { state: 'stopped', kind: 'claude' } })), NOW),
    ).toMatchObject({ icon: 'idle', tone: 'idle', word: 'Stopped' });
    const failed = rowWords(
      row(summary({ agent: { state: 'failed', kind: 'claude', error: 'exit 1\nmore' } })),
      NOW,
    );
    expect(failed).toMatchObject({ icon: 'alert', tone: 'fail', word: 'Failed' });
    expect(failed.detail).toEqual(['exit 1']);
    expect(
      rowWords(
        row(summary({ agent: { state: 'not-started', kind: 'claude', error: 'no claude' } })),
        NOW,
      ),
    ).toMatchObject({ tone: 'fail', word: 'Not started' });
    expect(rowWords(row(summary({ agent: { state: 'no-agent' } })), NOW)).toMatchObject({
      tone: 'fail',
      word: 'No agent',
    });
    expect(rowWords(row(summary({ tip: null })), NOW)).toMatchObject({
      tone: 'fail',
      word: 'Branch gone',
    });
  });

  it('a conflict or a gone worktree takes the second line, in its colour', () => {
    const conflicts = rowWords(
      row(summary({ ahead: 2, agent: { state: 'done', kind: 'claude' } })),
      NOW,
      { merge: { into: 'main', conflicts: ['a.ts'] } as never },
    );
    expect(conflicts).toMatchObject({ word: '1 conflict', tone: 'fail' });
    expect(conflicts.detail).toEqual(['with main']);
    const gone = rowWords(
      row(summary({ worktree: { path: '/w', exists: false, changed: 0 } })),
      NOW,
    );
    expect(gone).toMatchObject({ word: 'Worktree gone', tone: 'gone' });
  });

  it('merged: the check, green, done', () => {
    expect(rowWords(row(summary({ merged: true, ahead: 2 })), NOW)).toMatchObject({
      icon: 'check',
      tone: 'ok',
      word: 'Merged',
    });
  });

  it('its tip says everything the row left out: name, state, kind, branch, model, facts', () => {
    const words = rowWords(
      row(
        summary({
          ahead: 3,
          worktree: { path: '/w', exists: true, changed: 2 },
          agent: { state: 'done', kind: 'claude', model: 'claude-opus-5-5', effort: 'xhigh' },
        }),
      ),
      NOW,
    );
    expect(words.tip.split('\n')).toEqual([
      'Save a cart for later',
      'Ready for review',
      'feature · feature/saved-carts',
      'Claude Code · Opus 5.5 · xhigh effort',
      '3 commits · 2 files not committed yet',
    ]);
  });
});

const entry = (over: Partial<MergeEntry> = {}): MergeEntry => ({
  id: 'm1',
  branch: 'fix/order-total-rounding',
  head: 'b'.repeat(40),
  into: 'main',
  title: 'Merge fix/order-total-rounding: Fix order total rounding',
  state: 'queued',
  queued: ago(5),
  updated: ago(1),
  ...over,
});

describe('mergeRowWords', () => {
  it('checking: the merge icon, amber, the command, the check as a clock', () => {
    const words = mergeRowWords(
      entry({
        state: 'checking',
        check: {
          commands: ['npm test'],
          source: 'package.json',
          started: new Date(NOW - 12_000).toISOString(),
        },
      }),
      'Fix order total rounding',
      NOW,
    );
    expect(words).toMatchObject({ icon: 'merge', tone: 'run', word: 'Checking', time: '0:12' });
    expect(words.detail).toEqual(['npm test']);
    expect(words.object).toBeUndefined();
    expect(words.title).toBe('Fix order total rounding');
  });

  it('without a workspace: the subject after its branch, else the branch', () => {
    expect(mergeRowWords(entry(), undefined, NOW).title).toBe('Fix order total rounding');
    expect(mergeRowWords(entry({ title: 'Merge x' }), undefined, NOW).title).toBe(
      'fix/order-total-rounding',
    );
  });

  it('queued, merging, ready, failed, landed, needs you', () => {
    expect(mergeRowWords(entry(), 'T', NOW)).toMatchObject({ word: 'Queued', tone: 'run' });
    expect(mergeRowWords(entry({ state: 'merging' }), 'T', NOW)).toMatchObject({
      word: 'Merging',
      tone: 'run',
    });
    expect(
      mergeRowWords(
        entry({ state: 'ready', check: { commands: ['t'], source: 's', ok: true, ms: 1 } }),
        'T',
        NOW,
      ),
    ).toMatchObject({ word: 'Ready to land', tone: 'you' });
    expect(
      mergeRowWords(
        entry({ state: 'failed', check: { commands: ['t'], source: 's', ok: false, failed: 't' } }),
        'T',
        NOW,
      ),
    ).toMatchObject({ word: 'Check failed', tone: 'fail', icon: 'alert' });
    expect(mergeRowWords(entry({ state: 'landed', landed: ago(3) }), 'T', NOW)).toMatchObject({
      word: 'Landed',
      tone: 'ok',
      icon: 'check',
    });
    expect(mergeRowWords(entry({ state: 'needs-you' }), 'T', NOW)).toMatchObject({
      word: 'Needs you',
      tone: 'you',
    });
  });
});

describe('doneGroups', () => {
  it('Done today: merged since local midnight, the newest first, with when; the rest Earlier', () => {
    const today = row(
      summary({
        branch: 'a',
        merged: true,
        lastAction: new Date(2026, 10, 3, 11, 20).toISOString(),
      }),
    );
    const later = row(
      summary({
        branch: 'b',
        merged: true,
        lastAction: new Date(2026, 10, 3, 9, 41).toISOString(),
      }),
    );
    const old = row(
      summary({
        branch: 'c',
        merged: true,
        lastAction: new Date(2026, 10, 2, 18, 0).toISOString(),
      }),
    );
    const never = row(summary({ branch: 'd', merged: true }));
    const groups = doneGroups([later, old, today, never], [], NOW);
    expect(groups.today.map((r) => [r.workspace.branch, r.at])).toEqual([
      ['a', today.workspace.lastAction],
      ['b', later.workspace.lastAction],
    ]);
    expect(groups.earlier.map((r) => r.workspace.branch)).toEqual(['c', 'd']);
  });

  it('a landed merge says when it merged', () => {
    const merged = row(
      summary({ branch: 'a', merged: true, lastAction: new Date(2026, 10, 2, 9).toISOString() }),
    );
    const landed = new Date(2026, 10, 3, 10, 2).toISOString();
    const groups = doneGroups([merged], [entry({ branch: 'a', state: 'landed', landed })], NOW);
    expect(groups.today.map((r) => r.at)).toEqual([landed]);
  });
});
