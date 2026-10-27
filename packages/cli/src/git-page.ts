// Git's page (V66): a commit's details, the checkout's changes, and git's writes — staging,
// committing, branches and tags, fetch, pull, push — one at a time (`/api/git/…`).
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
  GitRefused,
  pull,
  PULL_MODES,
  push,
  renameBranch,
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

export interface GitPage {
  commit(sha: string): Promise<CommitInfo | null>;
  commitLines(sha: string): Promise<LineCount[]>;
  commitFile(sha: string, path: string): Promise<string | null>;
  changes(): Promise<WorkingChanges>;
  changesLines(): Promise<{ staged: LineCount[]; unstaged: LineCount[] }>;
  changeFile(path: string, staged: boolean): Promise<string | null>;
  sync(): Promise<SyncState>;
  /** Runs a write after those asked before it; refusals are `GitRefused`. */
  write(request: GitWrite): Promise<unknown>;
}

/** A request's body was not a write of its kind. */
export class BadGitWrite extends Error {
  override name = 'BadGitWrite';
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
}

/** Git's page on the repository at `repo`. */
export function gitPage(repo: GitRepo, { workspaceBranches }: GitPageOptions = {}): GitPage {
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
  return {
    commit: (sha) => commitInfo(repo, sha),
    commitLines: (sha) => commitLines(repo, sha),
    commitFile: (sha, path) => commitFileDiff(repo, sha, path),
    changes: () => workingChanges(repo),
    changesLines: () => workingLines(repo),
    changeFile: (path, staged) => workingFileDiff(repo, path, staged),
    sync: () => syncState(repo),
    write: (request) => serial(() => run(request)),
  };
}
