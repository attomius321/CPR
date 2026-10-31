// A merge's log (V46a, decisions 313 and 318): what each step of a queued merge did and wrote, a
// JSON line at a time, in a file of its own beside the queue. Written by the process that merges,
// read by any `symbiote view` that shows the merge, so it is appended as it happens.
import { appendFileSync, mkdirSync } from 'node:fs';
import { open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogLine, LogRead, MergeAgentEvent, MergeStep } from '@symbiote/core';

/** A step's output written as it comes; past it, only its end, written when the step ends. */
export const STEP_START = 512 * 1024;
export const STEP_END = 512 * 1024;

/** What a merge writes in its log; Hive's runs write theirs the same way (decision 695). */
export interface MergeLog<S extends string = MergeStep> {
  /** A step starts: what is written until `end` is its. */
  step(step: S, title: string): void;
  out(text: string): void;
  agent(event: MergeAgentEvent): void;
  /** The step ends: how it went, and how long it took since `step`. None open: nothing. */
  end(ok: boolean): void;
  /** The entry runs again, and why. */
  run(why: string): void;
}

/** The merges' logs in `dir`, one `<id>.jsonl` each; Hive's runs' in theirs. */
export interface MergeLogs<S extends string = MergeStep> {
  of(id: string): MergeLog<S>;
  /** The lines from byte `from` on; a line still being written waits for the next read. */
  read(id: string, from: number): Promise<LogRead<S>>;
  remove(id: string): Promise<void>;
  /** Removes every log but those of `keep`. */
  prune(keep: ReadonlySet<string>): Promise<void>;
}

/** `640 KB`, `1.5 MB`. */
const size = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024)).toLocaleString('en-US')} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function mergeLogs<S extends string = MergeStep>(dir: string): MergeLogs<S> {
  const fileOf = (id: string) => join(dir, `${id}.jsonl`);
  /** Each log's step in this process: when it started, and how much of its output was written. */
  const steps = new Map<string, { started: number; written: number; tail: string; left: number }>();

  function write(id: string, line: LogLine<S>): void {
    mkdirSync(dir, { recursive: true });
    appendFileSync(fileOf(id), `${JSON.stringify(line)}\n`);
  }

  return {
    of(id) {
      const add = (line: Omit<LogLine<S>, 'at'>) =>
        write(id, { at: Date.now(), ...line } as LogLine<S>);
      return {
        step(step, title) {
          steps.set(id, { started: Date.now(), written: 0, tail: '', left: 0 });
          add({ step, title });
        },
        out(text) {
          if (text === '') return;
          const current = steps.get(id);
          if (!current) return add({ out: text });
          const room = Math.max(0, STEP_START - current.written);
          if (room > 0) add({ out: text.slice(0, room) });
          current.written += Math.min(room, text.length);
          if (text.length <= room) return;
          // Past the start: only the end is kept, and how much was left out.
          const tail = current.tail + text.slice(room);
          current.left += Math.max(0, tail.length - STEP_END);
          current.tail = tail.slice(-STEP_END);
        },
        agent(event) {
          add({ agent: event });
        },
        end(ok) {
          const current = steps.get(id);
          // Only a step this process started: another's, or none, has nothing to end.
          if (!current) return;
          steps.delete(id);
          if (current.left > 0) add({ out: `\n… ${size(current.left)} of output not kept …\n` });
          if (current.tail !== '') add({ out: current.tail });
          add({ end: { ok, ms: Date.now() - current.started } });
        },
        run(why) {
          add({ run: why });
        },
      };
    },

    async read(id, from) {
      let file;
      try {
        file = await open(fileOf(id), 'r');
      } catch {
        return { lines: [], next: from };
      }
      try {
        const { size: length } = await file.stat();
        if (length <= from) return { lines: [], next: from };
        const buffer = Buffer.alloc(length - from);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, from);
        // Up to the last line's end: a newline is never part of a character's bytes.
        const end = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
        if (end < 0) return { lines: [], next: from };
        const lines: LogLine<S>[] = [];
        for (const text of buffer.subarray(0, end).toString('utf8').split('\n')) {
          try {
            lines.push(JSON.parse(text) as LogLine<S>);
          } catch {
            // A line no Symbiote wrote whole: left out.
          }
        }
        return { lines, next: from + end + 1 };
      } finally {
        await file.close();
      }
    },

    async remove(id) {
      steps.delete(id);
      await rm(fileOf(id), { force: true });
    },

    async prune(keep) {
      const names = await readdir(dir).catch(() => [] as string[]);
      await Promise.all(
        names
          .filter((name) => name.endsWith('.jsonl') && !keep.has(name.slice(0, -'.jsonl'.length)))
          .map((name) => rm(join(dir, name), { force: true })),
      );
    },
  };
}
