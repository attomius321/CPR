// Git's page (V66): a commit's details, the checkout's changes, and git's writes — staging,
// committing, branches and tags, fetch, pull, push — one at a time (`/api/git/…`); a file's diff
// opened in VS Code (V70). Since fix/git-page-feature-extend (decisions 636–645): an operation
// continued or aborted, cherry-pick, revert, merge, rebase, reset, discard, stashes, staging
// lines, a file's history and blame, remote branches deleted, branches hidden.
import { join } from 'node:path';
import {
  applyStash,
  blameFile,
  cherryPick,
  commitsLeaving,
  discardFile,
  deleteRemoteBranch,
  dropStash,
  endOperation,
  fileHistory,
  historyState,
  listRefs,
  listStashes,
  mergeInto,
  rebaseOnto,
  resetTo,
  RESET_MODES,
  revertCommit,
  stageLines,
  stashChanges,
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
  GitError,
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
  type FileBlame,
  type FileCommit,
  type GitRepo,
  type LineCount,
  type LinePick,
  type OperationEnd,
  type PullMode,
  type ResetMode,
  type StashEntry,
  type SyncState,
  type WorkingChanges,
} from '@symbiote/core';
import type { HiddenBranches } from './git-hidden.js';
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
  | { kind: 'pull'; mode: PullMode }
  | { kind: 'operation'; end: OperationEnd }
  | { kind: 'cherry-pick' | 'revert'; sha: string }
  | { kind: 'merge' | 'rebase'; branch: string }
  | { kind: 'reset'; sha: string; mode: ResetMode }
  | { kind: 'discard'; path: string }
  | { kind: 'stash'; action: 'push'; message: string }
  | { kind: 'stash'; action: 'apply' | 'pop' | 'drop'; sha: string }
  | { kind: 'lines'; path: string; staged: boolean; lines: LinePick[]; index: string }
  | { kind: 'remote-branch'; action: 'delete'; name: string }
  | { kind: 'hide'; ref: string; hidden: boolean };

export const GIT_WRITES = [
  'stage',
  'unstage',
  'commit',
  'branch',
  'tag',
  'fetch',
  'pull',
  'push',
  'operation',
  'cherry-pick',
  'revert',
  'merge',
  'rebase',
  'reset',
  'discard',
  'stash',
  'lines',
  'remote-branch',
  'hide',
];

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
  /** The stashes, newest first (decision 639). */
  stashes(): Promise<StashEntry[]>;
  /** The commits a reset to `sha` takes off the branch (decision 640). */
  leaving(sha: string): Promise<number>;
  /**
   * A file's commits from commit `sha` down, or from HEAD for an uncommitted one (`null`); null
   * unless the commit or the checkout lists the file (decision 643).
   */
  fileHistory(path: string, sha: string | null): Promise<FileCommit[] | null>;
  /** A file's blame at commit `sha`, or in the checkout (`null`); null unless listed there. */
  blame(path: string, sha: string | null): Promise<FileBlame | null>;
  /** The branches hidden from the graph, by full ref (decision 645). */
  hidden(): Promise<string[]>;
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
    case 'operation': {
      const end = text_('end');
      if (end !== 'continue' && end !== 'abort') throw new BadGitWrite('end: continue or abort');
      return { kind, end };
    }
    case 'cherry-pick':
    case 'revert':
      return { kind, sha: text_('sha') };
    case 'merge':
    case 'rebase':
      return { kind, branch: text_('branch') };
    case 'reset': {
      const mode = text_('mode');
      if (!RESET_MODES.includes(mode as ResetMode)) throw new BadGitWrite('mode: soft or mixed');
      return { kind, sha: text_('sha'), mode: mode as ResetMode };
    }
    case 'discard':
      return { kind, path: text_('path') };
    case 'stash': {
      const action = text_('action');
      if (action === 'push')
        return { kind, action, message: body.message === undefined ? '' : text_('message') };
      if (action === 'apply' || action === 'pop' || action === 'drop')
        return { kind, action, sha: text_('sha') };
      throw new BadGitWrite('action: push, apply, pop or drop');
    }
    case 'lines': {
      const lines = body.lines;
      const line = (pick: unknown): LinePick => {
        const { old, new: added } = (pick ?? {}) as Record<string, unknown>;
        const number = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0;
        if (old !== undefined && number(old) && added === undefined) return { old: old as number };
        if (added !== undefined && number(added) && old === undefined)
          return { new: added as number };
        throw new BadGitWrite('lines: each { old } or { new }, a line number');
      };
      if (!Array.isArray(lines)) throw new BadGitWrite('lines: a list');
      const staged = body.staged;
      if (typeof staged !== 'boolean') throw new BadGitWrite('staged: true or false');
      return { kind, path: text_('path'), staged, lines: lines.map(line), index: text_('index') };
    }
    case 'remote-branch': {
      if (text_('action') !== 'delete') throw new BadGitWrite('action: delete');
      return { kind, action: 'delete', name: text_('name') };
    }
    case 'hide': {
      const ref = text_('ref');
      if (!/^refs\/(heads|remotes)\/./.test(ref)) throw new BadGitWrite('ref: a branch, in full');
      const hidden = body.hidden;
      if (typeof hidden !== 'boolean') throw new BadGitWrite('hidden: true or false');
      return { kind, ref, hidden };
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
  /** The branches hidden from the graph (decision 645); without it, none can be. */
  hidden?: HiddenBranches;
}

/** Git's page on the repository at `repo`. */
export function gitPage(
  repo: GitRepo,
  { workspaceBranches, openFolder, revisions, hidden }: GitPageOptions = {},
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
      case 'operation':
        return endOperation(repo, request.end);
      case 'cherry-pick':
        return cherryPick(repo, request.sha);
      case 'revert':
        return revertCommit(repo, request.sha);
      case 'merge':
        return mergeInto(repo, request.branch);
      case 'rebase':
        return rebaseOnto(repo, request.branch);
      case 'reset':
        await resetTo(repo, request.sha, request.mode);
        return {};
      case 'discard':
        await discardFile(repo, request.path);
        return workingChanges(repo);
      case 'stash':
        if (request.action === 'push') await stashChanges(repo, request.message);
        else if (request.action === 'drop') await dropStash(repo, request.sha);
        else return applyStash(repo, request.sha, { pop: request.action === 'pop' });
        return {};
      case 'lines':
        await stageLines(repo, request);
        return workingChanges(repo);
      case 'remote-branch':
        await deleteRemoteBranch(repo, request.name);
        return {};
      case 'hide':
        return { hidden: await hide(request.ref, request.hidden) };
    }
  };
  /** Hides a listed branch or shows it again; the branch checked out is always listed. */
  const hide = async (ref: string, on: boolean): Promise<string[]> => {
    if (!hidden) throw new GitRefused('branches cannot be hidden here');
    if (!on) return hidden.set(ref, false);
    const refs = await listRefs(repo);
    const local = ref.startsWith('refs/heads/');
    const name = ref.slice(local ? 'refs/heads/'.length : 'refs/remotes/'.length);
    const listed = local ? refs.branches : refs.remotes;
    if (!listed.some((b) => b.name === name)) throw new GitRefused(`no branch ${name}`);
    if (local && (await historyState(repo)).branch === name)
      throw new GitRefused(`${name} is checked out: it is always listed`);
    return hidden.set(ref, true);
  };
  /** Where a file is listed: one of commit `sha`'s files, or a change in the checkout. */
  const listedFile = async (path: string, sha: string | null) => {
    if (sha) return (await commitInfo(repo, sha))?.files.find((f) => f.path === path) ?? null;
    const { staged, unstaged } = await workingChanges(repo);
    return [...staged, ...unstaged].find((f) => f.path === path) ?? null;
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
    stashes: () => listStashes(repo),
    leaving: (sha) => commitsLeaving(repo, sha),
    fileHistory: async (path, sha) =>
      (await listedFile(path, sha)) ? fileHistory(repo, path, sha ?? 'HEAD') : null,
    blame: async (path, sha) => {
      const file = await listedFile(path, sha);
      // A file gone at that side has no line to blame.
      if (!file || file.status === 'deleted') return null;
      if (!sha && file.status === 'untracked') return null;
      try {
        return await blameFile(repo, path, sha);
      } catch (error) {
        // A binary file, or one git cannot blame there: said in its words.
        if (error instanceof GitError) throw new GitRefused(error.stderr.trim(), { cause: error });
        throw error;
      }
    },
    hidden: () => hidden?.list() ?? Promise.resolve([]),
    open,
    write: (request) => serial(() => run(request)),
  };
}
