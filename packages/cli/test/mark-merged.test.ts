// Merged work marked in the docs (MC3, decision 990): the repository's `merged` commands run at the
// target's tip in a worktree of Symbiote's cache, their changes one commit landed as the merger
// lands and pushed as `merge.push` says; the person's checkout never written but by that landing.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { markMerged, readMarkedConfig } from '../src/mark-merged.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A repository whose config marks `docs/PLAN.md`'s rows, with `origin` a bare one. */
function repository(merged: unknown, push = true): { repo: TestRepo; remote: string } {
  const repo = createRepo();
  folders.push(repo.root);
  repo.write({
    'docs/PLAN.md': '| V1 | built, ready for review |\n',
    'symbiote/config.json': JSON.stringify({ merge: { push }, merged }),
  });
  repo.commit('First');
  const remote = tempDir();
  folders.push(remote);
  repo.git('init', '--quiet', '--bare', remote);
  repo.git('remote', 'add', 'origin', remote);
  repo.git('push', '--quiet', 'origin', 'main');
  return { repo, remote };
}

const MARK = {
  commands: [
    "sed -i 's/built, ready for review/✅/' docs/PLAN.md && echo 'marked  V1  feature/v1  merged 2026-11-11'",
    "echo 'wrote  docs/decisions.md' && printf 'V1 in force\\n' > docs/decisions.md",
  ],
};

async function marks(repo: TestRepo) {
  const cache = tempDir();
  folders.push(cache);
  return { marks: markMerged(await openRepo(repo.root), cache), cache };
}

describe('readMarkedConfig (MC3, decision 990)', () => {
  it("reads `merged`: its commands, one or several, and the commit's subject", () => {
    const { repo } = repository(MARK);
    expect(readMarkedConfig(repo.root)).toEqual({
      commands: MARK.commands,
      message: 'Docs: merged',
    });
    writeFileSync(
      join(repo.root, 'symbiote/config.json'),
      JSON.stringify({ merged: { commands: 'node mark.mjs', message: 'Docs: marked' } }),
    );
    expect(readMarkedConfig(repo.root)).toEqual({
      commands: ['node mark.mjs'],
      message: 'Docs: marked',
    });
  });

  it('is null without it, or with no command', () => {
    const { repo } = repository(undefined);
    expect(readMarkedConfig(repo.root)).toBeNull();
    writeFileSync(
      join(repo.root, 'symbiote/config.json'),
      JSON.stringify({ merged: { commands: [] } }),
    );
    expect(readMarkedConfig(repo.root)).toBeNull();
    writeFileSync(join(repo.root, 'symbiote/config.json'), '{ not json');
    expect(readMarkedConfig(repo.root)).toBeNull();
  });
});

describe('markMerged (MC3, decision 990)', () => {
  it("previews at the target's tip in the cache's worktree: what the commands change, nothing kept", async () => {
    const { repo } = repository(MARK);
    const { marks: m, cache } = await marks(repo);
    expect(m.configured()).toBe(true);
    const preview = await m.preview();
    expect(preview).toEqual({
      into: 'main',
      tip: repo.git('rev-parse', 'main'),
      files: ['docs/PLAN.md', 'docs/decisions.md'],
      output: 'marked  V1  feature/v1  merged 2026-11-11\nwrote  docs/decisions.md',
      push: true,
    });
    // The person's checkout is as it was; the work happened in the cache.
    expect(readFileSync(join(repo.root, 'docs/PLAN.md'), 'utf8')).toContain('ready for review');
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(existsSync(join(cache, 'worktrees'))).toBe(true);
  });

  it("commits the changes as one commit, the commands' output its body, landed in the checkout that has main, pushed", async () => {
    const { repo, remote } = repository(MARK);
    const before = repo.git('rev-parse', 'main');
    const { marks: m } = await marks(repo);
    const done = await m.mark();
    const after = repo.git('rev-parse', 'main');
    expect(done).toEqual({
      into: 'main',
      tip: before,
      files: ['docs/PLAN.md', 'docs/decisions.md'],
      output: 'marked  V1  feature/v1  merged 2026-11-11\nwrote  docs/decisions.md',
      commit: after,
      landed: true,
      pushed: { ok: true, remote: 'origin' },
    });
    expect(repo.git('rev-parse', 'main^')).toBe(before);
    expect(repo.git('log', '-1', '--format=%s%n%n%b', 'main')).toBe(
      'Docs: merged\n\nmarked  V1  feature/v1  merged 2026-11-11\nwrote  docs/decisions.md',
    );
    // The checkout moved with its branch: its files are the commit's.
    expect(readFileSync(join(repo.root, 'docs/PLAN.md'), 'utf8')).toBe('| V1 | ✅ |\n');
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(repo.git('--git-dir', remote, 'rev-parse', 'main')).toBe(after);
  });

  it('pushes nothing unless merge.push says so', async () => {
    const { repo, remote } = repository(MARK, false);
    const { marks: m } = await marks(repo);
    const done = await m.mark();
    expect(done).toMatchObject({ landed: true });
    expect(done).not.toHaveProperty('pushed');
    expect(repo.git('--git-dir', remote, 'rev-parse', 'main')).not.toBe(done.commit);
  });

  it('nothing to mark: no commit, said so', async () => {
    const { repo } = repository({
      commands: ["echo 'Nothing to mark: every merged row says ✅.'"],
    });
    const before = repo.git('rev-parse', 'main');
    const { marks: m } = await marks(repo);
    expect((await m.preview()).files).toEqual([]);
    expect(await m.mark()).toEqual({
      into: 'main',
      tip: before,
      files: [],
      output: 'Nothing to mark: every merged row says ✅.',
      landed: false,
      why: 'nothing to mark',
    });
    expect(repo.git('rev-parse', 'main')).toBe(before);
  });

  it('a command that fails: nothing committed, its output said', async () => {
    const { repo } = repository({ commands: ['echo marking && exit 3'] });
    const before = repo.git('rev-parse', 'main');
    const { marks: m } = await marks(repo);
    await expect(m.mark()).rejects.toThrow('echo marking && exit 3 failed (exit 3): marking');
    expect(repo.git('rev-parse', 'main')).toBe(before);
  });

  it("refused by the checkout's local changes: main not moved, the commit named, nothing lost", async () => {
    const { repo } = repository(MARK);
    const before = repo.git('rev-parse', 'main');
    writeFileSync(join(repo.root, 'docs/PLAN.md'), '| V1 | edited by the person |\n');
    const { marks: m } = await marks(repo);
    const done = await m.mark();
    expect(done).toMatchObject({ landed: false, commit: expect.any(String) as unknown });
    expect(done.why).toContain('main was not moved');
    expect(repo.git('rev-parse', 'main')).toBe(before);
    expect(readFileSync(join(repo.root, 'docs/PLAN.md'), 'utf8')).toBe(
      '| V1 | edited by the person |\n',
    );
    // The commit is kept, reachable by its SHA.
    expect(repo.git('cat-file', '-t', done.commit ?? '')).toBe('commit');
  });

  it('is not configured without `merged`, and refuses then', async () => {
    const { repo } = repository(undefined);
    const { marks: m } = await marks(repo);
    expect(m.configured()).toBe(false);
    await expect(m.preview()).rejects.toThrow('symbiote/config.json names no `merged` commands');
  });
});
