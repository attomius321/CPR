import type {
  AgentOption,
  BranchReviewSummary,
  WorkspaceAgentState,
  WorkspaceStart,
  WorkspaceHive,
  WorkspaceSummary,
  WorkspaceThread,
  ThreadEntry,
} from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  branchProblem,
  cleanableOnCard,
  effortChoices,
  keptEffort,
  keptModel,
  modelChoices,
  readRun,
  startedWith,
  activityText,
  allRows,
  workspaceChips,
  workspaceFacts,
  workspaceGroups,
  workspaceName,
  workspaceNext,
  workspacesFirst,
  proposeBranch,
  replyMode,
  shortAge,
  startedNotice,
  talkCommand,
  terminalHint,
  asksBeforeOpening,
  opensTerminal,
  threadItems,
  verdictToSend,
} from '../src/workspaces/workspaces.js';

describe('effortChoices and keptEffort (V30b)', () => {
  const claude: AgentOption = {
    kind: 'claude',
    command: 'claude',
    efforts: { levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  };
  const codex: AgentOption = {
    kind: 'codex',
    command: 'codex',
    efforts: { levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], default: 'medium' },
  };

  it("offers the agent's default first, named with its level when the agent says it, then its levels", () => {
    expect(effortChoices(claude)).toEqual([
      { value: '', label: "Claude Code's default" },
      { value: 'low', label: 'low' },
      { value: 'medium', label: 'medium' },
      { value: 'high', label: 'high' },
      { value: 'xhigh', label: 'xhigh' },
      { value: 'max', label: 'max' },
    ]);
    expect(effortChoices(codex)[0]).toEqual({ value: '', label: "Codex's default (medium)" });
    expect(effortChoices(codex).at(-1)).toEqual({ value: 'ultra', label: 'ultra' });
    // No levels read: no choice.
    expect(effortChoices({ kind: 'codex' })).toEqual([]);
  });

  it("names Symbiote's level as the default when the level is Symbiote's choice (V75c)", () => {
    const advisor = {
      kind: 'codex' as const,
      efforts: { levels: ['none', 'low'], default: 'low' },
    };
    expect(effortChoices({ ...advisor, efforts: { ...advisor.efforts, by: 'symbiote' } })).toEqual([
      { value: '', label: "Symbiote's default (low)" },
      { value: 'none', label: 'none' },
      { value: 'low', label: 'low' },
    ]);
    expect(effortChoices(advisor)[0]).toEqual({ value: '', label: "Codex's default (low)" });
  });

  it('keeps a level the other agent takes when the agent changes, else its default', () => {
    expect(keptEffort('high', codex)).toBe('high');
    expect(keptEffort('ultra', claude)).toBeUndefined();
    expect(keptEffort('high', {})).toBeUndefined();
    expect(keptEffort(undefined, claude)).toBeUndefined();
  });
});

describe('modelChoices, keptModel and the levels on a model (V47)', () => {
  const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const claude: AgentOption = {
    kind: 'claude',
    command: 'claude',
    efforts: { levels: LEVELS },
    models: [
      {
        id: 'opus',
        name: 'Opus 5.5',
        description: 'For complex work',
        efforts: { levels: LEVELS },
      },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Fastest' },
      {
        id: 'claude-opus-4-6',
        name: 'Opus 4.6',
        efforts: { levels: ['low', 'medium', 'high', 'max'] },
      },
    ],
  };
  const codex: AgentOption = {
    kind: 'codex',
    command: 'codex',
    efforts: { levels: LEVELS, default: 'medium' },
    models: [
      {
        id: 'gpt-6-luna',
        name: 'GPT-6-Luna',
        description: 'Fast and affordable model for easier tasks.',
        efforts: { levels: LEVELS, default: 'medium' },
      },
      {
        id: 'gpt-5.6-terra',
        name: 'GPT-5.6-Terra',
        efforts: { levels: [...LEVELS, 'ultra'], default: 'high' },
      },
    ],
    defaultModel: { id: 'gpt-6-luna', by: 'agent' },
  };

  it("offers the agent's default first, named when Symbiote knows it, then its models by name", () => {
    expect(modelChoices(claude)).toEqual([
      { value: '', label: "Claude Code's default" },
      { value: 'opus', label: 'Opus 5.5', description: 'For complex work' },
      { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fastest' },
      { value: 'claude-opus-4-6', label: 'Opus 4.6' },
    ]);
    expect(modelChoices(codex)[0]).toEqual({
      value: '',
      label: "Codex's default (GPT-6-Luna)",
      description: 'Fast and affordable model for easier tasks.',
    });
    // The project's (`agent.model`), and the merger's Symbiote picks; an ID not listed as is.
    expect(
      modelChoices({ ...claude, defaultModel: { id: 'claude-opus-4-6', by: 'project' } })[0],
    ).toEqual({ value: '', label: "The project's (Opus 4.6)" });
    expect(modelChoices({ ...claude, defaultModel: { id: 'sonnet', by: 'symbiote' } })[0]).toEqual({
      value: '',
      label: "Symbiote's default (sonnet)",
    });
    // No models read: no choice.
    expect(modelChoices({ kind: 'codex' })).toEqual([]);
  });

  it('keeps a model the agent lists, else its default', () => {
    expect(keptModel('opus', claude)).toBe('opus');
    expect(keptModel('gpt-6-luna', claude)).toBeUndefined();
    expect(keptModel(undefined, codex)).toBeUndefined();
    expect(keptModel('opus', {})).toBeUndefined();
  });

  it("offers the picked model's levels: none for a model that takes none", () => {
    expect(effortChoices(claude, 'claude-opus-4-6').map((c) => c.value)).toEqual([
      '',
      'low',
      'medium',
      'high',
      'max',
    ]);
    expect(effortChoices(claude, 'claude-haiku-4-5-20251001')).toEqual([]);
    expect(effortChoices(codex, 'gpt-5.6-terra')[0]).toEqual({
      value: '',
      label: "Codex's default (high)",
    });
    expect(effortChoices(codex, 'gpt-5.6-terra').at(-1)?.value).toBe('ultra');
    // The default model, or one not listed: the agent's levels, as before.
    expect(effortChoices(claude, undefined)).toEqual(effortChoices(claude));
    expect(keptEffort('xhigh', claude, 'claude-opus-4-6')).toBeUndefined();
    expect(keptEffort('max', claude, 'claude-opus-4-6')).toBe('max');
    expect(keptEffort('low', claude, 'claude-haiku-4-5-20251001')).toBeUndefined();
    expect(keptEffort('ultra', codex, 'gpt-5.6-terra')).toBe('ultra');
  });

  it('keeps a model with its agent in the draft, and a level only when that model takes it', () => {
    const agents = [claude, codex];
    expect(readRun({ model: 'claude-opus-4-6', effort: 'max' }, agents)).toEqual({
      model: 'claude-opus-4-6',
      effort: 'max',
    });
    expect(readRun({ model: 'claude-opus-4-6', effort: 'xhigh' }, agents)).toEqual({
      model: 'claude-opus-4-6',
    });
    expect(readRun({ agent: 'codex', model: 'opus' }, agents)).toEqual({ agent: 'codex' });
    expect(readRun({ agent: 'codex', model: 'gpt-5.6-terra', effort: 'ultra' }, agents)).toEqual({
      agent: 'codex',
      model: 'gpt-5.6-terra',
      effort: 'ultra',
    });
  });
});

describe('readRun (V30b)', () => {
  const agents: AgentOption[] = [
    { kind: 'claude', command: 'claude', efforts: { levels: ['low', 'high', 'max'] } },
    { kind: 'codex', command: 'codex' },
  ];
  it("reads the run's choices a draft kept: an agent installed, a level it lists, a mode, plan first", () => {
    expect(
      readRun(
        { agent: 'claude', effort: 'high', permissionMode: 'auto', planFirst: false },
        agents,
      ),
    ).toEqual({ agent: 'claude', effort: 'high', permissionMode: 'auto', planFirst: false });
    // What no longer holds is left out: the page's defaults take its place.
    expect(readRun({ agent: 'codex', effort: 'high' }, agents)).toEqual({ agent: 'codex' });
    expect(readRun({ agent: 'aider', effort: 'max', permissionMode: 'yolo' }, agents)).toEqual({});
    // No agent picked: the level is the default agent's, the first.
    expect(readRun({ effort: 'max' }, agents)).toEqual({ effort: 'max' });
    expect(readRun({ effort: 'max' }, [...agents].reverse())).toEqual({});
    expect(readRun(null, agents)).toEqual({});
    expect(readRun('run', agents)).toEqual({});
  });

  it('keeps the branch picked to start from while it is listed (V33)', () => {
    const branches = [
      { name: 'main', sha: 'a'.repeat(40) },
      { name: 'topic', sha: 'b'.repeat(40), remote: true as const },
    ];
    expect(readRun({ from: 'topic' }, agents, branches)).toEqual({ from: 'topic' });
    expect(readRun({ from: 'gone' }, agents, branches)).toEqual({});
    expect(readRun({ from: 'topic' }, agents)).toEqual({});
  });
});

describe('startedWith (V30b)', () => {
  const agent = (over: Partial<WorkspaceAgentState>): WorkspaceAgentState => ({
    state: 'working',
    kind: 'claude',
    ...over,
  });
  it('says how the agent was started: the agent, and its level or its default', () => {
    expect(startedWith(agent({ effort: 'high' }))).toBe('Started with Claude Code at high effort.');
    expect(startedWith(agent({ kind: 'codex' }))).toBe('Started with Codex at its default effort.');
    expect(startedWith(agent({ state: 'no-agent', kind: undefined }))).toBeNull();
  });

  it('says it was started through Nucleus or symbiote mcp (MC1)', () => {
    expect(startedWith(agent({ kind: 'codex' }), 'nucleus')).toBe(
      'Started through Nucleus with Codex at its default effort.',
    );
    expect(startedWith(agent({ effort: 'low' }), 'mcp')).toBe(
      'Started through symbiote mcp with Claude Code at low effort.',
    );
  });

  it('says the model it was started on (V47)', () => {
    expect(startedWith(agent({ effort: 'high', model: 'sonnet' }))).toBe(
      'Started with Claude Code on sonnet at high effort.',
    );
    expect(startedWith(agent({ kind: 'codex', model: 'gpt-5.6-luna' }))).toBe(
      'Started with Codex on gpt-5.6-luna at its default effort.',
    );
  });
});

describe('proposeBranch', () => {
  const none = new Set<string>();
  it("names a branch after the brief's first line: five words, at most 40 characters", () => {
    expect(proposeBranch('Export a review as CSV\n\nOne row per comment.', 'feature/', none)).toBe(
      'feature/export-a-review-as-csv',
    );
    expect(proposeBranch("  Fix: the HEAD chip's colour (dark mode)!", 'feature/', none)).toBe(
      'feature/fix-the-head-chips-colour',
    );
    expect(proposeBranch('Café über naïve', '', none)).toBe('cafe-uber-naive');
    expect(
      proposeBranch('Internationalization accessibility internationalization more', 'f/', none),
    ).toBe('f/internationalization-accessibility');
    expect(proposeBranch('!!!', 'feature/', none)).toBe('feature/new');
    expect(proposeBranch('', 'feature/', none)).toBe('feature/new');
  });

  it('numbers a name that is taken', () => {
    const taken = new Set(['feature/csv', 'feature/csv-2']);
    expect(proposeBranch('CSV', 'feature/', taken)).toBe('feature/csv-3');
  });
});

describe('branchProblem', () => {
  const taken = new Set(['main', 'feature/csv']);
  it('says why a name cannot be a new branch, as git would', () => {
    expect(branchProblem('feature/new', taken)).toBeNull();
    expect(branchProblem('', taken)).toBe('a branch needs a name');
    expect(branchProblem('-x', taken)).toBe('a branch name cannot start with -');
    expect(branchProblem('feature/csv', taken)).toBe('a branch feature/csv exists');
    for (const bad of [
      'a b',
      'a..b',
      'a~b',
      'a^b',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a\\b',
      'a//b',
      '/a',
      'a/',
      'a.',
      'a/.b',
      'a.lock',
      'a/b.lock/c',
      'a@{b',
      '@',
      'feature/',
    ]) {
      expect(branchProblem(bad, taken), bad).toBe(`not a valid branch name: ${bad}`);
    }
  });
});

describe('startedNotice', () => {
  const workspace: WorkspaceSummary = {
    branch: 'feature/csv',
    base: 'c'.repeat(40),
    from: 'main',
    created: '2026-10-15T09:00:00.000Z',
    planFirst: true,
    brief: 'CSV',
    worktree: { path: '/work/app.worktrees/feature-csv', exists: true },
    tip: 'c'.repeat(40),
    ahead: 0,
    merged: false,
    agent: { state: 'working', kind: 'claude', id: 's1' },
  };
  const start = (agent: WorkspaceSummary['agent']): WorkspaceStart => ({
    workspace: { ...workspace, agent },
    prompt: 'Build it.',
  });
  it('says where the workspace is and whether its agent started', () => {
    expect(startedNotice(start(workspace.agent))).toEqual({
      text: 'Started feature/csv: Claude Code is working in /work/app.worktrees/feature-csv.',
    });
    expect(
      startedNotice(
        start({ state: 'not-started', kind: 'claude', error: 'Workspace not trusted.' }),
      ),
    ).toEqual({
      text: 'Made feature/csv in /work/app.worktrees/feature-csv, but Claude Code did not start.',
      warning: 'Workspace not trusted.',
      copy: 'Build it.',
    });
    expect(startedNotice(start({ state: 'no-agent' }))).toEqual({
      text:
        'Made feature/csv in /work/app.worktrees/feature-csv. No agent was found to start: ' +
        'give it the prompt.',
      copy: 'Build it.',
    });
  });

  it('names the agent that was started (V20a)', () => {
    expect(startedNotice(start({ state: 'working', kind: 'codex' }))).toEqual({
      text: 'Started feature/csv: Codex is working in /work/app.worktrees/feature-csv.',
    });
    expect(
      startedNotice(
        start({ state: 'not-started', kind: 'codex', error: 'Codex is not logged in' }),
      ),
    ).toEqual({
      text: 'Made feature/csv in /work/app.worktrees/feature-csv, but Codex did not start.',
      warning: 'Codex is not logged in',
      copy: 'Build it.',
    });
  });
});

describe('talkCommand (V20a)', () => {
  it("is the command that continues the agent's session in a terminal", () => {
    expect(talkCommand({ state: 'ready', kind: 'claude', id: 's1' }, '/w/x')).toBe(
      'claude attach s1',
    );
    expect(talkCommand({ state: 'ready', kind: 'codex', id: 'T1' }, '/w/feature-csv')).toBe(
      'codex resume T1 -C /w/feature-csv',
    );
    expect(talkCommand({ state: 'ready', kind: 'codex', id: 'T1' }, "/my work/it's")).toBe(
      "codex resume T1 -C '/my work/it'\\''s'",
    );
    expect(talkCommand({ state: 'no-agent' }, '/w/x')).toBeNull();
    expect(talkCommand({ state: 'working', kind: 'codex' }, '/w/x')).toBeNull();
  });

  it("joins Codex's thread on its app server: the TUI there, its turns in the thread (V27a)", () => {
    const remote = 'unix:///home/someone/.codex/app-server-control/app-server-control.sock';
    expect(talkCommand({ state: 'ready', kind: 'codex', id: 'T1', remote }, '/w/feature-csv')).toBe(
      `codex resume T1 --remote ${remote} -C /w/feature-csv`,
    );
    expect(
      talkCommand({ state: 'ready', kind: 'codex', id: 'T1', remote: 'unix:///my socket' }, '/w'),
    ).toBe("codex resume T1 --remote 'unix:///my socket' -C /w");
  });

  it("continues Hermes's session: it goes back to the session's own folder (V58)", () => {
    expect(
      talkCommand({ state: 'stopped', kind: 'hermes', id: '20261026_101430_6ffcdc' }, '/w'),
    ).toBe('hermes --resume 20261026_101430_6ffcdc');
    expect(talkCommand({ state: 'working', kind: 'hermes' }, '/w')).toBeNull();
  });
});

const TIP = 'b'.repeat(40);
const summary = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  branch: 'feature/csv',
  base: 'a'.repeat(40),
  from: 'main',
  created: '2026-10-15T09:00:00.000Z',
  planFirst: true,
  brief: 'Export a review as CSV\n\nOne row per comment.',
  worktree: { path: '/work/app.worktrees/feature-csv', exists: true, changed: 0 },
  tip: TIP,
  ahead: 0,
  merged: false,
  agent: { state: 'working', kind: 'claude', id: 's1' },
  ...over,
});
const review = (over: Partial<BranchReviewSummary> = {}): BranchReviewSummary => ({
  branch: 'feature/csv',
  base: 'a'.repeat(40),
  head: TIP,
  updated: '2026-10-15T10:00:00Z',
  marks: 3,
  refs: [{ name: 'feature/csv', tip: TIP, since: 0 }],
  added: [],
  ...over,
});
const verdict = (event: 'approve' | 'request-changes' | 'comment', head = TIP) => ({
  event,
  head,
  at: '2026-10-15T10:00:00Z',
  comments: 1,
  merged: false,
});

describe('workspaceNext', () => {
  const next = (f: Partial<WorkspaceSummary>, r?: Partial<BranchReviewSummary>) => {
    const { group, text, chip } = workspaceNext(summary(f), r ? review(r) : undefined);
    return { group, text, mark: chip.mark };
  };

  it("says what each workspace needs from the person, by its agent's state", () => {
    expect(next({})).toEqual({ group: 'working', text: 'Working', mark: '⚙' });
    expect(
      next({ agent: { state: 'needs-you', kind: 'claude', waitingFor: 'permission prompt' } }),
    ).toEqual({ group: 'waiting', text: 'Waiting: permission prompt', mark: '?' });
    expect(next({ agent: { state: 'needs-you', kind: 'claude', interrupted: true } })).toEqual({
      group: 'waiting',
      text: 'Interrupted: waiting for you',
      mark: '?',
    });
    expect(next({ agent: { state: 'plan-ready', kind: 'claude' } })).toEqual({
      group: 'waiting',
      text: 'Plan ready: read it and answer',
      mark: '?',
    });
    expect(next({ agent: { state: 'failed', kind: 'claude' } })).toEqual({
      group: 'stopped',
      text: 'Its agent failed',
      mark: '!',
    });
    // Codex's words, when the run said why (V20a).
    expect(
      next({ agent: { state: 'failed', kind: 'codex', error: 'unexpected status 401\nmore' } }),
    ).toEqual({ group: 'stopped', text: 'Its agent failed: unexpected status 401', mark: '!' });
    expect(
      next({
        agent: { state: 'not-started', kind: 'claude', error: 'Workspace not trusted.\nMore' },
      }),
    ).toEqual({ group: 'stopped', text: 'Not started: Workspace not trusted.', mark: '!' });
    expect(next({ agent: { state: 'no-agent' } })).toEqual({
      group: 'stopped',
      text: 'No agent: give it the prompt',
      mark: '!',
    });
    expect(next({ agent: { state: 'unknown', kind: 'claude', error: 'no list' } })).toEqual({
      group: 'stopped',
      text: "Its agent's state is unknown: no list",
      mark: '·',
    });
    // V48: finished without commits is work to look at, not a stop.
    expect(next({ agent: { state: 'done', kind: 'claude' }, planFirst: false })).toEqual({
      group: 'review',
      text: 'Finished without commits',
      mark: '●',
    });
    expect(next({ agent: { state: 'stopped', kind: 'claude' } })).toEqual({
      group: 'stopped',
      text: 'Stopped',
      mark: '·',
    });
    expect(next({ agent: { state: 'not-running', kind: 'claude' } })).toEqual({
      group: 'stopped',
      text: 'Not running',
      mark: '·',
    });
  });

  it('once it has commits, by its review', () => {
    const done = { agent: { state: 'ready' as const, kind: 'claude' as const }, ahead: 3 };
    expect(next(done)).toEqual({ group: 'review', text: 'Ready for review', mark: '●' });
    expect(next(done, { verdict: verdict('request-changes') }).text).toBe(
      'Changes requested: send them to the agent',
    );
    expect(next(done, { verdict: verdict('comment') }).text).toBe(
      'Commented: send it to the agent',
    );
    expect(next(done, { verdict: verdict('approve') }).text).toBe(
      'Approved: ask your agent to merge it',
    );
    expect(
      next(done, {
        verdict: verdict('request-changes', 'c'.repeat(40)),
        refs: [{ name: 'feature/csv', tip: TIP, since: 2 }],
      }).text,
    ).toBe('2 commits since your review: review again');
    expect(next(done, {}).text).toBe('Review in progress');
    // Stopped with commits: they are to review.
    expect(next({ ...done, agent: { state: 'stopped', kind: 'claude' } }).group).toBe('review');
    // Still working: its review waits.
    expect(next({ ahead: 3 }, { verdict: verdict('request-changes') }).group).toBe('working');
  });

  it('is done once merged; a branch gone needs cleaning up', () => {
    expect(next({ ahead: 3, merged: true, agent: { state: 'ready', kind: 'claude' } })).toEqual({
      group: 'done',
      text: 'Merged',
      mark: '✓',
    });
    expect(next({ tip: null, agent: { state: 'not-running', kind: 'claude' } })).toEqual({
      group: 'stopped',
      text: 'Its branch is gone',
      mark: '!',
    });
  });

  // V48: what a waiting agent asks, from the list's activity, in the thread's words.
  describe('blocked', () => {
    const blocked = (f: Partial<WorkspaceSummary>) => workspaceNext(summary(f)).blocked;
    const asks = (tool: string, input: unknown): WorkspaceSummary['activity'] => ({
      since: '2026-10-15T09:05:00.000Z',
      asks: {
        at: '2026-10-15T09:05:00.000Z',
        session: 's1',
        kind: 'asks',
        tool,
        input: JSON.stringify(input),
      },
    });
    const waiting = { state: 'needs-you' as const, kind: 'claude' as const };

    it('says the permission it waits for: a command, a file in its worktree, a tool', () => {
      expect(
        blocked({ agent: waiting, activity: asks('Bash', { command: 'pnpm test -- --run' }) }),
      ).toBe('Permission to run pnpm test -- --run');
      expect(
        blocked({
          agent: waiting,
          activity: asks('Edit', { file_path: '/work/app.worktrees/feature-csv/src/a.ts' }),
        }),
      ).toBe('Permission to edit src/a.ts');
      expect(blocked({ agent: waiting, activity: asks('WebFetch', { url: 'x' }) })).toBe(
        'Permission to use WebFetch',
      );
    });

    it('says the question it asks, with its options', () => {
      expect(
        blocked({
          agent: waiting,
          activity: {
            asks: {
              at: '2026-10-15T09:05:00.000Z',
              session: 's1',
              kind: 'asks',
              tool: 'AskUserQuestion',
              questions: [{ question: 'Which store?', options: ['Redis', 'SQLite'] }],
            },
          },
        }),
      ).toBe('Asks: Which store? — Redis · SQLite');
    });

    it('else its last message while it waits (Codex); a plan says only that it is ready', () => {
      const at = '2026-10-15T09:05:00.000Z';
      const report = { at, text: 'May I run it outside the sandbox?' };
      expect(
        blocked({
          agent: { state: 'needs-you', kind: 'codex', waitingFor: 'approval prompt' },
          activity: { since: at, report },
        }),
      ).toBe('May I run it outside the sandbox?');
      // A plan's first line is mostly its heading: "Plan ready: read it and answer" says more.
      expect(
        blocked({
          agent: { state: 'plan-ready', kind: 'claude' },
          activity: { since: at, report: { ...report, text: '# Plan' } },
        }),
      ).toBeUndefined();
      // A report from an earlier turn is not what it waits on now.
      expect(
        blocked({
          agent: { state: 'needs-you', kind: 'claude', waitingFor: 'permission prompt' },
          activity: { since: '2026-10-15T09:20:00.000Z', report },
        }),
      ).toBeUndefined();
      expect(blocked({ agent: waiting, activity: { report } })).toBeUndefined();
    });

    it('nothing when nothing was recorded, or when it does not wait', () => {
      expect(blocked({ agent: { ...waiting, interrupted: true } })).toBeUndefined();
      expect(blocked({ agent: waiting })).toBeUndefined();
      expect(
        blocked({ agent: { state: 'working', kind: 'claude' }, activity: asks('Bash', {}) }),
      ).toBeUndefined();
    });
  });

  // V48f: what a working agent does, from its recorded tools.
  describe('doing', () => {
    const doing = (activity: WorkspaceSummary['activity'], state = 'working' as const) =>
      workspaceNext(summary({ agent: { state, kind: 'claude' }, activity })).doing;
    const since = '2026-10-15T09:05:00.000Z';

    it('says the tool running, in words, with what it works on', () => {
      expect(doing({ doing: { tool: 'Bash', subject: 'pnpm test' } })).toBe('Running pnpm test');
      expect(doing({ doing: { tool: 'Edit', subject: 'src/auth.ts' } })).toBe(
        'Editing src/auth.ts',
      );
      expect(doing({ doing: { thinking: true } })).toBe('Thinking');
    });

    it("a command without its leading cd to the worktree, the worktree's paths short (V73)", () => {
      const worktree = summary({}).worktree.path;
      expect(doing({ doing: { tool: 'Bash', subject: `cd ${worktree} && pnpm check` } })).toBe(
        'Running pnpm check',
      );
    });

    it('nothing while it does not work, or without recorded tools', () => {
      expect(doing({ doing: { thinking: true } }, 'needs-you' as 'working')).toBeUndefined();
      expect(doing({ since })).toBeUndefined();
      expect(doing(undefined)).toBeUndefined();
    });
  });
});

describe('activityText (V48f)', () => {
  it("says each agent's tools as the page shows them", () => {
    const say = (tool: string, subject?: string) =>
      activityText(subject === undefined ? { tool } : { tool, subject });
    expect(say('Bash', 'pnpm test')).toBe('Running pnpm test');
    expect(say('Bash')).toBe('Running a command');
    expect(say('Edit', 'src/a.ts')).toBe('Editing src/a.ts');
    expect(say('MultiEdit', 'src/a.ts')).toBe('Editing src/a.ts');
    expect(say('NotebookEdit', 'n.ipynb')).toBe('Editing n.ipynb');
    expect(say('Write', 'src/b.ts')).toBe('Writing src/b.ts');
    expect(say('Read', 'src/c.ts')).toBe('Reading src/c.ts');
    expect(say('Grep', 'parseToken')).toBe('Searching for parseToken');
    expect(say('Glob', 'src/**/*.ts')).toBe('Finding files: src/**/*.ts');
    expect(say('WebFetch', 'https://docs.rs')).toBe('Fetching https://docs.rs');
    expect(say('WebSearch', 'pino async')).toBe('Searching the web: pino async');
    expect(say('Task', 'find callers')).toBe('Running a subagent: find callers');
    expect(say('Agent', 'find callers')).toBe('Running a subagent: find callers');
    expect(say('TodoWrite')).toBe('Updating its to-do list');
    expect(say('mcp__symbiote__review')).toBe('Using mcp__symbiote__review');
    // Codex's items (V48f): the runner's and the app server's.
    expect(say('command', 'cargo test')).toBe('Running cargo test');
    expect(say('fileChange', 'src/lib.rs')).toBe('Editing src/lib.rs');
    expect(say('webSearch', 'rust tokio')).toBe('Searching the web: rust tokio');
    expect(say('mcp', 'github.search')).toBe('Using github.search');
  });
});

describe('workspaceGroups', () => {
  it('groups workspaces by what they need, the reviews matched by branch', () => {
    const groups = workspaceGroups(
      [
        summary({ branch: 'feature/a' }),
        summary({ branch: 'feature/b', agent: { state: 'plan-ready', kind: 'claude' } }),
        summary({ branch: 'feature/c', ahead: 1, merged: true }),
        summary({ branch: 'feature/d', ahead: 2, agent: { state: 'ready', kind: 'claude' } }),
        summary({ branch: 'feature/e', agent: { state: 'failed', kind: 'codex' } }),
        summary({ branch: 'feature/f', agent: { state: 'needs-you', kind: 'codex' } }),
      ],
      {
        defaultBranch: 'main',
        reviewer: 'ada@example.com',
        place: 'repository',
        reviews: [review({ branch: 'feature/d', refs: [], verdict: verdict('request-changes') })],
      },
    );
    const named = (rows: { workspace: WorkspaceSummary }[]) => rows.map((r) => r.workspace.branch);
    expect(groups.waiting.map((r) => [r.workspace.branch, r.next.text])).toEqual([
      ['feature/b', 'Plan ready: read it and answer'],
      ['feature/f', 'Waiting: for you'],
    ]);
    expect(groups.review.map((r) => [r.workspace.branch, r.next.text])).toEqual([
      ['feature/d', 'Changes requested: send them to the agent'],
    ]);
    expect(named(groups.stopped)).toEqual(['feature/e']);
    expect(named(groups.working)).toEqual(['feature/a']);
    expect(named(groups.done)).toEqual(['feature/c']);
  });
});

describe('cleanableOnCard (V55)', () => {
  it("offers Clean up on a card only once its workspace is merged: the Done group's", () => {
    const groups = workspaceGroups(
      [
        summary({ branch: 'feature/a' }),
        summary({ branch: 'feature/b', agent: { state: 'plan-ready', kind: 'claude' } }),
        summary({ branch: 'feature/c', ahead: 1, merged: true }),
        summary({ branch: 'feature/d', ahead: 2, agent: { state: 'ready', kind: 'claude' } }),
        summary({ branch: 'feature/e', agent: { state: 'stopped', kind: 'claude' } }),
        // Merged while its agent still works: done all the same.
        summary({ branch: 'feature/f', ahead: 1, merged: true }),
        // Its branch is gone: not merged, nothing to say it is done.
        summary({ branch: 'feature/g', tip: null }),
      ],
      null,
    );
    expect(
      allRows(groups)
        .filter(cleanableOnCard)
        .map((r) => r.workspace.branch),
    ).toEqual(['feature/c', 'feature/f']);
  });
});

describe('workspaceNext for a workspace Hive drives (HV2)', () => {
  const next = (f: Partial<WorkspaceSummary>, r?: Partial<BranchReviewSummary>) => {
    const { group, text, chip } = workspaceNext(summary(f), r ? review(r) : undefined);
    return { group, text, mark: chip.mark };
  };
  const hive = (over: Partial<WorkspaceHive> = {}): WorkspaceHive => ({
    step: 'writing',
    round: 1,
    rounds: 3,
    ...over,
  });
  const ready = { agent: { state: 'ready' as const, kind: 'claude' as const }, ahead: 2 };

  it("says Hive's step while Hive works, and the writer's own states otherwise", () => {
    // The writer at work, or waiting on the person: as any workspace.
    expect(next({ hive: hive() })).toEqual({ group: 'working', text: 'Working', mark: '⚙' });
    expect(next({ hive: hive(), agent: { state: 'plan-ready', kind: 'claude' } }).text).toBe(
      'Plan ready: read it and answer',
    );
    // Its turn ended: Hive's to act on, not the person's to review.
    expect(next({ ...ready, hive: hive() })).toEqual({
      group: 'working',
      text: 'Hive: reading its turn',
      mark: '⚙',
    });
    // The round is the card's fact (2/3), not its words.
    expect(next({ ...ready, hive: hive({ step: 'checking', round: 2 }) })).toEqual({
      group: 'working',
      text: 'Hive: running the check',
      mark: '⚙',
    });
    // Hive's words are Symbiote's: no agent's mark before them; the writer's are its agent's.
    expect(workspaceNext(summary({ ...ready, hive: hive({ step: 'checking' }) })).hive).toBe(true);
    expect(workspaceNext(summary({ hive: hive() })).hive).toBeUndefined();
  });

  it('asks the person to land it once checked, and says why Hive stopped', () => {
    const checked = hive({ step: 'landing', check: { round: 1, at: TIP, ok: true, ms: 1 } });
    expect(next({ ...ready, hive: checked })).toEqual({
      group: 'review',
      text: 'Checked: review and land it',
      mark: '●',
    });
    // A review in progress or a verdict says what is next, as for any workspace.
    expect(next({ ...ready, hive: checked }, { verdict: verdict('approve') }).text).toBe(
      'Approved: ask your agent to merge it',
    );
    expect(
      next({ ...ready, hive: hive({ step: 'landing', note: 'no check is set or found' }) }).text,
    ).toBe('No check ran: review, check and land it');
    expect(
      next({
        ...ready,
        hive: hive({ step: 'stuck', round: 3, note: 'the check failed 3 times: pnpm check' }),
      }),
    ).toEqual({
      group: 'waiting',
      text: 'Hive stopped: the check failed 3 times: pnpm check',
      mark: '?',
    });
  });

  it('says Hive off has paused it, unless the person goes on with the writer', () => {
    const stopped = { agent: { state: 'stopped' as const, kind: 'claude' as const } };
    expect(next({ ...stopped, hive: hive({ paused: true }) })).toEqual({
      group: 'stopped',
      text: 'Hive off: paused',
      mark: '·',
    });
    expect(next({ ...ready, hive: hive({ step: 'checking', paused: true }) })).toEqual({
      group: 'stopped',
      text: 'Hive off: paused before the check',
      mark: '·',
    });
    expect(next({ hive: hive({ paused: true }) }).text).toBe('Working');
  });
});

describe('workspaceFacts (V79)', () => {
  const facts = (
    over: Partial<WorkspaceSummary>,
    merge: Parameters<typeof workspaceFacts>[1] = null,
  ) => workspaceFacts(summary(over), merge);

  it('says its commits, its files not committed and a worktree gone: on the card a number, in the head words', () => {
    expect(facts({})).toEqual([{ kind: 'commits', shown: '0', words: 'no commits yet' }]);
    expect(facts({ ahead: 3, worktree: { path: '/w', exists: true, changed: 1 } })).toEqual([
      { kind: 'commits', shown: '3', words: '3 commits' },
      { kind: 'changed', shown: '1', words: '1 file not committed yet' },
    ]);
    expect(facts({ ahead: 1, worktree: { path: '/w', exists: false, changed: 0 } })).toEqual([
      { kind: 'commits', shown: '1', words: '1 commit' },
      { kind: 'gone', shown: 'worktree gone', words: 'its worktree is gone' },
    ]);
  });

  it('says the merge check last: clean, or how many files conflict', () => {
    expect(facts({ ahead: 2 }, { into: 'main', clean: true }).at(-1)).toEqual({
      kind: 'clean',
      shown: 'clean',
      words: 'Merges cleanly into main',
    });
    expect(facts({ ahead: 2 }, { into: 'main', conflicts: ['a.ts'] }).at(-1)).toEqual({
      kind: 'conflicts',
      shown: '1 conflict',
      words: 'Conflicts with main in 1 file',
    });
    expect(facts({ ahead: 2 }, { into: 'dev', conflicts: ['a.ts', 'b.ts'] }).at(-1)).toEqual({
      kind: 'conflicts',
      shown: '2 conflicts',
      words: 'Conflicts with dev in 2 files',
    });
    // A check git could not make says nothing.
    expect(facts({ ahead: 2 }, { into: 'main', error: 'no merge base' })).toHaveLength(1);
  });

  it('says first that Hive drives it, and its round (HV2)', () => {
    expect(facts({ hive: { step: 'writing', round: 2, rounds: 3 } })[0]).toEqual({
      kind: 'hive',
      shown: '2/3',
      words: 'Hive drives it: round 2 of 3',
    });
    expect(facts({ hive: { step: 'writing', round: 1, rounds: 3, paused: true } })[0]).toEqual({
      kind: 'hive',
      shown: 'off',
      words: 'Hive is off: its step waits',
    });
  });
});

describe('workspaceName (V24c)', () => {
  it("is the workspace's title; before V24, its brief's first line; else its branch", () => {
    expect(
      workspaceName(summary({ kind: 'fix', title: 'Dates sort as text', brief: '# Fix: …' })),
    ).toBe('Dates sort as text');
    expect(workspaceName(summary())).toBe('Export a review as CSV');
    expect(workspaceName(summary({ brief: '\n  \n' }))).toBe('feature/csv');
  });

  it("titles a branch's chip with the workspace's name", () => {
    const chips = workspaceChips([summary({ kind: 'fix', title: 'Dates' })], null, []);
    expect(chips.get('feature/csv')?.title).toBe('Workspace: Dates — Working');
  });
});

describe('workspaceChips', () => {
  it("marks a workspace's branch, local and pushed, with a link to the workspace", () => {
    const chips = workspaceChips(
      [summary(), summary({ branch: 'feature/gone', tip: null })],
      null,
      [
        { name: 'origin/feature/csv', branch: 'feature/csv' },
        { name: 'origin/other', branch: 'other' },
      ],
    );
    expect([...chips.keys()]).toEqual(['feature/csv', 'origin/feature/csv']);
    expect(chips.get('feature/csv')).toEqual({
      mark: '⚙',
      tone: 'working',
      title: 'Workspace: Export a review as CSV — Working',
      href: '/?branch=feature%2Fcsv',
    });
  });
});

describe('workspacesFirst', () => {
  const at = (hour: number) => `2026-10-18T${hour}:00:00.000Z`;
  it("lists the workspaces that need you, then working ones, each by its agent's last action, newest first (V23)", () => {
    const first = workspacesFirst(
      [
        summary({ branch: 'feature/working-older', lastAction: at(10) }),
        summary({
          branch: 'feature/plan',
          agent: { state: 'plan-ready', kind: 'claude' },
          lastAction: at(11),
        }),
        summary({
          branch: 'feature/asks',
          agent: { state: 'needs-you', kind: 'claude', waitingFor: 'permission prompt' },
          lastAction: at(13),
        }),
        summary({ branch: 'feature/working-newer', lastAction: at(12) }),
        // Nothing to do for the person: merged, or its branch gone (no entry to sort).
        summary({ branch: 'feature/merged', ahead: 1, merged: true, lastAction: at(14) }),
        summary({ branch: 'feature/gone', tip: null, lastAction: at(15) }),
        // No agent was found: when the workspace was made.
        summary({ branch: 'feature/no-agent', agent: { state: 'no-agent' }, created: at(12) }),
        // The same time: by name.
        summary({
          branch: 'feature/also-plan',
          agent: { state: 'plan-ready', kind: 'claude' },
          lastAction: at(11),
        }),
      ],
      null,
    );
    expect(first).toEqual([
      { branch: 'feature/asks', at: at(13) },
      { branch: 'feature/no-agent', at: at(12) },
      { branch: 'feature/also-plan', at: at(11) },
      { branch: 'feature/plan', at: at(11) },
      { branch: 'feature/working-newer', at: at(12) },
      { branch: 'feature/working-older', at: at(10) },
    ]);
    expect(workspacesFirst([], null)).toEqual([]);
  });
});

describe('shortAge', () => {
  it('says how long ago in a few characters', () => {
    const now = Date.parse('2026-10-18T14:00:00.000Z');
    expect(shortAge('2026-10-18T13:59:30.000Z', now)).toBe('now');
    expect(shortAge('2026-10-18T14:00:05.000Z', now)).toBe('now');
    expect(shortAge('2026-10-18T13:56:00.000Z', now)).toBe('4m');
    expect(shortAge('2026-10-18T13:00:01.000Z', now)).toBe('59m');
    expect(shortAge('2026-10-18T12:00:00.000Z', now)).toBe('2h');
    expect(shortAge('2026-10-15T14:00:00.000Z', now)).toBe('3d');
    expect(shortAge('2026-08-01T14:00:00.000Z', now)).toBe('78d');
  });
});

describe('threadItems', () => {
  const at = (n: number) => `2026-10-15T09:0${n}:00.000Z`;
  /** An entry without its time and session (`Omit` taken over each kind). */
  type Body<T> = T extends unknown ? Omit<T, 'at' | 'session'> : never;
  const e = (n: number, entry: Body<ThreadEntry>, session = 's1') => ({
    at: at(n),
    session,
    ...entry,
  });

  it("shows Symbiote's prompt, the agent's reports, the person's messages, and what the agent waits on", () => {
    const items = threadItems(
      [
        e(0, { kind: 'start', source: 'startup' }),
        e(0, { kind: 'prompt', text: 'You are starting a new feature…' }),
        e(1, {
          kind: 'asks',
          tool: 'AskUserQuestion',
          questions: [{ question: 'End with !?', options: ['Yes', 'No'] }],
        }),
        e(2, { kind: 'report', text: 'The plan' }),
        e(2, { kind: 'notice', type: 'idle_prompt', message: 'Claude is waiting for your input' }),
        e(2, { kind: 'end', reason: 'other' }),
        e(3, { kind: 'start', source: 'resume' }),
        e(3, { kind: 'prompt', text: 'OK, go ahead.' }),
        e(4, {
          kind: 'asks',
          tool: 'Edit',
          input: JSON.stringify({ file_path: '/w/app.worktrees/x/src/greet.js' }),
        }),
        e(5, {
          kind: 'asks',
          tool: 'Bash',
          input: JSON.stringify({ command: 'git commit -m "Add farewell"' }),
        }),
        e(6, { kind: 'start', source: 'fork' }, 's2'),
        e(6, { kind: 'asks', tool: 'WebFetch', input: '{"url":"https://example.com"}' }, 's2'),
      ],
      '/w/app.worktrees/x',
    );
    expect(items).toEqual([
      { who: 'symbiote', at: at(0), text: 'You are starting a new feature…' },
      { who: 'waits', at: at(1), text: 'Asks: End with !? — Yes · No' },
      { who: 'agent', at: at(2), text: 'The plan' },
      { who: 'line', at: at(3), text: 'Continued' },
      { who: 'you', at: at(3), text: 'OK, go ahead.' },
      { who: 'waits', at: at(4), text: 'Waiting: permission to edit src/greet.js' },
      { who: 'waits', at: at(5), text: 'Waiting: permission to run git commit -m "Add farewell"' },
      { who: 'line', at: at(6), text: 'A copy of the session started' },
      { who: 'waits', at: at(6), text: 'Waiting: permission to use WebFetch' },
    ]);
  });

  it('says a later fresh start, and keeps a broken input readable', () => {
    expect(
      threadItems([
        e(0, { kind: 'start', source: 'startup' }),
        e(1, { kind: 'start', source: 'startup' }, 's2'),
        e(1, { kind: 'asks', tool: 'Bash', input: '{"command":"npm run' }, 's2'),
      ]),
    ).toEqual([
      { who: 'line', at: at(1), text: 'Started again' },
      { who: 'waits', at: at(1), text: 'Waiting: permission to use Bash' },
    ]);
  });
});

describe('replyMode', () => {
  const agent = (over: Partial<WorkspaceAgentState>): WorkspaceAgentState => ({
    state: 'working',
    kind: 'claude',
    id: 's1',
    ...over,
  });
  it('sends to an agent that finished or waits for an answer; asks first when that ends its turn', () => {
    expect(replyMode(agent({ state: 'plan-ready' }))).toBe('send');
    expect(replyMode(agent({ state: 'ready' }))).toBe('send');
    expect(replyMode(agent({ state: 'done' }))).toBe('send');
    expect(replyMode(agent({ state: 'stopped' }))).toBe('send');
    expect(replyMode(agent({ state: 'failed' }))).toBe('send');
    expect(replyMode(agent({ state: 'needs-you' }))).toBe('send');
    expect(replyMode(agent({ state: 'needs-you', interrupted: true }))).toBe('send');
    expect(replyMode(agent({ state: 'working' }))).toBe('stop-and-send');
    expect(replyMode(agent({ state: 'needs-you', waitingFor: 'permission prompt' }))).toBe(
      'stop-and-send',
    );
    // No session to continue.
    for (const state of ['not-running', 'not-started', 'no-agent', 'unknown'] as const) {
      expect(replyMode(agent({ state }))).toBe('none');
    }
  });

  it('sends to Codex on its app server while it works: the message joins its turn (V27a)', () => {
    const codex = (over: Partial<WorkspaceAgentState>) =>
      agent({ kind: 'codex', remote: 'unix:///s.sock', ...over });
    expect(replyMode(codex({ state: 'working' }))).toBe('send');
    expect(replyMode(codex({ state: 'needs-you', waitingFor: 'approval prompt' }))).toBe(
      'stop-and-send',
    );
    // Through Symbiote's runner (V20a), a message still stops its run.
    expect(replyMode(agent({ kind: 'codex', state: 'working' }))).toBe('stop-and-send');
  });
});

describe('verdictToSend', () => {
  const verdict = {
    at: '2026-10-15T10:00:00.000Z',
    event: 'request-changes' as const,
    head: 'c'.repeat(40),
    text: 'Address this review…',
  };
  const thread = (entries: ThreadEntry[], withVerdict = true): WorkspaceThread => ({
    entries,
    recorded: true,
    ...(withVerdict ? { verdict } : {}),
  });
  const prompt = (at: string): ThreadEntry => ({ at, session: 's', kind: 'prompt', text: 'x' });
  it('offers a verdict newer than the last message the agent got', () => {
    expect(verdictToSend(thread([prompt('2026-10-15T09:00:00.000Z')]))).toBe(verdict);
    expect(verdictToSend(thread([prompt('2026-10-15T10:05:00.000Z')]))).toBeNull();
    expect(verdictToSend(thread([], false))).toBeNull();
    expect(verdictToSend(null)).toBeNull();
  });
});

describe("the agent's terminal in its panel (V21, V27b)", () => {
  const remote = 'unix:///home/someone/.codex/app-server-control/app-server-control.sock';
  const claude: WorkspaceAgentState = { state: 'ready', kind: 'claude', id: 's1' };
  const codex: WorkspaceAgentState = { state: 'ready', kind: 'codex', id: 'T1', remote };
  const hermes: WorkspaceAgentState = {
    state: 'ready',
    kind: 'hermes',
    id: '20261026_101430_6ffcdc',
  };
  const here = { available: true } as const;

  it("opens on Claude Code's session, and on Codex's thread on its app server", () => {
    expect(opensTerminal(claude, here)).toBe(true);
    expect(opensTerminal(codex, here)).toBe(true);
    // Through Symbiote's runner (V20a), Codex has no terminal; no session, no terminal.
    expect(opensTerminal({ ...codex, remote: undefined }, here)).toBe(false);
    expect(opensTerminal({ state: 'not-started', kind: 'codex' }, here)).toBe(false);
    expect(opensTerminal(claude, { available: false, reason: 'node-pty is not installed' })).toBe(
      false,
    );
    expect(opensTerminal(claude, undefined)).toBe(false);
  });

  it('opens on Hermes: the one it runs before its session is stored, or its session (V58)', () => {
    expect(opensTerminal(hermes, here)).toBe(true);
    expect(opensTerminal({ state: 'working', kind: 'hermes' }, here)).toBe(true);
    // Nothing to open: it did not start, or ended before a word.
    expect(opensTerminal({ state: 'not-started', kind: 'hermes', error: 'x' }, here)).toBe(false);
    expect(opensTerminal({ state: 'failed', kind: 'hermes', error: 'x' }, here)).toBe(false);
    expect(opensTerminal(hermes, { available: false, reason: 'node-pty is not installed' })).toBe(
      false,
    );
  });

  it("asks first only where opening restarts Claude Code's stopped session", () => {
    expect(asksBeforeOpening({ ...claude, state: 'stopped' })).toBe(true);
    expect(asksBeforeOpening(claude)).toBe(false);
    // Joining a stopped Codex thread starts nothing.
    expect(asksBeforeOpening({ ...codex, state: 'stopped' })).toBe(false);
    // Hermes's stopped session continues in a Hermes started again, with no turn (V58).
    expect(asksBeforeOpening({ ...hermes, state: 'stopped' })).toBe(true);
    expect(asksBeforeOpening(hermes)).toBe(false);
  });

  it("says each agent's own way around its terminal", () => {
    expect(terminalHint(claude)).toBe('← in an empty prompt lists all your agents');
    expect(terminalHint(codex)).toBe("? in an empty prompt lists Codex's keys");
    expect(terminalHint(hermes)).toBe("/help in its prompt lists Hermes's commands");
  });
});
