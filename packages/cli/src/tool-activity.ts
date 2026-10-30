// A tool call's line in an agent's activity (V48f, V73): what Claude Code's hooks say of a tool's
// start or end, kept as `ActivityEntry`. A workspace's hook (`thread.ts`) and Nucleus's gate
// (`nucleus-record.ts`, NU2) write them; the gate runs on every call, so this module imports
// nothing but types.
import type { ActivityEntry } from '@symbiote/core';

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

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

/** Longest command kept whole (V73): 99 % of the commands agents ran here were shorter. */
export const MAX_COMMAND = 8192;

/** How much of a command's output, or of a failure's error, is kept (V73): its end. */
export const MAX_OUTPUT = 2048;

/**
 * A text's end as an activity line keeps it (V73): whole up to `max` characters, else from the
 * first whole line in its last `max` (a test run's summary is at its end), said to be clipped.
 */
export function outputOf(
  value: string,
  max = MAX_OUTPUT,
): Pick<ActivityEntry, 'output' | 'clipped'> {
  const whole = value.trimEnd();
  if (whole === '') return {};
  if (whole.length <= max) return { output: whole };
  const end = whole.slice(-max);
  const from = end.indexOf('\n') + 1;
  return { output: from > 0 ? end.slice(from) : end, clipped: true };
}

/** A line's first line that says something, or null. */
const firstLineOf = (value: string | null): string | null =>
  value
    ?.split('\n')
    .find((line) => line.trim() !== '')
    ?.trim() ?? null;

/** What a call's start keeps beyond its subject (V73): a command whole, its words, its task. */
function startDetails(tool: string, input: unknown): Partial<ActivityEntry> {
  const v = (input ?? {}) as Record<string, unknown>;
  if (tool === 'Bash') {
    const command = text(v.command);
    const about = firstLineOf(text(v.description));
    return {
      ...(command ? { input: command.slice(0, MAX_COMMAND) } : {}),
      ...(about ? { about: about.slice(0, MAX_SUBJECT) } : {}),
    };
  }
  if (tool === 'TaskCreate') {
    const subject = text(v.subject);
    return subject ? { task: { subject: subject.slice(0, MAX_SUBJECT) } } : {};
  }
  if (tool === 'TaskUpdate') {
    const id = text(v.taskId);
    const status = text(v.status);
    return id ? { task: { id, ...(status ? { status } : {}) } } : {};
  }
  return {};
}

/** The lines an edit's diff hunks (`structuredPatch`) added and removed. */
function linesOf(patch: unknown): { added: number; removed: number } | null {
  if (!Array.isArray(patch)) return null;
  let added = 0;
  let removed = 0;
  for (const hunk of patch as unknown[]) {
    const lines = (hunk as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
  }
  return { added, removed };
}

/**
 * What a call's end keeps (V73), from Claude Code's `PostToolUse` (`tool_response`) or
 * `PostToolUseFailure` (`error`, `is_interrupt`), both with `duration_ms`.
 */
function endDetails(tool: string, v: Record<string, unknown>): Partial<ActivityEntry> {
  const ms =
    typeof v.duration_ms === 'number' && Number.isFinite(v.duration_ms) && v.duration_ms >= 0
      ? { ms: Math.round(v.duration_ms) }
      : {};
  if (v.hook_event_name === 'PostToolUseFailure') {
    const error = text(v.error);
    const code = error ? /^Exit code (\d+)\b/.exec(error)?.[1] : undefined;
    return {
      ...ms,
      ...(code !== undefined ? { exit: Number(code) } : {}),
      ...(error ? outputOf(error) : {}),
      ...(v.is_interrupt === true ? { interrupted: true as const } : {}),
    };
  }
  const response = (v.tool_response ?? {}) as Record<string, unknown>;
  if (tool === 'Bash') {
    const output = [response.stdout, response.stderr]
      .map((part) => (typeof part === 'string' ? part.trimEnd() : ''))
      .filter((part) => part !== '')
      .join('\n');
    return {
      ...ms,
      ...outputOf(output),
      ...(response.interrupted === true ? { interrupted: true as const } : {}),
      ...(text(response.backgroundTaskId) ? { background: true as const } : {}),
    };
  }
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write') {
    const content = text(response.content);
    // A file written new has no hunks: its lines are what was written.
    const lines =
      response.type === 'create' && content !== null
        ? { added: content.trimEnd().split('\n').length, removed: 0 }
        : linesOf(response.structuredPatch);
    return { ...ms, ...(lines ?? {}) };
  }
  if (tool === 'TaskCreate') {
    const task = (response.task ?? {}) as Record<string, unknown>;
    const id = text(task.id);
    const subject = text(task.subject);
    return {
      ...ms,
      ...(id
        ? { task: { id, ...(subject ? { subject: subject.slice(0, MAX_SUBJECT) } : {}) } }
        : {}),
    };
  }
  return ms;
}

/**
 * The activity line for one tool hook's input (V48f): `PreToolUse` a start, `PostToolUse` an end,
 * `PostToolUseFailure` a failed end; null for any other event, or without a session, a tool or
 * the call's ID (which pairs a start with its end). Since V73 a start keeps a command whole and
 * its words, an end its duration, exit code, output's end and an edit's lines.
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
    ...(phase === 'start' ? startDetails(tool, v.tool_input) : endDetails(tool, v)),
  };
}
