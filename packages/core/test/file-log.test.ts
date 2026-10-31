import { afterEach, describe, expect, it } from 'vitest';
import { blameFile, fileHistory, openRepo } from '../src/index.js';
import { createRepo, type TestRepo } from './helpers/git-repo.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

/** old.txt made, changed, renamed to new.txt and changed again; another file beside it. */
function renamed() {
  const repo = createRepo();
  repos.push(repo);
  repo.write({ 'old.txt': 'one\ntwo\nthree\nfour\nfive\n' });
  const made = repo.commitAt('Make it', '2026-10-01T10:00:00Z');
  repo.write({ 'old.txt': 'one\nTWO\nthree\nfour\nfive\n', 'other.txt': 'o\n' });
  const changed = repo.commitAt('Change it', '2026-10-02T10:00:00Z');
  repo.git('mv', 'old.txt', 'new.txt');
  const moved = repo.commitAt('Move it', '2026-10-03T10:00:00Z');
  repo.write({ 'new.txt': 'one\nTWO\nthree\nfour\nfive\nsix\n' });
  const grown = repo.commitAt('Grow it', '2026-10-04T10:00:00Z');
  return { repo, made, changed, moved, grown };
}

describe('fileHistory (decision 643)', () => {
  it("lists a file's commits newest first, across its renames, with its path at each", async () => {
    const { repo, made, changed, moved, grown } = renamed();
    const history = await fileHistory(await openRepo(repo.root), 'new.txt', grown);
    expect(history.map((c) => [c.sha, c.subject, c.path])).toEqual([
      [grown, 'Grow it', 'new.txt'],
      [moved, 'Move it', 'new.txt'],
      [changed, 'Change it', 'old.txt'],
      [made, 'Make it', 'old.txt'],
    ]);
    expect(history[0]).toMatchObject({ author: 'Symbiote Test' });
    expect(history[0]!.date).toMatch(/^2026-10-04T/);
    // From an older commit: the commits up to it.
    expect(
      (await fileHistory(await openRepo(repo.root), 'old.txt', changed)).map((c) => c.sha),
    ).toEqual([changed, made]);
  });
});

describe('blameFile (decision 643)', () => {
  it("says each line's commit at a commit, and the checkout's lines not committed", async () => {
    const { repo, made, changed, grown } = renamed();
    const git = await openRepo(repo.root);
    const blame = await blameFile(git, 'new.txt', grown);
    expect(blame.lines.map((l) => [l.text, l.sha])).toEqual([
      ['one', made],
      ['TWO', changed],
      ['three', made],
      ['four', made],
      ['five', made],
      ['six', grown],
    ]);
    expect(blame.commits[changed]).toMatchObject({ subject: 'Change it', path: 'old.txt' });
    expect(blame.commits[grown]!.date).toMatch(/^2026-10-04T10:00:00/);
    repo.write({ 'new.txt': 'zero\none\nTWO\nthree\nfour\nfive\nsix\n' });
    const here = await blameFile(git, 'new.txt', null);
    expect(here.lines[0]).toEqual({ text: 'zero', sha: null });
    expect(here.lines[1]).toEqual({ text: 'one', sha: made });
  });
});
