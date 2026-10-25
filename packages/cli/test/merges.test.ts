import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openRepo, type AgentModel, type MergeLogLine, type Verdict } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { run } from '../src/main.js';
import { merger, MergeRefused, readMergeConfig, type ChangedSymbols } from '../src/merges.js';
import type { RunCheck } from '../src/programs.js';
import { MERGER_INSTRUCTIONS, type MergerAgent } from '../src/merge-agent.js';
import { MERGER_ANSWER } from '../src/prompts.js';
import { AGENTS, serializeReview } from '../src/reviews.js';
import { serializeWorkspace, type WorkspaceFile } from '../src/workspace-record.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const EMAIL = 'ada@example.com';

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

/**
 * main: A ── M (adds src/m.ts); topic from A: T (adds src/t.ts). `main` is checked out in the
 * main checkout, as it usually is. `trunk` names the default branch (`master` for old projects).
 */
function setup({ trunk = 'main' }: { trunk?: string } = {}) {
  const repo = createRepo();
  repos.push(repo);
  repo.git('config', 'user.email', EMAIL);
  repo.git('config', 'user.name', 'Ada');
  if (trunk !== 'main') repo.git('branch', '-m', trunk);
  repo.write({ 'src/a.ts': 'export const a = 1;\n' });
  const A = repo.commit('A');
  repo.git('switch', '--quiet', '-c', 'topic');
  repo.write({ 'src/t.ts': 'export const t = 1;\n' });
  const T = repo.commit('T: add t');
  repo.git('switch', '--quiet', trunk);
  repo.write({ 'src/m.ts': 'export const m = 1;\n' });
  const M = repo.commit('M');
  return { repo, shas: { A, T, M } };
}

/** The reviewer's last verdict on `branch`, as Symbiote records it (V16, V17). */
function review(repo: TestRepo, branch: string, verdict: Partial<Verdict> & { head: string }) {
  const path = join(repo.root, 'symbiote', 'reviews', ...branch.split('/'), `${EMAIL}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(join(repo.root, 'symbiote', '.gitignore'), '*\n!config.json\n');
  writeFileSync(
    path,
    serializeReview({
      base: '',
      branch,
      drafts: [],
      head: verdict.head,
      marks: {},
      reviewer: EMAIL,
      summary: '',
      updated: NOW.toISOString(),
      verdicts: [
        { at: NOW.toISOString(), comments: [], event: 'approve', summary: '', ...verdict },
      ],
    }),
  );
}

function config(repo: TestRepo, merge: Record<string, unknown>) {
  mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
  writeFileSync(join(repo.root, 'symbiote', 'config.json'), JSON.stringify({ merge }));
}

/** A check that passes unless its command says `fail`; what it was asked, in order. */
function fakeChecks() {
  const asked: { command: string; cwd: string }[] = [];
  const run: RunCheck = (command, cwd) => {
    asked.push({ command, cwd });
    const failed = command.includes('fail');
    return Promise.resolve({
      code: failed ? 1 : 0,
      output: failed ? Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n') : 'ok\n',
    });
  };
  return { asked, run };
}

async function make(
  repo: TestRepo,
  runCheck = fakeChecks().run,
  more: Parameters<typeof merger>[2] = {},
) {
  return merger(await openRepo(repo.root), cache, { now: () => NOW, runCheck, ...more });
}

/** A merger agent that answers `answers` in turn; what it was asked. */
function fakeAgent(...answers: string[]) {
  const asked: Parameters<MergerAgent['run']>[0][] = [];
  const agent: MergerAgent = {
    kind: 'claude',
    run: (request) => {
      asked.push(request);
      const text = answers[asked.length - 1] ?? answers.at(-1) ?? '';
      return Promise.resolve({ ok: true, text, usage: { input: 1200, output: 80 }, ms: 4000 });
    },
  };
  return { asked, agent, find: () => Promise.resolve(agent) };
}

/**
 * main and topic both change src/a.ts's one line from `export const a = 1;`: one region. Main
 * also adds src/m.ts and topic src/t.ts (no conflict there).
 */
function conflicting() {
  const made = setup();
  const { repo } = made;
  repo.git('switch', '--quiet', 'topic');
  repo.write({ 'src/a.ts': 'export const a = "topic";\n' });
  const T2 = repo.commit('T2: a is topic');
  repo.git('switch', '--quiet', 'main');
  repo.write({ 'src/a.ts': 'export const a = "main";\n' });
  const M2 = repo.commit('M2: a is main');
  review(repo, 'topic', { head: T2, into: 'main' });
  return { ...made, shas: { ...made.shas, T2, M2 } };
}

const BOTH = JSON.stringify({
  regions: { '1': 'export const a = "main" + "topic";' },
  notes: { '1': 'kept both values' },
});

const subject = (repo: TestRepo, sha: string) => repo.git('log', '-1', '--format=%s', sha);
const parents = (repo: TestRepo, sha: string) =>
  repo.git('log', '-1', '--format=%P', sha).split(' ');

describe('readMergeConfig (V26a)', () => {
  it('reads merge.checks (a command or several) and merge.push; off and unset by default', () => {
    const { repo } = setup();
    expect(readMergeConfig(repo.root)).toEqual({ push: false });
    config(repo, { checks: 'pnpm check', push: true });
    expect(readMergeConfig(repo.root)).toEqual({ checks: ['pnpm check'], push: true });
    config(repo, { checks: ['pnpm install', 'pnpm check', ''] });
    expect(readMergeConfig(repo.root)).toEqual({
      checks: ['pnpm install', 'pnpm check'],
      push: false,
    });
  });
});

describe('queueing a merge (V26a)', () => {
  it('takes only an approved branch whose tip is the approved commit', async () => {
    const { repo, shas } = setup();
    const m = await make(repo);
    await expect(m.enqueue({ branch: 'topic', into: 'main' })).rejects.toThrow(/not approved/);
    review(repo, 'topic', { head: shas.T, event: 'request-changes' });
    await expect(m.enqueue({ branch: 'topic', into: 'main' })).rejects.toThrow(/not approved/);
    review(repo, 'topic', { head: shas.T, into: 'main' });
    await expect(m.enqueue({ branch: 'topic', into: 'topic' })).rejects.toThrow(/into itself/);
    await expect(m.enqueue({ branch: 'topic', into: 'nowhere' })).rejects.toThrow(/no branch/);
    await expect(m.enqueue({ branch: 'gone', into: 'main' })).rejects.toThrow(MergeRefused);

    // A commit after the approved one was not reviewed.
    repo.git('switch', '--quiet', 'topic');
    repo.write({ 'src/t.ts': 'export const t = 2;\n' });
    repo.commit('after the review');
    repo.git('switch', '--quiet', 'main');
    await expect(m.enqueue({ branch: 'topic', into: 'main' })).rejects.toThrow(
      /after the approved commit/,
    );
  });

  it('queues the approved commit with its title, once', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    const m = await make(repo);
    const entry = await m.enqueue({ branch: 'topic', into: 'main' }, { start: false });
    expect(entry).toMatchObject({
      branch: 'topic',
      head: shas.T,
      into: 'main',
      state: 'queued',
      title: 'Merge topic: T: add t',
      queued: NOW.toISOString(),
    });
    await expect(m.enqueue({ branch: 'topic', into: 'main' })).rejects.toThrow(/already queued/);
    expect((await m.list()).merges).toEqual([entry]);
  });

  it("titles a workspace's merge with the workspace's title", async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    const record: WorkspaceFile = {
      agent: null,
      base: shas.A,
      branch: 'topic',
      brief: '# Feature: Add t\n',
      created: NOW.toISOString(),
      from: 'main',
      kind: 'feature',
      planFirst: false,
      title: 'Add t',
      worktree: join(repo.root, '..', 'wt'),
    };
    mkdirSync(join(repo.root, 'symbiote', 'workspaces'), { recursive: true });
    writeFileSync(
      join(repo.root, 'symbiote', 'workspaces', 'topic.json'),
      serializeWorkspace(record),
    );
    const m = await make(repo);
    const entry = await m.enqueue({ branch: 'topic', into: 'main' }, { start: false });
    expect(entry.title).toBe('Merge topic: Add t');
  });
});

describe('merging, checking and landing (V26a)', () => {
  it('merges the approved commit with --no-ff, checks it, and fast-forwards the checkout that has main', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: ['pnpm install', 'pnpm check'] });
    const checks = fakeChecks();
    const m = await make(repo, checks.run);
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();

    const [entry] = (await m.list()).merges;
    expect(entry).toMatchObject({ state: 'landed', base: shas.M, landed: NOW.toISOString() });
    expect(entry?.check).toMatchObject({
      commands: ['pnpm install', 'pnpm check'],
      source: 'symbiote/config.json (merge.checks)',
      ok: true,
    });
    const merge = entry?.merge ?? '';
    expect(repo.git('rev-parse', 'main')).toBe(merge);
    expect(parents(repo, merge)).toEqual([shas.M, shas.T]);
    expect(subject(repo, merge)).toBe('Merge topic: T: add t');
    // The main checkout moved with its branch: its files are the merge's.
    expect(repo.git('status', '--porcelain', '--untracked-files=no')).toBe('');
    expect(existsSync(join(repo.root, 'src', 't.ts'))).toBe(true);
    // The check ran in Symbiote's merge worktree, not in the person's checkout.
    expect(checks.asked.map((a) => a.command)).toEqual(['pnpm install', 'pnpm check']);
    expect(checks.asked[0]?.cwd).not.toBe(repo.root);
    expect(checks.asked[0]?.cwd.startsWith(cache)).toBe(true);
  });

  it('keeps main as it was when the check fails, with the end of its output', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: ['first', 'then fail', 'never'] });
    const checks = fakeChecks();
    const m = await make(repo, checks.run);
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();

    const [entry] = (await m.list()).merges;
    expect(entry?.state).toBe('failed');
    expect(entry?.check).toMatchObject({ ok: false, failed: 'then fail' });
    const lines = entry?.check?.output?.split('\n') ?? [];
    expect(lines).toHaveLength(60);
    expect(lines.at(-1)).toBe('line 80');
    expect(checks.asked.map((a) => a.command)).toEqual(['first', 'then fail']);
    expect(repo.git('rev-parse', 'main')).toBe(shas.M);
  });

  it('runs a real check in the merge, through the shell', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: ['test -f src/t.ts && test -f src/m.ts'] });
    const m = merger(await openRepo(repo.root), cache, { now: () => NOW });
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    expect((await m.list()).merges[0]?.state).toBe('landed');
  });

  it('guesses the check from main when none is set', async () => {
    const { repo, shas } = setup();
    repo.write({ Makefile: 'check:\n\ttrue\n' });
    const M2 = repo.commit('a Makefile');
    review(repo, 'topic', { head: shas.T, into: 'main' });
    const checks = fakeChecks();
    const m = await make(repo, checks.run);
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry).toMatchObject({ state: 'landed', base: M2 });
    expect(entry?.check).toMatchObject({
      commands: ['make check'],
      source: 'Makefile (check target)',
    });
  });

  it("installs first when the check is guessed from package.json: Symbiote's worktree has no dependencies", async () => {
    const { repo, shas } = setup();
    repo.write({
      'package.json': JSON.stringify({ scripts: { check: 'tsc' }, packageManager: 'pnpm@12.1.0' }),
    });
    repo.commit('a package');
    review(repo, 'topic', { head: shas.T, into: 'main' });
    const checks = fakeChecks();
    const m = await make(repo, checks.run);
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry?.check).toMatchObject({
      commands: ['pnpm install', 'pnpm run check'],
      source: 'package.json (scripts.check), after an install',
      ok: true,
    });
  });

  it('never lands unasked without a check: it waits at ready for Land', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [ready] = (await m.list()).merges;
    expect(ready?.state).toBe('ready');
    expect(ready?.check).toBeUndefined();
    expect(ready?.message).toMatch(/no check/);
    expect(repo.git('rev-parse', 'main')).toBe(shas.M);

    const landed = await m.land(id);
    expect(landed.state).toBe('landed');
    expect(repo.git('rev-parse', 'main')).toBe(ready?.merge);
  });

  it('changes nothing when local changes in the checkout would be overwritten; Land tries again', async () => {
    const { repo, shas } = setup();
    // The branch changes a file the person is editing.
    repo.git('switch', '--quiet', 'topic');
    repo.write({ 'src/a.ts': 'export const a = 2;\n' });
    const T2 = repo.commit('T2: change a');
    repo.git('switch', '--quiet', 'main');
    review(repo, 'topic', { head: T2, into: 'main' });
    repo.write({ 'src/a.ts': 'export const a = 3; // mine\n' });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();

    let entry = await m.land(id);
    expect(entry.state).toBe('ready');
    expect(entry.message).toMatch(/local changes/);
    expect(repo.git('rev-parse', 'main')).toBe(shas.M);
    expect(readFileSync(join(repo.root, 'src', 'a.ts'), 'utf8')).toBe(
      'export const a = 3; // mine\n',
    );

    repo.git('checkout', '--', 'src/a.ts');
    entry = await m.land(id);
    expect(entry.state).toBe('landed');
    expect(repo.git('rev-parse', 'main')).toBe(entry.merge);
  });

  it('moves a branch checked out nowhere with update-ref, from the value it was merged on', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: 'ok' });
    repo.git('switch', '--quiet', '-c', 'elsewhere');
    const m = await make(repo);
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry?.state).toBe('landed');
    expect(repo.git('rev-parse', 'main')).toBe(entry?.merge);
    expect(repo.git('rev-parse', 'HEAD')).toBe(shas.M);
  });

  it('merges again on the new tip when the target moved before landing', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    repo.write({ 'src/n.ts': 'export const n = 1;\n' });
    const N = repo.commit('N');

    const requeued = await m.land(id);
    expect(requeued.state).toBe('queued');
    expect(requeued.message).toMatch(/main moved/);
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry).toMatchObject({ state: 'ready', base: N });
    expect(parents(repo, entry?.merge ?? '')).toEqual([N, shas.T]);
    expect(repo.git('rev-parse', 'main')).toBe(N);
  });

  it('stops at a conflict, naming the files; main and the merge worktree are left clean', async () => {
    const { repo } = setup();
    repo.git('switch', '--quiet', 'topic');
    repo.write({ 'src/a.ts': 'export const a = "topic";\n' });
    const T2 = repo.commit('T2');
    repo.git('switch', '--quiet', 'main');
    repo.write({ 'src/a.ts': 'export const a = "main";\n' });
    const M2 = repo.commit('M2');
    review(repo, 'topic', { head: T2, into: 'main' });
    const checks = fakeChecks();
    const m = await make(repo, checks.run);
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();

    const [entry] = (await m.list()).merges;
    expect(entry).toMatchObject({ state: 'needs-you', conflicts: ['src/a.ts'], base: M2 });
    expect(entry?.merge).toBeUndefined();
    expect(checks.asked).toEqual([]);
    expect(repo.git('rev-parse', 'main')).toBe(M2);
    // No merge left half-done in Symbiote's worktree.
    const worktree = join(cache, 'worktrees', (await openRepo(repo.root)).id, 'merge');
    expect(repo.git('-C', worktree, 'status', '--porcelain')).toBe('');
    expect(repo.git('-C', worktree, 'rev-parse', 'HEAD')).toBe(M2);
  });

  it('merges one at a time, each on the result of the last', async () => {
    const { repo, shas } = setup();
    repo.git('switch', '--quiet', '-c', 'second', shas.A);
    repo.write({ 'src/s.ts': 'export const s = 1;\n' });
    const S = repo.commit('S');
    repo.git('switch', '--quiet', 'main');
    review(repo, 'topic', { head: shas.T, into: 'main' });
    review(repo, 'second', { head: S, into: 'main' });
    config(repo, { checks: 'ok' });
    const m = await make(repo);
    await m.enqueue({ branch: 'topic', into: 'main' }, { start: false });
    await m.enqueue({ branch: 'second', into: 'main' });
    await m.idle();

    const [first, second] = (await m.list()).merges;
    expect([first?.state, second?.state]).toEqual(['landed', 'landed']);
    expect(second?.base).toBe(first?.merge);
    expect(repo.git('rev-parse', 'main')).toBe(second?.merge);
  });

  it('holds the next merge into a branch while one waits to land there', async () => {
    const { repo, shas } = setup();
    repo.git('switch', '--quiet', '-c', 'second', shas.A);
    repo.write({ 'src/s.ts': 'export const s = 1;\n' });
    const S = repo.commit('S');
    repo.git('switch', '--quiet', 'main');
    review(repo, 'topic', { head: shas.T, into: 'main' });
    review(repo, 'second', { head: S, into: 'main' });
    const m = await make(repo);
    const first = await m.enqueue({ branch: 'topic', into: 'main' }, { start: false });
    await m.enqueue({ branch: 'second', into: 'main' });
    await m.idle();
    expect((await m.list()).merges.map((e) => e.state)).toEqual(['ready', 'queued']);

    await m.land(first.id);
    await m.idle();
    const [landed, next] = (await m.list()).merges;
    expect(landed?.state).toBe('landed');
    expect(next).toMatchObject({ state: 'ready', base: landed?.merge });
  });

  it('retries a failed merge and removes an entry', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: 'fail' });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    expect((await m.list()).merges[0]?.state).toBe('failed');

    config(repo, { checks: 'ok' });
    await m.retry(id);
    await m.idle();
    expect((await m.list()).merges[0]?.state).toBe('landed');

    await m.remove(id);
    await m.idle();
    expect((await m.list()).merges).toEqual([]);
    await expect(m.land(id)).rejects.toThrow(/no merge/);
  });

  it('pushes after landing only with merge.push', async () => {
    const { repo, shas } = setup();
    const remote = tempDir();
    folders.push(remote);
    repo.git('init', '--quiet', '--bare', remote);
    repo.git('remote', 'add', 'origin', remote);
    repo.git('push', '--quiet', '-u', 'origin', 'main');
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: 'ok', push: true });
    const m = await make(repo);
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry?.pushed).toEqual({ ok: true, remote: 'origin' });
    expect(repo.git('--git-dir', remote, 'rev-parse', 'main')).toBe(entry?.merge);
  });
});

describe('the merger agent (V26c)', () => {
  it('answers each region; Symbiote writes it, commits the merge, checks it, and waits for review', async () => {
    const { repo, shas } = conflicting();
    config(repo, { checks: 'ok' });
    const agent = fakeAgent(BOTH);
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();

    const [entry] = (await m.list()).merges;
    expect(entry).toMatchObject({ state: 'needs-you', base: shas.M2, check: { ok: true } });
    expect(entry?.resolution).toEqual({
      agent: 'claude',
      model: 'sonnet',
      regions: [
        {
          path: 'src/a.ts',
          line: 1,
          ours: ['export const a = "main";'],
          base: ['export const a = 1;'],
          theirs: ['export const a = "topic";'],
          around: { before: [], after: [] },
          text: 'export const a = "main" + "topic";',
          note: 'kept both values',
        },
      ],
      usage: { input: 1200, output: 80 },
      ms: 4000,
    });
    const merge = entry?.merge ?? '';
    expect(parents(repo, merge)).toEqual([shas.M2, shas.T2]);
    expect(subject(repo, merge)).toBe('Merge topic: T2: a is topic');
    expect(repo.git('show', `${merge}:src/a.ts`)).toBe('export const a = "main" + "topic";');
    // Not landed before the person reviews it.
    expect(repo.git('rev-parse', 'main')).toBe(shas.M2);

    // Asked in Symbiote's merge worktree, with the region and the sides: not the other files.
    expect(agent.asked).toHaveLength(1);
    expect(agent.asked[0]?.cwd.startsWith(cache)).toBe(true);
    expect(agent.asked[0]?.model).toBe('sonnet');
    const prompt = agent.asked[0]?.prompt ?? '';
    expect(prompt).toContain('main (ours): M2: a is main');
    expect(prompt).toContain('topic (theirs): T2: a is topic');
    expect(prompt).toContain('<<<<<<< main\nexport const a = "main";\n||||||| ancestor');
    expect(prompt).not.toContain('export const m');
    expect(agent.asked[0]?.instructions).toBe(MERGER_INSTRUCTIONS);

    const landed = await m.approve(id);
    expect(landed.state).toBe('landed');
    expect(repo.git('rev-parse', 'main')).toBe(merge);
    expect(readFileSync(join(repo.root, 'src', 'a.ts'), 'utf8')).toBe(
      'export const a = "main" + "topic";\n',
    );
  });

  it("gives the merger the project's instructions, then Symbiote's answer format (V28)", async () => {
    const { repo } = conflicting();
    mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
    writeFileSync(
      join(repo.root, 'symbiote', 'config.json'),
      JSON.stringify({ prompts: { merger: ['Resolve conflicts.', 'Keep both values.'] } }),
    );
    const agent = fakeAgent(BOTH);
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find });
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    expect(agent.asked[0]?.instructions).toBe(
      `Resolve conflicts.\nKeep both values.\n\n${MERGER_ANSWER}`,
    );
  });

  it('stops when the agent says the person must decide: no merge, the worktree clean', async () => {
    const { repo, shas } = conflicting();
    const agent = fakeAgent('{"needsYou": "region 1: main and topic set a to different values"}');
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry).toMatchObject({ state: 'needs-you', conflicts: ['src/a.ts'] });
    expect(entry?.resolution).toMatchObject({
      regions: [],
      needsYou: 'region 1: main and topic set a to different values',
    });
    expect(entry?.merge).toBeUndefined();
    await expect(m.approve(id)).rejects.toThrow(/nothing to approve/);
    const worktree = join(cache, 'worktrees', (await openRepo(repo.root)).id, 'merge');
    expect(repo.git('-C', worktree, 'status', '--porcelain')).toBe('');
    expect(repo.git('rev-parse', 'main')).toBe(shas.M2);
  });

  it('keeps the regions it asked about, numbered as its prompt numbers them (fix/merge-viewer-on-conflict)', async () => {
    const { repo } = conflicting();
    const agent = fakeAgent('{"needsYou": "region 1: main and topic set a to different values"}');
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find });
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry?.resolution?.asked).toEqual([
      {
        path: 'src/a.ts',
        line: 1,
        ours: ['export const a = "main";'],
        base: ['export const a = 1;'],
        theirs: ['export const a = "topic";'],
        around: { before: [], after: [] },
      },
    ]);
  });

  it("answers the agent's question: it runs again with it, and keeps the files meanwhile", async () => {
    const { repo } = conflicting();
    const agent = fakeAgent('{"needsYou": "region 1: which value?"}', BOTH);
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const queued = await m.requestChanges(id, 'Both: main first.');
    // The files it asked about stay listed while it runs again.
    expect(queued).toMatchObject({ state: 'queued', conflicts: ['src/a.ts'] });
    await m.idle();
    const prompt = agent.asked[1]?.prompt ?? '';
    expect(prompt).toContain(
      'You asked: region 1: which value?\nThe person answered: Both: main first.',
    );
    expect(prompt).not.toContain('Your earlier answer was reviewed');
    const [entry] = (await m.list()).merges;
    expect(entry?.resolution?.regions[0]?.text).toBe('export const a = "main" + "topic";');
    expect(entry?.resolution?.needsYou).toBeUndefined();
  });

  it('keeps the files while it asks again, and none once the merge is clean', async () => {
    const { repo } = conflicting();
    const m = await make(repo, fakeChecks().run, { mergerAgent: fakeAgent(BOTH).find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const queued = await m.requestChanges(id, "Keep main's value.");
    expect(queued).toMatchObject({ state: 'queued', conflicts: ['src/a.ts'] });
    // main takes topic's value meanwhile: asked again, the merge no longer conflicts.
    repo.write({ 'src/a.ts': 'export const a = "topic";\n' });
    repo.commit('M3: a is topic');
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry?.conflicts).toBeUndefined();
    expect(entry?.resolution).toBeUndefined();
  });

  it('keeps the 3 lines around each region its prompt showed, which stay in the file', async () => {
    const { repo } = setup();
    const lines = (middle: string) =>
      ['one', 'two', 'three', 'four', middle, 'six', 'seven', 'eight', 'nine', ''].join('\n');
    repo.write({ 'src/n.ts': lines('five') });
    repo.commit('n');
    repo.git('switch', '--quiet', 'topic');
    repo.git('merge', '--quiet', 'main');
    repo.write({ 'src/n.ts': lines('FIVE') });
    const T2 = repo.commit('T2: shout');
    repo.git('switch', '--quiet', 'main');
    repo.write({ 'src/n.ts': lines('5') });
    repo.commit('M2: count');
    review(repo, 'topic', { head: T2, into: 'main' });
    const agent = fakeAgent(JSON.stringify({ regions: { '1': '5' } }));
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find });
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry?.resolution?.regions[0]?.around).toEqual({
      before: ['two', 'three', 'four'],
      after: ['six', 'seven', 'eight'],
    });
    expect(agent.asked[0]?.prompt).toContain('two\nthree\nfour\n<<<<<<< main');
  });

  it('takes no answer that leaves a region out', async () => {
    const { repo } = conflicting();
    const m = await make(repo, fakeChecks().run, {
      mergerAgent: fakeAgent('{"regions": {}}').find,
    });
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry?.state).toBe('needs-you');
    expect(entry?.message).toMatch(
      /the merger agent's answer: the answer has no text for region 1/,
    );
    expect(entry?.merge).toBeUndefined();
  });

  it("runs again with the person's words and the earlier answer", async () => {
    const { repo } = conflicting();
    const again = JSON.stringify({ regions: { '1': 'export const a = "main";' } });
    const agent = fakeAgent(BOTH, again);
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const queued = await m.requestChanges(id, "Keep main's value.");
    expect(queued.state).toBe('queued');
    await m.idle();

    expect(agent.asked).toHaveLength(2);
    expect(agent.asked[1]?.prompt).toContain(
      "Your earlier answer was reviewed: Keep main's value.\nIt was:",
    );
    expect(agent.asked[1]?.prompt).toContain('"1":"export const a = \\"main\\" + \\"topic\\";"');
    const [entry] = (await m.list()).merges;
    expect(entry?.resolution?.regions[0]?.text).toBe('export const a = "main";');
    expect(entry?.again).toBeUndefined();
  });

  it('gives the agent symbiote/merge.md, the symbols both sides changed, and merge.model', async () => {
    const { repo } = conflicting();
    config(repo, { model: 'opus' });
    writeFileSync(join(repo.root, 'symbiote', 'merge.md'), 'Prefer main for constants.\n');
    const agent = fakeAgent(BOTH);
    const asked: string[] = [];
    const changedSymbols: ChangedSymbols = (from, to, files) => {
      asked.push(`${from.slice(0, 7)}..${to.slice(0, 7)} ${files.join(',')}`);
      return Promise.resolve([
        { path: 'src/a.ts', name: 'a', kind: 'variable', status: 'modified' },
        ...(to === repo.git('rev-parse', 'main')
          ? [{ path: 'src/a.ts', name: 'onlyMain', kind: 'function', status: 'added' as const }]
          : []),
      ]);
    };
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find, changedSymbols });
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const prompt = agent.asked[0]?.prompt ?? '';
    expect(agent.asked[0]?.model).toBe('opus');
    expect(prompt).toContain(
      "The project's merge rules (symbiote/merge.md):\n\nPrefer main for constants.",
    );
    expect(prompt).toContain('- src/a.ts: a (variable): main modified, topic modified');
    expect(prompt).not.toContain('onlyMain');
    expect(asked).toHaveLength(2);
    expect(asked.every((a) => a.endsWith(' src/a.ts'))).toBe(true);
  });

  it('gives no one a file deleted on one side', async () => {
    const { repo, shas } = setup();
    repo.git('switch', '--quiet', 'topic');
    repo.git('rm', '--quiet', 'src/a.ts');
    const T2 = repo.commit('T2: remove a');
    repo.git('switch', '--quiet', 'main');
    repo.write({ 'src/a.ts': 'export const a = "main";\n' });
    repo.commit('M2');
    review(repo, 'topic', { head: T2, into: 'main' });
    const agent = fakeAgent(BOTH);
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find });
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry).toMatchObject({ state: 'needs-you', conflicts: ['src/a.ts'] });
    expect(entry?.message).toMatch(/src\/a\.ts is deleted on one side/);
    // Each file not given to the agent, and why: the merge page lists them (V46c).
    expect(entry?.unresolvable).toEqual([{ path: 'src/a.ts', kind: 'deleted' }]);
    expect(agent.asked).toEqual([]);
    expect(shas.M).not.toBe(repo.git('rev-parse', 'main'));
  });

  it('waits for the person when its check failed, and lands it on Approve: the person decides', async () => {
    const { repo, shas } = conflicting();
    config(repo, { checks: ['ok', 'then fail'] });
    const m = await make(repo, fakeChecks().run, { mergerAgent: fakeAgent(BOTH).find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry).toMatchObject({ state: 'needs-you', check: { ok: false, failed: 'then fail' } });
    expect(repo.git('rev-parse', 'main')).toBe(shas.M2);

    const landed = await m.approve(id);
    expect(landed).toMatchObject({ state: 'landed', check: { ok: false, failed: 'then fail' } });
    expect(repo.git('rev-parse', 'main')).toBe(entry?.merge);
  });

  it('runs a failed check again on the same merge: its resolution kept, no agent asked', async () => {
    const { repo, shas } = conflicting();
    config(repo, { checks: ['ok', 'flaky'] });
    // `flaky` fails its first run only; each run says which commit the worktree had.
    const ran: { command: string; head: string }[] = [];
    let cwd = '';
    const runCheck: RunCheck = (command, at) => {
      cwd = at;
      const head = execFileSync('git', ['-C', at, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
      ran.push({ command, head: head.trim() });
      const failed = command === 'flaky' && ran.filter((r) => r.command === 'flaky').length === 1;
      return Promise.resolve({ code: failed ? 1 : 0, output: failed ? '1 failed\n' : 'ok\n' });
    };
    const agent = fakeAgent(BOTH);
    const m = await make(repo, runCheck, { mergerAgent: agent.find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [before] = (await m.list()).merges;
    expect(before).toMatchObject({ state: 'needs-you', check: { ok: false, failed: 'flaky' } });
    // Another merge in the meantime leaves the worktree elsewhere.
    execFileSync('git', ['-C', cwd, 'checkout', '--quiet', '--detach', shas.M2]);

    expect(await m.recheck(id)).toMatchObject({ state: 'queued', recheck: true });
    await m.idle();
    const [after] = (await m.list()).merges;
    expect(after).toMatchObject({
      state: 'needs-you',
      base: shas.M2,
      merge: before?.merge,
      check: { ok: true },
    });
    expect(after?.resolution).toEqual(before?.resolution);
    expect(after?.recheck).toBeUndefined();
    expect(agent.asked).toHaveLength(1);
    expect(ran.map((r) => r.command)).toEqual(['ok', 'flaky', 'ok', 'flaky']);
    expect(ran.slice(2).every((r) => r.head === before?.merge)).toBe(true);
    expect(repo.git('rev-parse', 'main')).toBe(shas.M2);
  });

  it('runs the check again only for a resolution whose check failed', async () => {
    const { repo } = conflicting();
    config(repo, { checks: 'ok' });
    const m = await make(repo, fakeChecks().run, { mergerAgent: fakeAgent(BOTH).find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    await expect(m.recheck(id)).rejects.toThrow(/no failed check to run again/);
  });
});

describe('the config a landing reads (V26a)', () => {
  it('decides the push before landing: not from the config file the landing brings', async () => {
    const { repo, shas } = setup();
    const remote = tempDir();
    folders.push(remote);
    repo.git('init', '--quiet', '--bare', remote);
    repo.git('remote', 'add', 'origin', remote);
    repo.git('push', '--quiet', '-u', 'origin', 'main');
    // The branch commits a config that pushes; the checkout has none.
    repo.git('switch', '--quiet', 'topic');
    repo.write({ 'symbiote/config.json': JSON.stringify({ merge: { checks: 'ok', push: true } }) });
    const T2 = repo.commit('T2: push merges');
    repo.git('switch', '--quiet', 'main');
    review(repo, 'topic', { head: T2, into: 'main' });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const landed = await m.land(id);
    expect(landed.state).toBe('landed');
    expect(existsSync(join(repo.root, 'symbiote', 'config.json'))).toBe(true);
    expect(landed.pushed).toBeUndefined();
    expect(repo.git('--git-dir', remote, 'rev-parse', 'main')).toBe(shas.M);
  });
});

describe('into which branch (V26a)', () => {
  it('preselects the workspace’s from, else the verdict’s into, else the default branch', async () => {
    const { repo, shas } = setup();
    repo.git('branch', 'develop', shas.M);
    const m = await make(repo);
    let targets = await m.targets('topic');
    expect(targets.branches).toEqual(['develop', 'main']);
    expect(targets.into).toBe('main');
    expect(targets.blocked).toMatch(/not approved/);

    review(repo, 'topic', { head: shas.T, into: 'develop' });
    targets = await m.targets('topic');
    expect(targets).toMatchObject({ into: 'develop', head: shas.T });
    expect(targets.blocked).toBeUndefined();

    mkdirSync(join(repo.root, 'symbiote', 'workspaces'), { recursive: true });
    writeFileSync(
      join(repo.root, 'symbiote', 'workspaces', 'topic.json'),
      serializeWorkspace({
        agent: null,
        base: shas.A,
        branch: 'topic',
        brief: 'b',
        created: NOW.toISOString(),
        from: 'main',
        planFirst: false,
        worktree: join(repo.root, '..', 'wt'),
      }),
    );
    expect((await m.targets('topic')).into).toBe('main');
  });

  it('merges into master in an old project', async () => {
    const { repo, shas } = setup({ trunk: 'master' });
    review(repo, 'topic', { head: shas.T });
    config(repo, { checks: 'ok' });
    const m = await make(repo);
    const targets = await m.targets('topic');
    expect(targets.into).toBe('master');
    await m.enqueue({ branch: 'topic', into: 'master' });
    await m.idle();
    expect(repo.git('rev-parse', 'master')).toBe((await m.list()).merges[0]?.merge);
  });

  it('lands a merge into a branch that is not the default in the worktree that has it', async () => {
    const { repo, shas } = setup();
    const folder = join(tempDir(), 'develop');
    folders.push(dirname(folder));
    repo.git('worktree', 'add', '--quiet', '-b', 'develop', folder, shas.M);
    review(repo, 'topic', { head: shas.T });
    config(repo, { checks: 'ok' });
    const m = await make(repo);
    await m.enqueue({ branch: 'topic', into: 'develop' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry?.state).toBe('landed');
    expect(repo.git('rev-parse', 'develop')).toBe(entry?.merge);
    expect(existsSync(join(folder, 'src', 't.ts'))).toBe(true);
    expect(repo.git('rev-parse', 'main')).toBe(shas.M);
  });

  it('merges into a branch only a remote has, making the local branch', async () => {
    const { repo, shas } = setup();
    repo.git('update-ref', 'refs/remotes/origin/release', shas.M);
    review(repo, 'topic', { head: shas.T });
    config(repo, { checks: 'ok' });
    const m = await make(repo);
    expect((await m.targets('topic')).branches).toEqual(['main', 'release']);
    await m.enqueue({ branch: 'topic', into: 'release' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    expect(entry).toMatchObject({ state: 'landed', base: shas.M });
    expect(repo.git('rev-parse', 'release')).toBe(entry?.merge);
  });
});

describe('symbiote merge (V26a)', () => {
  /** `env`: more of the environment, as `{ env }` before the arguments. */
  async function symbioteMerge(repo: TestRepo, ...args: (string | { env: NodeJS.ProcessEnv })[]) {
    let stdout = '';
    let stderr = '';
    const env = args.find((a) => typeof a !== 'string')?.env ?? {};
    const code = await run(['merge', ...args.filter((a) => typeof a === 'string')], {
      cwd: repo.root,
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      openUrl: () => undefined,
      waitForExit: () => Promise.resolve(),
      env: { ...process.env, SYMBIOTE_CACHE_DIR: cache, ...env },
    });
    return { code, stdout, stderr };
  }

  /** A fake Claude Code whose `-p` runs answer `answers` in turn, as `stream-json`'s result. */
  function fakeClaude(...answers: string[]): string {
    const folder = tempDir();
    folders.push(folder);
    const script = join(folder, 'claude');
    writeFileSync(
      script,
      `#!/usr/bin/env node
const fs = require('node:fs');
if (!process.argv.includes('-p')) process.exit(0);
fs.readFileSync(0, 'utf8');
const count = ${JSON.stringify(join(folder, 'runs'))};
const n = fs.existsSync(count) ? Number(fs.readFileSync(count, 'utf8')) : 0;
fs.writeFileSync(count, String(n + 1));
const answers = ${JSON.stringify(answers)};
const result = answers[Math.min(n, answers.length - 1)];
process.stdout.write(JSON.stringify({ type: 'result', result, is_error: false }) + '\\n');
`,
      { mode: 0o755 },
    );
    return script;
  }

  it('prints what the agent asked with the regions it asked about, and answers it with --again (fix/merge-viewer-on-conflict)', async () => {
    const { repo } = conflicting();
    const env = { SYMBIOTE_CLAUDE: fakeClaude('{"needsYou": "Region 1: which value?"}', BOTH) };
    let result = await symbioteMerge(repo, { env }, 'topic');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      [
        'needs you: the merger agent: Region 1: which value?',
        '  Region 1 · src/a.ts:1',
        '    main | export const a = "main";',
        '    topic | export const a = "topic";',
        '  then --again "<your answer>"',
      ].join('\n'),
    );
    result = await symbioteMerge(repo, { env }, 'topic', '--again', 'Both: main first.');
    expect(result.stdout).toMatch(/^needs you: review the resolution/m);
  });

  it('merges, checks and lands, printing each state', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: 'test -f src/t.ts' });
    const { code, stdout } = await symbioteMerge(repo, 'topic');
    expect(code).toBe(0);
    const merge = repo.git('rev-parse', 'main');
    expect(stdout.split('\n').map((line) => line.replace(/ \(\d+\.\d s\)/, ''))).toEqual([
      `queued: ${shas.T.slice(0, 7)} into main`,
      `merging into main at ${shas.M.slice(0, 7)}`,
      'checking: test -f src/t.ts (symbiote/config.json (merge.checks))',
      'ready to land',
      `landed: main is at ${merge.slice(0, 7)}`,
      '',
    ]);
  });

  it('says why it does not merge, and waits for --land without a check', async () => {
    const { repo, shas } = setup();
    let result = await symbioteMerge(repo, 'topic');
    expect(result).toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/not approved/) as unknown,
    });

    review(repo, 'topic', { head: shas.T, into: 'main' });
    result = await symbioteMerge(repo, 'topic', '--into', 'main');
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/ready to land: no check/);
    expect(repo.git('rev-parse', 'main')).toBe(shas.M);

    result = await symbioteMerge(repo, 'topic', '--land');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^landed: main is at/m);
    expect(repo.git('rev-parse', 'main')).not.toBe(shas.M);
  });

  it('lands a resolution whose check failed on --approve, and still says the check failed', async () => {
    const { repo } = conflicting();
    config(repo, { checks: ['ok', 'then fail'] });
    const m = await make(repo, fakeChecks().run, { mergerAgent: fakeAgent(BOTH).find });
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const { code, stdout } = await symbioteMerge(repo, 'topic', '--approve');
    expect(code).toBe(0);
    expect(stdout).toMatch(
      /^landed: main is at [0-9a-f]{7} \(\d+\.\d s\); its check failed: then fail$/m,
    );
  });
});

describe("the agents' instructions (V26a)", () => {
  it('no longer tell an agent to merge an approval: Symbiote merges it', () => {
    expect(AGENTS).not.toMatch(/git merge --no-ff/);
    expect(AGENTS).toMatch(/Symbiote\n {2}merges it/);
  });
});

/** A log's lines in short: `step <kind> <title>`, `out <text>`, `end ok|failed`, `run <why>`. */
function shortLog(lines: readonly MergeLogLine[]): string[] {
  return lines.map((line) =>
    'step' in line
      ? `step ${line.step} ${line.title}`
      : 'end' in line
        ? `end ${line.end.ok ? 'ok' : 'failed'}`
        : 'run' in line
          ? `run ${line.run}`
          : 'out' in line
            ? `out ${line.out.trimEnd()}`
            : 'agent',
  );
}

async function logOf(m: Awaited<ReturnType<typeof make>>, id: string): Promise<MergeLogLine[]> {
  return (await m.log(id))?.lines ?? [];
}

describe("a merge's log (V46a)", () => {
  it('logs each step of a clean merge in order: the merge, each check command and its output, the landing', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: ['pnpm install', 'pnpm check'] });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    const merge = entry?.merge?.slice(0, 7) ?? '';

    const lines = await logOf(m, id);
    expect(shortLog(lines)).toEqual([
      'step merge Merge topic into main',
      `out Symbiote's merge worktree at main (${shas.M.slice(0, 7)})`,
      `out Merged ${shas.T.slice(0, 7)}: ${merge}`,
      'end ok',
      'step check pnpm install',
      'out ok',
      'end ok',
      'step check pnpm check',
      'out ok',
      'end ok',
      'step land Land in main',
      `out main fast-forwarded to ${merge} in ${repo.root}`,
      'end ok',
    ]);
    for (const line of lines) expect(typeof line.at).toBe('number');
    for (const line of lines) if ('end' in line) expect(line.end.ms).toBeGreaterThanOrEqual(0);
  });

  it('logs a failed check up to its failed command: the commands after it have no step', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: ['first', 'then fail', 'never'] });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const steps = shortLog(await logOf(m, id)).filter((l) => /^(step|end)/.test(l));
    expect(steps).toEqual([
      'step merge Merge topic into main',
      'end ok',
      'step check first',
      'end ok',
      'step check then fail',
      'end failed',
    ]);
    // All of its output, not only the 60 lines the entry keeps.
    const out = shortLog(await logOf(m, id)).filter((l) => l.startsWith('out line '));
    expect(out).toEqual([
      `out ${Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n')}`,
    ]);
  });

  it("has a check's output in the log while the command still runs", async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: 'slow' });
    let finish = () => {};
    let started = () => {};
    const halfway = new Promise<void>((done) => (started = done));
    const runCheck: RunCheck = (_command, _cwd, onOutput) =>
      new Promise((done) => {
        onOutput?.('first half\n');
        started();
        finish = () => {
          onOutput?.('second half\n');
          done({ code: 0, output: 'first half\nsecond half\n' });
        };
      });
    const m = await make(repo, runCheck);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await halfway;

    const running = shortLog(await logOf(m, id));
    expect(running.slice(-2)).toEqual(['step check slow', 'out first half']);
    const read = await m.log(id);
    finish();
    await m.idle();
    // Read on from where the last read stopped: only what came since.
    const next = await m.log(id, read?.next);
    expect(shortLog(next?.lines ?? []).slice(0, 2)).toEqual(['out second half', 'end ok']);
  });

  it("logs the merger agent's step between the merge and the check", async () => {
    const { repo } = conflicting();
    config(repo, { checks: 'ok' });
    const m = await make(repo, fakeChecks().run, { mergerAgent: fakeAgent(BOTH).find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const [entry] = (await m.list()).merges;
    const log = shortLog(await logOf(m, id));
    expect(log).toEqual([
      'step merge Merge topic into main',
      expect.stringMatching(/^out Symbiote's merge worktree at main/),
      'out 1 file conflicts: src/a.ts',
      'end ok',
      'step resolve Merger agent',
      expect.stringMatching(/^out Symbols both sides changed in src\/a\.ts: \d+ \(\d+\.\d s\)$/),
      expect.stringMatching(
        /^out Asking Claude Code \(sonnet\): 1 region in 1 file, [\d,]+ characters$/,
      ),
      'out Answered in 4.0 s · 1.2K tokens in, 80 out',
      `out Wrote 1 region in 1 file; committed the merge ${entry?.merge?.slice(0, 7) ?? ''}`,
      'end ok',
      'step check ok',
      'out ok',
      'end ok',
    ]);
  });

  it("keeps the merger agent's events in its step, between the question and the answer (V46b)", async () => {
    const { repo } = conflicting();
    const agent: MergerAgent = {
      kind: 'claude',
      run: ({ onEvent }) => {
        onEvent?.({ start: 'Claude Code 2.1.310 · sonnet' });
        onEvent?.({ think: 'Both sides changed a.' });
        onEvent?.({ tool: 'Read', input: 'src/a.ts' });
        onEvent?.({ result: '1 line' });
        onEvent?.({ say: BOTH });
        return Promise.resolve({ ok: true, text: BOTH, ms: 1000 });
      },
    };
    const m = await make(repo, fakeChecks().run, { mergerAgent: () => Promise.resolve(agent) });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const lines = await logOf(m, id);
    const log = shortLog(lines);
    const asked = log.findIndex((l) => l.startsWith('out Asking Claude Code'));
    expect(log.slice(asked + 1, asked + 7)).toEqual([
      'agent',
      'agent',
      'agent',
      'agent',
      'agent',
      'out Answered in 1.0 s',
    ]);
    expect(lines.flatMap((l) => ('agent' in l ? [l.agent] : []))).toEqual([
      { start: 'Claude Code 2.1.310 · sonnet' },
      { think: 'Both sides changed a.' },
      { tool: 'Read', input: 'src/a.ts' },
      { result: '1 line' },
      { say: BOTH },
    ]);
  });

  it('ends the agent step failed when the agent says the person must decide', async () => {
    const { repo } = conflicting();
    const m = await make(repo, fakeChecks().run, {
      mergerAgent: fakeAgent(JSON.stringify({ needsYou: 'both renamed it' })).find,
    });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    expect(shortLog(await logOf(m, id)).slice(-2)).toEqual([
      'out It says you must decide: both renamed it',
      'end failed',
    ]);
  });

  it('keeps the earlier runs when a merge runs again, each again after a line saying why', async () => {
    const { repo } = conflicting();
    config(repo, { checks: ['ok', 'flaky'] });
    let runs = 0;
    const runCheck: RunCheck = (command) => {
      const failed = command === 'flaky' && ++runs === 1;
      return Promise.resolve({ code: failed ? 1 : 0, output: failed ? '1 failed\n' : 'ok\n' });
    };
    const m = await make(repo, runCheck, { mergerAgent: fakeAgent(BOTH, BOTH).find });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    await m.recheck(id);
    await m.idle();
    await m.requestChanges(id, 'keep main first');
    await m.idle();
    await m.retry(id);
    await m.idle();

    const log = shortLog(await logOf(m, id));
    const runs_ = log.filter((l) => l.startsWith('run '));
    expect(runs_).toEqual(['run Check again', 'run Request changes: keep main first', 'run Retry']);
    // Each run's steps after its line; the first run's steps before any.
    const at = (line: string) => log.indexOf(line);
    expect(log.slice(0, at('run Check again')).filter((l) => l.startsWith('step '))).toEqual([
      'step merge Merge topic into main',
      'step resolve Merger agent',
      'step check ok',
      'step check flaky',
    ]);
    expect(
      log
        .slice(at('run Check again'), at('run Request changes: keep main first'))
        .filter((l) => l.startsWith('step ')),
    ).toEqual(['step check ok', 'step check flaky']);
  });

  it('logs a refused landing with git’s words, then the landing that worked', async () => {
    const { repo } = setup();
    repo.git('switch', '--quiet', 'topic');
    repo.write({ 'src/a.ts': 'export const a = 2;\n' });
    const T2 = repo.commit('T2: change a');
    repo.git('switch', '--quiet', 'main');
    review(repo, 'topic', { head: T2, into: 'main' });
    repo.write({ 'src/a.ts': 'export const a = 3; // mine\n' });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    await m.land(id);
    repo.git('checkout', '--', 'src/a.ts');
    await m.land(id);

    const log = shortLog(await logOf(m, id));
    const lands = log.slice(log.indexOf('step land Land in main'));
    expect(lands[0]).toBe('step land Land in main');
    expect(lands[1]).toMatch(/^out main was not moved in .*: .*local changes/s);
    expect(lands.slice(2)).toEqual([
      'end failed',
      'step land Land in main',
      expect.stringMatching(/^out main fast-forwarded to [0-9a-f]{7} in /),
      'end ok',
    ]);
    // Without a check the merge waits at ready: the log says so, outside any step.
    expect(log).toContain(
      'out No check to run: set merge.checks in symbiote/config.json, or Land once you have checked it',
    );
  });

  it('logs a landing given up because the target moved, then the merge again on its tip', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    repo.write({ 'src/n.ts': 'export const n = 1;\n' });
    const N = repo.commit('N');
    await m.land(id);
    await m.idle();
    const log = shortLog(await logOf(m, id));
    const from = log.indexOf('step land Land in main');
    expect(log.slice(from, from + 5)).toEqual([
      'step land Land in main',
      `out main moved since the merge (now ${N.slice(0, 7)})`,
      'end failed',
      "run Merging again on main's tip",
      'step merge Merge topic into main',
    ]);
  });

  it('logs the push as part of the landing', async () => {
    const { repo, shas } = setup();
    const remote = tempDir();
    folders.push(remote);
    repo.git('init', '--quiet', '--bare', remote);
    repo.git('remote', 'add', 'origin', remote);
    repo.git('push', '--quiet', '-u', 'origin', 'main');
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: 'ok', push: true });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    expect(shortLog(await logOf(m, id)).slice(-2)).toEqual(['out Pushed to origin', 'end ok']);
  });

  it('removes the log with its entry; a log left without an entry goes at the next drain', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: 'ok' });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    const logs = join(cache, 'state', (await openRepo(repo.root)).id, 'merges');
    expect(existsSync(join(logs, `${id}.jsonl`))).toBe(true);
    writeFileSync(join(logs, 'gone.jsonl'), '{}\n');

    await m.remove(id);
    await m.idle();
    expect(await m.log(id)).toBeNull();
    expect(existsSync(join(logs, `${id}.jsonl`))).toBe(false);
    expect(existsSync(join(logs, 'gone.jsonl'))).toBe(false);
  });

  it('ends the step that threw with what it said', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    config(repo, { checks: 'ok' });
    const runCheck: RunCheck = () => Promise.reject(new Error('the shell is gone'));
    const m = await make(repo, runCheck);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    expect((await m.list()).merges[0]).toMatchObject({ state: 'failed' });
    expect(shortLog(await logOf(m, id)).slice(-3)).toEqual([
      'step check ok',
      'out the shell is gone',
      'end failed',
    ]);
  });

  it('answers an entry that has no log yet with no lines', async () => {
    const { repo, shas } = setup();
    review(repo, 'topic', { head: shas.T, into: 'main' });
    const m = await make(repo);
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' }, { start: false });
    expect(await m.log(id)).toEqual({ lines: [], next: 0 });
    expect(await m.log('nowhere')).toBeNull();
  });
});

describe("the merger's effort (V46d)", () => {
  /** An agent that lists `levels` (null: none Symbiote can read), and what it was asked. */
  function leveled(levels: string[] | null) {
    const agent = fakeAgent(BOTH);
    return {
      ...agent,
      levels: () => Promise.resolve(levels ? { levels } : null),
    };
  }

  it('reads merge.effort, a word', () => {
    const { repo } = setup();
    config(repo, { effort: 'high' });
    expect(readMergeConfig(repo.root)).toEqual({ push: false, effort: 'high' });
    config(repo, { effort: '--model opus' });
    expect(readMergeConfig(repo.root)).toEqual({ push: false });
  });

  it('asks the agent at merge.effort when it lists that level, and says so in the log', async () => {
    const { repo } = conflicting();
    config(repo, { effort: 'high' });
    const agent = leveled(['low', 'medium', 'high']);
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find, levels: agent.levels });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    expect(agent.asked[0]?.effort).toBe('high');
    expect(shortLog(await logOf(m, id))).toContain('out Effort: high (merge.effort)');
  });

  it("asks at the agent's own level when it does not list merge.effort, or its levels cannot be read", async () => {
    for (const [levels, said] of [
      [
        ['low', 'high'],
        'out merge.effort is ultra, which Claude Code does not list: its own level',
      ],
      [null, "out Symbiote cannot read Claude Code's effort levels: its own level"],
    ] as const) {
      const { repo } = conflicting();
      config(repo, { effort: 'ultra' });
      const agent = leveled(levels === null ? null : [...levels]);
      const m = await make(repo, fakeChecks().run, {
        mergerAgent: agent.find,
        levels: agent.levels,
      });
      const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
      await m.idle();
      expect(agent.asked[0]?.effort).toBeUndefined();
      expect(shortLog(await logOf(m, id))).toContain(said);
    }
  });

  it('passes no level, and says none, without merge.effort', async () => {
    const { repo } = conflicting();
    const agent = leveled(['low', 'high']);
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find, levels: agent.levels });
    const { id } = await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    expect(agent.asked[0]?.effort).toBeUndefined();
    expect(shortLog(await logOf(m, id)).some((l) => /effort/i.test(l))).toBe(false);
  });

  it("lists the merger's agent's levels and merge.effort; sets it in the config, or removes it", async () => {
    const { repo } = setup();
    config(repo, { checks: ['ok'] });
    const agent = leveled(['low', 'medium', 'high']);
    const m = await make(repo, fakeChecks().run, { mergerAgent: agent.find, levels: agent.levels });
    expect(await m.efforts()).toEqual({
      agents: [{ kind: 'claude', efforts: { levels: ['low', 'medium', 'high'] } }],
      file: 'symbiote/config.json',
    });
    expect(await m.setEffort({ effort: 'high' })).toMatchObject({ effort: 'high' });
    const written = () =>
      JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8')) as {
        merge: Record<string, unknown>;
      };
    expect(written().merge).toEqual({ checks: ['ok'], effort: 'high' });
    await expect(m.setEffort({ effort: 'ultra' })).rejects.toThrow(
      'Claude Code takes low, medium or high: ultra',
    );
    await expect(m.setEffort({ effort: '--model opus' })).rejects.toThrow(/a word/);
    const removed = await m.setEffort({ effort: null });
    expect(removed.effort).toBeUndefined();
    expect(written().merge).toEqual({ checks: ['ok'] });
  });

  it('lists no agent when none is installed, and refuses a level then', async () => {
    const { repo } = setup();
    const m = await make(repo);
    expect(await m.efforts()).toEqual({ agents: [], file: 'symbiote/config.json' });
    await expect(m.setEffort({ effort: 'high' })).rejects.toThrow(/needs Claude Code or Codex/);
  });
});

describe("the merger's model (V47)", () => {
  const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const MODELS: AgentModel[] = [
    { id: 'opus', name: 'Opus 5.5', efforts: { levels: LEVELS } },
    { id: 'sonnet', name: 'Sonnet 5.5', efforts: { levels: LEVELS } },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
    {
      id: 'claude-opus-4-6',
      name: 'Opus 4.6',
      efforts: { levels: ['low', 'medium', 'high', 'max'] },
    },
  ];
  const options = (agent: ReturnType<typeof fakeAgent>) => ({
    mergerAgent: agent.find,
    levels: () => Promise.resolve({ levels: LEVELS }),
    models: () => Promise.resolve({ models: structuredClone(MODELS) }),
  });
  const written = (repo: TestRepo) =>
    JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8')) as {
      merge: Record<string, unknown>;
    };

  it("lists its agent's models, Symbiote's sonnet its default; sets merge.model, or removes it", async () => {
    const { repo } = setup();
    config(repo, { checks: ['ok'] });
    const m = await make(repo, fakeChecks().run, options(fakeAgent(BOTH)));
    expect(await m.efforts()).toEqual({
      agents: [
        {
          kind: 'claude',
          efforts: { levels: LEVELS },
          models: MODELS,
          defaultModel: { id: 'sonnet', by: 'symbiote' },
        },
      ],
      file: 'symbiote/config.json',
    });
    // Opus 4.6: its levels are the merger's now.
    const set = await m.setModel({ model: 'claude-opus-4-6' });
    expect(set).toMatchObject({
      model: 'claude-opus-4-6',
      agents: [{ efforts: { levels: ['low', 'medium', 'high', 'max'] } }],
    });
    expect(written(repo).merge).toEqual({ checks: ['ok'], model: 'claude-opus-4-6' });
    await expect(m.setModel({ model: 'gpt-6-luna' })).rejects.toThrow(
      'Claude Code lists no model gpt-6-luna: pick one it lists',
    );
    await expect(m.setModel({ model: '--yolo' })).rejects.toThrow(/a model is its ID/);
    expect((await m.setModel({ model: null })).model).toBeUndefined();
    expect(written(repo).merge).toEqual({ checks: ['ok'] });
  });

  it('asks on merge.model as written, and at a level that model takes', async () => {
    const { repo } = conflicting();
    // A full name Claude Code takes but does not list: passed as before (decision 343).
    config(repo, { model: 'claude-sonnet-4-5-20250929', effort: 'high' });
    const agent = fakeAgent(BOTH);
    const m = await make(repo, fakeChecks().run, options(agent));
    await m.enqueue({ branch: 'topic', into: 'main' });
    await m.idle();
    expect(agent.asked[0]).toMatchObject({ model: 'claude-sonnet-4-5-20250929', effort: 'high' });
    // Haiku 4.5 takes no level: none asked, and the log says why.
    const second = conflicting();
    config(second.repo, { model: 'claude-haiku-4-5-20251001', effort: 'high' });
    const other = fakeAgent(BOTH);
    const n = await make(second.repo, fakeChecks().run, options(other));
    const { id } = await n.enqueue({ branch: 'topic', into: 'main' });
    await n.idle();
    expect(other.asked[0]?.model).toBe('claude-haiku-4-5-20251001');
    expect(other.asked[0]?.effort).toBeUndefined();
    expect(shortLog(await logOf(n, id))).toContain(
      'out merge.effort is high, which Haiku 4.5 does not take: its own level',
    );
  });
});
