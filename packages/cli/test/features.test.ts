import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { listRefs, openRepo } from '@cpr/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import {
  agentState,
  featureBase,
  featurePath,
  featurePrompt,
  features,
  FeatureRefused,
  parseAccount,
  parseSessions,
  readFeature,
  serializeFeature,
  worktreeFolder,
  type AgentSession,
  type ClaudeCode,
  type FeatureFile,
} from '../src/features.js';
import { reviewPlace } from '../src/reviews.js';

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
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, serializeFeature(record()));
    expect(await readFeature(path)).toEqual(record());
    writeFileSync(path, '{ nope');
    expect(await readFeature(path)).toBeNull();
    expect(await readFeature(join(dir, 'missing.json'))).toBeNull();
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
        state: 'working',
      });
      return Promise.resolve({ ok: true });
    });
    const sessions = vi.fn<ClaudeCode['sessions']>(() => Promise.resolve(listed));
    const claude: ClaudeCode = {
      command: '/usr/bin/claude',
      start,
      sessions,
      account: () => Promise.resolve('your Pro subscription'),
    };
    return { claude, listed, start, sessions };
  }
  const service = (repo: TestRepo, claude: ClaudeCode | null) =>
    openRepo(repo.root).then((git) =>
      features(git, cache, { claude: () => Promise.resolve(claude), now: () => NOW, env: {} }),
    );

  it("offers the default branch's tip, the agent and its account, and where worktrees go", async () => {
    const { repo, shas } = fresh();
    const { claude } = fakeClaude();
    const options = await (await service(repo, claude)).options();
    expect(options).toEqual({
      base: { from: 'main', sha: shas.B },
      branchPrefix: 'feature/',
      worktrees: join(dirname(repo.root), `${basename(repo.root)}.worktrees`, '<branch>'),
      agent: {
        kind: 'claude',
        command: '/usr/bin/claude',
        account: 'your Pro subscription',
        permissionMode: 'default',
      },
      maxBrief: 20000,
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
      worktree: { path: folder, exists: true },
      tip: shas.B,
      ahead: 0,
      merged: false,
      agent: { state: 'working', kind: 'claude', id: 's1' },
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
      agent: { kind: 'claude', permissionMode: 'auto', started: NOW.toISOString() },
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

  it('lists nothing and asks no agent when no feature was started', async () => {
    const { repo } = fresh();
    const { claude, sessions } = fakeClaude();
    expect(await (await service(repo, claude)).list()).toEqual({
      features: [],
      place: 'repository',
    });
    expect(sessions).not.toHaveBeenCalled();
  });
});
