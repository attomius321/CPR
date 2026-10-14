import { realpath } from 'node:fs/promises';
import { git } from './exec.js';
import type { GitRepo } from './repo.js';

/** A local branch; `upstream` as `origin/x`, with how far the branch is ahead and behind it. */
export interface LocalBranch {
  name: string;
  sha: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  /** The upstream was deleted (pruned, or never fetched). */
  gone?: boolean;
  /** The worktree it is checked out in, when that is not this one (V18). */
  worktree?: string;
}

/** A remote branch: `origin/topic` is `topic` on the remote `origin`. */
export interface RemoteBranch {
  name: string;
  remote: string;
  branch: string;
  sha: string;
}

export interface Tag {
  name: string;
  /** The commit it names (an annotated tag peeled). */
  sha: string;
}

export interface RefList {
  branches: LocalBranch[];
  remotes: RemoteBranch[];
  tags: Tag[];
}

// Fields end with US; the peeled object (`%(*…)`) is empty except for annotated tags.
const FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(objecttype)',
  '%(*objectname)',
  '%(*objecttype)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(worktreepath)',
].join('%1f');

/** The repository's branches, remote branches and tags, by name (one `git for-each-ref`). */
export async function listRefs(repo: GitRepo): Promise<RefList> {
  const [output, remoteNames] = await Promise.all([
    git(repo.root, [
      'for-each-ref',
      `--format=${FORMAT}`,
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]),
    git(repo.root, ['remote']),
  ]);
  // Longest first: a remote named `a/b` wins over `a` for `refs/remotes/a/b/x`.
  const remotes = remoteNames
    .split('\n')
    .filter((r) => r !== '')
    .sort((a, b) => b.length - a.length);
  const list: RefList = { branches: [], remotes: [], tags: [] };
  for (const line of output.split('\n')) {
    if (line === '') continue;
    const [
      ref = '',
      sha = '',
      type = '',
      peeled = '',
      peeledType = '',
      upstream = '',
      track = '',
      worktree = '',
    ] = line.split('\x1f');
    if (ref.startsWith('refs/heads/')) {
      list.branches.push({
        name: ref.slice('refs/heads/'.length),
        sha,
        ...(upstream ? { upstream, ...parseTrack(track) } : {}),
        ...(worktree && !(await samePath(worktree, repo.root)) ? { worktree } : {}),
      });
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length);
      const remote = remotes.find((r) => name.startsWith(`${r}/`)) ?? name.split('/')[0] ?? '';
      const branch = name.slice(remote.length + 1);
      // A remote's HEAD only names its default branch.
      if (branch !== 'HEAD') list.remotes.push({ name, remote, branch, sha });
    } else if (ref.startsWith('refs/tags/')) {
      const commit = peeled ? peeledType === 'commit' && peeled : type === 'commit' && sha;
      if (commit) list.tags.push({ name: ref.slice('refs/tags/'.length), sha: commit });
    }
  }
  return list;
}

/** Whether two paths name one folder (symbolic links resolved where they exist). */
async function samePath(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const real = (path: string) => realpath(path).catch(() => path);
  return (await real(a)) === (await real(b));
}

/** `ahead 1, behind 2`, `gone` or nothing (in step). */
function parseTrack(track: string): Pick<LocalBranch, 'ahead' | 'behind' | 'gone'> {
  if (track === 'gone') return { gone: true };
  const count = (word: string) => Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0);
  return { ahead: count('ahead'), behind: count('behind') };
}
