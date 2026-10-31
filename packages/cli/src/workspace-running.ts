// What a workspace's agent runs on (V83): its model and effort level, read back from its session —
// Claude Code's newest answer in its transcript, Codex's thread on its app server — rather than
// what Symbiote passed when it started. Only what was read: a field it cannot read is left out,
// never guessed.
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { EFFORT_LEVEL, MODEL_ID, type AgentRunsOn, type ThreadEntry } from '@symbiote/core';
import type { CodexThread } from './app-server.js';
import { fileWindow } from './thread.js';

/**
 * How much of a transcript's end is read when nothing of it was read yet: past a tool's long
 * result after its newest answer (1.36 MB the longest line of the person's 110 transcripts).
 */
export const TRANSCRIPT_FIRST = 2 * 1024 * 1024;

/**
 * How much is read again when it grew (decision 660): at rest its newest answer is within 14 KB
 * of its end (median 8 KB, the V83 spike).
 */
export const TRANSCRIPT_END = 64 * 1024;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** A model's ID, as an agent gives it; Claude Code's `<synthetic>` (a command's reply) is none. */
const modelId = (value: unknown): string | undefined => {
  const id = text(value);
  return id && MODEL_ID.test(id) ? id : undefined;
};

/**
 * What the newest answer of a transcript's main session says it ran on (decision 659): its
 * model (`message.model`, else `requestedModel`), its level (`effort`) and when. A subagent's
 * answer (`isSidechain`) and an answer with neither a model nor a level are passed over; a command
 * typed (`/model`) writes no answer, so it shows from the next one. Null with none.
 */
export function runsOnIn(lines: string): AgentRunsOn | null {
  const all = lines.split('\n');
  for (let i = all.length - 1; i >= 0; i--) {
    const line = all[i] ?? '';
    // Most lines are not answers: parse only those that may be.
    if (!line.includes('"assistant"')) continue;
    let v: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== 'object') continue;
      v = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (v.type !== 'assistant' || v.isSidechain === true) continue;
    const message = (v.message ?? {}) as { model?: unknown };
    const model = modelId(message.model) ?? modelId(v.requestedModel);
    const effort = text(v.effort);
    const level = effort && EFFORT_LEVEL.test(effort) ? effort : undefined;
    if (!model && !level) continue;
    const at = text(v.timestamp);
    return {
      ...(model ? { model } : {}),
      ...(level ? { effort: level } : {}),
      ...(at && !Number.isNaN(Date.parse(at)) ? { at } : {}),
    };
  }
  return null;
}

/**
 * The transcript of a thread's newest session (V83): its newest start or prompt that names one,
 * as Claude Code's hooks gave it. None for a thread written before V83, or for a path that is not
 * an absolute `.jsonl` (a thread is a file in the repository: it names nothing else to read).
 */
export function transcriptOf(entries: readonly ThreadEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || (entry.kind !== 'start' && entry.kind !== 'prompt')) continue;
    const path = entry.transcript;
    if (path && isAbsolute(path) && path.endsWith('.jsonl')) return path;
  }
  return undefined;
}

/** What a transcript said when it was last read, and the file as it was then. */
interface Read {
  size: number;
  mtimeMs: number;
  runsOn: AgentRunsOn | null;
}

/**
 * Reads what transcripts say an agent runs on, for the workspaces list (decision 660), which asks
 * every 5 s: a transcript is read again only when its size or time changed, then its last 64 KB;
 * an end with no answer in it (a tool's long result) keeps what was read before; one never read is
 * read 2 MB from its end. Null for a transcript gone, or with no answer yet.
 */
export function transcriptReader({ window = fileWindow }: { window?: typeof fileWindow } = {}): {
  runsOn(path: string): Promise<AgentRunsOn | null>;
} {
  const reads = new Map<string, Read>();
  return {
    async runsOn(path) {
      const file = await stat(path).catch(() => null);
      if (!file) {
        reads.delete(path);
        return null;
      }
      const before = reads.get(path);
      if (before && before.size === file.size && before.mtimeMs === file.mtimeMs) {
        return before.runsOn;
      }
      const { text: end } = await window(path, before ? TRANSCRIPT_END : TRANSCRIPT_FIRST);
      const runsOn = runsOnIn(end) ?? before?.runsOn ?? null;
      reads.set(path, { size: file.size, mtimeMs: file.mtimeMs, runsOn });
      return runsOn;
    },
  };
}

/**
 * What Codex on its app server runs on (V83): its thread's model and level, "current configured
 * … when loaded, otherwise the latest persisted" (Codex 0.163), as of the thread's last change.
 * A level the thread does not say is left out. Null when it says neither.
 */
export function codexRunsOn(read: CodexThread): AgentRunsOn | null {
  if (!read.model && !read.effort) return null;
  return {
    ...(read.model ? { model: read.model } : {}),
    ...(read.effort ? { effort: read.effort } : {}),
    ...(read.updatedAt > 0 ? { at: new Date(read.updatedAt * 1000).toISOString() } : {}),
  };
}
