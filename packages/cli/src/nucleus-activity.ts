// What Nucleus did (NU2, decisions 604–608): its activity file beside its record,
// `nucleus-activity.jsonl`, one line an event across its conversations. Claude Code's hooks write
// it (`nucleus-hook.ts`): the gate its call's start and decision in its own process
// (`nucleus-record.ts`), the other events in the background; Symbiote writes its own side (its tools, the Confirms, a conversation
// opened or ended, Codex's thread as it reads it). Every string is redacted before it is written.
// The hook loads this module for the events it records in the background: Node's own modules only.
import { rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  NucleusActivity,
  NucleusActivityLine,
  NucleusCall,
  TurnTokens,
  WebPage,
} from '@symbiote/core';
import { activityArg, appendActivity, checkoutOf, gateHook, ofSession } from './nucleus-record.js';
import { fileWindow } from './thread.js';
import { activityEntry, MAX_OUTPUT, MAX_SUBJECT } from './tool-activity.js';

export { appendActivity, gateLine, redact } from './nucleus-record.js';

/** The activity file, and the one it moved to when it grew past `ACTIVITY_ROTATE`. */
export const NUCLEUS_ACTIVITY = 'nucleus-activity.jsonl';
export const NUCLEUS_ACTIVITY_OLDER = 'nucleus-activity.1.jsonl';

/** Past this size the file moves to the older one, which it replaces (decision 604). */
export const ACTIVITY_ROTATE = 4 * 1024 * 1024;

/** What the Activity tab reads: the newest megabyte, across the two files (V73's window). */
export const ACTIVITY_WINDOW = 1024 * 1024;

/** Moves the file in `folder` to the older one when it is past `limit`; whether it did. */
export async function rotateActivity(folder: string, limit = ACTIVITY_ROTATE): Promise<boolean> {
  const file = join(folder, NUCLEUS_ACTIVITY);
  const size = await stat(file).then(
    (s) => s.size,
    () => 0,
  );
  if (size <= limit) return false;
  await rename(file, join(folder, NUCLEUS_ACTIVITY_OLDER));
  return true;
}

/** Whether a line is one of the file's: an entry (`kind`) or a call's start or end. */
function isLine(value: unknown): value is NucleusActivityLine {
  const v = value as Partial<Record<string, unknown>> | null;
  if (!v || typeof v !== 'object' || typeof v.at !== 'string') return false;
  if (typeof v.kind === 'string') return true;
  return (
    (v.phase === 'start' || v.phase === 'end') &&
    typeof v.id === 'string' &&
    typeof v.tool === 'string' &&
    typeof v.session === 'string'
  );
}

/**
 * The newest `bytes` of Nucleus's activity in `folder`, across the older file and the current one,
 * oldest first; broken lines skipped. `cut` when older lines were left out.
 */
export async function readNucleusActivity(
  folder: string,
  bytes = ACTIVITY_WINDOW,
): Promise<NucleusActivity> {
  const current = await fileWindow(join(folder, NUCLEUS_ACTIVITY), bytes);
  let text = current.text;
  let cut = current.cut;
  const left = bytes - Buffer.byteLength(current.text);
  if (!cut && left > 0) {
    const older = await fileWindow(join(folder, NUCLEUS_ACTIVITY_OLDER), left);
    text = older.text + text;
    cut = older.cut;
  } else if (!cut) {
    cut = await stat(join(folder, NUCLEUS_ACTIVITY_OLDER)).then(
      () => true,
      () => false,
    );
  }
  const lines = text.split('\n').flatMap((line) => {
    if (line === '') return [];
    try {
      const value = JSON.parse(line) as unknown;
      return isLine(value) ? [value] : [];
    } catch {
      return [];
    }
  });
  return { lines, cut };
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

/** A text's start, whole up to `max`, else cut at its last line break in it, said to be clipped. */
export function headOf(value: string, max = MAX_OUTPUT): { output?: string; clipped?: true } {
  const whole = value.trimEnd();
  if (whole === '') return {};
  if (whole.length <= max) return { output: whole };
  const start = whole.slice(0, max);
  const at = start.lastIndexOf('\n');
  return { output: at > max / 2 ? start.slice(0, at) : start, clipped: true };
}

/** A tool's answer as text: a string, MCP's content blocks, or the text parts of its object. */
function answerText(response: unknown): string {
  if (typeof response === 'string') return response;
  const blocks = Array.isArray(response)
    ? response
    : Array.isArray((response as { content?: unknown } | null)?.content)
      ? (response as { content: unknown[] }).content
      : null;
  if (!blocks) return '';
  return blocks
    .map((b) => (typeof b === 'string' ? b : (text((b as { text?: unknown } | null)?.text) ?? '')))
    .filter((t) => t !== '')
    .join('\n');
}

/** What a call's end keeps besides V73's fields, by its tool. */
function endExtras(tool: string, response: unknown): Partial<NucleusCall> {
  const r = (response ?? {}) as Record<string, unknown>;
  if (tool === 'WebFetch') {
    const url = text(r.url);
    const code = count(r.code);
    const bytes = count(r.bytes);
    const pages: WebPage[] = url
      ? [
          {
            url,
            ...(code !== undefined ? { code } : {}),
            ...(bytes !== undefined ? { bytes } : {}),
          },
        ]
      : [];
    return { ...(pages.length > 0 ? { pages } : {}), ...headOf(text(r.result) ?? '') };
  }
  if (tool === 'WebSearch') {
    const links: WebPage[] = [];
    for (const result of Array.isArray(r.results) ? (r.results as unknown[]) : []) {
      const content = (result as { content?: unknown } | null)?.content;
      for (const link of Array.isArray(content) ? (content as unknown[]) : []) {
        const v = (link ?? {}) as { url?: unknown; title?: unknown };
        const url = text(v.url);
        const title = text(v.title);
        if (url) links.push({ ...(title ? { title: title.slice(0, MAX_SUBJECT) } : {}), url });
      }
    }
    return links.length > 0 ? { links } : {};
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const files = Array.isArray(r.filenames)
      ? (r.filenames as unknown[]).filter((f): f is string => typeof f === 'string')
      : [];
    return headOf(text(r.content) ?? files.join('\n'));
  }
  if (tool.startsWith('mcp__')) return headOf(answerText(response));
  return {};
}

/** How much of a transcript's end is read for a turn's tokens. */
const TRANSCRIPT_END = 4 * 1024 * 1024;

/** Whether a transcript's line is the person's prompt: text, not a tool's result. */
function isPrompt(line: Record<string, unknown>): boolean {
  if (line.type !== 'user') return false;
  const content = (line.message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content.trim() !== '';
  return (
    Array.isArray(content) &&
    (content as { type?: unknown }[]).some((block) => block?.type === 'text') &&
    !(content as { type?: unknown }[]).some((block) => block?.type === 'tool_result')
  );
}

/**
 * A turn's tokens and time from Claude Code's transcript at `path`: its assistant messages' usage
 * since the last prompt, each message once (its blocks are lines of their own); the time from that
 * prompt to `at`. Empty when nothing is read.
 */
export async function turnTokens(
  path: string,
  at: string,
): Promise<{ tokens?: TurnTokens; ms?: number }> {
  const { text: content } = await fileWindow(path, TRANSCRIPT_END);
  const parsed = content.split('\n').flatMap((line): Record<string, unknown>[] => {
    try {
      const value = JSON.parse(line) as unknown;
      return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
  const from = parsed.findLastIndex(isPrompt);
  if (from < 0) return {};
  const usages = new Map<string, Record<string, unknown>>();
  parsed.slice(from + 1).forEach((line, i) => {
    if (line.type !== 'assistant') return;
    const message = (line.message ?? {}) as { id?: unknown; usage?: unknown };
    if (!message.usage || typeof message.usage !== 'object') return;
    usages.set(text(message.id) ?? `#${i}`, message.usage as Record<string, unknown>);
  });
  const sum = (field: string) =>
    [...usages.values()].reduce((total, usage) => total + (count(usage[field]) ?? 0), 0);
  const started = Date.parse(text(parsed[from]?.timestamp) ?? '');
  const ended = Date.parse(at);
  const ms = Number.isNaN(started) || Number.isNaN(ended) ? undefined : ended - started;
  const tokens: TurnTokens | undefined =
    usages.size > 0
      ? {
          input: sum('input_tokens'),
          cached: sum('cache_read_input_tokens'),
          cacheWrite: sum('cache_creation_input_tokens'),
          output: sum('output_tokens'),
        }
      : undefined;
  return { ...(tokens ? { tokens } : {}), ...(ms !== undefined && ms >= 0 ? { ms } : {}) };
}

/**
 * The lines for one of Claude Code's hooks but PreToolUse (the gate's): the person's message, an
 * answer and its turn's tokens, a session's start and end, a compaction, an error, a notice, a
 * call's end, a call its agent refused. Empty for anything else.
 */
export async function hookLines(
  input: unknown,
  at: string,
  checkout: string,
): Promise<NucleusActivityLine[]> {
  if (!input || typeof input !== 'object') return [];
  const v = input as Record<string, unknown>;
  const session = text(v.session_id);
  if (!session) return [];
  const of = { at, ...ofSession(session) };
  switch (v.hook_event_name) {
    case 'UserPromptSubmit': {
      const prompt = text(v.prompt);
      return prompt ? [{ ...of, kind: 'prompt', text: prompt }] : [];
    }
    case 'Stop': {
      const report = text(v.last_assistant_message);
      if (!report) return [];
      const path = text(v.transcript_path);
      const turn = path ? await turnTokens(path, at).catch(() => ({})) : {};
      return [{ ...of, kind: 'report', text: report, ...turn }];
    }
    case 'StopFailure': {
      const details = text(v.error_details);
      return [
        {
          ...of,
          kind: 'error',
          error: text(v.error) ?? 'unknown',
          ...(details ? { details } : {}),
        },
      ];
    }
    case 'SessionStart': {
      const model = text(v.model);
      return [
        { ...of, kind: 'start', source: text(v.source) ?? 'startup', ...(model ? { model } : {}) },
      ];
    }
    case 'SessionEnd': {
      const reason = text(v.reason);
      return [{ ...of, kind: 'end', ...(reason ? { reason } : {}) }];
    }
    case 'PreCompact':
    case 'PostCompact': {
      const trigger = text(v.trigger);
      const summary = text(v.compact_summary);
      return [
        {
          ...of,
          kind: 'compact',
          stage: v.hook_event_name === 'PreCompact' ? 'before' : 'after',
          ...(trigger ? { trigger } : {}),
          ...(summary ? { summary: headOf(summary).output ?? summary } : {}),
        },
      ];
    }
    case 'Notification': {
      const type = text(v.notification_type);
      const message = text(v.message);
      return type ? [{ ...of, kind: 'notice', type, ...(message ? { message } : {}) }] : [];
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const entry = activityEntry(input, at, checkout);
      if (!entry) return [];
      const extras =
        v.hook_event_name === 'PostToolUse' ? endExtras(entry.tool, v.tool_response) : {};
      return [{ ...entry, ...ofSession(session), ...extras }];
    }
    case 'PermissionDenied': {
      const tool = text(v.tool_name);
      const id = text(v.tool_use_id);
      if (!tool || !id) return [];
      return [
        {
          at,
          session,
          ...ofSession(session),
          id,
          tool,
          phase: 'end',
          failed: true,
          refused: text(v.reason) ?? 'refused',
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * The background part of the hook (`nucleus-hook.ts`): the lines of any event but PreToolUse,
 * appended to the `--activity` file. Never throws.
 */
export async function recordHook(
  input: unknown,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  at: string,
): Promise<void> {
  const file = activityArg(args);
  if (!file) return;
  try {
    appendActivity(file, await hookLines(input, at, checkoutOf(args, input)), env);
  } catch {
    // Nothing Claude Code should see.
  }
}

/** The whole hook, as `nucleus-hook.ts` runs it: the gate's answer, or the event recorded and ''. */
export async function nucleusHook(
  stdin: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  at: string,
): Promise<string> {
  let input: unknown = null;
  try {
    input = JSON.parse(stdin);
  } catch {
    // Not a tool call Symbiote can read.
  }
  const answer = gateHook(input, args, env, at);
  if (answer !== null) return answer;
  await recordHook(input, args, env, at);
  return '';
}
