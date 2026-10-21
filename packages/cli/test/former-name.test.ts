import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { createRepo, tempDir } from '../../core/test/helpers/git-repo.js';
import { moveFormerCache, moveInto } from '../src/former-name.js';
import { reviewPlace } from '../src/reviews.js';

/** Symbiote's former name, as its folders were called. */
const FORMER = 'cpr';

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

describe('moveInto', () => {
  it('moves each entry the new folder lacks, merges folders in both, then removes the old', () => {
    const root = tempDir();
    write(root, {
      'old/workspaces/feature/a.json': 'a',
      'old/reviews/feature/a/ada.json': 'old review',
      'old/threads/feature/a.jsonl': 't',
      'new/reviews/feature/b/ada.json': 'b',
    });
    moveInto(join(root, 'old'), join(root, 'new'));
    expect(readFileSync(join(root, 'new/workspaces/feature/a.json'), 'utf8')).toBe('a');
    expect(readFileSync(join(root, 'new/reviews/feature/a/ada.json'), 'utf8')).toBe('old review');
    expect(readFileSync(join(root, 'new/reviews/feature/b/ada.json'), 'utf8')).toBe('b');
    expect(existsSync(join(root, 'new/threads/feature/a.jsonl'))).toBe(true);
    expect(existsSync(join(root, 'old'))).toBe(false);
  });

  it('keeps what the new folder has, and the old folder with what could not move', () => {
    const root = tempDir();
    write(root, { 'old/config.json': 'old', 'new/config.json': 'new' });
    moveInto(join(root, 'old'), join(root, 'new'));
    expect(readFileSync(join(root, 'new/config.json'), 'utf8')).toBe('new');
    expect(readFileSync(join(root, 'old/config.json'), 'utf8')).toBe('old');
  });

  it('drops a file the new folder has the same', () => {
    const root = tempDir();
    write(root, { 'old/config.json': 'same', 'new/config.json': 'same' });
    moveInto(join(root, 'old'), join(root, 'new'));
    expect(existsSync(join(root, 'old'))).toBe(false);
  });

  it('drops the files Symbiote writes again, and leaves the ones it is told to keep', () => {
    const root = tempDir();
    write(root, {
      'old/.gitignore': 'old ignore',
      'old/AGENTS.md': 'old agents',
      'old/worktrees/x/file': 'x',
      'old/state/r/reviews/a.json': 'r',
    });
    moveInto(join(root, 'old'), join(root, 'new'), {
      drop: ['.gitignore', 'AGENTS.md'],
      keep: ['worktrees'],
    });
    expect(existsSync(join(root, 'new/.gitignore'))).toBe(false);
    expect(existsSync(join(root, 'new/AGENTS.md'))).toBe(false);
    expect(existsSync(join(root, 'new/state/r/reviews/a.json'))).toBe(true);
    expect(existsSync(join(root, 'old/worktrees/x/file'))).toBe(true);
    expect(existsSync(join(root, 'old/.gitignore'))).toBe(false);
  });

  it('does nothing without the old folder', () => {
    const root = tempDir();
    moveInto(join(root, 'old'), join(root, 'new'));
    expect(existsSync(join(root, 'new'))).toBe(false);
  });
});

describe('moveFormerCache', () => {
  it("moves the former cache's state beside it, never its worktrees", () => {
    const home = tempDir();
    write(home, {
      [`.cache/${FORMER}/state/r/reviews/a.json`]: 'r',
      [`.cache/${FORMER}/usage/claude.json`]: '{}',
      [`.cache/${FORMER}/worktrees/r/head-0/.git`]: 'gitdir: x',
    });
    const cache = join(home, '.cache', 'symbiote');
    moveFormerCache(cache, {});
    expect(existsSync(join(cache, 'state/r/reviews/a.json'))).toBe(true);
    expect(existsSync(join(cache, 'usage/claude.json'))).toBe(true);
    expect(existsSync(join(cache, 'worktrees'))).toBe(false);
    expect(existsSync(join(home, '.cache', FORMER, 'worktrees/r/head-0/.git'))).toBe(true);
  });

  it('leaves a cache named by SYMBIOTE_CACHE_DIR alone', () => {
    const home = tempDir();
    write(home, { [`${FORMER}/state/a`]: 'a' });
    moveFormerCache(join(home, 'symbiote'), { SYMBIOTE_CACHE_DIR: join(home, 'symbiote') });
    expect(existsSync(join(home, FORMER, 'state/a'))).toBe(true);
  });
});

describe('reviewPlace and the former folder', () => {
  it("moves the former folder's reviews, workspaces and threads into symbiote/", async () => {
    const repo = createRepo();
    repo.write({ 'a.ts': 'export const a = 1;\n' });
    repo.commit('a');
    repo.git('config', 'user.email', 'ada@example.com');
    write(repo.root, {
      [`${FORMER}/.gitignore`]: '# old\n*\n',
      [`${FORMER}/AGENTS.md`]: 'old',
      [`${FORMER}/reviews/feature/x/ada.json`]: '{}',
      [`${FORMER}/workspaces/feature/x.json`]: '{}',
      [`${FORMER}/threads/feature/x.jsonl`]: '',
    });
    const place = await reviewPlace(await openRepo(repo.root), tempDir());
    expect(place.place).toBe('repository');
    expect(existsSync(join(repo.root, 'symbiote/reviews/feature/x/ada.json'))).toBe(true);
    expect(existsSync(join(repo.root, 'symbiote/workspaces/feature/x.json'))).toBe(true);
    expect(existsSync(join(repo.root, 'symbiote/threads/feature/x.jsonl'))).toBe(true);
    expect(existsSync(join(repo.root, 'symbiote/AGENTS.md'))).toBe(false);
    expect(existsSync(join(repo.root, FORMER))).toBe(false);
  });

  it("leaves a project's own folder of that name alone", async () => {
    const repo = createRepo();
    repo.write({ [`${FORMER}/main.c`]: 'int main;\n' });
    repo.commit('own');
    repo.git('config', 'user.email', 'ada@example.com');
    await reviewPlace(await openRepo(repo.root), tempDir());
    expect(existsSync(join(repo.root, FORMER, 'main.c'))).toBe(true);
    expect(existsSync(join(repo.root, 'symbiote/main.c'))).toBe(false);
  });
});
