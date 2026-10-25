// A workspace's thread (V18c): what Symbiote's hooks record of its agent's sessions, one JSON line
// per entry in `symbiote/threads/<branch>.jsonl`. The hook runs once per event in the agent's
// process tree (`agent-hook.ts`), so this module uses Node's own modules only: loading
// `@symbiote/core` would make each event cost ~290 ms instead of ~25 ms.
import { realpathSync } from 'node:fs';
import {
  access,
  appendFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { ActivityEntry, ThreadEntry, ThreadQuestion } from '@symbiote/core';

/** Longest tool input kept: an `Edit` or a `Write` can carry a whole file. */
export const MAX_INPUT = 4096;

/** Entries a thread read answers, the newest. */
export const THREAD_LIMIT = 200;

/** A branch's file under `dir`, its slashes as folders (as workspaces and reviews are kept). */
function branchFile(dir: string, branch: string, extension: string): string | null {
  const parts = branch.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  const last = parts.pop() as string;
  return join(dir, ...parts, `${last}${extension}`);
}

/**
 * Where workspaces are kept: `<symbiote>/workspaces/` (V25). Their folder before,
 * `<symbiote>/features/`, is moved there by one `rename` when only it is there (an empty
 * `workspaces/` is replaced); with both, the old one is `left` as it is.
 */
export async function workspacesFolder(symbiote: string): Promise<{ dir: string; left?: true }> {
  const dir = join(symbiote, 'workspaces');
  const old = join(symbiote, 'features');
  try {
    await rename(old, dir);
    return { dir };
  } catch {
    // No old folder (often: moved already, or by another reader just now), or both are there.
    const left = await access(old).then(
      () => true,
      () => false,
    );
    return left ? { dir, left } : { dir };
  }
}

/** Where a workspace's thread is kept: `<symbiote>/threads/<branch>.jsonl`. */
export function threadPath(symbiote: string, branch: string): string {
  const path = branchFile(join(symbiote, 'threads'), branch, '.jsonl');
  if (!path) throw new Error(`not a branch name: ${branch}`);
  return path;
}

/**
 * Where a workspace's recorded tools are kept (V48f): `<symbiote>/activity/<branch>.jsonl`, a file
 * of their own, so the thread's last entries stay its messages.
 */
export function activityPath(symbiote: string, branch: string): string {
  const path = branchFile(join(symbiote, 'activity'), branch, '.jsonl');
  if (!path) throw new Error(`not a branch name: ${branch}`);
  return path;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** The questions of an `AskUserQuestion` call, with their options' labels. */
function questionsOf(input: unknown): ThreadQuestion[] | null {
  const list = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return null;
  const questions: ThreadQuestion[] = [];
  for (const item of list as unknown[]) {
    const v = (item ?? {}) as { question?: unknown; options?: unknown };
    const question = text(v.question);
    if (!question) continue;
    const options = Array.isArray(v.options)
      ? (v.options as unknown[])
          .map((o) => text((o as { label?: unknown } | null)?.label))
          .filter((o): o is string => o !== null)
      : [];
    questions.push({ question, options });
  }
  return questions;
}

/**
 * The thread entry for one hook's input (Claude Code's documented fields only), or null for an
 * event the thread does not keep.
 */
export function threadEntry(input: unknown, at: string): ThreadEntry | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  const session = text(v.session_id);
  if (!session) return null;
  const head = { at, session };
  switch (v.hook_event_name) {
    case 'SessionStart':
      return { ...head, kind: 'start', source: text(v.source) ?? 'startup' };
    case 'SessionEnd': {
      const reason = text(v.reason);
      return { ...head, kind: 'end', ...(reason ? { reason } : {}) };
    }
    case 'UserPromptSubmit': {
      const prompt = text(v.prompt);
      return prompt ? { ...head, kind: 'prompt', text: prompt } : null;
    }
    case 'Stop': {
      const report = text(v.last_assistant_message);
      return report ? { ...head, kind: 'report', text: report } : null;
    }
    case 'PermissionRequest':
    case 'PreToolUse': {
      const tool = text(v.tool_name);
      if (!tool) return null;
      if (tool === 'AskUserQuestion') {
        const questions = questionsOf(v.tool_input);
        return questions ? { ...head, kind: 'asks', tool, questions } : null;
      }
      // PreToolUse is registered for questions only; anything else waits on a permission.
      if (v.hook_event_name === 'PreToolUse') return null;
      const shown = v.tool_input === undefined ? null : JSON.stringify(v.tool_input);
      return {
        ...head,
        kind: 'asks',
        tool,
        ...(shown ? { input: shown.slice(0, MAX_INPUT) } : {}),
      };
    }
    case 'Notification': {
      const type = text(v.notification_type);
      const message = text(v.message);
      return type ? { ...head, kind: 'notice', type, ...(message ? { message } : {}) } : null;
    }
    default:
      return null;
  }
}

/** Longest subject kept of a tool call (V48f): enough for a command's line or a long path. */
export const MAX_SUBJECT = 160;

/** The tools' inputs whose field says what they work on (V48f); `path` marks a file's path. */
const SUBJECTS: Record<string, { field: string; path?: true }> = {
  Bash: { field: 'command' },
  Read: { field: 'file_path', path: true },
  Edit: { field: 'file_path', path: true },
  MultiEdit: { field: 'file_path', path: true },
  Write: { field: 'file_path', path: true },
  NotebookEdit: { field: 'notebook_path', path: true },
  Grep: { field: 'pattern' },
  Glob: { field: 'pattern' },
  WebFetch: { field: 'url' },
  WebSearch: { field: 'query' },
  Task: { field: 'description' },
  Agent: { field: 'description' },
};

/**
 * What a tool works on (V48f): its input's one field that says so — a command's first line, a
 * file's path (from the worktree when inside it), a pattern, a URL, a query, a subagent's
 * description —, cut at 160 characters; nothing else of its input is kept.
 */
function subjectOf(tool: string, input: unknown, worktree: string): string | undefined {
  const spec = SUBJECTS[tool];
  const value = spec ? text((input as Record<string, unknown> | null)?.[spec.field]) : null;
  if (!spec || !value) return undefined;
  let words =
    value
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? '';
  if (spec.path) {
    const inside = [`${worktree}/`, `${worktree}\\`].find((p) => words.startsWith(p));
    if (inside) words = words.slice(inside.length);
  }
  return words === '' ? undefined : words.slice(0, MAX_SUBJECT);
}

/**
 * The activity line for one tool hook's input (V48f): `PreToolUse` a start, `PostToolUse` an end,
 * `PostToolUseFailure` a failed end; null for any other event, or without a session, a tool or
 * the call's ID (which pairs a start with its end).
 */
export function activityEntry(input: unknown, at: string, worktree: string): ActivityEntry | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  const session = text(v.session_id);
  const tool = text(v.tool_name);
  const id = text(v.tool_use_id);
  const phase =
    v.hook_event_name === 'PreToolUse'
      ? 'start'
      : v.hook_event_name === 'PostToolUse' || v.hook_event_name === 'PostToolUseFailure'
        ? 'end'
        : null;
  if (!session || !tool || !id || !phase) return null;
  const subject = subjectOf(tool, v.tool_input, worktree);
  return {
    at,
    session,
    id,
    tool,
    ...(subject ? { subject } : {}),
    phase,
    ...(v.hook_event_name === 'PostToolUseFailure' ? { failed: true as const } : {}),
  };
}

/** A path's real path; the path as given when it cannot be resolved. */
export const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** The workspace whose worktree holds `cwd` (its branch and worktree), from the records in
 * `<symbiote>/workspaces/`. */
async function workspaceAt(
  symbiote: string,
  cwd: string,
): Promise<{ branch: string; worktree: string } | null> {
  const { dir } = await workspacesFolder(symbiote);
  const files = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
  const here = real(cwd);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    let record: { branch?: unknown; worktree?: unknown };
    try {
      record = JSON.parse(await readFile(join(dir, file), 'utf8')) as typeof record;
    } catch {
      continue;
    }
    const branch = text(record.branch);
    const worktree = text(record.worktree);
    if (!branch || !worktree) continue;
    // The file must be the branch's own: a copied or renamed record is not that workspace.
    const own = branchFile(dir, branch, '.json');
    if (!own || relative(dir, own) !== file) continue;
    const folder = real(worktree);
    if (here === folder || here.startsWith(folder + sep)) return { branch, worktree };
  }
  return null;
}

/**
 * Records one hook's input in the thread of the workspace whose worktree holds its `cwd`; the
 * thread's path, or null when there is nothing to record or no workspace there.
 */
export async function recordEvent(
  symbiote: string,
  input: unknown,
  at: string,
): Promise<string | null> {
  const entry = threadEntry(input, at);
  const cwd = text((input as { cwd?: unknown } | null)?.cwd);
  if (!entry || !cwd) return null;
  const branch = (await workspaceAt(symbiote, cwd))?.branch;
  if (!branch) return null;
  const path = threadPath(symbiote, branch);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`);
  return path;
}

/**
 * Records one tool hook's input in the activity of the workspace whose worktree holds its `cwd`
 * (V48f); the file's path, or null when there is nothing to record or no workspace there.
 */
export async function recordActivity(
  symbiote: string,
  input: unknown,
  at: string,
): Promise<string | null> {
  const cwd = text((input as { cwd?: unknown } | null)?.cwd);
  const found = cwd ? await workspaceAt(symbiote, cwd) : null;
  const entry = found ? activityEntry(input, at, found.worktree) : null;
  if (!found || !entry) return null;
  const path = activityPath(symbiote, found.branch);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`);
  return path;
}

/** Appends an entry Symbiote writes itself to a workspace's thread: a Codex run it stopped (V20a).
 * */
export async function appendThread(
  symbiote: string,
  branch: string,
  entry: ThreadEntry,
): Promise<void> {
  const path = threadPath(symbiote, branch);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`);
}

/**
 * The hook's work (`agent-hook.ts`): never throws, whatever it is given; decides nothing. In its
 * `activity` mode (V48f, the tools' hooks) it records a tool's start or end, else a thread entry.
 */
export async function hookMain(
  stdin: string,
  symbiote: string | undefined,
  at: string,
  mode?: string,
): Promise<void> {
  if (!symbiote) return;
  try {
    const input = JSON.parse(stdin) as unknown;
    await (mode === 'activity' ? recordActivity : recordEvent)(symbiote, input, at);
  } catch {
    // Nothing the hook can do about it, and nothing Claude Code should see.
  }
}

/** Whether a line is an entry the thread keeps. */
function isEntry(value: unknown): value is ThreadEntry {
  const v = value as Partial<Record<string, unknown>> | null;
  return (
    !!v &&
    typeof v.at === 'string' &&
    typeof v.session === 'string' &&
    ['start', 'end', 'prompt', 'report', 'asks', 'notice'].includes(v.kind as string)
  );
}

/**
 * A workspace's thread, the last `limit` entries, oldest first; broken lines are skipped, and a
 * question seen by both hooks (`PreToolUse`, then `PermissionRequest` when nothing answered it)
 * is one entry.
 */
export async function readThread(
  symbiote: string,
  branch: string,
  limit = THREAD_LIMIT,
): Promise<ThreadEntry[]> {
  const content = await readFile(threadPath(symbiote, branch), 'utf8').catch(() => '');
  return parseThread(content).slice(-limit);
}

/** How much of a thread's end the workspaces list reads: 40 of the longest entries seen (6 KB). */
export const THREAD_END = 256 * 1024;

/**
 * A file's last `bytes`, from the first whole line in them ('' when there is none, or no file):
 * what the workspaces list needs at a cost that does not grow with the file.
 */
async function fileEnd(path: string, bytes: number): Promise<string> {
  let file: FileHandle;
  try {
    file = await open(path, 'r');
  } catch {
    return '';
  }
  try {
    const { size } = await file.stat();
    // One byte before the cut: a newline there means the cut is at a line's start.
    const start = Math.max(0, size - bytes - 1);
    const buffer = Buffer.alloc(size - start);
    await file.read(buffer, 0, buffer.length, start);
    const from = start === 0 ? 0 : buffer.indexOf(0x0a) + 1;
    return from === 0 && start > 0 ? '' : buffer.subarray(from).toString('utf8');
  } finally {
    await file.close();
  }
}

/**
 * A thread's last entries, from its file's last `bytes`, the line cut there dropped: what the
 * workspaces list needs (the newest report, prompt and question) at a cost that does not grow with
 * the thread (V23: reading 5,000 entries whole took 9.6 ms, for each workspace on every read).
 */
export async function readThreadEnd(
  symbiote: string,
  branch: string,
  bytes = THREAD_END,
): Promise<ThreadEntry[]> {
  return parseThread(await fileEnd(threadPath(symbiote, branch), bytes));
}

/**
 * How much of the recorded tools the list reads (V48f): ~80 lines. What runs is among the newest:
 * while one tool runs, only tools beside it write. 64 KB cost 0.8 ms a working workspace.
 */
export const ACTIVITY_END = 16 * 1024;

/** Whether a line is a recorded tool's start or end (V48f). */
function isActivity(value: unknown): value is ActivityEntry {
  const v = value as Partial<Record<string, unknown>> | null;
  return (
    !!v &&
    typeof v.at === 'string' &&
    typeof v.session === 'string' &&
    typeof v.id === 'string' &&
    typeof v.tool === 'string' &&
    (v.phase === 'start' || v.phase === 'end')
  );
}

/** A workspace's recorded tools (V48f), from its file's last `bytes`; broken lines skipped. */
export async function readActivityEnd(
  symbiote: string,
  branch: string,
  bytes = ACTIVITY_END,
): Promise<ActivityEntry[]> {
  const lines = (await fileEnd(activityPath(symbiote, branch), bytes)).split('\n');
  return lines.flatMap((line) => {
    try {
      const value = JSON.parse(line) as unknown;
      return isActivity(value) ? [value] : [];
    } catch {
      return [];
    }
  });
}

/** A thread file's entries, as `readThread` describes them. */
function parseThread(content: string): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  /** The last question asked in each session, until something else happens there. */
  const asked = new Map<string, string>();
  for (const line of content.split('\n')) {
    if (line === '') continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isEntry(entry)) continue;
    if (entry.kind === 'asks' && entry.questions) {
      const key = JSON.stringify(entry.questions);
      if (asked.get(entry.session) === key) continue;
      asked.set(entry.session, key);
    } else if (entry.kind !== 'notice') {
      asked.delete(entry.session);
    }
    entries.push(entry);
  }
  return entries;
}

/** Whether the agent's last turn ended: its last report comes after the last prompt. */
export function turnEnded(entries: readonly ThreadEntry[]): boolean {
  const last = (kind: ThreadEntry['kind']) => entries.findLastIndex((e) => e.kind === kind);
  const report = last('report');
  return report >= 0 && report > last('prompt');
}

/**
 * When the agent last handed the turn back (V23): its newest report or question. Prompts are the
 * person's or Symbiote's; notices and sessions' starts and ends (a `/clear`) are not the agent's
 * acts.
 */
export function lastAction(entries: readonly ThreadEntry[]): string | undefined {
  return entries.findLast((e) => e.kind === 'report' || e.kind === 'asks')?.at;
}
