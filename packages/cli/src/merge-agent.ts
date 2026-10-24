// The merger agent (V26c, decisions 150–152): a fresh Claude Code or Codex run, given only the
// conflict, that answers each region's text. It writes no file: Symbiote writes its answer between
// the markers, commits the merge, and the person reviews each region before it lands.
import { spawn } from 'node:child_process';
import { isAbsolute, relative } from 'node:path';
import type { AgentKind, MergeAgentEvent } from '@symbiote/core';
import { DEFAULT_PROMPTS, MERGER_ANSWER } from './prompts.js';

/** A conflict region, its lines 0-based in the file: `<<<<<<<` at `start`, `>>>>>>>` at `end`. */
export interface ConflictRegion {
  start: number;
  end: number;
  ours: string[];
  /** The ancestor's lines (git's diff3 style); null when git did not write them. */
  base: string[] | null;
  theirs: string[];
}

/** A file's lines, without the empty one after a final newline. */
const linesOf = (text: string) => {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

/** The conflict regions git left in a file; a region without its closing marker is not one. */
export function conflictRegions(text: string): ConflictRegion[] {
  const lines = linesOf(text);
  const regions: ConflictRegion[] = [];
  let open: { start: number; ours: string[]; base: string[] | null; theirs: string[] } | null =
    null;
  let part: 'ours' | 'base' | 'theirs' = 'ours';
  lines.forEach((line, i) => {
    if (line.startsWith('<<<<<<< ') || line === '<<<<<<<') {
      open = { start: i, ours: [], base: null, theirs: [] };
      part = 'ours';
    } else if (!open) {
      return;
    } else if (part === 'ours' && (line.startsWith('||||||| ') || line === '|||||||')) {
      open.base = [];
      part = 'base';
    } else if (part !== 'theirs' && line === '=======') {
      part = 'theirs';
    } else if (part === 'theirs' && (line.startsWith('>>>>>>> ') || line === '>>>>>>>')) {
      regions.push({
        start: open.start,
        end: i,
        ours: open.ours,
        base: open.base,
        theirs: open.theirs,
      });
      open = null;
    } else if (part === 'base') {
      open.base?.push(line);
    } else {
      open[part].push(line);
    }
  });
  return regions;
}

/** A file with each region replaced by its answer (lines; an empty answer is none). */
export function applyAnswer(text: string, regions: ConflictRegion[], answers: string[]): string {
  const lines = linesOf(text);
  const out: string[] = [];
  let at = 0;
  regions.forEach((region, i) => {
    out.push(...lines.slice(at, region.start));
    const answer = answers[i] ?? '';
    if (answer !== '') out.push(...linesOf(answer));
    at = region.end + 1;
  });
  out.push(...lines.slice(at));
  return out.length === 0 ? '' : `${out.join('\n')}${text.endsWith('\n') ? '\n' : ''}`;
}

const MARKER = /^(<<<<<<<|\|\|\|\|\|\|\||=======|>>>>>>>)( |$)/m;

/** What the agent answered: a text per region (and a note each), "needs you", or why neither. */
export type MergerAnswer =
  { texts: string[]; notes: string[] } | { needsYou: string } | { error: string };

/** The agent's last message, read: one JSON object, alone or in a fence. */
export function parseAnswer(message: string, count: number): MergerAnswer {
  const from = message.indexOf('{');
  const to = message.lastIndexOf('}');
  let value: unknown;
  try {
    value = JSON.parse(message.slice(from, to + 1));
  } catch {
    const said = message.trim().split('\n')[0] ?? '';
    return { error: `the answer is not JSON: ${said.slice(0, 200)}` };
  }
  const v = (value && typeof value === 'object' ? value : {}) as {
    regions?: unknown;
    notes?: unknown;
    needsYou?: unknown;
  };
  if (typeof v.needsYou === 'string' && v.needsYou.trim() !== '') return { needsYou: v.needsYou };
  const regions = (v.regions && typeof v.regions === 'object' ? v.regions : {}) as Record<
    string,
    unknown
  >;
  const notes = (v.notes && typeof v.notes === 'object' ? v.notes : {}) as Record<string, unknown>;
  const texts: string[] = [];
  for (let n = 1; n <= count; n++) {
    const text = regions[String(n)];
    if (typeof text !== 'string') return { error: `the answer has no text for region ${n}` };
    if (MARKER.test(text)) return { error: `the answer for region ${n} has conflict markers` };
    texts.push(text);
  }
  return {
    texts,
    notes: texts.map((_, i) => {
      const note = notes[String(i + 1)];
      return typeof note === 'string' ? note : '';
    }),
  };
}

/**
 * The merger's system prompt (decision 150), the same for Claude Code (`--system-prompt`) and
 * Codex (before its prompt): the project's instructions or Symbiote's (V28), then Symbiote's answer
 * format, which a project cannot change (decision 169). Symbiote's are at most 1K tokens: read on
 * every run.
 */
export const mergerInstructions = (instructions: string) =>
  `${instructions.trimEnd()}\n\n${MERGER_ANSWER}`;

/** Symbiote's system prompt for the merger, until a project has its own (`prompts.merger`). */
export const MERGER_INSTRUCTIONS = mergerInstructions(DEFAULT_PROMPTS.merger);

/** What the prompt is made of: the merge, its two sides' titles, the conflicting files. */
export interface MergerInput {
  branch: string;
  into: string;
  /** The approved commit, and the target's tip it is merged on. */
  head: string;
  base: string;
  /** Each side's title, a line or two. */
  sides: { into: string; branch: string };
  /** Each conflicting file's text, with git's markers. */
  files: { path: string; text: string }[];
  /** Symbols both sides changed in those files (Symbiote's analysis), when known. */
  symbols?: { path: string; name: string; kind: string; into: string; branch: string }[];
  /** `symbiote/merge.md`, the project's own rules. */
  rules?: string;
  /** The person's words on an earlier answer, and that answer. */
  again?: { comments: string; previous: string[] };
}

/** Lines shown around a region. */
const AROUND = 3;

/** The prompt: the merge, the sides, the symbols, each region with 3 lines around; nothing more. */
export function mergerPrompt(input: MergerInput): string {
  const { branch, into } = input;
  const out = [
    `Merge ${branch} (${input.head.slice(0, 7)}) into ${into} (${input.base.slice(0, 7)}).`,
    '',
    `${into} (ours): ${input.sides.into}`,
    `${branch} (theirs): ${input.sides.branch}`,
    '',
  ];
  if (input.rules?.trim()) {
    out.push("The project's merge rules (symbiote/merge.md):", '', input.rules.trimEnd(), '');
  }
  if (input.symbols && input.symbols.length > 0) {
    out.push('Changed on both sides in the conflicting files:');
    for (const s of input.symbols) {
      out.push(`- ${s.path}: ${s.name} (${s.kind}): ${into} ${s.into}, ${branch} ${s.branch}`);
    }
    out.push('');
  }
  let n = 0;
  for (const file of input.files) {
    const lines = linesOf(file.text);
    out.push(`## ${file.path}`, '');
    for (const region of conflictRegions(file.text)) {
      n++;
      out.push(`Region ${n} (lines ${region.start + 1}–${region.end + 1}):`, '```');
      out.push(...lines.slice(Math.max(0, region.start - AROUND), region.start));
      out.push(`<<<<<<< ${into}`, ...region.ours);
      if (region.base) out.push('||||||| ancestor', ...region.base);
      out.push('=======', ...region.theirs, `>>>>>>> ${branch}`);
      out.push(...lines.slice(region.end + 1, region.end + 1 + AROUND), '```', '');
    }
  }
  if (input.again) {
    const regions = Object.fromEntries(
      input.again.previous.map((text, i) => [String(i + 1), text]),
    );
    out.push(
      `Your earlier answer was reviewed: ${input.again.comments.trim()}`,
      'It was:',
      '```json',
      JSON.stringify({ regions }),
      '```',
      '',
    );
  }
  out.push(n === 1 ? 'Answer for region 1.' : `Answer for regions 1–${n}.`, '');
  return out.join('\n');
}

/** A run's answer: its last message and what it used, or why it gave none. */
export type MergerRun =
  | { ok: true; text: string; usage?: { input: number; output: number }; ms: number }
  | { ok: false; error: string };

/** A merger agent: one run in `cwd`, waited for. */
export interface MergerAgent {
  kind: AgentKind;
  /**
   * `instructions`: its system prompt, `MERGER_INSTRUCTIONS` unless the project has its own.
   * `onEvent`: what it does as it works (V46b): its thinking, tools, text.
   */
  run(request: {
    cwd: string;
    prompt: string;
    model?: string;
    instructions?: string;
    /** Its effort level (`merge.effort`, V46d), one it lists. */
    effort?: string;
    onEvent?: (event: MergeAgentEvent) => void;
  }): Promise<MergerRun>;
}

/**
 * Runs a program with `input` on its stdin, without a shell; resolves when it exits. `onLine`:
 * each line of its stdout as it comes (V46b).
 */
export type RunWithInput = (
  command: string,
  args: string[],
  options: { cwd: string; input: string; timeoutMs: number; onLine?: (line: string) => void },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const runWithInput: RunWithInput = (command, args, { cwd, input, timeoutMs, onLine }) =>
  new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let line = '';
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      if (!onLine) return;
      const lines = (line + chunk).split('\n');
      line = lines.pop() ?? '';
      for (const each of lines) onLine(each);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (line !== '') onLine?.(line);
      done({ code, stdout, stderr });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });

/** A run may think for a while on many regions. */
const RUN_TIMEOUT_MS = 15 * 60_000;

const lastWords = (text: string) => text.trim().split('\n').slice(-3).join('\n');

/** A path as the log shows it: from the merge worktree, when it is in it. */
function shownPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;
  const inside = relative(cwd, path);
  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) ? inside : path;
}

/** A tool call's main input, in a few words: the file read, the pattern looked for. */
function toolInput(input: Record<string, unknown>, cwd: string): string {
  const text = (key: string) => (typeof input[key] === 'string' ? input[key] : undefined);
  const path = text('file_path') ?? text('path');
  const pattern = text('pattern');
  const where = path ? shownPath(path, cwd) : undefined;
  if (pattern) return where ? `${pattern} in ${where}` : pattern;
  if (where) {
    const from = typeof input.offset === 'number' ? input.offset : undefined;
    const lines = typeof input.limit === 'number' ? input.limit : undefined;
    return from !== undefined || lines !== undefined
      ? `${where} (from line ${from ?? 1}${lines !== undefined ? `, ${lines} lines` : ''})`
      : where;
  }
  return JSON.stringify(input).slice(0, 200);
}

/** What a tool gave back, by its size: `214 lines`; a refusal by its first line. */
function resultSize(content: unknown, failed: boolean): string {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              part &&
              typeof part === 'object' &&
              typeof (part as { text?: unknown }).text === 'string'
                ? (part as { text: string }).text
                : '',
            )
            .join('\n')
        : '';
  if (failed) return `refused: ${text.trim().split('\n')[0]?.slice(0, 200) ?? ''}`;
  const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
  return `${lines} line${lines === 1 ? '' : 's'}`;
}

/**
 * One line of Claude Code's `stream-json` (V46b): the events the log keeps — its start, its
 * thinking summary and text as they stream, its tool calls and their results by size — and, for
 * its last line, the run's result. Hook, rate-limit and message events are not kept.
 */
export function claudeLine(
  line: string,
  cwd: string,
): { events: MergeAgentEvent[]; result?: Record<string, unknown> } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { events: [] };
  }
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (v.type === 'result') return { events: [], result: v };
  if (v.type === 'system' && v.subtype === 'init') {
    const version = typeof v.claude_code_version === 'string' ? ` ${v.claude_code_version}` : '';
    const model = typeof v.model === 'string' ? ` · ${v.model}` : '';
    return { events: [{ start: `Claude Code${version}${model}` }] };
  }
  if (v.type === 'stream_event') {
    const delta = (v.event as { type?: unknown; delta?: Record<string, unknown> } | undefined)
      ?.delta;
    if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
      return { events: [{ think: delta.thinking }] };
    }
    if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
      return { events: [{ say: delta.text }] };
    }
    return { events: [] };
  }
  const content = (v.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return { events: [] };
  const events: MergeAgentEvent[] = [];
  for (const part of content as Record<string, unknown>[]) {
    if (v.type === 'assistant' && part.type === 'tool_use' && typeof part.name === 'string') {
      const input = (part.input && typeof part.input === 'object' ? part.input : {}) as Record<
        string,
        unknown
      >;
      events.push({ tool: part.name, input: toolInput(input, cwd) });
    } else if (v.type === 'user' && part.type === 'tool_result') {
      events.push({ result: resultSize(part.content, part.is_error === true) });
    }
  }
  return { events };
}

/** One line of Codex's `exec --json` (V46b): its reasoning, its commands and their exit, its message. */
export function codexLine(line: string, model?: string): MergeAgentEvent[] {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [];
  }
  const v = (value && typeof value === 'object' ? value : {}) as {
    type?: unknown;
    item?: Record<string, unknown>;
  };
  if (v.type === 'thread.started') return [{ start: model ? `Codex · ${model}` : 'Codex' }];
  const item = v.item;
  if (!item) return [];
  const text = typeof item.text === 'string' ? item.text : '';
  if (item.type === 'command_execution' && typeof item.command === 'string') {
    if (v.type === 'item.started') return [{ tool: '$', input: item.command }];
    if (v.type !== 'item.completed') return [];
    const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
    const code = typeof item.exit_code === 'number' ? `exit ${item.exit_code} · ` : '';
    return [{ result: `${code}${resultSize(output, false)}` }];
  }
  if (v.type !== 'item.completed' || text === '') return [];
  if (item.type === 'reasoning') return [{ think: text.endsWith('\n') ? text : `${text}\n` }];
  if (item.type === 'agent_message') return [{ say: text }];
  return [];
}

/** Claude Code refused `--thinking-display`: an older one, or one that dropped it. */
const NO_THINKING_DISPLAY = /unknown option '--thinking-display'/;

/**
 * Claude Code as the merger: `claude -p`, its system prompt the merger's instructions, read-only
 * tools, no MCP servers, nothing kept; the prompt on stdin (a long one would not fit an argument).
 * Its `stream-json` is read as it comes (V46b): its thinking's summary (`--thinking-display
 * summarized`, a flag its `--help` does not list: run again without it when refused), its tool
 * calls and its text go to `onEvent`; the answer is its last line, the `result` that `--output-format
 * json` gave alone.
 */
export function claudeMerger(
  command: string,
  { run = runWithInput }: { run?: RunWithInput } = {},
): MergerAgent {
  return {
    kind: 'claude',
    async run({ cwd, prompt, model, instructions = MERGER_INSTRUCTIONS, effort, onEvent }) {
      const argsOf = (thinking: boolean) => [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        ...(thinking ? ['--thinking-display', 'summarized'] : []),
        '--tools',
        'Read,Grep,Glob',
        '--strict-mcp-config',
        '--no-session-persistence',
        ...(model ? ['--model', model] : []),
        ...(effort ? ['--effort', effort] : []),
        '--system-prompt',
        instructions,
      ];
      const started = Date.now();
      let value: Record<string, unknown> | undefined;
      const once = (thinking: boolean) =>
        run(command, argsOf(thinking), {
          cwd,
          input: prompt,
          timeoutMs: RUN_TIMEOUT_MS,
          onLine: (line) => {
            const read = claudeLine(line, cwd);
            if (read.result) value = read.result;
            for (const event of read.events) onEvent?.(event);
          },
        });
      let result = await once(true);
      if (!value && result.code !== 0 && NO_THINKING_DISPLAY.test(result.stderr)) {
        onEvent?.({
          note: 'This Claude Code has no --thinking-display: its thinking is not shown',
        });
        result = await once(false);
      }
      const ms = Date.now() - started;
      if (!value) {
        return {
          ok: false,
          error:
            lastWords(result.stderr) || lastWords(result.stdout) || 'Claude Code gave no answer',
        };
      }
      const v = value as {
        result?: unknown;
        is_error?: unknown;
        usage?: Record<string, unknown>;
      };
      const text = typeof v.result === 'string' ? v.result : '';
      if (v.is_error === true || result.code !== 0) {
        return { ok: false, error: text || lastWords(result.stderr) || 'Claude Code failed' };
      }
      const n = (key: string) => (typeof v.usage?.[key] === 'number' ? v.usage[key] : 0);
      return {
        ok: true,
        text,
        ...(v.usage
          ? {
              usage: {
                input:
                  n('input_tokens') +
                  n('cache_creation_input_tokens') +
                  n('cache_read_input_tokens'),
                output: n('output_tokens'),
              },
            }
          : {}),
        ms,
      };
    },
  };
}

/**
 * Codex as the merger: `codex exec` in its read-only sandbox, nothing kept, the merger's
 * instructions before the prompt (Codex has no system prompt to set), both on stdin; its last
 * message.
 */
export function codexMerger(
  command: string,
  { run = runWithInput }: { run?: RunWithInput } = {},
): MergerAgent {
  return {
    kind: 'codex',
    async run({ cwd, prompt, model, instructions = MERGER_INSTRUCTIONS, effort, onEvent }) {
      const args = [
        'exec',
        '--json',
        '--sandbox',
        'read-only',
        '--ephemeral',
        ...(effort ? ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : []),
        ...(model ? ['--model', model] : []),
        '--cd',
        cwd,
        '-',
      ];
      const started = Date.now();
      const input = `${instructions}\n\n---\n\n${prompt}`;
      const result = await run(command, args, {
        cwd,
        input,
        timeoutMs: RUN_TIMEOUT_MS,
        onLine: (line) => {
          for (const event of codexLine(line, model)) onEvent?.(event);
        },
      });
      const ms = Date.now() - started;
      let text: string | null = null;
      let failure: string | null = null;
      let usage: { input: number; output: number } | undefined;
      for (const line of result.stdout.split('\n')) {
        let event: {
          type?: string;
          item?: { type?: string; text?: unknown };
          usage?: Record<string, unknown>;
          error?: { message?: unknown };
          message?: unknown;
        };
        try {
          event = JSON.parse(line) as typeof event;
        } catch {
          continue;
        }
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          if (typeof event.item.text === 'string') text = event.item.text;
        } else if (event.type === 'turn.completed' && event.usage) {
          const n = (key: string) =>
            typeof event.usage?.[key] === 'number' ? event.usage[key] : 0;
          usage = { input: n('input_tokens'), output: n('output_tokens') };
        } else if (event.type === 'turn.failed' && typeof event.error?.message === 'string') {
          failure = event.error.message;
        } else if (event.type === 'error' && typeof event.message === 'string') {
          failure = event.message;
        }
      }
      if (text === null) {
        return {
          ok: false,
          error: failure ?? (lastWords(result.stderr) || 'Codex gave no answer'),
        };
      }
      return { ok: true, text, ...(usage ? { usage } : {}), ms };
    },
  };
}
