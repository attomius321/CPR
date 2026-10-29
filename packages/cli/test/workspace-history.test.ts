import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openRepo, type ActivityEntry, type ThreadEntry } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import type { FolderAt } from '../src/editor.js';
import { workspaces } from '../src/workspaces.js';
import { serializeWorkspace, type WorkspaceFile } from '../src/workspace-record.js';
import { endOf } from '../src/workspace-history.js';

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

const REVIEWER = 'ada@example.com';

/**
 * main: A ── B ── M, M merging feature/merged's C (`--no-ff`, as Symbiote's merger does), then
 * the branch deleted; feature/kept at D on B, not merged; feature/gone's E on B, its branch
 * deleted unmerged; feature/recorded's F, started at M, merged by a fast-forward of main to F,
 * its branch gone.
 */
function history() {
  const repo = createRepo();
  repos.push(repo);
  repo.git('config', 'user.email', REVIEWER);
  repo.write({ 'src/a.ts': 'export const a = 1;\n' });
  const A = repo.commit('A');
  repo.write({ 'src/b.ts': 'export const b = 1;\n' });
  const B = repo.commit('B');
  const side = (branch: string, file: string) => {
    repo.git('checkout', '--quiet', '-b', branch, B);
    repo.write({ [file]: `export const x = '${branch}';\n` });
    const sha = repo.commit(branch);
    repo.git('checkout', '--quiet', 'main');
    return sha;
  };
  const C = side('feature/merged', 'src/c.ts');
  repo.git('merge', '--quiet', '--no-ff', '-m', 'Merge feature/merged: Merged', 'feature/merged');
  repo.git('branch', '--quiet', '-D', 'feature/merged');
  const D = side('feature/kept', 'src/d.ts');
  const E = side('feature/gone', 'src/e.ts');
  repo.git('branch', '--quiet', '-D', 'feature/gone');
  const M = repo.git('rev-parse', 'main');
  repo.git('checkout', '--quiet', '-b', 'feature/recorded');
  repo.write({ 'src/f.ts': 'export const f = 1;\n' });
  const F = repo.commit('F');
  repo.git('checkout', '--quiet', 'main');
  repo.git('merge', '--quiet', '--ff-only', 'feature/recorded');
  repo.git('branch', '--quiet', '-D', 'feature/recorded');
  return { repo, shas: { A, B, C, D, E, M, F } };
}

const record = (over: Partial<WorkspaceFile> & { branch: string }): WorkspaceFile => ({
  agent: {
    kind: 'claude',
    permissionMode: 'default',
    started: '2026-10-20T09:00:00.000Z',
    hooks: true,
    activity: true,
  },
  base: 'a'.repeat(40),
  brief: `# Feature: ${over.branch}\n\n## Goal\nDo it.\n`,
  by: REVIEWER,
  created: '2026-10-20T09:00:00.000Z',
  from: 'main',
  planFirst: true,
  worktree: `/nowhere/${over.branch.replace('/', '-')}`,
  ...over,
});

/** Writes a file under `symbiote/`, its folders made. */
function put(repo: TestRepo, path: string, text: string) {
  const file = join(repo.root, 'symbiote', path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const keep = (repo: TestRepo, workspace: WorkspaceFile) =>
  put(repo, `workspaces/${workspace.branch}.json`, serializeWorkspace(workspace));

/** The person's review of `branch` whose verdicts are `events`, each at its head. */
function review(repo: TestRepo, branch: string, verdicts: { event: string; head: string }[]) {
  put(
    repo,
    `reviews/${branch}/${REVIEWER}.json`,
    JSON.stringify({
      base: '',
      branch,
      drafts: [],
      head: verdicts.at(-1)?.head ?? '',
      marks: {},
      reviewer: REVIEWER,
      summary: '',
      updated: '2026-10-20T10:00:00.000Z',
      verdicts: verdicts.map((v, i) => ({
        at: `2026-10-20T1${i}:00:00.000Z`,
        comments: [],
        summary: '',
        ...v,
        ...(v.event === 'approve' ? { into: 'main' } : {}),
      })),
    }),
  );
}

const lines = (values: unknown[]) => values.map((v) => `${JSON.stringify(v)}\n`).join('');

/** What VS Code was asked to open: a file alone, or a diff's two sides. */
const opened: FolderAt[] = [];

/** A service whose agents fail the test if anything asks for them. */
async function service(repo: TestRepo) {
  const asked = (name: string) => () => Promise.reject(new Error(`${name} was asked for`));
  opened.length = 0;
  return workspaces(await openRepo(repo.root), cache, {
    claude: asked('Claude Code'),
    codex: asked('Codex'),
    hermes: asked('Hermes'),
    now: () => new Date('2026-10-29T09:00:00Z'),
    env: { PATH: '/usr/bin' },
    openFolder: (_folder, at) => {
      if (at) opened.push(at);
      return Promise.resolve({ opened: true });
    },
  });
}

/** The four finished workspaces of `history()`, a live one, and their reviews. */
function finished(repo: TestRepo, shas: ReturnType<typeof history>['shas']) {
  keep(repo, record({ branch: 'feature/merged', base: shas.B, finished: '2026-10-21T09:00:00Z' }));
  review(repo, 'feature/merged', [
    { event: 'request-changes', head: shas.B },
    { event: 'approve', head: shas.C },
  ]);
  keep(repo, record({ branch: 'feature/kept', base: shas.B, finished: '2026-10-23T09:00:00Z' }));
  keep(
    repo,
    record({
      branch: 'feature/gone',
      base: shas.B,
      finished: '2026-10-22T09:00:00Z',
      kind: 'feature',
      title: 'Gone',
    }),
  );
  review(repo, 'feature/gone', [{ event: 'approve', head: shas.E }]);
  keep(
    repo,
    record({
      branch: 'feature/recorded',
      base: shas.M,
      finished: '2026-10-24T09:00:00Z',
      tip: shas.F,
      merged: true,
      agent: { kind: 'codex', model: 'gpt-5.5', effort: 'high', thread: 't-1' },
    }),
  );
  keep(repo, record({ branch: 'fix/nothing', base: shas.B, finished: '2026-10-20T12:00:00Z' }));
  keep(repo, record({ branch: 'feature/live', base: shas.B }));
}

describe('endOf (V78, decision 573)', () => {
  it('is the tip Clean up recorded, else the branch kept, else the last Approve, else none', () => {
    const recorded = record({ branch: 'feature/x', tip: 'f'.repeat(40) });
    expect(endOf(recorded, 'b'.repeat(40), 'c'.repeat(40))).toBe('f'.repeat(40));
    expect(endOf(record({ branch: 'feature/x' }), 'b'.repeat(40), 'c'.repeat(40))).toBe(
      'b'.repeat(40),
    );
    expect(endOf(record({ branch: 'feature/x' }), null, 'c'.repeat(40))).toBe('c'.repeat(40));
    expect(endOf(record({ branch: 'feature/x' }), null, null)).toBeNull();
  });
});

describe('workspaces history (V78)', () => {
  it('lists the finished workspaces only, the newest finished first, each with its outcome', async () => {
    const { repo, shas } = history();
    finished(repo, shas);
    const s = await service(repo);
    const read = await s.history();
    expect(read.place).toBe('repository');
    expect(read.workspaces.map((w) => [w.branch, w.outcome, w.into, w.end])).toEqual([
      // Clean up's record says so (decision 574).
      ['feature/recorded', 'merged', 'main', shas.F],
      // Not merged, its branch still there: its commits from the branch.
      ['feature/kept', 'kept', undefined, shas.D],
      // Approved, never merged, the branch deleted: git still has the commit.
      ['feature/gone', 'gone', undefined, shas.E],
      // Before V78: the last Approve's commit, which main holds through its merge.
      ['feature/merged', 'merged', 'main', shas.C],
      // Nothing known of its end.
      ['fix/nothing', 'gone', undefined, undefined],
    ]);
    const gone = read.workspaces.find((w) => w.branch === 'feature/gone');
    expect(gone).toEqual({
      branch: 'feature/gone',
      kind: 'feature',
      title: 'Gone',
      brief: '# Feature: feature/gone\n\n## Goal\nDo it.\n',
      created: '2026-10-20T09:00:00.000Z',
      finished: '2026-10-22T09:00:00Z',
      by: REVIEWER,
      planFirst: true,
      agent: { kind: 'claude' },
      outcome: 'gone',
      end: shas.E,
    });
    expect(read.workspaces.find((w) => w.branch === 'feature/recorded')?.agent).toEqual({
      kind: 'codex',
      model: 'gpt-5.5',
      effort: 'high',
    });
  });

  it('leaves out an end git no longer has', async () => {
    const { repo, shas } = history();
    keep(repo, record({ branch: 'feature/lost', base: shas.B, finished: '2026-10-21T09:00:00Z' }));
    review(repo, 'feature/lost', [{ event: 'approve', head: '9'.repeat(40) }]);
    const s = await service(repo);
    expect((await s.history()).workspaces).toMatchObject([
      { branch: 'feature/lost', outcome: 'gone' },
    ]);
    expect((await s.history()).workspaces[0]).not.toHaveProperty('end');
  });

  it("finds a merged end older than the default branch's commits it reads at once (a clock off)", async () => {
    const { repo, shas } = history();
    // Started, by its record, after every commit was made: none is read in the one run.
    keep(
      repo,
      record({
        branch: 'feature/merged',
        base: shas.B,
        created: '2027-01-01T00:00:00.000Z',
        finished: '2027-01-02T00:00:00.000Z',
      }),
    );
    review(repo, 'feature/merged', [{ event: 'approve', head: shas.C }]);
    expect((await (await service(repo)).history()).workspaces).toMatchObject([
      { branch: 'feature/merged', outcome: 'merged', into: 'main', end: shas.C },
    ]);
  });

  it('is empty with no finished workspace', async () => {
    const { repo, shas } = history();
    keep(repo, record({ branch: 'feature/live', base: shas.B }));
    expect((await (await service(repo)).history()).workspaces).toEqual([]);
  });

  it('gives one finished workspace as the tabs read it: no agent asked, its end its tip', async () => {
    const { repo, shas } = history();
    finished(repo, shas);
    const s = await service(repo);
    const merged = await s.finished('feature/merged');
    expect(merged).toMatchObject({
      branch: 'feature/merged',
      base: shas.B,
      finished: '2026-10-21T09:00:00Z',
      worktree: { path: '/nowhere/feature-merged', exists: false },
      tip: shas.C,
      ahead: 1,
      merged: true,
      agent: { state: 'not-running', kind: 'claude' },
    });
    expect(merged).not.toHaveProperty('activity');
    expect(await s.finished('feature/recorded')).toMatchObject({
      tip: shas.F,
      ahead: 1,
      merged: true,
      agent: { state: 'not-running', kind: 'codex', model: 'gpt-5.5', effort: 'high' },
    });
    expect(await s.finished('fix/nothing')).toMatchObject({ tip: null, ahead: 0, merged: false });
    await expect(s.finished('feature/live')).rejects.toMatchObject({ status: 404 });
    await expect(s.finished('feature/none')).rejects.toMatchObject({ status: 404 });
  });

  it("reads a finished workspace's thread and tools from Symbiote's files, never its agent", async () => {
    const { repo, shas } = history();
    finished(repo, shas);
    const report: ThreadEntry = {
      at: '2026-10-20T09:30:00.000Z',
      session: 's',
      kind: 'report',
      text: 'Done',
    };
    const call: ActivityEntry = {
      at: '2026-10-20T09:10:00.000Z',
      session: 's',
      id: 't1',
      tool: 'Bash',
      phase: 'start',
      input: 'pnpm check',
    };
    put(repo, 'threads/feature/merged.jsonl', lines([report]));
    put(repo, 'activity/feature/merged.jsonl', lines([call]));
    // Codex on its app server keeps its own thread: Symbiote has none, and never asks.
    put(repo, 'threads/feature/recorded.jsonl', lines([report]));
    const s = await service(repo);
    const thread = await s.thread('feature/merged');
    expect(thread.entries).toEqual([report]);
    expect(thread.recorded).toBe(true);
    expect(thread.verdict).toMatchObject({ event: 'approve', head: shas.C });
    expect(await s.tools('feature/merged')).toEqual({ tools: [call] });
    expect(await s.thread('feature/recorded')).toEqual({ entries: [], recorded: false });
    expect(await s.tools('feature/recorded')).toEqual({});
  });

  it("lists a merged, cleaned-up workspace's commits from its base to its end", async () => {
    const { repo, shas } = history();
    finished(repo, shas);
    const s = await service(repo);
    const merged = await s.changes('feature/merged');
    expect(merged.tip).toBe(shas.C);
    expect(merged.commits.listed.map((c) => c.sha)).toEqual([shas.C]);
    expect(merged.files.listed.map((f) => f.path)).toEqual(['src/c.ts']);
    expect(merged.uncommitted).toBeNull();
    const kept = await s.changes('feature/kept');
    expect(kept.commits.listed.map((c) => c.sha)).toEqual([shas.D]);
    expect((await s.changes('fix/nothing')).commits.listed).toEqual([]);
  });

  it("opens a file's changes in VS Code from where a finished workspace ended, its branch gone", async () => {
    const { repo, shas } = history();
    finished(repo, shas);
    const s = await service(repo);
    // src/c.ts is new at C: it opens alone, as it is at C.
    await s.openDiff('feature/merged', { path: 'src/c.ts' });
    expect(opened).toHaveLength(1);
    expect(readFileSync((opened[0] as { path: string }).path, 'utf8')).toBe(
      "export const x = 'feature/merged';\n",
    );
    await expect(s.openDiff('fix/nothing', { path: 'src/c.ts' })).rejects.toMatchObject({
      status: 409,
    });
  });
});
