// The skill library (SK1): one folder of skills outside the checkout (`<folder>/<name>/SKILL.md`),
// a plain folder or one in a git repository (decision 426), set on this machine in Settings and
// kept in Symbiote's config folder, `library.json` (decision 427), read again at each use: every
// `symbiote view` here shows the same library. Its changes are committed, and pushed, only as the
// setting says (decision 428): never a force, a branch switch, a rebase or a stash.
import { execFile } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  git,
  GitError,
  type LibraryChange,
  type LibraryCommits,
  type LibraryGit,
  type LibraryProbe,
  type LibraryState,
  type SkillChange,
} from '@symbiote/core';
import { SkillRefused } from './skills.js';
import { writeFileWhole } from './file-write.js';

const execFileAsync = promisify(execFile);

/** A clone, a push or a pull: given up after this long, never left waiting for a password. */
const NETWORK_MS = 120_000;
const COMMITS: readonly LibraryCommits[] = ['none', 'commit', 'push'];

/** The library as this machine keeps it. */
export interface LibrarySetting {
  /** The folder of skills, absolute. */
  folder: string;
  commits: LibraryCommits;
}

/** The library's record, what is in it, and its git (`/api/skills`'s library actions). */
export interface LibraryService {
  /** The setting; null when none is set, or the record cannot be read. */
  setting(): LibrarySetting | null;
  /** The library as the Skills page shows it; null without one. */
  state(): Promise<LibraryState | null>;
  /** What is at `folder`, as Settings shows it before the library is set there. */
  probe(folder: string): Promise<LibraryProbe>;
  set(change: Extract<SkillChange, { action: 'library' }>): Promise<void>;
  /** No library; nothing on disk is deleted. */
  forget(): Promise<void>;
  /** The folder's changes committed with `message`; pushed too when set to. */
  commit(message: string): Promise<void>;
  push(): Promise<void>;
  /** The upstream pulled, fast-forward only. */
  pull(): Promise<void>;
}

/** `text` read as a folder's path: `~` is `home`; null when it is not a full path. */
function pathOf(text: string, home: string): string | null {
  const trimmed = text.trim();
  const expanded =
    trimmed === '~' || trimmed.startsWith('~/') ? join(home, trimmed.slice(1)) : trimmed;
  return expanded !== '' && isAbsolute(expanded) ? resolve(expanded) : null;
}

const NOT_FULL = 'give the folder’s full path (/…, or ~/… in your home)';

function kindOf(path: string): 'missing' | 'file' | 'folder' {
  try {
    return statSync(path).isDirectory() ? 'folder' : 'file';
  } catch {
    return lstatSync(path, { throwIfNoEntry: false }) ? 'file' : 'missing';
  }
}

/** The skills in `folder`: its sub-folders holding a `SKILL.md`. */
function skillCount(folder: string): number {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return 0;
  }
  return names.filter((name) => {
    try {
      return statSync(join(folder, name, 'SKILL.md')).isFile();
    } catch {
      return false;
    }
  }).length;
}

/** git's words, without its `fatal:` and `error:`. */
function words(error: unknown): string {
  if (error instanceof GitError) {
    return error.stderr.trim().replace(/^(fatal|error): /gm, '') || error.message;
  }
  const failed = error as { stderr?: unknown; killed?: unknown; message?: unknown };
  if (failed.killed) return `git took more than ${NETWORK_MS / 60_000} minutes and was stopped`;
  const stderr = typeof failed.stderr === 'string' ? failed.stderr.trim() : '';
  return stderr.replace(/^(fatal|error): /gm, '') || String(failed.message);
}

/** `git` at `cwd`, or null when it fails: a read whose failure means "none". */
async function read(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    return (await git(cwd, args)).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/**
 * git reaching a remote (a clone, a push, a pull): no prompt for a password nobody would see (SSH
 * in batch mode, unless the person configured SSH for git), and a time limit.
 */
async function network(cwd: string, args: readonly string[]): Promise<void> {
  const ssh =
    process.env.GIT_SSH_COMMAND ||
    process.env.GIT_SSH ||
    (await read(cwd, ['config', '--get', 'core.sshCommand']));
  await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: NETWORK_MS,
    env: {
      ...process.env,
      LC_ALL: 'C',
      GIT_TERMINAL_PROMPT: '0',
      ...(ssh ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
    },
  });
}

/** The git repository `folder` is in: its root, branch, upstream, remote and the folder's changes. */
async function gitOf(folder: string): Promise<LibraryGit | undefined> {
  const root = await read(folder, ['rev-parse', '--show-toplevel']);
  if (!root) return undefined;
  const path = relative(realpathSync(root), realpathSync(folder)).split(sep).join('/');
  const branch = (await read(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])) ?? undefined;
  const upstream = branch
    ? ((await read(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])) ??
      undefined)
    : undefined;
  const remotes = ((await read(root, ['remote'])) ?? '').split('\n').filter((r) => r !== '');
  const upstreamRemote = branch
    ? ((await read(root, ['config', '--get', `branch.${branch}.remote`])) ?? undefined)
    : undefined;
  const remote =
    upstream && upstreamRemote
      ? upstreamRemote
      : remotes.includes('origin')
        ? 'origin'
        : remotes[0];
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = await read(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    const [a = '0', b = '0'] = (counts ?? '').split(/\s+/);
    ahead = Number(a) || 0;
    behind = Number(b) || 0;
  }
  const status = await git(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
    '--',
    `:/${path}`,
  ]);
  const prefix = path === '' ? '' : `${path}/`;
  const changes: LibraryChange[] = status
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => {
      const xy = entry.slice(0, 2);
      const state: LibraryChange['state'] =
        xy === '??' || xy.startsWith('A') ? 'new' : xy.includes('D') ? 'deleted' : 'changed';
      return { path: entry.slice(3).slice(prefix.length), state };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    root,
    path,
    ...(branch ? { branch } : {}),
    ...(upstream ? { upstream } : {}),
    ...(remote ? { remote } : {}),
    ahead,
    behind,
    changes,
  };
}

/** The library kept in `file` (Symbiote's config folder); `home` is what `~` stands for. */
export function libraryService(file: string, { home }: { home: string }): LibraryService {
  function setting(): LibrarySetting | null {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    if (typeof v.folder !== 'string' || !isAbsolute(v.folder)) return null;
    const commits = COMMITS.find((c) => c === v.commits) ?? 'none';
    return { folder: v.folder, commits };
  }

  async function write(next: LibrarySetting): Promise<void> {
    await writeFileWhole(file, `${JSON.stringify(next, null, 2)}\n`);
  }

  /** The setting, refused (409) without one. */
  function current(): LibrarySetting {
    const set = setting();
    if (!set) throw new SkillRefused('No skill library is set: set one in Settings', 409);
    return set;
  }

  /** The library's repository on a branch, refused (409) in a plain folder or on none. */
  async function onBranch(folder: string, what: string): Promise<LibraryGit & { branch: string }> {
    const repo = await gitOf(folder);
    if (!repo) {
      throw new SkillRefused(`${folder} is in no git repository: there is nothing to ${what}`, 409);
    }
    const { branch } = repo;
    if (!branch) {
      throw new SkillRefused('The library’s repository is on no branch: check one out first', 409);
    }
    return { ...repo, branch };
  }

  async function push(): Promise<void> {
    const { folder, commits } = current();
    if (commits !== 'push') {
      throw new SkillRefused(
        'Symbiote pushes the library only when Settings say Commit and push',
        409,
      );
    }
    const repo = await onBranch(folder, 'push');
    if (!repo.remote) {
      throw new SkillRefused(
        'The library’s repository has no remote to push to: add one with git remote add',
        409,
      );
    }
    const target = repo.upstream
      ? [
          'push',
          '--quiet',
          repo.remote,
          `HEAD:refs/heads/${repo.upstream.slice(repo.remote.length + 1)}`,
        ]
      : ['push', '--quiet', '--set-upstream', repo.remote, repo.branch];
    try {
      await network(repo.root, target);
    } catch (error) {
      throw new SkillRefused(`Not pushed: ${words(error)}`, 409);
    }
  }

  return {
    setting,
    async state() {
      const set = setting();
      if (!set) return null;
      const exists = kindOf(set.folder) === 'folder';
      const repo = exists ? await gitOf(set.folder) : undefined;
      return { folder: set.folder, exists, commits: set.commits, ...(repo ? { git: repo } : {}) };
    },
    async probe(text) {
      const folder = pathOf(text, home);
      if (!folder) return { folder: text, kind: 'missing', skills: 0, problem: NOT_FULL };
      const kind = kindOf(folder);
      if (kind === 'missing') return { folder, kind, skills: 0 };
      if (kind === 'file') {
        return { folder, kind, skills: 0, problem: `${folder} is a file, not a folder` };
      }
      const skills = skillCount(folder);
      const nested = skillCount(join(folder, 'skills'));
      const root = await read(folder, ['rev-parse', '--show-toplevel']);
      let repo: LibraryProbe['git'];
      if (root) {
        const branch = await read(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
        const remotes = ((await read(root, ['remote'])) ?? '').split('\n').filter((r) => r);
        const remote = remotes.includes('origin') ? 'origin' : remotes[0];
        repo = { root, ...(branch ? { branch } : {}), ...(remote ? { remote } : {}) };
      }
      return {
        folder,
        kind: readdirSync(folder).length === 0 ? 'empty' : 'folder',
        skills,
        ...(repo ? { git: repo } : {}),
        ...(nested > 0 ? { skillsFolder: nested } : {}),
      };
    },
    async set(change) {
      const folder = pathOf(change.folder, home);
      if (!folder) throw new SkillRefused(NOT_FULL, 400);
      const kind = kindOf(folder);
      if (kind === 'file') throw new SkillRefused(`${folder} is a file, not a folder`, 400);
      let library = folder;
      if (change.url !== undefined) {
        if (kind === 'folder' && readdirSync(folder).length > 0) {
          throw new SkillRefused(`${folder} holds files: clone into a new or empty folder`, 409);
        }
        await mkdir(dirname(folder), { recursive: true });
        try {
          await network(dirname(folder), ['clone', '--quiet', '--', change.url, folder]);
        } catch (error) {
          if (kind === 'missing') await rm(folder, { recursive: true, force: true });
          throw new SkillRefused(`Not cloned: ${words(error)}`, 409);
        }
        // A repository of skills keeps them in skills/, as `npx skills` and plugins read them.
        if (kindOf(join(folder, 'skills')) === 'folder') library = join(folder, 'skills');
      } else if (kind === 'missing') {
        if (!change.create) {
          throw new SkillRefused(`${folder} is not there: make it, or give another folder`, 409);
        }
        await mkdir(folder, { recursive: true });
      }
      await write({ folder: library, commits: change.commits });
    },
    async forget() {
      await rm(file, { force: true });
    },
    async commit(message) {
      const { folder, commits } = current();
      if (commits === 'none') {
        throw new SkillRefused(
          'Symbiote leaves the library’s git to you: commit it yourself, or change it in Settings',
          409,
        );
      }
      if (message.trim() === '') throw new SkillRefused('a commit needs a message', 400);
      const repo = await onBranch(folder, 'commit to');
      if (repo.changes.length === 0) {
        throw new SkillRefused('Nothing to commit in the library', 409);
      }
      // Only the library's folder: anything else staged in that repository stays staged.
      const where = `:/${repo.path}`;
      try {
        await git(repo.root, ['add', '--all', '--', where]);
        await git(repo.root, ['commit', '--quiet', '--message', message.trim(), '--', where]);
      } catch (error) {
        throw new SkillRefused(`Not committed: ${words(error)}`, 409);
      }
      if (commits === 'push') {
        try {
          await push();
        } catch (error) {
          if (error instanceof SkillRefused) {
            throw new SkillRefused(`Committed; ${error.message.replace(/^Not/, 'not')}`, 409);
          }
          throw error;
        }
      }
    },
    push,
    async pull() {
      const { folder, commits } = current();
      if (commits !== 'push') {
        throw new SkillRefused(
          'Symbiote pulls the library only when Settings say Commit and push',
          409,
        );
      }
      const repo = await onBranch(folder, 'pull into');
      if (!repo.upstream) {
        throw new SkillRefused('The library’s branch has no upstream to pull from', 409);
      }
      try {
        await network(repo.root, ['pull', '--quiet', '--ff-only']);
      } catch (error) {
        throw new SkillRefused(`Not pulled: ${words(error)}`, 409);
      }
    },
  };
}
