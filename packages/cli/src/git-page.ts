// Git's page (V66): a commit's details, the checkout's changes, and git's writes — staging,
// committing, branches and tags, fetch, pull, push — one at a time (`/api/git/…`); a file's diff
// opened in VS Code (V70).
import { join } from 'node:path';
import {
  commitFileDiff,
  commitInfo,
  commitLines,
  commitStaged,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  fetchAll,
  fileChangedSince,
  GitRefused,
  pull,
  PULL_MODES,
  push,
  renameBranch,
  resolveCommit,
  stageFiles,
  syncState,
  unstageFiles,
  workingChanges,
  workingFileDiff,
  workingLines,
  type CommitInfo,
  type GitRepo,
  type LineCount,
  type PullMode,
  type SyncState,
  type WorkingChanges,
} from '@symbiote/core';
import type { FolderAt, OpenFolder } from './editor.js';
import { emptyFile, isFile, keptFile, keptIndexFile } from './revision-copies.js';

/** A write the page asks for: the path's last part (`POST /api/git/<kind>`) and its body. */
export type GitWrite =
  | { kind: 'stage' | 'unstage'; paths: string[] }
  | { kind: 'commit'; message: string; amend?: boolean }
  | { kind: 'branch'; action: 'create'; name: string; at: string; checkout?: boolean }
  | { kind: 'branch'; action: 'rename'; name: string; to: string }
  | { kind: 'branch'; action: 'delete'; name: string; force?: boolean }
  | { kind: 'tag'; action: 'create'; name: string; at: string; message?: string }
  | { kind: 'tag'; action: 'delete'; name: string }
  | { kind: 'fetch' | 'push' }
  | { kind: 'pull'; mode: PullMode };

export const GIT_WRITES = ['stage', 'unstage', 'commit', 'branch', 'tag', 'fetch', 'pull', 'push'];

/**
 * A file whose diff opens in VS Code (`POST /api/git/open`, V70): one of a commit's files, against
 * its first parent; or one the status lists, staged (HEAD against the index) or not (the index
 * against the disk).
 */
export type GitOpen = { sha: string; path: string } | { path: string; staged: boolean };

export interface GitPage {
  commit(sha: string): Promise<CommitInfo | null>;
  commitLines(sha: string): Promise<LineCount[]>;
  commitFile(sha: string, path: string): Promise<string | null>;
  changes(): Promise<WorkingChanges>;
  changesLines(): Promise<{ staged: LineCount[]; unstaged: LineCount[] }>;
  changeFile(path: string, staged: boolean): Promise<string | null>;
  sync(): Promise<SyncState>;
  /** Opens a file's diff in VS Code, the two sides the page shows; refusals are `GitOpenRefused`. */
  open(request: GitOpen): Promise<void>;
  /** Runs a write after those asked before it; refusals are `GitRefused`. */
  write(request: GitWrite): Promise<unknown>;
}

/** A request's body was not a write of its kind. */
export class BadGitWrite extends Error {
  override name = 'BadGitWrite';
}

/** Why a file's diff did not open, with the answer's status. */
export class GitOpenRefused extends Error {
  override name = 'GitOpenRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502,
  ) {
    super(message);
  }
}

/** Reads `POST /api/git/open`'s body; throws `BadGitWrite` on anything else. */
export function parseGitOpen(text: string): GitOpen {
  const body: unknown = JSON.parse(text);
  if (typeof body !== 'object' || body === null) throw new BadGitWrite('a JSON object');
  const { sha, path, staged } = body as Record<string, unknown>;
  if (typeof path !== 'string' || path === '') throw new BadGitWrite('path: a file');
  if (sha !== undefined) {
    if (typeof sha !== 'string') throw new BadGitWrite('sha: a commit');
    return { sha, path };
  }
  if (staged !== undefined && typeof staged !== 'boolean')
    throw new BadGitWrite('staged: true or false');
  return { path, staged: staged === true };
}

/** Reads `POST /api/git/<kind>`'s body; throws `BadGitWrite` on anything else. */
export function parseGitWrite(kind: string, text: string): GitWrite {
  let body: Record<string, unknown> = {};
  if (text.trim() !== '') {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) throw new BadGitWrite('a JSON object');
    body = parsed as Record<string, unknown>;
  }
  const text_ = (key: string) => {
    const value = body[key];
    if (typeof value !== 'string') throw new BadGitWrite(`${key}: a string`);
    return value;
  };
  const flag = (key: string) => {
    const value = body[key];
    if (value !== undefined && typeof value !== 'boolean')
      throw new BadGitWrite(`${key}: true or false`);
    return value === true ? { [key]: true } : {};
  };
  const optional = (key: string) => (body[key] === undefined ? {} : { [key]: text_(key) });
  switch (kind) {
    case 'stage':
    case 'unstage': {
      const paths = body.paths;
      if (!Array.isArray(paths) || !paths.every((p): p is string => typeof p === 'string'))
        throw new BadGitWrite('paths: a list of paths');
      return { kind, paths };
    }
    case 'commit':
      return { kind, message: text_('message'), ...flag('amend') };
    case 'branch': {
      const action = text_('action');
      const name = text_('name');
      if (action === 'create') return { kind, action, name, at: text_('at'), ...flag('checkout') };
      if (action === 'rename') return { kind, action, name, to: text_('to') };
      if (action === 'delete') return { kind, action, name, ...flag('force') };
      throw new BadGitWrite('action: create, rename or delete');
    }
    case 'tag': {
      const action = text_('action');
      const name = text_('name');
      if (action === 'create')
        return { kind, action, name, at: text_('at'), ...optional('message') };
      if (action === 'delete') return { kind, action, name };
      throw new BadGitWrite('action: create or delete');
    }
    case 'fetch':
    case 'push':
      return { kind };
    case 'pull': {
      const mode = body.mode ?? 'ff-only';
      if (!PULL_MODES.includes(mode as PullMode))
        throw new BadGitWrite(`mode: ${PULL_MODES.join(', ')}`);
      return { kind, mode: mode as PullMode };
    }
  }
  throw new BadGitWrite(`no write ${kind}`);
}

export interface GitPageOptions {
  /** The workspaces' branches: renamed or deleted only with their workspace. */
  workspaceBranches?: () => Promise<string[]>;
  /** VS Code, which opens a file's diff (V70); without it, none opens. */
  openFolder?: OpenFolder;
  /** Where the sides' copies are kept: V43's `state/<repo>/revisions`. */
  revisions?: string;
}

/** Git's page on the repository at `repo`. */
export function gitPage(
  repo: GitRepo,
  { workspaceBranches, openFolder, revisions }: GitPageOptions = {},
): GitPage {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };
  const notAWorkspace = async (name: string) => {
    if ((await workspaceBranches?.())?.includes(name))
      throw new GitRefused(`${name} is a workspace's branch: clean up its workspace instead`);
  };
  const run = async (request: GitWrite): Promise<unknown> => {
    switch (request.kind) {
      case 'stage':
        await stageFiles(repo, request.paths);
        return workingChanges(repo);
      case 'unstage':
        await unstageFiles(repo, request.paths);
        return workingChanges(repo);
      case 'commit':
        return commitStaged(repo, request);
      case 'branch':
        if (request.action === 'create') return createBranch(repo, request);
        await notAWorkspace(request.name);
        if (request.action === 'rename') await renameBranch(repo, request.name, request.to);
        else await deleteBranch(repo, request.name, { force: request.force ?? false });
        return {};
      case 'tag':
        if (request.action === 'create') await createTag(repo, request);
        else await deleteTag(repo, request.name);
        return {};
      case 'fetch':
        await fetchAll(repo);
        return {};
      case 'pull':
        return pull(repo, request.mode);
      case 'push':
        return push(repo);
    }
  };
  // Each side as the row reads it (decision 501); the right side is the checkout's own file when
  // it is the same, editable there (V43's decision 287).
  const sides = async (
    request: GitOpen,
    revisions: string,
  ): Promise<[string | null, string | null]> => {
    const own = join(repo.root, ...request.path.split('/'));
    if ('sha' in request) {
      const info = await commitInfo(repo, request.sha);
      if (!info) throw new GitOpenRefused(`no commit ${request.sha}`, 404);
      const file = info.files.find((f) => f.path === request.path);
      if (!file) throw new GitOpenRefused(`${request.path} is not among its files`, 400);
      const parent = info.parents[0];
      const left = parent
        ? await keptFile(revisions, repo, parent, file.previousPath ?? file.path)
        : null;
      const right = await keptFile(revisions, repo, info.sha, file.path);
      const same =
        right !== null &&
        (await isFile(own)) &&
        !(await fileChangedSince(repo, info.sha, file.path));
      return [left, same ? own : right];
    }
    const changes = await workingChanges(repo);
    const file = (request.staged ? changes.staged : changes.unstaged).find(
      (f) => f.path === request.path,
    );
    if (!file) {
      const side = request.staged ? 'staged' : 'not staged';
      throw new GitOpenRefused(`${request.path} has no change ${side}`, 400);
    }
    const before = file.previousPath ?? file.path;
    const head = () => resolveCommit(repo, 'HEAD').catch(() => null);
    const atHead = async (path: string) => {
      const sha = await head();
      return sha ? keptFile(revisions, repo, sha, path) : null;
    };
    const onDisk = async () => ((await isFile(own)) ? own : null);
    if (request.staged) {
      const right = await keptIndexFile(revisions, repo, file.path);
      const changedAgain = changes.unstaged.some((f) => f.path === file.path);
      return [await atHead(before), right && !changedAgain ? ((await onDisk()) ?? right) : right];
    }
    // A conflict's diff is against HEAD, its markers on disk; a new file has nothing before it.
    if (file.status === 'conflicted') return [await atHead(file.path), await onDisk()];
    if (file.status === 'untracked') return [null, await onDisk()];
    return [await keptIndexFile(revisions, repo, before), await onDisk()];
  };
  const open = async (request: GitOpen): Promise<void> => {
    if (!openFolder || !revisions) throw new GitOpenRefused('no editor to open it in', 409);
    const [left, right] = await sides(request, revisions);
    if (!left && !right) throw new GitOpenRefused(`${request.path} is in neither side`, 409);
    // A new file opens alone, as it is; a deleted one against an empty side (V43).
    const at: FolderAt = left
      ? { left, right: right ?? (await emptyFile(revisions, request.path)) }
      : { path: right as string };
    const result = await openFolder(repo.root, at);
    if (!result.opened) throw new GitOpenRefused(result.message, 502);
  };
  return {
    commit: (sha) => commitInfo(repo, sha),
    commitLines: (sha) => commitLines(repo, sha),
    commitFile: (sha, path) => commitFileDiff(repo, sha, path),
    changes: () => workingChanges(repo),
    changesLines: () => workingLines(repo),
    changeFile: (path, staged) => workingFileDiff(repo, path, staged),
    sync: () => syncState(repo),
    open,
    write: (request) => serial(() => run(request)),
  };
}
