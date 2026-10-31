// Hive's running reviewer (HV3, decisions 675–678): one review of a commit the check passed on. A
// throwaway clone of the repository at that commit (its own refs, no remote), the project's
// install, then a clean-context Claude Code (`claude -p`) in it, its commands in Claude Code's
// sandbox, which reports only defects a failing test of its own shows. Symbiote then reruns each
// test on a fresh clone with only its files added, confined by bubblewrap, and keeps a finding only
// when its test fails there and its output names it. Both clones are removed whatever the end.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import {
  git,
  EFFORT_LEVEL,
  MODEL_ID,
  type AgentLevels,
  type EffortChange,
  type HiveFinding,
  type HiveLogStep,
  type HiveReview,
  type MergeAgentEvent,
  type ModelChange,
} from '@symbiote/core';
import {
  AGENT_NAMES,
  effortOnProblem,
  effortWordProblem,
  levelsOn,
  modelProblem,
  modelWordProblem,
} from './agent-levels.js';
import { shellWord, type ClaudeCode } from './claude-code.js';
import { localHost, onPath } from './editor.js';
import { claudeLine } from './merge-agent.js';
import type { MergeLog } from './merge-log.js';
import { CONFIG_FILES } from './plugins.js';
import { HIVE_REVIEW_ANSWER, PromptRefused, readPrompts, writeConfig } from './prompts.js';
import {
  runGroup,
  spawnGroup,
  type GroupRun,
  type ProgramGroupRun,
  type RunGroup,
  type SpawnGroup,
} from './programs.js';

/** The running reviewer's model and level without the project's (the person's answer, HV2's plan). */
export const REVIEWER_MODEL = 'opus';
export const REVIEWER_EFFORT = 'high';

/** `hive.reviewer.model` and `hive.reviewer.effort` in the project's config, where set. */
export function readReviewerConfig(root: string): { model?: string; effort?: string } {
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return {};
  }
  const hive = (value as { hive?: unknown } | null)?.hive;
  const reviewer = (hive && typeof hive === 'object' ? (hive as { reviewer?: unknown }) : {})
    .reviewer;
  const v = (reviewer && typeof reviewer === 'object' ? reviewer : {}) as {
    model?: unknown;
    effort?: unknown;
  };
  return {
    ...(typeof v.model === 'string' && MODEL_ID.test(v.model) ? { model: v.model } : {}),
    ...(typeof v.effort === 'string' && EFFORT_LEVEL.test(v.effort) ? { effort: v.effort } : {}),
  };
}

/** How long the reviewer may work, and each rerun of its tests (decisions 676, 678). */
export const REVIEWER_MS = 30 * 60_000;
export const RERUN_MS = 10 * 60_000;
/** Its spend at most, at list price, by Claude Code's own count (HV1's costliest review: $1.37). */
export const REVIEWER_BUDGET_USD = 5;

/** What one review reads of the reviewer's answer, at most. */
const MAX_FINDINGS = 10;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 200_000;
/** The last lines of a rerun's output kept, and their characters at most. */
const OUTPUT_LINES = 40;
const OUTPUT_CHARS = 4_000;

/** The tools the reviewer has: it reads, writes in its copy and runs commands in the sandbox. */
export const REVIEWER_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob'] as const;

/** The answer's JSON schema (`--json-schema`): Symbiote's, as `HIVE_REVIEW_ANSWER` says it. */
export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    ran: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          defect: { type: 'string' },
          test: { type: 'string' },
          command: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
        required: ['defect', 'test', 'command', 'files'],
      },
    },
  },
  required: ['summary', 'ran', 'findings'],
} as const;

/**
 * The reviewer's settings file (decision 677): Claude Code's sandbox on, required, every command
 * allowed and run in it, none outside (a write outside its copy fails, the network is refused);
 * nothing asked (`dontAsk`), edits only in its copy; no hook of any settings file. Given with `--setting-sources ""`: no user, project or local settings are read,
 * so neither the person's (their MCP servers, hooks, plugins) nor the branch's own reach it.
 */
export function reviewerSettings(): string {
  const settings = {
    disableAllHooks: true,
    permissions: { defaultMode: 'dontAsk', allow: ['Bash', 'Edit(./**)', 'Write(./**)'] },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowLocalBinding: true },
    },
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** `claude -p`'s arguments for the reviewer (decision 676); its prompt goes on stdin. */
export function reviewerArgs(request: {
  settings: string;
  instructions: string;
  model: string;
  effort: string;
}): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--json-schema',
    JSON.stringify(REVIEW_SCHEMA),
    '--model',
    request.model,
    '--effort',
    request.effort,
    '--permission-mode',
    'dontAsk',
    '--tools',
    REVIEWER_TOOLS.join(','),
    '--setting-sources',
    '',
    '--settings',
    request.settings,
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-budget-usd',
    String(REVIEWER_BUDGET_USD),
    '--append-system-prompt',
    `${request.instructions.trimEnd()}\n\n${HIVE_REVIEW_ANSWER}`,
  ];
}

/** Runs a reviewer's test command confined (decision 678): a shell command line. */
export type Confine = (command: string, copy: string) => string;

/**
 * bubblewrap's command line for a rerun: the whole file system read only, the copy writable, a
 * private /tmp, no network but its own loopback; ended with its parent.
 */
export function bubblewrapCommand(bwrap: string, command: string, copy: string): string {
  return [
    bwrap,
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
    '--bind',
    copy,
    copy,
    '--unshare-net',
    '--die-with-parent',
    '--chdir',
    copy,
    '--',
    'sh',
    '-c',
    command,
  ]
    .map((word) => shellWord(word, 'linux'))
    .join(' ');
}

/** bubblewrap on Linux, found on PATH; null elsewhere or without it: no rerun, so no review. */
export async function findConfinement(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Promise<Confine | null> {
  if (platform !== 'linux') return null;
  const bwrap = await onPath(localHost(env), 'bwrap');
  return bwrap ? (command, copy) => bubblewrapCommand(bwrap, command, copy) : null;
}

/** The install commands among the check's (decision 675): its leading package-manager installs. */
export function installCommands(commands: readonly string[]): string[] {
  const installs: string[] = [];
  for (const command of commands) {
    if (!/^\s*(npm|pnpm|yarn|bun)\s+(install|ci|i)(\s|$)/.test(command)) break;
    installs.push(command);
  }
  return installs;
}

/** The reviewer's prompt (decision 676): the brief, the change, the check, the round before. */
export function reviewPrompt(input: {
  brief: string;
  branch: string;
  base: string;
  tip: string;
  diff: string;
  check: { ok: true; ms: number; commands: readonly string[] } | null;
  installs: readonly string[];
  /** The round before's kept findings and the writer's report of its turn after them. */
  before?: { round: number; findings: readonly HiveFinding[]; report?: string };
}): string {
  const short = (sha: string) => sha.slice(0, 7);
  const MAX_DIFF = 80_000;
  const cut = input.diff.length > MAX_DIFF;
  const parts = [
    `The brief this change was written for:\n\n${input.brief.trim()}`,
    `The change on ${input.branch}: git diff ${short(input.base)}..${short(input.tip)}` +
      `${cut ? ` (cut at ${MAX_DIFF.toLocaleString('en')} characters: run \`git diff ${input.base}..${input.tip}\` in your copy for the rest)` : ''}:\n\n` +
      '```diff\n' +
      `${input.diff.slice(0, MAX_DIFF).trimEnd()}\n` +
      '```',
    input.check
      ? `Symbiote's check passed on ${short(input.tip)} in ${Math.round(input.check.ms / 1000)} s: ${input.check.commands.map((c) => `\`${c}\``).join(', ')}.`
      : 'No check is set or found for this project: Symbiote ran none.',
  ];
  if (input.before && input.before.findings.length > 0) {
    const listed = input.before.findings
      .map(
        (f, i) =>
          `${i + 1}. ${f.defect}\n   Test: ${f.test}, run with \`${f.command}\` (${f.files.join(', ')})`,
      )
      .join('\n');
    parts.push(
      `In round ${input.before.round}, a reviewer proved these defects with failing tests, and the writer was asked to add each test and make it pass, or to say in one line why a test is wrong:\n\n${listed}` +
        (input.before.report
          ? `\n\nThe writer's report of its turn since, its own claims to check:\n\n${input.before.report.trim()}`
          : '') +
        '\n\nCheck that each defect is fixed. Report a test the writer left out again only with an answer to its reason.',
    );
  }
  parts.push(
    `You work in a throwaway copy of the repository at ${short(input.tip)}` +
      (input.installs.length > 0
        ? `, its dependencies installed (${input.installs.map((c) => `\`${c}\``).join(', ')}).`
        : '.') +
      " Read the project's own instructions first (CLAUDE.md, AGENTS.md, its README) for how it builds and tests.",
  );
  return `${parts.join('\n\n')}\n`;
}

/** What the reviewer answered (`structured_output`), read; null when it is not that. */
export function parseReviewAnswer(value: unknown): {
  summary: string;
  ran: string;
  findings: { defect: string; test: string; command: string; files: string[] }[];
} | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.findings)) return null;
  const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  return {
    summary: text(v.summary),
    ran: text(v.ran),
    findings: (v.findings as unknown[]).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const f = item as Record<string, unknown>;
      const files = Array.isArray(f.files)
        ? f.files.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
        : [];
      return text(f.defect)
        ? [{ defect: text(f.defect), test: text(f.test), command: text(f.command), files }]
        : [];
    }),
  };
}

/** Why a reviewer's file cannot be taken, or null: repo-relative, inside the copy, a file. */
export function fileProblem(path: string, copy: string): string | null {
  if (isAbsolute(path) || /^[a-zA-Z]:/.test(path)) return `${path} is not repo-relative`;
  if (path.split(/[\\/]/).includes('..')) return `${path} holds ".."`;
  const full = join(copy, path);
  if (!existsSync(full)) return `${path} is not in the copy`;
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    return `${path} cannot be read`;
  }
  const inside = relative(realpathSync(copy), real);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    return `${path} leads outside the copy`;
  }
  return null;
}

const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[ -/]*[@-~]`, 'g');

const lastLines = (text: string) =>
  text
    .replace(ANSI, '')
    .replace(/\n+$/, '')
    .split('\n')
    .slice(-OUTPUT_LINES)
    .join('\n')
    .slice(-OUTPUT_CHARS);

/**
 * Symbiote's word on one rerun (decision 678): kept when the test's command failed by itself (not
 * 126 or 127, which mean it never ran; not stopped at the limit) and its output names the test.
 */
export function rerunVerdict(
  test: string,
  result: { code: number | null; output: string },
): { kept: true } | { kept: false; why: string } {
  if (result.code === 0) return { kept: false, why: "its test passed on Symbiote's rerun" };
  if (result.code === null) {
    return { kept: false, why: `its test did not end within ${RERUN_MS / 60_000} minutes` };
  }
  if (result.code === 126 || result.code === 127) {
    return { kept: false, why: `its command could not run (exit ${result.code})` };
  }
  if (test === '') return { kept: false, why: 'it named no test' };
  if (!result.output.replace(ANSI, '').includes(test)) {
    return { kept: false, why: `its command failed, but its output does not name "${test}"` };
  }
  return { kept: true };
}

/** One review's ask (decisions 675–678). */
export interface ReviewRequest {
  /** The repository its copies are cloned from, and the commit they are at. */
  source: string;
  tip: string;
  round: number;
  /** This branch's copies' folder in Symbiote's cache, removed whole at the end. */
  folder: string;
  /** Where the reviewer's stream is kept (the journal's numbers, a diagnosis). */
  log: string;
  installs: readonly string[];
  prompt: string;
  instructions: string;
  model: string;
  effort: string;
}

/** What a review needs from its surroundings; tests give fakes and shorter limits. */
export interface ReviewDeps {
  /** Claude Code's program; null when there is none. */
  claude: string | null;
  /** How a rerun is confined; null where it cannot be: then nothing is reviewed. */
  confine: Confine | null;
  run?: RunGroup;
  spawn?: SpawnGroup;
  /** Each process group's leader as it starts: the record names it for a new runner to end. */
  onPid?: (pid: number) => void;
  reviewerMs?: number;
  rerunMs?: number;
  /**
   * Its log beside Hive's record (decisions 695, 696): each install command, the reviewer and
   * its stream's events, each rerun, as they come.
   */
  steps?: MergeLog<HiveLogStep>;
}

/**
 * The reviewer's stream's events for its log (decision 696): what the merger's log keeps
 * (`claudeLine`), and the reviewer's words and thinking, which come whole (no partial messages).
 */
export function reviewerEvents(line: string, cwd: string): MergeAgentEvent[] {
  const { events } = claudeLine(line, cwd);
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return events;
  }
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const content = (v.message as { content?: unknown } | undefined)?.content;
  if (v.type !== 'assistant' || !Array.isArray(content)) return events;
  const words: MergeAgentEvent[] = [];
  for (const part of content as Record<string, unknown>[]) {
    if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking) {
      words.push({ think: `${part.thinking.trimEnd()}\n` });
    } else if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      words.push({ say: `${part.text.trimEnd()}\n` });
    }
  }
  return [...words, ...events];
}

/** A review's end: what it found, and the kept findings' files (repo-relative path → text). */
export interface ReviewOutcome {
  review: HiveReview;
  files: Map<string, string>;
}

/** A review running: its end (null when stopped) and a stop. */
export interface ReviewRun {
  done: Promise<ReviewOutcome | null>;
  /** Ends the process running; the copies are removed before `done` resolves. */
  stop(): void;
}

/** A clone of `source` at `tip` (decision 675): detached, no remote, the objects shared. */
async function cloneAt(source: string, tip: string, dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dirname(dir), { recursive: true });
  await git(dirname(dir), ['clone', '--quiet', '--shared', '--no-checkout', source, dir]);
  await git(dir, ['checkout', '--quiet', '--detach', tip]);
  await git(dir, ['remote', 'remove', 'origin']);
}

/** The result line of Claude Code's `stream-json`, the last one in `stdout`. */
function resultOf(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line?.startsWith('{')) continue;
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.type === 'result') return value;
    } catch {
      continue;
    }
  }
  return null;
}

const wordsOf = (text: string) => text.trim().split('\n').slice(-3).join('\n').slice(0, 1_000);

/** Claude Code refused to start without its sandbox (`failIfUnavailable`): its words. */
const SANDBOX_MISSING = /sandbox required but unavailable[^\n]*/;

/** Starts one review (decisions 675–678); `done` resolves with what it found, or null if stopped. */
export function startReview(request: ReviewRequest, deps: ReviewDeps): ReviewRun {
  const run = deps.run ?? runGroup;
  const spawn = deps.spawn ?? spawnGroup;
  const reviewerMs = deps.reviewerMs ?? REVIEWER_MS;
  const rerunMs = deps.rerunMs ?? RERUN_MS;
  const started = Date.now();
  let stopped = false;
  let current: GroupRun | ProgramGroupRun | null = null;
  const base = {
    round: request.round,
    at: request.tip,
    model: request.model,
    effort: request.effort,
  };
  const ended = (
    verdict: HiveReview['verdict'],
    more: Partial<HiveReview> = {},
  ): ReviewOutcome => ({
    review: { ...base, verdict, ms: Date.now() - started, findings: [], ...more },
    files: new Map(),
  });

  async function group<T extends GroupRun | ProgramGroupRun>(
    process: T,
  ): Promise<Awaited<T['done']> | null> {
    current = process;
    if (process.pid !== undefined) deps.onPid?.(process.pid);
    const result = (await process.done) as Awaited<T['done']>;
    current = null;
    return stopped ? null : result;
  }

  /** The install commands in `copy`: why they failed, if they did; null when stopped. */
  /** A command in a copy, as a step of the log. */
  const logged = (
    step: HiveLogStep,
    title: string,
    command: string,
    cwd: string,
    timeoutMs?: number,
  ) => {
    deps.steps?.step(step, title);
    return run(command, cwd, {
      ...(timeoutMs ? { timeoutMs } : {}),
      onOutput: (chunk) => deps.steps?.out(chunk),
    });
  };

  async function install(copy: string): Promise<{ failed: string | null } | null> {
    for (const command of request.installs) {
      const result = await group(logged('install', command, command, copy));
      if (!result) return null;
      deps.steps?.end(result.code === 0);
      if (result.code !== 0) {
        return { failed: `\`${command}\` failed: ${wordsOf(result.output)}` };
      }
    }
    return { failed: null };
  }

  async function review(): Promise<ReviewOutcome | null> {
    if (!deps.claude) return ended('unavailable', { error: 'Claude Code is not installed' });
    if (!deps.confine) {
      return ended('unavailable', {
        error:
          "Symbiote reruns the reviewer's tests confined by bubblewrap, which it finds on Linux only: install bubblewrap (bwrap)",
      });
    }
    const copy = join(request.folder, 'review');
    await cloneAt(request.source, request.tip, copy);
    if (stopped) return null;
    const installed = await install(copy);
    if (!installed) return null;
    if (installed.failed) {
      return ended('failed', { error: `the install failed in the copy: ${installed.failed}` });
    }
    const settings = join(request.folder, 'reviewer-settings.json');
    await writeFile(settings, reviewerSettings());
    deps.steps?.step('review', 'The reviewer');
    const answer = await group(
      spawn(
        deps.claude,
        reviewerArgs({
          settings,
          instructions: request.instructions,
          model: request.model,
          effort: request.effort,
        }),
        {
          cwd: copy,
          input: request.prompt,
          timeoutMs: reviewerMs,
          ...(deps.steps
            ? {
                onLine: (line: string) => {
                  for (const event of reviewerEvents(line, copy)) deps.steps?.agent(event);
                },
              }
            : {}),
        },
      ),
    );
    if (!answer) return null;
    const answered = resultOf(answer.stdout);
    deps.steps?.end(answer.code === 0 && answered !== null && answered.is_error !== true);
    await mkdir(dirname(request.log), { recursive: true });
    await writeFile(request.log, answer.stdout).catch(() => undefined);
    const missing = SANDBOX_MISSING.exec(`${answer.stderr}\n${answer.stdout}`);
    if (missing) {
      return ended('unavailable', {
        error: `Claude Code's sandbox is not available: ${missing[0].replace(/^sandbox required but unavailable:\s*/, '')}`,
      });
    }
    const result = answered;
    const cost = typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : undefined;
    const said = parseReviewAnswer(result?.structured_output);
    if (!result || result.is_error === true || !said) {
      const why =
        (typeof result?.result === 'string' && result.result) ||
        (typeof result?.subtype === 'string' && result.subtype !== 'success' && result.subtype) ||
        wordsOf(answer.stderr) ||
        (answer.code === null
          ? `it did not end within ${reviewerMs / 60_000} minutes`
          : `Claude Code exited with code ${answer.code}`);
      return ended('failed', {
        error: `the reviewer gave no answer: ${String(why).slice(0, 1_000)}`,
        ...(cost !== undefined ? { cost } : {}),
      });
    }
    const told = {
      ...(said.summary ? { summary: said.summary } : {}),
      ...(said.ran ? { ran: said.ran } : {}),
      ...(cost !== undefined ? { cost } : {}),
    };
    if (said.findings.length === 0) return ended('approved', told);

    // Its files read from its copy; a finding without them, or past the limits, is dropped.
    const findings: HiveFinding[] = [];
    const files = new Map<string, string>();
    for (const [i, f] of said.findings.entries()) {
      const finding: HiveFinding = { ...f, kept: false };
      findings.push(finding);
      if (i >= MAX_FINDINGS) {
        finding.why = `past the first ${MAX_FINDINGS} findings`;
        continue;
      }
      if (f.files.length === 0 || f.files.length > MAX_FILES) {
        finding.why =
          f.files.length === 0 ? 'it gave no test file' : `more than ${MAX_FILES} files`;
        continue;
      }
      if (f.command === '') {
        finding.why = 'it gave no command';
        continue;
      }
      const problem = f.files.map((p) => fileProblem(p, copy)).find((p) => p !== null);
      if (problem) {
        finding.why = problem;
        continue;
      }
      const sizes = await Promise.all(f.files.map((p) => stat(join(copy, p))));
      if (sizes.some((s) => !s.isFile() || s.size > MAX_FILE_BYTES)) {
        finding.why = `a file is not one, or is over ${MAX_FILE_BYTES / 1000} KB`;
        continue;
      }
      for (const p of f.files) files.set(p, await readFile(join(copy, p), 'utf8'));
      finding.why = 'not rerun';
    }
    await rm(copy, { recursive: true, force: true });
    const toRerun = findings.filter((f) => f.why === 'not rerun');
    if (toRerun.length > 0) {
      // A fresh copy of the commit, with only the findings' files added (decision 678).
      const again = join(request.folder, 'rerun');
      await cloneAt(request.source, request.tip, again);
      if (stopped) return null;
      const reinstalled = await install(again);
      if (!reinstalled) return null;
      if (reinstalled.failed) {
        return ended('failed', {
          ...told,
          error: `the install failed in the rerun's copy: ${reinstalled.failed}`,
        });
      }
      for (const [path, text] of files) {
        await mkdir(dirname(join(again, path)), { recursive: true });
        await writeFile(join(again, path), text);
      }
      for (const finding of toRerun) {
        const result = await group(
          logged(
            'rerun',
            finding.test || finding.command,
            deps.confine(finding.command, again),
            again,
            rerunMs,
          ),
        );
        if (!result) return null;
        deps.steps?.end(result.code === 0);
        const verdict = rerunVerdict(finding.test, result);
        finding.code = result.code;
        finding.output = lastLines(result.output);
        finding.kept = verdict.kept;
        if (verdict.kept) delete finding.why;
        else finding.why = verdict.why;
      }
    }
    const keptFiles = new Map(
      [...files].filter(([path]) => findings.some((f) => f.kept && f.files.includes(path))),
    );
    const kept = findings.some((f) => f.kept);
    return {
      review: {
        ...base,
        verdict: kept ? 'changes' : 'approved',
        ms: Date.now() - started,
        ...told,
        findings,
      },
      files: keptFiles,
    };
  }

  const done = review()
    .catch((error: unknown): ReviewOutcome | null =>
      stopped ? null : ended('failed', { error: (error as Error).message }),
    )
    .then(async (outcome) => {
      await rm(request.folder, { recursive: true, force: true }).catch(() => undefined);
      return stopped ? null : outcome;
    });
  return {
    done,
    stop() {
      stopped = true;
      current?.kill();
    },
  };
}

/** A file's text as a fenced block, its fence longer than any run of backticks in it. */
function fenced(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}\n${text.replace(/\n+$/, '')}\n${fence}`;
}

/**
 * `{findings}` of `hive.review` (decision 679): each kept finding's defect, test, command, files
 * and the rerun's last lines, within `budget` characters. Over it, the files' text goes first (the
 * largest first: it is kept in `folder`), then the outputs' lines, then the end.
 */
export function findingsText(
  findings: readonly HiveFinding[],
  files: ReadonlyMap<string, string>,
  folder: string,
  budget: number,
): string {
  const kept = findings.filter((f) => f.kept);
  const shownFiles = new Set(files.keys());
  let outputLines = OUTPUT_LINES;
  const render = () =>
    kept
      .map((f, i) => {
        const parts = [`${i + 1}. ${f.defect}`, `Test: ${f.test}, run with \`${f.command}\``];
        for (const path of f.files) {
          const text = files.get(path);
          const where = `${folder}/${path}`;
          parts.push(
            text !== undefined && shownFiles.has(path)
              ? `${path} (kept in ${where}):\n${fenced(text)}`
              : `${path}: its text is in ${where}`,
          );
        }
        if (f.output) {
          const lines = f.output.split('\n').slice(-outputLines).join('\n');
          parts.push(`Symbiote's rerun, its last lines:\n${fenced(lines)}`);
        }
        return parts.join('\n');
      })
      .join('\n\n');
  let text = render();
  const bySize = [...shownFiles].sort(
    (a, b) => (files.get(b)?.length ?? 0) - (files.get(a)?.length ?? 0),
  );
  for (const path of bySize) {
    if (text.length <= budget) break;
    shownFiles.delete(path);
    text = render();
  }
  if (text.length > budget) {
    outputLines = 8;
    text = render();
  }
  return text.length > budget ? `${text.slice(0, Math.max(0, budget - 2))}\n…` : text;
}

/** The Reviewer's settings in Settings (decision 680): its levels and models, and setting them. */
export interface ReviewerSettings {
  /** Claude Code's levels on the reviewer's model, its models, Symbiote's default. */
  efforts(): Promise<AgentLevels>;
  /** Sets `hive.reviewer.effort`, one of Claude Code's levels on its model; null removes it. */
  setEffort(change: EffortChange): Promise<AgentLevels>;
  /** Sets `hive.reviewer.model`, one of Claude Code's models; null removes it. */
  setModel(change: ModelChange): Promise<AgentLevels>;
}

/** The Reviewer's settings of the project at `root`, on Claude Code as `claude` finds it. */
export function reviewerSettingsService(
  root: string,
  claude: () => Promise<ClaudeCode | null>,
): ReviewerSettings {
  const levels = async (agent: ClaudeCode) => {
    const list = await agent.efforts().catch(() => null);
    return list ? { levels: list } : null;
  };
  async function efforts(): Promise<AgentLevels> {
    const config = readReviewerConfig(root);
    const about = {
      ...(config.effort ? { effort: config.effort } : {}),
      ...(config.model ? { model: config.model } : {}),
      file: readPrompts(root).file,
    };
    const agent = await claude();
    if (!agent) return { agents: [], ...about };
    const [fallback, models] = await Promise.all([levels(agent), agent.models().catch(() => null)]);
    const on = levelsOn(models, config.model ?? REVIEWER_MODEL, fallback);
    return {
      agents: [
        {
          kind: 'claude',
          ...(on ? { efforts: { ...on, default: REVIEWER_EFFORT, by: 'symbiote' as const } } : {}),
          ...(models ? { models } : {}),
          ...(models ? { defaultModel: { id: REVIEWER_MODEL, by: 'symbiote' as const } } : {}),
        },
      ],
      ...about,
    };
  }
  return {
    efforts,
    async setEffort({ effort }) {
      if (effort !== null) {
        if (typeof effort !== 'string' || !EFFORT_LEVEL.test(effort)) {
          throw new PromptRefused(effortWordProblem(effort), 400);
        }
        const agent = await claude();
        if (!agent)
          throw new PromptRefused('the reviewer needs Claude Code: it is not installed', 409);
        const model = readReviewerConfig(root).model ?? REVIEWER_MODEL;
        const models = await agent.models().catch(() => null);
        const problem = effortOnProblem(
          effort,
          AGENT_NAMES.claude,
          models,
          model,
          await levels(agent),
        );
        if (problem) throw new PromptRefused(problem, 400);
      }
      await writeConfig(root, ['hive', 'reviewer', 'effort'], effort ?? undefined);
      return efforts();
    },
    async setModel({ model }) {
      if (model !== null) {
        if (typeof model !== 'string' || !MODEL_ID.test(model)) {
          throw new PromptRefused(modelWordProblem(model), 400);
        }
        const agent = await claude();
        if (!agent)
          throw new PromptRefused('the reviewer needs Claude Code: it is not installed', 409);
        const problem = modelProblem(
          model,
          AGENT_NAMES.claude,
          await agent.models().catch(() => null),
        );
        if (problem) throw new PromptRefused(problem, 400);
      }
      await writeConfig(root, ['hive', 'reviewer', 'model'], model ?? undefined);
      return efforts();
    },
  };
}
