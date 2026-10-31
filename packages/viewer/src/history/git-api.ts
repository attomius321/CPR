// Git's page's calls to `symbiote view` (V66): a commit's details, the checkout's changes, the
// branch's upstream, a search, and git's writes; since fix/git-page-feature-extend the stashes,
// a file's history and blame, and the writes of decisions 636–645. Absolute, as History's are
// (`/api/git/…`).
import type {
  CommitInfo,
  FileBlame,
  FileCommit,
  HistoryScope,
  LineCount,
  LinePick,
  OperationEnd,
  PullMode,
  ResetMode,
  StashEntry,
  Stoppable,
  SyncState,
  WorkingChanges,
} from '@symbiote/core';

const API = '/api/git';
const WRITE_HEADERS = { 'content-type': 'application/json', 'x-symbiote': '1' };

/** git (or Symbiote) refused a write; `only`: the commits an unmerged branch alone holds. */
export class GitRefusal extends Error {
  override name = 'GitRefusal';
  constructor(
    message: string,
    readonly only?: number,
  ) {
    super(message);
  }
}

async function read<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${API}/${path}?${new URLSearchParams(query)}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

/** A diff as git gives it; null when there is none (404). */
async function diffText(path: string, query: Record<string, string>): Promise<string | null> {
  const response = await fetch(`${API}/${path}?${new URLSearchParams(query)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await response.text());
  return response.text();
}

export const fetchCommit = (sha: string) => read<CommitInfo>('commit', { sha });
export const fetchCommitLines = (sha: string) => read<LineCount[]>('commit/lines', { sha });
export const fetchCommitFile = (sha: string, path: string) =>
  diffText('commit/file', { sha, path });

export const fetchChanges = () => read<WorkingChanges>('changes');
export const fetchChangesLines = () =>
  read<{ staged: LineCount[]; unstaged: LineCount[] }>('changes/lines');
export const fetchChangeFile = (path: string, staged: boolean) =>
  diffText('changes/file', { path, ...(staged ? { staged: '1' } : {}) });

export const fetchSync = () => read<SyncState>('sync');
export const fetchStashes = () => read<StashEntry[]>('stashes');
/** The commits a reset to `sha` takes off the branch. */
export const fetchLeaving = async (sha: string) =>
  (await read<{ count: number }>('leaving', { sha })).count;
/** A file's commits from commit `sha` down, or from HEAD for an uncommitted one (null). */
export const fetchFileHistory = (path: string, sha: string | null) =>
  read<FileCommit[]>('file/history', { path, ...(sha ? { sha } : {}) });
/** A file's blame at commit `sha`, or in the checkout (null); git's refusal in its words. */
export async function fetchBlame(path: string, sha: string | null): Promise<FileBlame> {
  const query = new URLSearchParams({ path, ...(sha ? { sha } : {}) });
  const response = await fetch(`${API}/file/blame?${query}`);
  if (response.ok) return (await response.json()) as FileBlame;
  const text = await response.text();
  let said = text;
  try {
    said = (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    // A plain-text answer (404).
  }
  throw new Error(said);
}

/** The rows a search finds in a listing; null when the listing is stale (409). */
export async function findRows(
  scope: HistoryScope,
  version: string,
  q: string,
): Promise<number[] | null> {
  const response = await fetch(`${API}/find?${new URLSearchParams({ scope, version, q })}`);
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as { rows: number[] }).rows;
}

/** A write (`POST /api/git/<kind>`): its answer, or a `GitRefusal` in git's words. */
async function write<T>(kind: string, body: object = {}): Promise<T> {
  const response = await fetch(`${API}/${kind}`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(body),
  });
  if (response.ok) return (await response.json()) as T;
  const text = await response.text();
  let refusal: { error?: string; only?: number } = {};
  try {
    refusal = JSON.parse(text) as typeof refusal;
  } catch {
    // A plain-text refusal (400, 403).
  }
  throw new GitRefusal(refusal.error ?? text, refusal.only);
}

export const stage = (paths: string[]) => write<WorkingChanges>('stage', { paths });
export const unstage = (paths: string[]) => write<WorkingChanges>('unstage', { paths });
export const commit = (message: string, amend: boolean) =>
  write<{ sha: string }>('commit', { message, ...(amend ? { amend } : {}) });

export const createBranch = (name: string, at: string, checkout: boolean) =>
  write<{ warning?: string }>('branch', { action: 'create', name, at, checkout });
export const renameBranch = (name: string, to: string) =>
  write<object>('branch', { action: 'rename', name, to });
export const deleteBranch = (name: string, force: boolean) =>
  write<object>('branch', { action: 'delete', name, ...(force ? { force } : {}) });
export const createTag = (name: string, at: string, message: string) =>
  write<object>('tag', { action: 'create', name, at, ...(message.trim() ? { message } : {}) });
export const deleteTag = (name: string) => write<object>('tag', { action: 'delete', name });

export const fetchRemotes = () => write<object>('fetch');
export const pull = (mode: PullMode) => write<{ stopped?: string }>('pull', { mode });
export const push = () => write<{ upstream: string; set?: true }>('push');

export const endOperation = (end: OperationEnd) => write<Stoppable>('operation', { end });
export const cherryPick = (sha: string) => write<Stoppable>('cherry-pick', { sha });
export const revert = (sha: string) => write<Stoppable>('revert', { sha });
export const merge = (branch: string) => write<Stoppable>('merge', { branch });
export const rebase = (branch: string) => write<Stoppable>('rebase', { branch });
export const reset = (sha: string, mode: ResetMode) => write<object>('reset', { sha, mode });
export const discard = (path: string) => write<WorkingChanges>('discard', { path });
export const stash = (message: string) => write<object>('stash', { action: 'push', message });
export const unstash = (sha: string, action: 'apply' | 'pop' | 'drop') =>
  write<Stoppable>('stash', { action, sha });
/** Stages (`staged` false) or unstages the lines picked, from the diff whose `index` line was read. */
export const stageLines = (path: string, staged: boolean, lines: LinePick[], index: string) =>
  write<WorkingChanges>('lines', { path, staged, lines, index });
export const deleteRemoteBranch = (name: string) =>
  write<object>('remote-branch', { action: 'delete', name });
export const hideBranch = (ref: string, hidden: boolean) =>
  write<{ hidden: string[] }>('hide', { ref, hidden });

/** Opens a file's diff in VS Code (V70): one of a commit's files, or an uncommitted one on its side. */
export const openDiff = (file: { path: string } & ({ sha: string } | { staged: boolean })) =>
  write<object>('open', file);
