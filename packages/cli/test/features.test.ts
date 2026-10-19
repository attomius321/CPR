import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { listRefs, openRepo, type FeatureRequest, type WorkKind } from '@cpr/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import {
  agentState,
  briefOf,
  claudeCode,
  featureBase,
  featurePath,
  featurePrompt,
  features,
  FeatureRefused,
  parseAccount,
  parseSessions,
  readFeature,
  readFeatureConfig,
  serializeFeature,
  workKinds,
  worktreeFolder,
  type AgentSession,
  type ClaudeCode,
  type FeatureFile,
  type Run,
} from '../src/features.js';
import { reviewPlace } from '../src/reviews.js';
import type { Terminals } from '../src/terminal.js';

/**
 * main: A ── B; origin/main at A, origin/HEAD naming main; origin/taken at A. The repository
 * sits in a folder of its own (`<parent>/app`), so worktrees go beside it in `<parent>`.
 */
function appRepo() {
  const repo = createRepo();
  repo.write({ 'src/a.ts': 'export const a = 1;\n' });
  const A = repo.commit('A');
  repo.write({ 'src/b.ts': 'export const b = 1;\n' });
  const B = repo.commit('B');
  repo.git('remote', 'add', 'origin', 'https://example.com/never-fetched.git');
  repo.git('update-ref', 'refs/remotes/origin/main', A);
  repo.git('update-ref', 'refs/remotes/origin/taken', A);
  repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  repo.git('config', 'user.email', 'ada@example.com');
  return { repo, shas: { A, B } };
}

const repos: TestRepo[] = [];
const folders: string[] = [];
let cache: string;
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  cache = tempDir();
  folders.push(cache);
});
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const fresh = () => {
  const made = appRepo();
  repos.push(made.repo);
  // Worktrees land beside the repository: its parent folder goes with the test.
  folders.push(join(dirname(made.repo.root), `${basename(made.repo.root)}.worktrees`));
  return made;
};
const NOW = new Date('2026-10-15T09:00:00Z');
/** Where CPR's hook would be installed. */
const HOOK = '/opt/cpr/dist/agent-hook.js';

const record = (over: Partial<FeatureFile> = {}): FeatureFile => ({
  agent: { kind: 'claude', permissionMode: 'default', started: '2026-10-15T09:00:00.000Z' },
  base: 'a'.repeat(40),
  branch: 'feature/csv',
  brief: 'Export a review as CSV',
  by: 'ada@example.com',
  created: '2026-10-15T09:00:00.000Z',
  from: 'main',
  planFirst: true,
  worktree: '/work/app.worktrees/feature-csv',
  ...over,
});

describe('featurePath and serializeFeature', () => {
  it("nests a branch's folders; the same feature gives the same bytes, about first", () => {
    expect(featurePath('/f', 'feature/csv')).toBe(join('/f', 'feature', 'csv.json'));
    expect(() => featurePath('/f', '../out')).toThrow(FeatureRefused);
    const text = serializeFeature(record());
    expect(text.split('\n').slice(0, 3)).toEqual([
      '{',
      '  "about": "A feature started in CPR. Agents: read cpr/AGENTS.md before acting on it.",',
      '  "agent": {',
    ]);
    const keys = Object.keys(JSON.parse(text) as object);
    expect(keys).toEqual([...keys].sort());
    expect(serializeFeature({ ...record() })).toBe(text);
  });

  it('reads a record back; a missing or broken file is none', async () => {
    const dir = tempDir();
    folders.push(dir);
    const path = featurePath(dir, 'feature/csv');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serializeFeature(record()));
    expect(await readFeature(path)).toEqual(record());
    writeFileSync(path, '{ nope');
    expect(await readFeature(path)).toBeNull();
    expect(await readFeature(join(dir, 'missing.json'))).toBeNull();
  });

  it("reads a record's kind, title and parts (V24); what is not one of them is left out", async () => {
    const dir = tempDir();
    folders.push(dir);
    const path = featurePath(dir, 'fix/dates');
    mkdirSync(dirname(path), { recursive: true });
    const fix = record({
      branch: 'fix/dates',
      kind: 'fix',
      title: 'Dates sort as text',
      parts: { happens: 'They sort 1, 10, 2.', doneWhen: 'A test passes.' },
    });
    writeFileSync(path, serializeFeature(fix));
    expect(await readFeature(path)).toEqual(fix);
    writeFileSync(
      path,
      serializeFeature({
        ...fix,
        kind: 'bug' as WorkKind,
        title: 7 as unknown as string,
        parts: { happens: 'H', size: 'L', notes: 3 } as never,
      }),
    );
    const read = await readFeature(path);
    expect(read?.kind).toBeUndefined();
    expect(read?.title).toBeUndefined();
    expect(read?.parts).toEqual({ happens: 'H' });
  });
});

describe('readFeatureConfig (V24)', () => {
  const DEFAULTS = {
    feature: 'feature/',
    fix: 'fix/',
    refactor: 'refactor/',
    chore: 'chore/',
    spike: 'spike/',
  };
  const configured = (config: unknown) => {
    const root = tempDir();
    folders.push(root);
    mkdirSync(join(root, 'cpr'));
    writeFileSync(join(root, 'cpr', 'config.json'), JSON.stringify(config));
    return readFeatureConfig(root).branchPrefixes;
  };
  it("gives each kind its branch prefix; a config's prefixes override only their kinds", () => {
    expect(configured({})).toEqual(DEFAULTS);
    // Before V24, one prefix: still the Feature's.
    expect(configured({ features: { branchPrefix: 'feat/' } })).toEqual({
      ...DEFAULTS,
      feature: 'feat/',
    });
    expect(
      configured({ features: { branchPrefixes: { fix: 'bugfix/', size: 'x/', chore: 7 } } }),
    ).toEqual({ ...DEFAULTS, fix: 'bugfix/' });
    // Both: the per-kind one wins for its kind.
    expect(
      configured({ features: { branchPrefix: 'feat/', branchPrefixes: { feature: 'f/' } } }),
    ).toEqual({ ...DEFAULTS, feature: 'f/' });
  });
});

describe('worktreeFolder', () => {
  it("is beside the checkout, the branch's slashes as dashes; a pattern moves it", () => {
    expect(worktreeFolder('/work/app', 'feature/csv')).toBe('/work/app.worktrees/feature-csv');
    expect(worktreeFolder('/work/app', 'fix', '../{repo}-features')).toBe('/work/app-features/fix');
    expect(worktreeFolder('/work/app', 'fix', '/tmp/trees/{repo}')).toBe('/tmp/trees/app/fix');
  });
});

describe('featureBase', () => {
  it("is the default branch's newest tip: local or remote, the local one when they diverged", async () => {
    const { repo, shas } = fresh();
    const git = await openRepo(repo.root);
    // Local main (B) is ahead of origin/main (A).
    expect(await featureBase(git, await listRefs(git))).toEqual({ from: 'main', sha: shas.B });
    // origin/main ahead of the local main.
    repo.write({ 'src/c.ts': 'export const c = 1;\n' });
    const C = repo.commit('C');
    repo.git('update-ref', 'refs/remotes/origin/main', C);
    repo.git('reset', '--quiet', '--hard', shas.B);
    expect(await featureBase(git, await listRefs(git))).toEqual({ from: 'main', sha: C });
    // Diverged: the local one.
    repo.write({ 'src/d.ts': 'export const d = 1;\n' });
    const D = repo.commit('D');
    expect(await featureBase(git, await listRefs(git))).toEqual({ from: 'main', sha: D });
  });

  it('is none without a default branch', async () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write({ 'a.ts': '1;\n' });
    repo.commit('A');
    repo.git('branch', '--move', 'main', 'trunk');
    const git = await openRepo(repo.root);
    expect(await featureBase(git, await listRefs(git))).toBeNull();
  });
});

describe('featurePrompt', () => {
  const where = {
    record: '/work/app/cpr/features/feature/csv.json',
    reviews: '/work/app/cpr/reviews/feature/csv',
    agents: '/work/app/cpr/AGENTS.md',
    into: 'main',
  };
  it('gives the brief, the branch, where things are, and plan first when asked', () => {
    const text = featurePrompt(record(), where);
    expect(text).toContain('Export a review as CSV');
    expect(text).toContain('feature/csv');
    expect(text).toContain('aaaaaaa');
    expect(text).toContain(where.record);
    expect(text).toContain(where.reviews);
    expect(text).toContain(where.agents);
    expect(text).toMatch(/plan.*then stop and wait for the person's OK/s);
    expect(featurePrompt(record({ planFirst: false }), where)).not.toMatch(/then stop and wait/);
    expect(featurePrompt(record({ planFirst: false }), where)).toMatch(/Commit your work/);
  });

  it('adds one line per kind after the brief, and names the work by its kind (V24)', () => {
    const kinds = {
      fix: /Reproduce it first, with a failing test where the project has tests/,
      refactor: /Change structure, not behaviour: do not change what existing tests assert/,
      chore: /Keep to what is asked; if it needs a change in behaviour, stop and say so/,
      spike: /The answer is what is asked for, not a change to merge/,
    };
    const lines = Object.values(kinds);
    for (const [kind, line] of Object.entries(kinds)) {
      const text = featurePrompt(record({ kind: kind as WorkKind, title: 'T' }), where);
      expect(text).toMatch(line);
      expect(text).toContain(`You are starting a new ${kind} in this repository`);
      // After the brief, before the plan.
      expect(text.indexOf('Export a review as CSV')).toBeLessThan(text.search(line));
      expect(text.search(line)).toBeLessThan(text.indexOf('First write a plan'));
      for (const other of lines) if (other !== line) expect(text).not.toMatch(other);
    }
    // A feature, and a record from before V24, get no line.
    for (const feature of [record({ kind: 'feature', title: 'T' }), record()]) {
      const text = featurePrompt(feature, where);
      expect(text).toContain('You are starting a new feature in this repository');
      for (const line of lines) expect(text).not.toMatch(line);
    }
    // A spike's answer is its report: nothing to commit unless asked.
    const spike = featurePrompt(record({ kind: 'spike', title: 'T' }), where);
    expect(spike).not.toMatch(/Commit your work/);
    expect(spike).toMatch(/Commit nothing unless the brief asks for it/);
  });
});

describe('briefOf (V24)', () => {
  it('puts the title and the parts under fixed headings, in a fixed order, Done when last', () => {
    // Keys in another order than the brief's: the order is the kind's, not the object's.
    const brief = briefOf('fix', 'The date column sorts as text', {
      doneWhen: 'A test that fails today passes, and `pnpm run check` passes.',
      where: 'packages/viewer/src/table.ts',
      happens: 'Dates sort 1, 10, 2.\nThey should sort by date.',
      notes: 'Seen on Firefox.',
      reproduce: 'Open a review, sort by Date.',
    });
    expect(brief).toBe(
      [
        '# Fix: The date column sorts as text',
        '',
        '## What happens',
        'Dates sort 1, 10, 2.',
        'They should sort by date.',
        '',
        '## How to reproduce',
        'Open a review, sort by Date.',
        '',
        '## Where to look',
        'packages/viewer/src/table.ts',
        '',
        '## Notes',
        'Seen on Firefox.',
        '',
        '## Done when',
        'A test that fails today passes, and `pnpm run check` passes.',
        '',
      ].join('\n'),
    );
  });

  it('names each kind and its parts', () => {
    expect(briefOf('feature', 'CSV', { goal: 'G', outOfScope: 'O' })).toBe(
      '# Feature: CSV\n\n## Goal\nG\n\n## Out of scope\nO\n',
    );
    expect(briefOf('refactor', 'R', { restructure: 'S' })).toBe(
      '# Refactor: R\n\n## What to restructure\nS\n',
    );
    expect(briefOf('chore', 'C', { change: 'X' })).toBe('# Chore: C\n\n## What to change\nX\n');
    expect(briefOf('spike', 'Q', { question: 'Why?', known: 'K' })).toBe(
      '# Spike: Q\n\n## Question\nWhy?\n\n## What is known\nK\n',
    );
  });

  it("leaves empty parts out and keeps the person's text as written, Markdown included", () => {
    const text = '    indented first line\n\n## not a heading of ours\n- a list\n';
    expect(
      briefOf('feature', '  CSV  ', { goal: `\n\n${text}\n  \n`, where: '   ', notes: '' }),
    ).toBe(`# Feature: CSV\n\n## Goal\n${text.trimEnd()}\n`);
  });
});

describe("the start dialog's length of a brief (V24c)", () => {
  it("is the length of the brief the server makes, so the dialog's count is the server's", async () => {
    const { briefLength, formParts, newForm } = await import('../../viewer/src/brief.js');
    const kinds = workKinds();
    const forms = [
      { kind: 'fix', title: '  Dates  ', main: '\n\n  They sort.\n  \n', more: { notes: 'N ' } },
      { kind: 'feature', title: 'CSV', main: 'Export it.', more: { where: ' ', outOfScope: 'O' } },
      {
        kind: 'spike',
        title: 'Q',
        main: 'Why?',
        more: { known: 'K', reproduce: 'not a Spike part' },
      },
    ] as const;
    for (const over of forms) {
      const spec = kinds.find((k) => k.kind === over.kind)!;
      const form = { ...newForm(spec, null), ...over, more: { ...over.more } };
      expect(briefLength(form, spec), over.kind).toBe(
        briefOf(over.kind, form.title, formParts(form, spec)).length,
      );
    }
  });
});

describe('parseSessions and parseAccount', () => {
  it("reads Claude Code's sessions; anything else is none", () => {
    const text = JSON.stringify([
      { pid: 1, cwd: '/w/x', kind: 'interactive', startedAt: 1, status: 'busy' },
      {
        id: '7c5dcf5d',
        cwd: '/w/y',
        kind: 'background',
        startedAt: 2,
        state: 'blocked',
        waitingFor: 'permission prompt',
        name: 'feature/y',
      },
      { kind: 'background' },
      'nonsense',
    ]);
    expect(parseSessions(text)).toEqual([
      { cwd: '/w/x', kind: 'interactive', startedAt: 1, status: 'busy' },
      {
        id: '7c5dcf5d',
        cwd: '/w/y',
        kind: 'background',
        startedAt: 2,
        state: 'blocked',
        waitingFor: 'permission prompt',
        name: 'feature/y',
      },
    ]);
    expect(parseSessions('not json')).toEqual([]);
  });

  it('says whose account: a subscription, an API key, or nothing known', () => {
    expect(
      parseAccount(
        JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }),
      ),
    ).toBe('your Pro subscription');
    expect(parseAccount(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }))).toBe(
      'your Claude subscription',
    );
    expect(parseAccount(JSON.stringify({ loggedIn: true, authMethod: 'api_key' }))).toBe(
      'an API key',
    );
    expect(parseAccount(JSON.stringify({ loggedIn: false }))).toBe('not logged in');
    expect(parseAccount('nope')).toBeUndefined();
  });
});

describe('agentState', () => {
  const session = (over: Partial<AgentSession>): AgentSession => ({
    cwd: '/work/app.worktrees/feature-csv',
    kind: 'background',
    startedAt: 10,
    id: 'abc',
    ...over,
  });
  const at = (f: FeatureFile, sessions: AgentSession[] | null, ahead = 0) =>
    agentState(f, sessions, ahead, (p) => p);

  it("maps the session in the feature's worktree to what the page says", () => {
    const f = record();
    expect(at(f, [session({ state: 'working' })])).toEqual({
      state: 'working',
      kind: 'claude',
      id: 'abc',
    });
    expect(at(f, [session({ state: 'blocked', waitingFor: 'permission prompt' })])).toEqual({
      state: 'needs-you',
      kind: 'claude',
      id: 'abc',
      waitingFor: 'permission prompt',
    });
    expect(at(f, [session({ state: 'done' })]).state).toBe('plan-ready');
    expect(at(f, [session({ state: 'done' })], 2).state).toBe('ready');
    expect(at(record({ planFirst: false }), [session({ state: 'done' })]).state).toBe('done');
    expect(at(f, [session({ state: 'failed' })]).state).toBe('failed');
    expect(at(f, [session({ state: 'stopped' })]).state).toBe('stopped');
    // Someone working in the folder interactively.
    expect(at(f, [session({ kind: 'interactive', status: 'waiting', id: undefined })]).state).toBe(
      'needs-you',
    );
  });

  it('reads a turn interrupted with Esc as waiting for the person', () => {
    // Measured (V21 spike): after Esc no hook fires, and Claude Code says `status: idle` with
    // `state: working` until the next turn ends.
    const f = record();
    expect(at(f, [session({ state: 'working', status: 'idle' })])).toEqual({
      state: 'needs-you',
      kind: 'claude',
      id: 'abc',
      interrupted: true,
    });
    expect(at(f, [session({ state: 'working', status: 'busy' })]).state).toBe('working');
    // The thread says the turn ended with a report: finished, whatever `state` still says.
    expect(
      agentState(f, [session({ state: 'working', status: 'idle' })], 0, (p) => p, true),
    ).toEqual({ state: 'plan-ready', kind: 'claude', id: 'abc' });
  });

  it('takes the newest session there and ignores other folders', () => {
    const f = record();
    const sessions = [
      session({ state: 'failed', startedAt: 1, id: 'old' }),
      session({ state: 'working', startedAt: 5, id: 'new' }),
      session({ cwd: '/elsewhere', state: 'blocked', startedAt: 9 }),
    ];
    expect(at(f, sessions)).toMatchObject({ state: 'working', id: 'new' });
    expect(at(f, [session({ cwd: '/elsewhere', state: 'working' })]).state).toBe('not-running');
  });

  it('says when it never started, has no agent, or cannot be read', () => {
    expect(at(record({ agent: null }), [])).toEqual({ state: 'no-agent' });
    const failed = record({
      agent: { kind: 'claude', permissionMode: 'default', error: 'Workspace not trusted.' },
    });
    expect(at(failed, [])).toEqual({
      state: 'not-started',
      kind: 'claude',
      error: 'Workspace not trusted.',
    });
    expect(at(record(), null)).toEqual({
      state: 'unknown',
      kind: 'claude',
      error: 'Claude Code could not list its sessions',
    });
  });
});

describe('reviewPlace in a linked worktree', () => {
  it("keeps reviews in the main checkout's cpr/, not the worktree's", async () => {
    const { repo, shas } = fresh();
    const folder = join(tempDir(), 'linked');
    folders.push(dirname(folder));
    repo.git('worktree', 'add', '--quiet', '-b', 'linked', folder, shas.A);
    const place = await reviewPlace(await openRepo(folder), cache);
    expect(place.place).toBe('repository');
    expect(realpathSync(dirname(dirname(place.dir)))).toBe(repo.root);
  });
});

describe('features', () => {
  /** A fake Claude Code: records what it is asked to start, lists the sessions given. */
  function fakeClaude() {
    const listed: AgentSession[] = [];
    const start = vi.fn<ClaudeCode['start']>(({ cwd }) => {
      listed.push({
        cwd,
        kind: 'background',
        startedAt: listed.length,
        id: 's1',
        sessionId: 'session-1',
        state: 'working',
        status: 'busy',
      });
      return Promise.resolve({ ok: true });
    });
    const sessions = vi.fn<ClaudeCode['sessions']>(() => Promise.resolve(listed));
    const stop = vi.fn<ClaudeCode['stop']>((id) => {
      for (const session of listed) {
        if (session.id !== id) continue;
        session.state = 'stopped';
        delete session.status;
      }
      return Promise.resolve({ ok: true });
    });
    const resume = vi.fn<ClaudeCode['resume']>(({ sessionId }) => {
      for (const session of listed) {
        if (session.sessionId !== sessionId) continue;
        session.state = 'working';
        session.status = 'busy';
      }
      return Promise.resolve({ ok: true });
    });
    const remove = vi.fn<ClaudeCode['remove']>((id) => {
      const at = listed.findIndex((session) => session.id === id);
      if (at >= 0) listed.splice(at, 1);
      return Promise.resolve({ ok: true });
    });
    const claude: ClaudeCode = {
      command: '/usr/bin/claude',
      start,
      sessions,
      stop,
      resume,
      remove,
      account: () => Promise.resolve('your Pro subscription'),
    };
    return { claude, listed, start, sessions, stop, resume, remove };
  }
  /** Fake terminals (V21): records what it is asked to open. */
  function fakeTerminals(reason?: string) {
    const opening: Parameters<Terminals['open']>[0][] = [];
    const terminals: Terminals = {
      available: () => Promise.resolve(reason ? { available: false, reason } : { available: true }),
      open: (request) => {
        if (reason) return Promise.reject(new Error(reason));
        opening.push(request);
        return Promise.resolve(`t${opening.length}`);
      },
      listen: () => undefined,
      write: () => false,
      resize: () => false,
      close: () => false,
      closeAll: () => {},
    };
    return { terminals, opening };
  }
  const opened: string[] = [];
  const service = (repo: TestRepo, claude: ClaudeCode | null, hook = HOOK, terminals?: Terminals) =>
    openRepo(repo.root).then((git) =>
      features(git, cache, {
        claude: () => Promise.resolve(claude),
        now: () => NOW,
        env: { PATH: '/usr/bin' },
        hook,
        node: '/usr/bin/node',
        openFolder: (folder) => {
          opened.push(folder);
          return Promise.resolve({ opened: true });
        },
        ...(terminals ? { terminals } : {}),
      }),
    );

  it("offers the default branch's tip, the agent and its account, and where worktrees go", async () => {
    const { repo, shas } = fresh();
    const { claude } = fakeClaude();
    const { kinds, ...options } = await (await service(repo, claude)).options();
    expect(options).toEqual({
      base: { from: 'main', sha: shas.B },
      branchPrefixes: {
        feature: 'feature/',
        fix: 'fix/',
        refactor: 'refactor/',
        chore: 'chore/',
        spike: 'spike/',
      },
      worktrees: join(dirname(repo.root), `${basename(repo.root)}.worktrees`, '<branch>'),
      agent: {
        kind: 'claude',
        command: '/usr/bin/claude',
        account: 'your Pro subscription',
        permissionMode: 'default',
      },
      maxBrief: 20000,
    });
    // The kinds as the dialog offers them (V24): each one's parts in the brief's order.
    expect(
      kinds.map((k) => [
        k.kind,
        k.name,
        k.parts.map((p) => (p.required ? `${p.heading}*` : p.heading)).join(', '),
      ]),
    ).toEqual([
      ['feature', 'Feature', 'Goal*, Where to look, Out of scope, Notes, Done when'],
      ['fix', 'Fix', 'What happens*, How to reproduce, Where to look, Notes, Done when'],
      [
        'refactor',
        'Refactor',
        'What to restructure*, Where to look, Out of scope, Notes, Done when',
      ],
      ['chore', 'Chore', 'What to change*, Where to look, Out of scope, Notes, Done when'],
      ['spike', 'Spike', 'Question*, What is known, Where to look, Notes, Done when'],
    ]);
    expect(Object.fromEntries(kinds.map((k) => [k.kind, k.doneWhen]))).toEqual({
      feature: undefined,
      fix: 'A test that fails today passes, and {checks pass}.',
      refactor:
        'Behaviour is unchanged: existing tests pass without changing what they assert, and {checks pass}.',
      chore: 'Nothing else changes, and {checks pass}.',
      spike: 'A written answer: what was tried, what was measured, and a recommendation.',
    });
    const without = await (await service(repo, null)).options();
    expect(without.agent).toBeNull();
  });

  it('starts a feature: the branch at the base in its worktree, the record, the agent there', async () => {
    const { repo, shas } = fresh();
    const { claude, start } = fakeClaude();
    const service_ = await service(repo, claude);
    const { feature, prompt } = await service_.start({
      brief: 'Export a review as CSV\n\nOne row per comment.',
      branch: 'feature/csv',
      planFirst: true,
      permissionMode: 'auto',
    });
    const folder = join(dirname(repo.root), `${basename(repo.root)}.worktrees`, 'feature-csv');
    expect(feature).toEqual({
      branch: 'feature/csv',
      base: shas.B,
      from: 'main',
      created: NOW.toISOString(),
      planFirst: true,
      brief: 'Export a review as CSV\n\nOne row per comment.',
      worktree: { path: folder, exists: true, changed: 0 },
      tip: shas.B,
      ahead: 0,
      merged: false,
      agent: { state: 'working', kind: 'claude', id: 's1' },
      // Nothing reported yet: when its agent started (V23).
      lastAction: NOW.toISOString(),
    });
    expect(repo.git('rev-parse', 'feature/csv')).toBe(shas.B);
    expect(repo.git('branch', '--show-current')).toBe('main');
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(existsSync(join(folder, 'src/b.ts'))).toBe(true);
    expect(start).toHaveBeenCalledWith({
      cwd: folder,
      name: 'feature/csv',
      prompt,
      permissionMode: 'auto',
      addDir: join(repo.root, 'cpr'),
      settings: join(repo.root, 'cpr', 'claude-settings.json'),
    });
    expect(prompt).toContain('One row per comment.');
    const saved = JSON.parse(
      readFileSync(join(repo.root, 'cpr', 'features', 'feature', 'csv.json'), 'utf8'),
    ) as FeatureFile;
    expect(saved).toMatchObject({
      branch: 'feature/csv',
      base: shas.B,
      by: 'ada@example.com',
      planFirst: true,
      worktree: folder,
      agent: { kind: 'claude', permissionMode: 'auto', started: NOW.toISOString(), hooks: true },
    });
    // The agents' instructions and the folder's .gitignore, as for reviews.
    expect(existsSync(join(repo.root, 'cpr', 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(repo.root, 'cpr', '.gitignore'))).toBe(true);
  });

  it('starts at a picked commit, without `from`', async () => {
    const { repo, shas } = fresh();
    const { claude } = fakeClaude();
    const { feature } = await (
      await service(repo, claude)
    ).start({ brief: 'Fix', branch: 'fix/one', base: shas.A, planFirst: false });
    expect(feature.base).toBe(shas.A);
    expect(feature.from).toBeUndefined();
    expect(repo.git('rev-parse', 'fix/one')).toBe(shas.A);
  });

  it('starts a kind of work: the brief assembled from its parts, the record keeping both (V24)', async () => {
    const { repo } = fresh();
    const { claude, start } = fakeClaude();
    const s = await service(repo, claude);
    const parts = {
      happens: 'Dates sort 1, 10, 2.',
      where: '  ',
      doneWhen: 'A test that fails today passes.',
    };
    const { feature, prompt } = await s.start({
      kind: 'fix',
      title: ' Dates sort as text ',
      parts,
      branch: 'fix/dates',
      planFirst: false,
    });
    const brief = briefOf('fix', 'Dates sort as text', parts);
    expect(feature).toMatchObject({ kind: 'fix', title: 'Dates sort as text', brief });
    expect(prompt).toContain(brief);
    expect(prompt).toMatch(/Reproduce it first/);
    expect(start.mock.calls[0]?.[0].prompt).toBe(prompt);
    const saved = await readFeature(join(repo.root, 'cpr', 'features', 'fix', 'dates.json'));
    // Empty parts are not kept.
    expect(saved).toMatchObject({
      kind: 'fix',
      title: 'Dates sort as text',
      parts: { happens: 'Dates sort 1, 10, 2.', doneWhen: 'A test that fails today passes.' },
      brief,
    });
    expect(saved?.parts).not.toHaveProperty('where');
    // A request from before V24 makes a record as before: no kind, no title.
    const old = await s.start({
      brief: 'Export a review as CSV',
      branch: 'feature/csv',
      planFirst: false,
    });
    expect(old.feature.kind).toBeUndefined();
    expect(old.feature.title).toBeUndefined();
    expect(old.feature.brief).toBe('Export a review as CSV');
  });

  it('guesses the check command at the commit a workspace starts from (V24b)', async () => {
    const { repo, shas } = fresh();
    const s = await service(repo, null);
    expect(await s.check(shas.B)).toBeNull();
    repo.write({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) });
    const C = repo.commit('C');
    expect(await s.check(C)).toEqual({
      command: 'npm run test',
      source: 'package.json (scripts.test)',
    });
    expect(await s.check(shas.B)).toBeNull();
    const refused = (at: string) => s.check(at).catch((e: unknown) => e as FeatureRefused);
    expect(await refused('main')).toMatchObject({ status: 400, message: /full SHA/ });
    expect(await refused('0'.repeat(40))).toMatchObject({ status: 400, message: /not a commit/ });
  });

  it("keeps the start dialog's draft in CPR's cache, not in the repository (V24c)", async () => {
    const { repo } = fresh();
    const s = await service(repo, null);
    expect(await s.draft()).toEqual({});
    const draft = { kind: 'fix', title: 'Dates', main: 'They sort as text.', more: {} };
    await s.saveDraft(draft);
    expect(await s.draft()).toEqual(draft);
    // Another service on the same repository (a new `cpr view`, another port) reads it.
    expect(await (await service(repo, null)).draft()).toEqual(draft);
    expect(repo.git('status', '--porcelain')).toBe('');
    const file = join(cache, 'state', (await openRepo(repo.root)).id, 'start-draft.json');
    expect(existsSync(file)).toBe(true);
    writeFileSync(file, '{ nope');
    expect(await s.draft()).toEqual({});
  });

  it('refuses a kind of work that is not complete, before touching anything (V24)', async () => {
    const { repo } = fresh();
    const { claude, start: launched } = fakeClaude();
    const s = await service(repo, claude);
    const refused = async (over: Record<string, unknown>, words: RegExp) => {
      const request = {
        kind: 'fix',
        title: 'Dates',
        parts: { happens: 'H' },
        branch: 'fix/x',
        planFirst: true,
        ...over,
      } as FeatureRequest;
      const error = (await s.start(request).catch((e: unknown) => e)) as FeatureRefused;
      expect(error, JSON.stringify(over)).toBeInstanceOf(FeatureRefused);
      expect(error.status).toBe(400);
      expect(error.message).toMatch(words);
    };
    await refused({ kind: 'bug' }, /unknown kind: bug/);
    await refused({ title: '  ' }, /needs a title/);
    await refused({ title: 'One\nTwo' }, /a title is one line/);
    await refused({ title: 'One\rTwo' }, /a title is one line/);
    await refused({ title: 'x'.repeat(201) }, /a title is at most 200 characters/);
    await refused({ parts: { happens: ' \n ' } }, /a fix needs "What happens"/);
    await refused({ parts: { happens: 'H', goal: 'G' } }, /a fix has no "Goal"/);
    await refused({ parts: { happens: 'H', size: 'L' } }, /a fix has no "size"/);
    await refused({ parts: { happens: 'x'.repeat(20_000) } }, /20,000/);
    await refused({ brief: 'Both' }, /a brief or a kind of work, not both/);
    await refused({ kind: undefined, title: undefined, parts: undefined }, /brief/);
    expect(repo.git('branch', '--list', 'fix/*')).toBe('');
    expect(launched).not.toHaveBeenCalled();
  });

  it('refuses a bad request before touching anything', async () => {
    const { repo } = fresh();
    const { claude, start: launched } = fakeClaude();
    const s = await service(repo, claude);
    const start = (over: Record<string, unknown>) =>
      s.start({ brief: 'Do it', branch: 'feature/x', planFirst: true, ...over });
    const refused = async (over: Record<string, unknown>, status: number, words: RegExp) => {
      const error = (await start(over).catch((e: unknown) => e)) as FeatureRefused;
      expect(error).toBeInstanceOf(FeatureRefused);
      expect(error.status).toBe(status);
      expect(error.message).toMatch(words);
    };
    await refused({ brief: '  ' }, 400, /brief/);
    await refused({ brief: 'x'.repeat(20001) }, 400, /20,000/);
    await refused({ branch: 'a..b' }, 400, /not a valid branch name/);
    await refused({ branch: 'main' }, 409, /a branch main exists/);
    await refused({ branch: 'taken' }, 409, /origin has a branch taken/);
    await refused({ base: 'main' }, 400, /full SHA/);
    await refused({ base: '0'.repeat(40) }, 400, /not a commit/);
    await refused({ permissionMode: 'bypassPermissions' }, 400, /permission mode/);
    mkdirSync(worktreeFolder(repo.root, 'feature/x'), { recursive: true });
    await refused({}, 409, /exists/);
    expect(repo.git('branch', '--list', 'feature/*')).toBe('');
    expect(launched).not.toHaveBeenCalled();
  });

  it('keeps the feature when the agent does not start, and starts it again later', async () => {
    const { repo } = fresh();
    const { claude, start } = fakeClaude();
    claude.start = () =>
      Promise.resolve({
        ok: false,
        error:
          'Workspace not trusted. Run `claude` in /x once and accept the trust prompt, then retry.',
      });
    const s = await service(repo, claude);
    const { feature } = await s.start({ brief: 'Do it', branch: 'feature/x', planFirst: true });
    expect(feature.agent).toEqual({
      state: 'not-started',
      kind: 'claude',
      error:
        'Workspace not trusted. Run `claude` in /x once and accept the trust prompt, then retry.',
    });
    expect(feature.worktree.exists).toBe(true);

    claude.start = start;
    const again = await s.startAgent('feature/x');
    expect(again.feature.agent.state).toBe('working');
    expect((await s.list()).features.map((f) => f.agent.state)).toEqual(['working']);
  });

  it('makes the feature without an agent and hands back its prompt', async () => {
    const { repo } = fresh();
    const s = await service(repo, null);
    const { feature, prompt } = await s.start({
      brief: 'Do it',
      branch: 'feature/x',
      planFirst: true,
    });
    expect(feature.agent).toEqual({ state: 'no-agent' });
    expect(prompt).toContain('Do it');
    await expect(s.startAgent('feature/x')).rejects.toThrow(/No agent/);
  });

  it('lists features with their commits since the base and their agents', async () => {
    const { repo } = fresh();
    const { claude, listed } = fakeClaude();
    const s = await service(repo, claude);
    await s.start({ brief: 'One', branch: 'feature/one', planFirst: false });
    await s.start({ brief: 'Two', branch: 'feature/two', planFirst: true });
    const folder = worktreeFolder(repo.root, 'feature/one');
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['-C', folder, 'commit', '--quiet', '--allow-empty', '-m', 'work'], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'A',
        GIT_AUTHOR_EMAIL: 'a@x',
        GIT_COMMITTER_NAME: 'A',
        GIT_COMMITTER_EMAIL: 'a@x',
      },
    });
    for (const session of listed) session.state = 'done';
    const list = await s.list();
    expect(list.place).toBe('repository');
    expect(
      list.features.map((f) => ({ branch: f.branch, ahead: f.ahead, state: f.agent.state })),
    ).toEqual([
      { branch: 'feature/one', ahead: 1, state: 'ready' },
      { branch: 'feature/two', ahead: 0, state: 'plan-ready' },
    ]);
  });

  it('asks Claude Code for its sessions once for a whole list', async () => {
    const { repo } = fresh();
    const { claude, sessions } = fakeClaude();
    const s = await service(repo, claude);
    await s.start({ brief: 'One', branch: 'feature/one', planFirst: false });
    await s.start({ brief: 'Two', branch: 'feature/two', planFirst: false });
    sessions.mockClear();
    await s.list();
    expect(sessions).toHaveBeenCalledTimes(1);
  });

  it("opens its agent's session in a terminal: claude attach <id> in its worktree (V21)", async () => {
    const { repo } = fresh();
    const { claude, listed } = fakeClaude();
    const { terminals, opening } = fakeTerminals();
    const s = await service(repo, claude, HOOK, terminals);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    // A session that wakes needs its settings file: written back before it is attached to.
    const settings = join(repo.root, 'cpr', 'claude-settings.json');
    rmSync(settings);
    expect(await s.terminal({ branch: 'feature/one', cols: 100, rows: 30 })).toEqual({ id: 't1' });
    expect(opening).toEqual([
      {
        command: '/usr/bin/claude',
        args: ['attach', 's1'],
        cwd: feature.worktree.path,
        cols: 100,
        rows: 30,
        env: { PATH: '/usr/bin' },
      },
    ]);
    expect(existsSync(settings)).toBe(true);

    // The newest session in its worktree; a stopped one too (attach continues it).
    listed.push({ ...(listed[0] as AgentSession), id: 's2', startedAt: 99, state: 'stopped' });
    await s.terminal({ branch: 'feature/one', cols: 80, rows: 24 });
    expect(opening[1]?.args).toEqual(['attach', 's2']);

    // No session listed: attach to an unknown ID exits 0 saying nothing useful, so refused.
    listed.length = 0;
    await expect(s.terminal({ branch: 'feature/one', cols: 80, rows: 24 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/no session/) as string,
    });
    await expect(s.terminal({ branch: 'feature/nope', cols: 80, rows: 24 })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('says why no terminal opens: none here, or no agent (V21)', async () => {
    const { repo } = fresh();
    const { claude } = fakeClaude();
    const missing = fakeTerminals('node-pty is not installed');
    const s = await service(repo, claude, HOOK, missing.terminals);
    await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    await expect(s.terminal({ branch: 'feature/one', cols: 80, rows: 24 })).rejects.toMatchObject({
      status: 409,
      message: 'node-pty is not installed',
    });
    const none = await service(repo, claude);
    await expect(
      none.terminal({ branch: 'feature/one', cols: 80, rows: 24 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('lists whether terminals can run, once there are features (V21)', async () => {
    const { repo } = fresh();
    const { claude } = fakeClaude();
    const s = await service(repo, claude, HOOK, fakeTerminals().terminals);
    expect((await s.list()).terminal).toBeUndefined();
    await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    expect((await s.list()).terminal).toEqual({ available: true });
    const missing = await service(
      repo,
      claude,
      HOOK,
      fakeTerminals('node-pty is not installed').terminals,
    );
    expect((await missing.list()).terminal).toEqual({
      available: false,
      reason: 'node-pty is not installed',
    });
    expect((await (await service(repo, claude)).list()).terminal).toBeUndefined();
  });

  it('lists nothing and asks no agent when no feature was started', async () => {
    const { repo } = fresh();
    const { claude, sessions } = fakeClaude();
    expect(await (await service(repo, claude)).list()).toEqual({
      features: [],
      place: 'repository',
    });
    expect(sessions).not.toHaveBeenCalled();
  });

  it("counts what is not committed yet in a feature's worktree", async () => {
    const { repo } = fresh();
    const s = await service(repo, fakeClaude().claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: false });
    expect(feature.worktree).toEqual({ path: feature.worktree.path, exists: true, changed: 0 });
    writeFileSync(join(feature.worktree.path, 'src/a.ts'), 'export const a = 2;\n');
    writeFileSync(join(feature.worktree.path, 'src/new.ts'), 'export const n = 1;\n');
    expect((await s.list()).features[0]?.worktree.changed).toBe(2);
  });

  it('gives the prompt again, stops the agent and opens the worktree', async () => {
    const { repo } = fresh();
    const { claude, stop, listed } = fakeClaude();
    const s = await service(repo, claude);
    const { feature, prompt } = await s.start({
      brief: 'One',
      branch: 'feature/one',
      planFirst: false,
    });
    expect(await s.prompt('feature/one')).toBe(prompt);
    await expect(s.prompt('feature/nope')).rejects.toMatchObject({ status: 404 });

    expect((await s.stopAgent('feature/one')).feature.agent.state).toBe('stopped');
    expect(stop).toHaveBeenCalledWith('s1');
    listed.length = 0;
    await expect(s.stopAgent('feature/one')).rejects.toMatchObject({
      status: 409,
      message: 'its agent is not running',
    });

    opened.length = 0;
    await s.openWorktree('feature/one');
    expect(opened).toEqual([feature.worktree.path]);
    rmSync(feature.worktree.path, { recursive: true, force: true });
    await expect(s.openWorktree('feature/one')).rejects.toMatchObject({ status: 409 });
  });

  it('says whether a feature merges cleanly into the default branch, once per pair', async () => {
    const { repo } = fresh();
    const s = await service(repo, fakeClaude().claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: false });
    const { execFileSync } = await import('node:child_process');
    const commit = (cwd: string, file: string, text: string) => {
      writeFileSync(join(cwd, file), text);
      execFileSync('git', ['-C', cwd, 'commit', '--quiet', '-am', file], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'A',
          GIT_AUTHOR_EMAIL: 'a@x',
          GIT_COMMITTER_NAME: 'A',
          GIT_COMMITTER_EMAIL: 'a@x',
        },
      });
    };
    commit(feature.worktree.path, 'src/a.ts', 'export const a = 2;\n');
    expect(await s.merge('feature/one')).toEqual({ into: 'main', clean: true });
    commit(repo.root, 'src/a.ts', 'export const a = 3;\n');
    expect(await s.merge('feature/one')).toEqual({ into: 'main', conflicts: ['src/a.ts'] });
    await expect(s.merge('feature/nope')).rejects.toMatchObject({ status: 404 });
  });

  /** Commits in `cwd` as an agent would. */
  const commitIn = async (cwd: string, file: string, text: string) => {
    const { execFileSync } = await import('node:child_process');
    writeFileSync(join(cwd, file), text);
    execFileSync('git', ['-C', cwd, 'add', file]);
    execFileSync('git', ['-C', cwd, 'commit', '--quiet', '-m', file], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'A',
        GIT_AUTHOR_EMAIL: 'a@x',
        GIT_COMMITTER_NAME: 'A',
        GIT_COMMITTER_EMAIL: 'a@x',
      },
    });
  };

  it("starts the agent with CPR's hooks: one settings file, rewritten when CPR moves or it is gone", async () => {
    const { repo } = fresh();
    const settings = join(repo.root, 'cpr', 'claude-settings.json');
    const s = await service(repo, fakeClaude().claude);
    await s.list();
    // No feature: nothing written.
    expect(existsSync(settings)).toBe(false);
    await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    const written = JSON.parse(readFileSync(settings, 'utf8')) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
    };
    expect(Object.keys(written.hooks).sort()).toEqual([
      'Notification',
      'PermissionRequest',
      'PreToolUse',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'UserPromptSubmit',
    ]);
    const command = `'/usr/bin/node' '${HOOK}' '${join(repo.root, 'cpr')}'`;
    for (const [event, entries] of Object.entries(written.hooks)) {
      expect(entries).toEqual([
        {
          ...(event === 'PreToolUse' ? { matcher: 'AskUserQuestion' } : {}),
          hooks: [{ type: 'command', command, timeout: 30 }],
        },
      ]);
    }
    // CPR installed elsewhere: the next look rewrites it, so older sessions find the hook.
    await (await service(repo, fakeClaude().claude, '/new/cpr/agent-hook.js')).list();
    expect(readFileSync(settings, 'utf8')).toContain('/new/cpr/agent-hook.js');
    // Gone (a session would not wake without it): written again.
    rmSync(settings);
    await s.list();
    expect(existsSync(settings)).toBe(true);
  });

  it("saves the record before the agent starts: its first hooks find the feature's worktree", async () => {
    const { repo } = fresh();
    const { claude, start } = fakeClaude();
    const record = join(repo.root, 'cpr', 'features', 'feature', 'one.json');
    let seen: FeatureFile | null = null;
    claude.start = (request) => {
      seen = JSON.parse(readFileSync(record, 'utf8')) as FeatureFile;
      return start(request);
    };
    const s = await service(repo, claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    expect(seen).toMatchObject({ branch: 'feature/one', worktree: feature.worktree.path });
  });

  it('a reply continues the same session: a live one is stopped first, never resumed with a flag', async () => {
    const { repo } = fresh();
    const { claude, listed, stop, resume } = fakeClaude();
    const s = await service(repo, claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    const session = listed[0] as AgentSession;

    // Its turn ended, its process alive: stopped, then resumed with the text.
    Object.assign(session, { state: 'blocked', status: 'idle' });
    const replied = await s.reply({ branch: 'feature/one', text: 'OK, go ahead.' });
    expect(stop).toHaveBeenCalledWith('s1');
    expect(resume).toHaveBeenCalledWith({
      sessionId: 'session-1',
      cwd: feature.worktree.path,
      text: 'OK, go ahead.',
    });
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(resume.mock.invocationCallOrder[0] ?? 0);
    expect(replied).toEqual({
      feature: expect.objectContaining({ branch: 'feature/one' }) as unknown,
    });
    expect(replied.feature.agent.state).toBe('working');

    // Working: sending would end its turn, so only when asked to.
    stop.mockClear();
    await expect(s.reply({ branch: 'feature/one', text: 'Wait' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/working/) as string,
    });
    expect(stop).not.toHaveBeenCalled();
    await s.reply({ branch: 'feature/one', text: 'Wait', stop: true });
    expect(stop).toHaveBeenCalledWith('s1');

    // Stopped already: resumed only.
    stop.mockClear();
    Object.assign(session, { state: 'stopped' });
    delete session.status;
    await s.reply({ branch: 'feature/one', text: 'Go on' });
    expect(stop).not.toHaveBeenCalled();
    expect(resume).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Go on' }));
  });

  it('says when Claude Code made a copy, and refuses what it cannot send', async () => {
    const { repo } = fresh();
    const { claude, listed } = fakeClaude();
    const s = await service(repo, claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    Object.assign(listed[0] as AgentSession, { state: 'done', status: 'idle' });
    claude.resume = () => {
      listed.push({
        cwd: feature.worktree.path,
        kind: 'background',
        startedAt: 99,
        id: 's2',
        sessionId: 'session-2',
        state: 'working',
        status: 'busy',
      });
      return Promise.resolve({ ok: true });
    };
    expect((await s.reply({ branch: 'feature/one', text: 'OK' })).copy).toBe('s2');

    const refused = (text: string, status: number, words: RegExp) =>
      expect(s.reply({ branch: 'feature/one', text })).rejects.toMatchObject({
        status,
        message: expect.stringMatching(words) as string,
      });
    await refused('  ', 400, /empty/);
    await refused('x'.repeat(20_001), 400, /20,000/);
    await expect(s.reply({ branch: 'feature/nope', text: 'OK' })).rejects.toMatchObject({
      status: 404,
    });
    listed.length = 0;
    await refused('OK', 409, /no session/);
  });

  it("gives a feature's thread, whether it is recorded, and its review's last verdict as text", async () => {
    const { repo, shas } = fresh();
    const { claude } = fakeClaude();
    const s = await service(repo, claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    const { recordEvent } = await import('../src/thread.js');
    const cpr = join(repo.root, 'cpr');
    const cwd = feature.worktree.path;
    await recordEvent(
      cpr,
      { hook_event_name: 'UserPromptSubmit', session_id: 'session-1', cwd, prompt: 'Start' },
      '2026-10-15T09:00:01.000Z',
    );
    await recordEvent(
      cpr,
      { hook_event_name: 'Stop', session_id: 'session-1', cwd, last_assistant_message: 'The plan' },
      '2026-10-15T09:00:02.000Z',
    );
    const thread = await s.thread('feature/one');
    expect(thread).toEqual({
      entries: [
        { at: '2026-10-15T09:00:01.000Z', session: 'session-1', kind: 'prompt', text: 'Start' },
        { at: '2026-10-15T09:00:02.000Z', session: 'session-1', kind: 'report', text: 'The plan' },
      ],
      recorded: true,
    });

    // A verdict on the branch: its text for the agent, as "Copy for the agent" has it.
    const review = join(cpr, 'reviews', 'feature', 'one', 'ada@example.com.json');
    mkdirSync(dirname(review), { recursive: true });
    writeFileSync(
      review,
      JSON.stringify({
        base: shas.B,
        branch: 'feature/one',
        drafts: [],
        head: shas.B,
        marks: {},
        reviewer: 'ada@example.com',
        summary: '',
        updated: NOW.toISOString(),
        verdicts: [
          {
            at: '2026-10-15T09:30:00.000Z',
            comments: [],
            event: 'request-changes',
            head: shas.B,
            summary: 'Name it half.',
          },
        ],
      }),
    );
    const { verdict } = await s.thread('feature/one');
    expect(verdict).toMatchObject({
      at: '2026-10-15T09:30:00.000Z',
      event: 'request-changes',
      head: shas.B,
    });
    expect(verdict?.text).toContain('Address this review of the branch feature/one');
    expect(verdict?.text).toContain('Name it half.');
    await expect(s.thread('feature/nope')).rejects.toMatchObject({ status: 404 });
  });

  it('reads a finished plan as plan ready: Claude Code says blocked, the thread has its report', async () => {
    const { repo } = fresh();
    const { claude, listed } = fakeClaude();
    const s = await service(repo, claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    const { recordEvent } = await import('../src/thread.js');
    const cpr = join(repo.root, 'cpr');
    const cwd = feature.worktree.path;
    Object.assign(listed[0] as AgentSession, { state: 'blocked', status: 'idle' });
    await recordEvent(
      cpr,
      { hook_event_name: 'UserPromptSubmit', session_id: 'session-1', cwd, prompt: 'Start' },
      '2026-10-15T09:00:01.000Z',
    );
    expect((await s.list()).features[0]?.agent.state).toBe('needs-you');
    await recordEvent(
      cpr,
      { hook_event_name: 'Stop', session_id: 'session-1', cwd, last_assistant_message: 'The plan' },
      '2026-10-15T09:00:02.000Z',
    );
    expect((await s.list()).features[0]?.agent.state).toBe('plan-ready');
    // Waiting on something named: still needs you.
    Object.assign(listed[0] as AgentSession, { waitingFor: 'permission prompt' });
    expect((await s.list()).features[0]?.agent).toMatchObject({
      state: 'needs-you',
      waitingFor: 'permission prompt',
    });
  });

  it("lists when each agent last acted: its thread's newest report or question, else its start (V23)", async () => {
    const { repo } = fresh();
    const { claude } = fakeClaude();
    const s = await service(repo, claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: true });
    await s.start({ brief: 'Two', branch: 'feature/two', planFirst: true });
    const lastActions = async () =>
      Object.fromEntries((await s.list()).features.map((f) => [f.branch, f.lastAction]));
    // Nothing reported yet: when the agents started.
    expect(await lastActions()).toEqual({
      'feature/one': NOW.toISOString(),
      'feature/two': NOW.toISOString(),
    });
    const { recordEvent } = await import('../src/thread.js');
    const cpr = join(repo.root, 'cpr');
    const cwd = feature.worktree.path;
    const event = (input: Record<string, unknown>, at: string) =>
      recordEvent(cpr, { session_id: 'session-1', cwd, ...input }, at);
    await event(
      { hook_event_name: 'Stop', last_assistant_message: 'The plan' },
      '2026-10-15T09:05:00.000Z',
    );
    // The person's answer and Claude Code's idle notice are not the agent's actions.
    await event(
      { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Waiting' },
      '2026-10-15T09:06:00.000Z',
    );
    await event({ hook_event_name: 'UserPromptSubmit', prompt: 'OK' }, '2026-10-15T09:07:00.000Z');
    expect(await lastActions()).toEqual({
      'feature/one': '2026-10-15T09:05:00.000Z',
      'feature/two': NOW.toISOString(),
    });
  });

  it('lists no last action for a feature whose agent was never found (V23)', async () => {
    const { repo } = fresh();
    const s = await service(repo, null);
    await s.start({ brief: 'Do it', branch: 'feature/x', planFirst: true });
    const [listed] = (await s.list()).features;
    expect(listed?.agent.state).toBe('no-agent');
    expect(listed).not.toHaveProperty('lastAction');
  });

  it('cleans up a merged feature: its sessions, worktree and branch; the record stays, finished', async () => {
    const { repo } = fresh();
    const { claude, remove } = fakeClaude();
    const s = await service(repo, claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: false });
    await commitIn(feature.worktree.path, 'src/c.ts', 'export const c = 1;\n');
    repo.git('merge', '--quiet', '--ff-only', 'feature/one');
    await s.clean({ branch: 'feature/one' });
    expect(remove).toHaveBeenCalledWith('s1');
    expect(existsSync(feature.worktree.path)).toBe(false);
    expect(repo.git('branch', '--list', 'feature/one')).toBe('');
    const saved = JSON.parse(
      readFileSync(join(repo.root, 'cpr', 'features', 'feature', 'one.json'), 'utf8'),
    ) as FeatureFile;
    expect(saved.finished).toBe(NOW.toISOString());
    expect((await s.list()).features).toEqual([]);
  });

  it('cleans up an unmerged feature only when asked: the worktree goes, the branch stays; never one with work', async () => {
    const { repo } = fresh();
    const { claude, remove, stop } = fakeClaude();
    const s = await service(repo, claude);
    const { feature } = await s.start({ brief: 'One', branch: 'feature/one', planFirst: false });
    await commitIn(feature.worktree.path, 'src/c.ts', 'export const c = 1;\n');
    await expect(s.clean({ branch: 'feature/one' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/not merged/) as string,
    });
    // Work not committed: nothing is touched, whatever is asked.
    writeFileSync(join(feature.worktree.path, 'notes.md'), 'todo\n');
    await expect(s.clean({ branch: 'feature/one', unmerged: true })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/1 file not committed/) as string,
    });
    expect(remove).not.toHaveBeenCalled();
    rmSync(join(feature.worktree.path, 'notes.md'));
    await s.clean({ branch: 'feature/one', unmerged: true });
    expect(stop).toHaveBeenCalledWith('s1');
    expect(remove).toHaveBeenCalledWith('s1');
    expect(existsSync(feature.worktree.path)).toBe(false);
    expect(repo.git('branch', '--list', 'feature/one')).toContain('feature/one');
  });
});

describe('claudeCode', () => {
  it('starts with --settings, resumes with no other flag, and removes a session', async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const run: Run = (_command, args, { cwd }) => {
      calls.push({ args, cwd });
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    const claude = claudeCode('/usr/bin/claude', { run, cwd: '/repo' });
    await claude.start({
      cwd: '/w',
      name: 'feature/x',
      prompt: 'Do it',
      permissionMode: 'default',
      addDir: '/repo/cpr',
      settings: '/repo/cpr/claude-settings.json',
    });
    await claude.resume({ sessionId: 'session-1', cwd: '/w', text: 'OK' });
    await claude.remove('s1');
    expect(calls).toEqual([
      {
        args: [
          '--bg',
          '--name',
          'feature/x',
          '--add-dir',
          '/repo/cpr',
          '--settings',
          '/repo/cpr/claude-settings.json',
          'Do it',
        ],
        cwd: '/w',
      },
      { args: ['--bg', '--resume', 'session-1', 'OK'], cwd: '/w' },
      { args: ['rm', 's1'], cwd: '/repo' },
    ]);
  });
});
