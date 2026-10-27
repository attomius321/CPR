// What the server accepts (`server.ts`): each request's JSON body and query, checked; a value
// that is not one throws with the words the server answers 400 with.
import {
  HISTORY_SCOPES,
  MERGE_STRATEGIES,
  type AgentKind,
  type BriefParts,
  type CheckoutTarget,
  type Graph,
  type HistoryScope,
  type LineCount,
  type LocalReview,
  type McpAnswer,
  type MergeRequest,
  type MergeStrategy,
  type PermissionMode,
  type ReviewFile,
  type ScoutAsk,
  type ScoutOpen,
  type ScoutEffortChange,
  type ScoutModelChange,
  type ScoutTerminalRequest,
  type WorkKind,
  type WorkspaceReply,
  type WorkspaceRequest,
  type WorkspaceTerminalRequest,
} from '@symbiote/core';
import type { Review, ReviewComment, ReviewEvent } from '@symbiote/forge';
import type { Pair } from './diffs.js';
import type { FileAt } from './terminal.js';

/** A side of a graph's change. */
export type Side = 'base' | 'head';

const EVENTS: readonly ReviewEvent[] = ['comment', 'approve', 'request-changes'];

/** A commit's full SHA, as a pattern's text: 40 hex digits, or 64 (SHA-256). */
export const SHA = '[0-9a-f]{40}(?:[0-9a-f]{24})?';
const FULL_SHA = new RegExp(`^${SHA}$`);

/** Most paths a terminal is asked about at once, and their length (V38): a row's worth. */
const MAX_TERMINAL_PATHS = 50;
const MAX_TERMINAL_PATH = 1024;

/**
 * `{ kind, title, parts, branch, planFirst, base?, from?, agent?, permissionMode?, effort?,
 * model? }` (V24, V20a, V30b, V33, V47), or `brief` instead of the kind, title and parts, each of its type; what
 * they say is the workspaces' to check (V18).
 */
export function parseWorkspaceRequest(text: string): WorkspaceRequest {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected { kind, title, parts, branch, planFirst }');
  }
  const {
    brief,
    kind,
    title,
    parts,
    branch,
    planFirst,
    base,
    from,
    agent,
    permissionMode,
    effort,
    model,
    documents,
  } = value;
  if (brief === undefined && kind === undefined) {
    throw new Error('kind: feature, fix, refactor, chore or spike');
  }
  if (brief !== undefined && typeof brief !== 'string') throw new Error('brief: what to build');
  if (kind !== undefined && typeof kind !== 'string') {
    throw new Error('kind: feature, fix, refactor, chore or spike');
  }
  if (title !== undefined && typeof title !== 'string') throw new Error("title: the work's name");
  const textOnly = (v: unknown) =>
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string');
  if (parts !== undefined && !textOnly(parts)) throw new Error('parts: each a text');
  if (typeof branch !== 'string') throw new Error("branch: the new branch's name");
  if (typeof planFirst !== 'boolean') throw new Error('planFirst: true or false');
  if (base !== undefined && typeof base !== 'string') throw new Error('base: a full SHA');
  if (from !== undefined && typeof from !== 'string') throw new Error("from: a branch's name");
  if (agent !== undefined && typeof agent !== 'string') {
    throw new Error('agent: claude, codex or hermes');
  }
  if (permissionMode !== undefined && typeof permissionMode !== 'string') {
    throw new Error('permissionMode: default, acceptEdits or auto');
  }
  if (effort !== undefined && typeof effort !== 'string')
    throw new Error('effort: a level, as high');
  if (model !== undefined && typeof model !== 'string') throw new Error('model: its ID, as sonnet');
  const isDocument = (d: unknown): d is { id: string; name: string } =>
    d !== null &&
    typeof d === 'object' &&
    typeof (d as { id?: unknown }).id === 'string' &&
    typeof (d as { name?: unknown }).name === 'string';
  if (documents !== undefined && !(Array.isArray(documents) && documents.every(isDocument))) {
    throw new Error('documents: each { id, name }, as kept');
  }
  return {
    ...(brief === undefined ? {} : { brief }),
    ...(kind === undefined ? {} : { kind: kind as WorkKind }),
    ...(title === undefined ? {} : { title }),
    ...(parts === undefined ? {} : { parts: parts as BriefParts }),
    branch,
    planFirst,
    ...(base === undefined ? {} : { base }),
    ...(from === undefined ? {} : { from }),
    ...(agent === undefined ? {} : { agent: agent as AgentKind }),
    ...(permissionMode === undefined ? {} : { permissionMode: permissionMode as PermissionMode }),
    ...(effort === undefined ? {} : { effort }),
    ...(model === undefined ? {} : { model }),
    ...(documents === undefined
      ? {}
      : { documents: documents.map(({ id, name }) => ({ id, name })) }),
  };
}

/** A file for a workspace about to start (V40): `{ name, data }`, the file as base64. */
export function parseDocument(text: string): { name: string; bytes: Buffer } {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected { name, data }');
  }
  if (typeof value.name !== 'string') throw new Error("name: the file's name");
  if (typeof value.data !== 'string') throw new Error('data: the file, as base64');
  return { name: value.name, bytes: Buffer.from(value.data, 'base64') };
}

/** The start page's draft (V24c): any object; what it holds is the page's to read. */
export function parseDraft(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('a draft is an object');
  }
  return value as Record<string, unknown>;
}

/** A page's error for Symbiote's logs (LG1, decision 353), as `report.ts` in the viewer sends it. */
export interface PageError {
  level: 'error' | 'warn';
  msg: string;
  /** The page's path. */
  page: string;
  /** The error, in the shape pino writes one: its name as `type`. */
  err?: { type: string; message: string; stack?: string };
  /** React's component stack, for an error thrown while a page renders. */
  componentStack?: string;
  /** How many more times it came in the reporter's window, and how many errors it dropped. */
  repeated?: number;
  dropped?: number;
}

/** `{ level, msg, page, err?: { name, message, stack? }, componentStack?, repeated?, dropped? }`. */
export function parsePageError(text: string): PageError {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (value?.level !== 'error' && value?.level !== 'warn') throw new Error('level: error or warn');
  if (typeof value.msg !== 'string' || value.msg === '') throw new Error('msg: what went wrong');
  if (typeof value.page !== 'string') throw new Error("page: the page's path");
  const error: PageError = { level: value.level, msg: value.msg, page: value.page };
  const err = value.err as Record<string, unknown> | null | undefined;
  if (err && typeof err === 'object' && typeof err.message === 'string') {
    error.err = {
      type: typeof err.name === 'string' ? err.name : 'Error',
      message: err.message,
      ...(typeof err.stack === 'string' ? { stack: err.stack } : {}),
    };
  }
  if (typeof value.componentStack === 'string') error.componentStack = value.componentStack;
  for (const count of ['repeated', 'dropped'] as const) {
    const n = value[count];
    if (typeof n === 'number' && Number.isSafeInteger(n) && n > 0) error[count] = n;
  }
  return error;
}

/** `{ branch, text, stop? }`: a message for a workspace's agent (V18c). */
export function parseWorkspaceReply(text: string): WorkspaceReply {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  if (typeof value.text !== 'string') throw new Error('text: the message');
  if (value.stop !== undefined && typeof value.stop !== 'boolean') {
    throw new Error('stop: true or false');
  }
  return { branch: value.branch, text: value.text, ...(value.stop ? { stop: true } : {}) };
}

/** `{ cols, rows }`: whole numbers from 2 to 1000; null otherwise. */
export function terminalSize(
  value: Record<string, unknown> | null,
): { cols: number; rows: number } | null {
  const ok = (n: unknown): n is number =>
    Number.isInteger(n) && (n as number) >= 2 && (n as number) <= 1000;
  return ok(value?.cols) && ok(value.rows) ? { cols: value.cols, rows: value.rows } : null;
}

/** `{ paths }` (V38): the paths in a row of a terminal, each as the agent printed it. */
export function parseTerminalPaths(text: string): string[] {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  const paths = value?.paths;
  if (
    !Array.isArray(paths) ||
    paths.length > MAX_TERMINAL_PATHS ||
    !paths.every((path) => typeof path === 'string' && path.length <= MAX_TERMINAL_PATH)
  ) {
    throw new Error(
      `paths: at most ${MAX_TERMINAL_PATHS}, each at most ${MAX_TERMINAL_PATH} characters`,
    );
  }
  return paths as string[];
}

/** `{ path, line?, column? }` (V38): a path a terminal printed, and where in it, 1-based. */
export function parseTerminalFile(text: string): FileAt {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  const { path, line, column } = value ?? {};
  if (typeof path !== 'string' || path === '' || path.length > MAX_TERMINAL_PATH) {
    throw new Error('path: a path the terminal printed');
  }
  if (line !== undefined && !isPosition(line)) throw new Error('line: a positive integer');
  if (column !== undefined && !isPosition(column)) throw new Error('column: a positive integer');
  return {
    path,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

/** `{ branch, cols, rows }`: a terminal on a workspace's agent session (V21), or a shell (V45). */
export function parseWorkspaceTerminal(text: string): WorkspaceTerminalRequest {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  const size = terminalSize(value);
  if (!size) throw new Error('cols, rows: whole numbers, 2 to 1000');
  return { branch: value.branch, ...size };
}

/** `{ text, agent?, effort? }`: a question for Scout (V35). */
export function parseScoutAsk(text: string): ScoutAsk {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.text !== 'string') throw new Error('text: the question');
  if (value.agent !== undefined && value.agent !== 'claude' && value.agent !== 'codex') {
    throw new Error('agent: claude or codex');
  }
  const { effort, model } = value;
  if (effort !== undefined && effort !== null && typeof effort !== 'string') {
    throw new Error("effort: a level, as high, or null for the agent's own");
  }
  if (model !== undefined && model !== null && typeof model !== 'string') {
    throw new Error('model: its ID, as sonnet, or null for the default');
  }
  return {
    text: value.text,
    ...(value.agent ? { agent: value.agent } : {}),
    ...(effort === undefined ? {} : { effort }),
    ...(model === undefined ? {} : { model }),
  };
}

/** `{ agent?, model?, effort? }` (V50): Scout's conversation opened with no question. */
export function parseScoutOpen(text: string): ScoutOpen {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (value?.agent !== undefined && value.agent !== 'claude' && value.agent !== 'codex') {
    throw new Error('agent: claude or codex');
  }
  const { model, effort } = value ?? {};
  if (model !== undefined && model !== null && typeof model !== 'string') {
    throw new Error('model: its ID, as sonnet, or null for the default');
  }
  if (effort !== undefined && effort !== null && typeof effort !== 'string') {
    throw new Error("effort: a level, as high, or null for the agent's own");
  }
  return {
    ...(value?.agent ? { agent: value.agent } : {}),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
}

/** `{ effort }`: Scout's, Scribe's or the merger's level in the project's config, null for none. */
export function parseScoutEffort(text: string): ScoutEffortChange {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  const effort = value?.effort;
  if (effort !== null && typeof effort !== 'string') {
    throw new Error("effort: a level, as high, or null for each agent's own");
  }
  return { effort };
}

/** `{ model }` (V47): a model's ID, or null for the default; Scout's, Scribe's, the merger's. */
export function parseModelChange(text: string): ScoutModelChange {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  const model = value?.model;
  if (model !== null && typeof model !== 'string') {
    throw new Error('model: its ID, as sonnet, or null for the default');
  }
  return { model };
}

/** `{ cols, rows }`: a terminal on Scout's session (V35). */
export function parseScoutTerminal(text: string): ScoutTerminalRequest {
  const size = terminalSize(JSON.parse(text) as Record<string, unknown> | null);
  if (!size) throw new Error('cols, rows: whole numbers, 2 to 1000');
  return size;
}

/** `{ branch, unmerged? }`: a workspace to clean up (V18c). */
export function parseWorkspaceClean(text: string): { branch: string; unmerged?: boolean } {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  if (value.unmerged !== undefined && typeof value.unmerged !== 'boolean') {
    throw new Error('unmerged: true or false');
  }
  return { branch: value.branch, ...(value.unmerged ? { unmerged: true } : {}) };
}

/** `{ branch, against }` (V65): the branch to review a workspace against; null, where it started. */
export function parseWorkspaceAgainst(text: string): { branch: string; against: string | null } {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  if (value.against !== null && (typeof value.against !== 'string' || value.against === '')) {
    throw new Error('against: a branch name, or null for where it started');
  }
  return { branch: value.branch, against: value.against };
}

/** `{ branch }`: a workspace's worktree to open. */
export function parseWorkspaceOpen(text: string): { branch: string } {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  return { branch: value.branch };
}

/**
 * `{ branch, file, previousPath?, uncommitted? }` (V43): a file a workspace's changes list, to
 * open as its diff; for a renamed file, where it was; `uncommitted`, a file its worktree has not
 * committed.
 */
export function parseWorkspaceDiff(text: string): {
  branch: string;
  file: { path: string; previousPath?: string; uncommitted?: true };
} {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  if (typeof value.file !== 'string' || value.file === '') {
    throw new Error('file: a path in its worktree');
  }
  if (value.previousPath !== undefined && typeof value.previousPath !== 'string') {
    throw new Error('previousPath: where a renamed file was');
  }
  if (value.uncommitted !== undefined && typeof value.uncommitted !== 'boolean') {
    throw new Error('uncommitted: true for a file its worktree has not committed');
  }
  const { previousPath, uncommitted } = value;
  return {
    branch: value.branch,
    file: {
      path: value.file,
      ...(previousPath ? { previousPath } : {}),
      ...(uncommitted ? { uncommitted: true as const } : {}),
    },
  };
}

/**
 * `{ branch, into, strategy? }`: a branch to merge, the branch to merge it into (V26), and how
 * it lands (V67).
 */
export function parseMergeRequest(text: string): MergeRequest {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string' || value.branch === '') {
    throw new Error('branch: the branch to merge');
  }
  if (typeof value.into !== 'string' || value.into === '') {
    throw new Error('into: the branch to merge into');
  }
  const { strategy } = value;
  if (strategy !== undefined && !(MERGE_STRATEGIES as readonly unknown[]).includes(strategy)) {
    throw new Error(`strategy: ${MERGE_STRATEGIES.join(' or ')}`);
  }
  return {
    branch: value.branch,
    into: value.into,
    ...(strategy ? { strategy: strategy as MergeStrategy } : {}),
  };
}

/** `{ id, comments }`: what to change in a merge's resolution (V26c). */
export function parseMergeChanges(text: string): { id: string; comments: string } {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.id !== 'string' || value.id === '') throw new Error('id: a queued merge');
  if (typeof value.comments !== 'string') throw new Error('comments: what to change');
  return { id: value.id, comments: value.comments };
}

/** `{ id }`: a queued merge. */
export function parseMergeId(text: string): string {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.id !== 'string' || value.id === '') throw new Error('id: a queued merge');
  return value.id;
}

const CHECKOUT_KINDS: readonly CheckoutTarget['kind'][] = ['branch', 'remote', 'tag', 'commit'];

/** `{ kind, name }`, or `{ kind: 'commit', sha }` with a full SHA. */
export function parseCheckoutTarget(text: string): CheckoutTarget {
  const value = JSON.parse(text) as { kind?: unknown; name?: unknown; sha?: unknown } | null;
  const kind = value?.kind as CheckoutTarget['kind'];
  if (!CHECKOUT_KINDS.includes(kind)) throw new Error('kind: branch, remote, tag or commit');
  if (kind === 'commit') {
    if (typeof value?.sha !== 'string' || !FULL_SHA.test(value.sha)) {
      throw new Error('sha: not a full SHA');
    }
    return { kind, sha: value.sha };
  }
  const name = value?.name;
  if (typeof name !== 'string' || name === '' || name.length > 255)
    throw new Error('name: a ref name');
  return { kind, name };
}

/** `{ side, file, line, column? }`: a file the graph mentions on that side, 1-based positions. */
/** `POST ./api/open`'s body: a file of the change, or one of `conflicts` (head side). */
export function parseOpen(
  text: string,
  allowed: Record<Side, Set<string>>,
  conflicts: ReadonlySet<string> = new Set(),
): { side: Side; file: string; line: number; column: number } {
  const value = JSON.parse(text) as Record<'side' | 'file' | 'line' | 'column', unknown> | null;
  const { side, file, line, column = 1 } = value ?? {};
  if (side !== 'base' && side !== 'head') throw new Error('side: base or head');
  const known = (path: string) =>
    allowed[side].has(path) || (side === 'head' && conflicts.has(path));
  if (typeof file !== 'string' || !known(file)) {
    throw new Error(`${String(file)} is not part of this change`);
  }
  if (!isPosition(line)) throw new Error('line: a positive integer');
  if (!isPosition(column)) throw new Error('column: a positive integer');
  return { side, file, line, column };
}

function isPosition(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
}

/** `?scope=`: every branch when absent; null when unknown. */
export function historyScope(url: URL): HistoryScope | null {
  const scope = url.searchParams.get('scope') ?? 'all';
  return HISTORY_SCOPES.includes(scope as HistoryScope) ? (scope as HistoryScope) : null;
}

/** A non-negative integer, or null. */
export function count(text: string): number | null {
  const n = Number(text);
  return text !== '' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * A branch review's verdict from the viewer (V16): the event, the summary, and comments on lines
 * of the change (checked as for a forge) or about one of its symbols; a comment on a line no
 * symbol holds names none (V60).
 */
export function parseLocalReview(
  text: string,
  graph: Graph,
  allowed: Record<Side, Set<string>>,
): LocalReview {
  const value = JSON.parse(text) as Partial<Record<keyof LocalReview, unknown>> | null;
  if (!value || typeof value !== 'object') throw new Error('not a review');
  const { event, body, comments } = value;
  if (!EVENTS.includes(event as ReviewEvent)) throw new Error(`unknown event '${String(event)}'`);
  if (typeof body !== 'string') throw new Error('body must be a string');
  if (!Array.isArray(comments)) throw new Error('comments must be a list');
  const symbols = new Set(graph.nodes.map((n) => n.id));
  return {
    event: event as ReviewEvent,
    body,
    comments: comments.map((raw: unknown, i) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      const where = `comment ${i + 1}`;
      if (typeof c.id !== 'string' || c.id === '' || c.id.length > 100)
        throw new Error(`${where}: id`);
      if (c.symbol === undefined && c.side === undefined) {
        throw new Error(`${where}: a line or a symbol`);
      }
      if (c.symbol !== undefined && (typeof c.symbol !== 'string' || !symbols.has(c.symbol))) {
        const named = typeof c.symbol === 'string' ? c.symbol : 'its symbol';
        throw new Error(`${where}: ${named} is not part of this change`);
      }
      if (typeof c.body !== 'string' || c.body.trim() === '') throw new Error(`${where}: empty`);
      const about = {
        id: c.id,
        ...(typeof c.symbol === 'string' ? { symbol: c.symbol } : {}),
        body: c.body,
      };
      if (c.side === undefined) return about;
      // Checked as a forge's comment would be; its errors name this comment.
      let placed: ReviewComment | undefined;
      try {
        [placed] = parseReview(
          JSON.stringify({ event, body: '', comments: [{ ...c, body: c.body }] }),
          allowed,
        ).comments;
      } catch (error) {
        throw new Error((error as Error).message.replace(/^comment 1/, where), { cause: error });
      }
      if (!placed) throw new Error(`${where}: line`);
      const { side, path, otherPath, line } = placed;
      return { ...about, side, path, otherPath, line };
    }),
  };
}

/** `{ id, yes }` (MC1): the person's answer to an ask of Symbiote's MCP. */
export function parseMcpAnswer(text: string): McpAnswer {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.id !== 'string' || value.id === '' || value.id.length > 100) {
    throw new Error('id: an ask');
  }
  if (typeof value.yes !== 'boolean') throw new Error('yes: true or false');
  return { id: value.id, yes: value.yes };
}

/** `{ ref }`: a branch or remote branch name. */
export function parseRef(text: string): string {
  const ref = (JSON.parse(text) as { ref?: unknown } | null)?.ref;
  if (typeof ref !== 'string' || ref === '' || ref.length > 255) throw new Error('ref: a branch');
  return ref;
}

/** `{ base, head }`: two full SHAs. */
export function parsePair(text: string): Pair {
  const value = JSON.parse(text) as Partial<Record<keyof Pair, unknown>> | null;
  const { base, head } = value ?? {};
  if (typeof base !== 'string' || !FULL_SHA.test(base)) throw new Error('base: not a full SHA');
  if (typeof head !== 'string' || !FULL_SHA.test(head)) throw new Error('head: not a full SHA');
  return { base, head };
}

/** Checks a review from the viewer: known event, comments only on files of this change. */
export function parseReview(text: string, allowed: Record<Side, Set<string>>): Review {
  const value = JSON.parse(text) as Partial<Record<keyof Review, unknown>>;
  if (!value || typeof value !== 'object') throw new Error('not a review');
  const { event, body, comments } = value;
  if (!EVENTS.includes(event as ReviewEvent)) throw new Error(`unknown event '${String(event)}'`);
  if (typeof body !== 'string') throw new Error('body must be a string');
  if (!Array.isArray(comments)) throw new Error('comments must be a list');
  return {
    event: event as ReviewEvent,
    body,
    comments: comments.map((raw: unknown, i): ReviewComment => {
      const c = (raw ?? {}) as Partial<Record<keyof ReviewComment, unknown>>;
      const where = `comment ${i + 1}`;
      if (c.side !== 'base' && c.side !== 'head') throw new Error(`${where}: side`);
      const other = c.side === 'head' ? 'base' : 'head';
      if (typeof c.path !== 'string' || !allowed[c.side].has(c.path)) {
        throw new Error(`${where}: ${String(c.path)} is not part of this change`);
      }
      if (
        typeof c.otherPath !== 'string' ||
        !(c.otherPath === c.path || allowed[other].has(c.otherPath))
      ) {
        throw new Error(`${where}: otherPath`);
      }
      if (typeof c.line !== 'number' || !Number.isInteger(c.line) || c.line < 1) {
        throw new Error(`${where}: line`);
      }
      if (typeof c.body !== 'string' || c.body.trim() === '') throw new Error(`${where}: empty`);
      return { side: c.side, path: c.path, otherPath: c.otherPath, line: c.line, body: c.body };
    }),
  };
}

/**
 * The graph's files with git's lines (V60), matched by path (where a file is, or was for a deleted
 * one); a file git counts no lines of is binary.
 */
export function withLines(files: Graph['files'], counts: readonly LineCount[]): ReviewFile[] {
  const byPath = new Map(counts.map((count) => [count.path, count]));
  return files.map((file) => {
    const count = byPath.get(file.path);
    if (!count) return file;
    if (count.added === null || count.removed === null) return { ...file, binary: true };
    return { ...file, added: count.added, removed: count.removed };
  });
}

/** Repo-relative files per side that the graph refers to. */
export function sourceFiles(graph: Graph): Record<Side, Set<string>> {
  const files: Record<Side, Set<string>> = { base: new Set(), head: new Set() };
  for (const node of graph.nodes) {
    if (node.base) files.base.add(node.base.file);
    if (node.head) files.head.add(node.head.file);
  }
  for (const file of graph.files) {
    if (file.status !== 'added') files.base.add(file.previousPath ?? file.path);
    if (file.status !== 'deleted') files.head.add(file.path);
  }
  return files;
}
