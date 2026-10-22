import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openRepo, type Verdict } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { run } from '../src/main.js';
import {
  merger,
  MergeRefused,
  readMergeConfig,
  type ChangedSymbols,
  type RunCheck,
} from '../src/merges.js';
import { MERGER_INSTRUCTIONS, type MergerAgent } from '../src/merge-agent.js';
import { MERGER_ANSWER } from '../src/prompts.js';
import { AGENTS, serializeReview } from '../src/reviews.js';
import { serializeWorkspace, type WorkspaceFile } from '../src/workspaces.js';

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
  const asked: { cwd: string; prompt: string; model?: string; instructions?: string }[] = [];
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
  async function symbioteMerge(repo: TestRepo, ...args: string[]) {
    let stdout = '';
    let stderr = '';
    const code = await run(['merge', ...args], {
      cwd: repo.root,
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      openUrl: () => undefined,
      waitForExit: () => Promise.resolve(),
      env: { ...process.env, SYMBIOTE_CACHE_DIR: cache },
    });
    return { code, stdout, stderr };
  }

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
