// The merger agent (V26c, decisions 150–152): a fresh Claude Code or Codex run, given only the
// conflict, that answers each region's text. It writes no file: CPR writes its answer between
// the markers, commits the merge, and the person reviews each region before it lands.
import { spawn } from 'node:child_process';
import type { AgentKind } from '@cpr/core';
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
 * Codex (before its prompt): the project's instructions or CPR's (V28), then CPR's answer format,
 * which a project cannot change (decision 169). CPR's are at most 1K tokens: read on every run.
 */
export const mergerInstructions = (instructions: string) =>
  `${instructions.trimEnd()}\n\n${MERGER_ANSWER}`;

/** CPR's system prompt for the merger, until a project has its own (`prompts.merger`). */
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
  /** Symbols both sides changed in those files (CPR's analysis), when known. */
  symbols?: { path: string; name: string; kind: string; into: string; branch: string }[];
  /** `cpr/merge.md`, the project's own rules. */
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
    out.push("The project's merge rules (cpr/merge.md):", '', input.rules.trimEnd(), '');
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
  /** `instructions`: its system prompt, `MERGER_INSTRUCTIONS` unless the project has its own. */
  run(request: {
    cwd: string;
    prompt: string;
    model?: string;
    instructions?: string;
  }): Promise<MergerRun>;
}

/** Runs a program with `input` on its stdin, without a shell; resolves when it exits. */
export type RunWithInput = (
  command: string,
  args: string[],
  options: { cwd: string; input: string; timeoutMs: number },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const runWithInput: RunWithInput = (command, args, { cwd, input, timeoutMs }) =>
  new Promise((done) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });

/** A run may think for a while on many regions. */
const RUN_TIMEOUT_MS = 15 * 60_000;

const lastWords = (text: string) => text.trim().split('\n').slice(-3).join('\n');

/**
 * Claude Code as the merger: `claude -p`, its system prompt the merger's instructions, read-only tools,
 * no MCP servers, nothing kept; the prompt on stdin (a long one would not fit an argument).
 */
export function claudeMerger(
  command: string,
  { run = runWithInput }: { run?: RunWithInput } = {},
): MergerAgent {
  return {
    kind: 'claude',
    async run({ cwd, prompt, model, instructions = MERGER_INSTRUCTIONS }) {
      const args = [
        '-p',
        '--output-format',
        'json',
        '--tools',
        'Read,Grep,Glob',
        '--strict-mcp-config',
        '--no-session-persistence',
        ...(model ? ['--model', model] : []),
        '--system-prompt',
        instructions,
      ];
      const started = Date.now();
      const result = await run(command, args, { cwd, input: prompt, timeoutMs: RUN_TIMEOUT_MS });
      const ms = Date.now() - started;
      let value: unknown;
      try {
        value = JSON.parse(result.stdout);
      } catch {
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
 * Codex as the merger: `codex exec` in its read-only sandbox, nothing kept, the merger's instructions
 * before the prompt (Codex has no system prompt to set), both on stdin; its last message.
 */
export function codexMerger(
  command: string,
  { run = runWithInput }: { run?: RunWithInput } = {},
): MergerAgent {
  return {
    kind: 'codex',
    async run({ cwd, prompt, model, instructions = MERGER_INSTRUCTIONS }) {
      const args = [
        'exec',
        '--json',
        '--sandbox',
        'read-only',
        '--ephemeral',
        ...(model ? ['--model', model] : []),
        '--cd',
        cwd,
        '-',
      ];
      const started = Date.now();
      const input = `${instructions}\n\n---\n\n${prompt}`;
      const result = await run(command, args, { cwd, input, timeoutMs: RUN_TIMEOUT_MS });
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
