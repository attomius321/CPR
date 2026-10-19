import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addWorktree,
  branchNameProblem,
  checkMerge,
  commitsBetween,
  defaultBranch,
  deleteMergedBranch,
  isAncestor,
  isCommit,
  listRefs,
  PERMISSION_MODES,
  removeWorktree,
  uncommittedFiles,
  userEmail,
  WorktreeRefused,
  WORK_KINDS,
  type AgentKind,
  type BranchMerge,
  type BriefPart,
  type BriefParts,
  type CheckGuess,
  type AgentStateName,
  type FeatureAgentState,
  type FeatureList,
  type FeatureOptions,
  type FeatureReplied,
  type FeatureReply,
  type FeatureRequest,
  type FeatureStart,
  type FeatureSummary,
  type FeatureTerminalRequest,
  type FeatureThread,
  type GitRepo,
  type PermissionMode,
  type RefList,
  type WorkKind,
  type WorkKindSpec,
} from '@cpr/core';
import { guessCheck, treeAt } from './check.js';
import { localHost, onPath } from './editor.js';
import { TerminalRefused, type Terminals } from './terminal.js';
import { CONFIG_FILES } from './plugins.js';
import {
  prepareCprFolder,
  readReview,
  reviewPath,
  reviewPlace,
  sortKeys,
  verdictText,
  type ReviewPlace,
} from './reviews.js';
import { lastAction, readThread, readThreadEnd, turnEnded } from './thread.js';

/** A feature on disk: `cpr/features/<branch>.json` (V18), one per branch. */
export interface FeatureFile {
  /** The agent started for it; null when none was found. */
  agent: FeatureAgentRecord | null;
  /** The commit the branch started at (full SHA). */
  base: string;
  branch: string;
  brief: string;
  /** Who started it (`user.email`). */
  by?: string;
  created: string;
  /** The branch `base` was the tip of; absent when a row was picked. */
  from?: string;
  /** When it was cleaned up (V18c): no longer listed. */
  finished?: string;
  /** What it is for, its name, and the parts `brief` was made of (V24); absent before V24. */
  kind?: WorkKind;
  parts?: BriefParts;
  planFirst: boolean;
  title?: string;
  /** The feature's worktree folder. */
  worktree: string;
}

export interface FeatureAgentRecord {
  kind: AgentKind;
  permissionMode: PermissionMode;
  /** When it last started. */
  started?: string;
  /** Why the last start failed, in the agent's words. */
  error?: string;
  /** Started with CPR's hooks (V18c): its thread is recorded. */
  hooks?: boolean;
}

/** Every feature file's first key: where an agent that opens it finds its instructions. */
export const FEATURE_ABOUT =
  'A feature started in CPR. Agents: read cpr/AGENTS.md before acting on it.';

/** Longest brief: it goes on the agent's command line (Windows takes 32,767 characters). */
export const MAX_BRIEF = 20_000;

/** Longest title: a workspace's name in lists and the start of its branch's (V24). */
export const MAX_TITLE = 200;

/** Each part's heading in the brief, in the brief's order (V24). */
const HEADINGS: Record<BriefPart, string> = {
  goal: 'Goal',
  happens: 'What happens',
  restructure: 'What to restructure',
  change: 'What to change',
  question: 'Question',
  reproduce: 'How to reproduce',
  known: 'What is known',
  where: 'Where to look',
  outOfScope: 'Out of scope',
  notes: 'Notes',
  doneWhen: 'Done when',
};
const ORDER = Object.keys(HEADINGS) as BriefPart[];

/**
 * The kinds of work (V24, decision 122): the one part each needs, its others, Done when's text
 * until the person changes it, and the one line the agent's prompt adds after the brief.
 */
const KINDS: Record<
  WorkKind,
  { name: string; required: BriefPart; optional: BriefPart[]; doneWhen?: string; line?: string }
> = {
  feature: { name: 'Feature', required: 'goal', optional: ['where', 'outOfScope', 'notes'] },
  fix: {
    name: 'Fix',
    required: 'happens',
    optional: ['reproduce', 'where', 'notes'],
    doneWhen: 'A test that fails today passes, and {checks pass}.',
    line:
      'Reproduce it first, with a failing test where the project has tests, then fix the cause, ' +
      'not the symptom.',
  },
  refactor: {
    name: 'Refactor',
    required: 'restructure',
    optional: ['where', 'outOfScope', 'notes'],
    doneWhen:
      'Behaviour is unchanged: existing tests pass without changing what they assert, and ' +
      '{checks pass}.',
    line:
      'Change structure, not behaviour: do not change what existing tests assert; if behaviour ' +
      'must change, stop and say so.',
  },
  chore: {
    name: 'Chore',
    required: 'change',
    optional: ['where', 'outOfScope', 'notes'],
    doneWhen: 'Nothing else changes, and {checks pass}.',
    line: 'Keep to what is asked; if it needs a change in behaviour, stop and say so.',
  },
  spike: {
    name: 'Spike',
    required: 'question',
    optional: ['known', 'where', 'notes'],
    doneWhen: 'A written answer: what was tried, what was measured, and a recommendation.',
    line:
      'The answer is what is asked for, not a change to merge: put it in your final report; ' +
      "keep experiments out of the project's code unless the brief says otherwise.",
  },
};

/** A kind's parts in the brief's order, Done when last. */
const partsOf = (kind: WorkKind): BriefPart[] => {
  const { required, optional } = KINDS[kind];
  return ORDER.filter(
    (part) => part === required || part === 'doneWhen' || optional.includes(part),
  );
};

/** The kinds as the start dialog offers them. */
export function workKinds(): WorkKindSpec[] {
  return WORK_KINDS.map((kind) => {
    const { name, required, doneWhen } = KINDS[kind];
    return {
      kind,
      name,
      parts: partsOf(kind).map((part) => ({
        part,
        heading: HEADINGS[part],
        ...(part === required ? { required: true as const } : {}),
      })),
      ...(doneWhen ? { doneWhen } : {}),
    };
  });
}

/** A part's text as written, without the blank lines and spaces around it. */
const written = (text: string | undefined) => (text ?? '').replace(/^\s*\n/, '').trimEnd();

/**
 * The brief CPR gives the agent (V24, decisions 123–124): `# <Kind>: <title>`, then each part
 * with text under its heading in the brief's order, Done when last; the person's text as written.
 */
export function briefOf(kind: WorkKind, title: string, parts: BriefParts): string {
  const sections = [`# ${KINDS[kind].name}: ${title.trim()}`];
  for (const part of partsOf(kind)) {
    const text = written(parts[part]);
    if (text.trim() !== '') sections.push(`## ${HEADINGS[part]}\n${text}`);
  }
  return `${sections.join('\n\n')}\n`;
}

const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** A request the server answers with `status` and the message. */
export class FeatureRefused extends Error {
  override name = 'FeatureRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502,
  ) {
    super(message);
  }
}

/** A feature's file: the branch's slashes as folders. */
export function featurePath(dir: string, branch: string): string {
  const parts = branch.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new FeatureRefused(`not a branch name: ${branch}`, 400);
  }
  const last = parts.pop() as string;
  return join(dir, ...parts, `${last}.json`);
}

/** Sorted keys, two-space indent, a final newline; `about` first. */
export function serializeFeature(feature: FeatureFile): string {
  return `${JSON.stringify(sortKeys({ ...feature, about: FEATURE_ABOUT }), null, 2)}\n`;
}

/** A feature file, or null when it is missing or not one. */
export async function readFeature(path: string): Promise<FeatureFile | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<Record<keyof FeatureFile, unknown>>;
  const text = (x: unknown) => (typeof x === 'string' ? x : '');
  if (!text(v.branch) || !text(v.base) || !text(v.worktree)) return null;
  return {
    agent: asAgent(v.agent),
    base: text(v.base),
    branch: text(v.branch),
    brief: text(v.brief),
    ...(text(v.by) ? { by: text(v.by) } : {}),
    created: text(v.created),
    ...(text(v.from) ? { from: text(v.from) } : {}),
    ...(text(v.finished) ? { finished: text(v.finished) } : {}),
    ...kindOf(v.kind),
    ...partsRead(v.parts),
    planFirst: v.planFirst === true,
    ...(text(v.title) ? { title: text(v.title) } : {}),
    worktree: text(v.worktree),
  };
}

function kindOf(value: unknown): { kind?: WorkKind } {
  const kind = WORK_KINDS.find((k) => k === value);
  return kind ? { kind } : {};
}

/** The parts CPR knows, each with text. */
function partsRead(value: unknown): { parts?: BriefParts } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const parts: BriefParts = {};
  for (const part of ORDER) {
    const text = v[part];
    if (typeof text === 'string' && text.trim() !== '') parts[part] = text;
  }
  return Object.keys(parts).length > 0 ? { parts } : {};
}

function asAgent(value: unknown): FeatureAgentRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<Record<keyof FeatureAgentRecord, unknown>>;
  if (v.kind !== 'claude') return null;
  const mode = PERMISSION_MODES.find((m) => m === v.permissionMode) ?? 'default';
  return {
    kind: v.kind,
    permissionMode: mode,
    ...(typeof v.started === 'string' ? { started: v.started } : {}),
    ...(typeof v.error === 'string' ? { error: v.error } : {}),
    ...(v.hooks === true ? { hooks: true } : {}),
  };
}

/**
 * Where a feature's worktree goes: beside the checkout, `../<checkout>.worktrees/<branch>`, the
 * branch's slashes as dashes; `pattern` (`features.worktrees` in `cpr/config.json`, relative to
 * the checkout, `{repo}` for its folder name) moves the folder that holds them.
 */
export function worktreeFolder(main: string, branch: string, pattern?: string): string {
  const name = basename(main);
  const holder = pattern
    ? resolve(main, pattern.replaceAll('{repo}', name))
    : join(dirname(main), `${name}.worktrees`);
  return join(holder, branch.replaceAll('/', '-'));
}

/**
 * Where a feature starts by default: the default branch's newest tip — of the local branch and
 * the remotes', the one that holds the others; the local one when they diverged.
 */
export async function featureBase(
  repo: GitRepo,
  refs: RefList,
): Promise<{ from: string; sha: string } | null> {
  const name = await defaultBranch(repo, refs);
  if (!name) return null;
  const local = refs.branches.find((b) => b.name === name)?.sha;
  const remotes = refs.remotes
    .filter((r) => r.branch === name)
    .sort((a, b) => Number(b.remote === 'origin') - Number(a.remote === 'origin'))
    .map((r) => r.sha);
  const tips = [...new Set([...(local ? [local] : []), ...remotes])];
  for (const tip of tips) {
    let holdsAll = true;
    for (const other of tips) {
      if (other !== tip && !(await isAncestor(repo, other, tip))) holdsAll = false;
    }
    if (holdsAll) return { from: name, sha: tip };
  }
  const sha = local ?? tips[0];
  return sha ? { from: name, sha } : null;
}

/**
 * What the agent is told: the brief, its kind's line (V24), its branch and worktree, where its
 * record and reviews are. A record from before V24 is a feature.
 */
export function featurePrompt(
  feature: FeatureFile,
  where: { record: string; reviews: string; agents: string; into: string | null },
): string {
  const kind = feature.kind ?? 'feature';
  const start = feature.from
    ? `${feature.from} at ${feature.base.slice(0, 7)}`
    : `the commit ${feature.base.slice(0, 7)}`;
  const { line } = KINDS[kind];
  return [
    `You are starting a new ${kind} in this repository, on the branch ${feature.branch}, ` +
      `started from ${start}. This folder is a git worktree of its own with that branch ` +
      'checked out: work only here.',
    '',
    "The person's brief:",
    '',
    feature.brief.trim(),
    '',
    ...(line ? [line, ''] : []),
    feature.planFirst
      ? 'First write a plan: what you will change and how you will check it, then stop and ' +
        "wait for the person's OK before changing anything."
      : "Plan it, build it and check it as the project's own instructions say.",
    '',
    kind === 'spike'
      ? 'Commit nothing unless the brief asks for it. When you have the answer, say it: the ' +
        'person reads your report in CPR.'
      : `Commit your work on ${feature.branch} as you go. Push only if the project's instructions ` +
        'say so. When it is ready, say so: the person reviews the branch in CPR' +
        (where.into ? `, and an approved commit is merged into ${where.into}.` : '.'),
    '',
    `This ${kind}'s record: ${where.record}. Reviews of the branch will be in ${where.reviews}; ` +
      `${where.agents} says how to act on one. Never edit anything in ${dirname(where.agents)}.`,
    '',
  ].join('\n');
}

/** A Claude Code session, as `claude agents --json --all` lists it. */
export interface AgentSession {
  cwd: string;
  /** `background` or `interactive`. */
  kind: string;
  startedAt: number;
  /** Background sessions: `working`, `blocked`, `done`, `failed` or `stopped`. */
  state?: string;
  /** While its process lives: `busy`, `waiting` or `idle`. */
  status?: string;
  waitingFor?: string;
  /** The short ID `claude attach` takes. */
  id?: string;
  name?: string;
  sessionId?: string;
}

/** Claude Code's sessions from `claude agents --json`; anything not one is left out. */
export function parseSessions(text: string): AgentSession[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const sessions: AgentSession[] = [];
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    if (typeof v.cwd !== 'string' || typeof v.kind !== 'string') continue;
    const text = (key: string) => {
      const value = v[key];
      return typeof value === 'string' ? { [key]: value } : {};
    };
    sessions.push({
      cwd: v.cwd,
      kind: v.kind,
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : 0,
      ...text('state'),
      ...text('status'),
      ...text('waitingFor'),
      ...text('id'),
      ...text('name'),
      ...text('sessionId'),
    });
  }
  return sessions;
}

/** Whose account Claude Code runs on, from `claude auth status`; undefined when unknown. */
export function parseAccount(text: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown };
  if (v.loggedIn === false) return 'not logged in';
  if (v.authMethod === 'claude.ai') {
    const plan = typeof v.subscriptionType === 'string' ? v.subscriptionType : '';
    return plan
      ? `your ${plan.charAt(0).toUpperCase()}${plan.slice(1)} subscription`
      : 'your Claude subscription';
  }
  if (v.authMethod === 'api_key' || v.authMethod === 'api_key_helper') return 'an API key';
  if (v.authMethod === 'oauth_token') return 'a long-lived token';
  if (v.authMethod === 'third_party') return 'a cloud provider';
  return undefined;
}

/** The newest session in a feature's worktree, matched by real path. */
export function newestSession(
  feature: FeatureFile,
  sessions: AgentSession[] | null,
  real: (path: string) => string,
): AgentSession | undefined {
  const folder = real(feature.worktree);
  return (sessions ?? [])
    .filter((s) => real(s.cwd) === folder)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

/** Claude Code's word for a session waiting on the person, or for one whose turn ended there. */
const isBlocked = (session: AgentSession) =>
  ['blocked', 'waiting'].includes(session.state ?? session.status ?? '');

/**
 * What the page says of a feature's agent: the newest session working in its worktree (matched
 * by real path), else why there is none. `ahead` (commits since the base) tells a finished plan
 * from finished work. `ended`: the thread says its last turn ended (V18c) — Claude Code reads a
 * finished plan as `blocked` with nothing named it waits for, so that is a finished turn. A
 * turn interrupted with Esc fires no hook and reads `idle` with `working` until the next one ends.
 */
export function agentState(
  feature: FeatureFile,
  sessions: AgentSession[] | null,
  ahead: number,
  real: (path: string) => string,
  ended = false,
): FeatureAgentState {
  const { agent } = feature;
  if (!agent) return { state: 'no-agent' };
  const kind = agent.kind;
  const session = newestSession(feature, sessions, real);
  if (!session) {
    if (agent.error) return { state: 'not-started', kind, error: agent.error };
    if (sessions === null) {
      return { state: 'unknown', kind, error: 'Claude Code could not list its sessions' };
    }
    return { state: 'not-running', kind };
  }
  const id = session.id ? { id: session.id } : {};
  const finished = (): AgentStateName =>
    ahead > 0 ? 'ready' : feature.planFirst ? 'plan-ready' : 'done';
  const waiting = session.waitingFor ? { waitingFor: session.waitingFor } : {};
  switch (session.state ?? session.status) {
    case 'working':
      if (session.status !== 'idle') return { state: 'working', kind, ...id };
      if (ended) return { state: finished(), kind, ...id };
      return { state: 'needs-you', kind, ...id, ...waiting, interrupted: true };
    case 'busy':
      return { state: 'working', kind, ...id };
    case 'blocked':
    case 'waiting':
      if (ended && !session.waitingFor) return { state: finished(), kind, ...id };
      return { state: 'needs-you', kind, ...id, ...waiting };
    case 'failed':
      return { state: 'failed', kind, ...id };
    case 'stopped':
      return { state: 'stopped', kind, ...id };
    default:
      return { state: finished(), kind, ...id };
  }
}

/** A program's run: its exit code (null when it could not start) and what it wrote. */
export type Run = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/**
 * Runs a program without a shell; resolves when it exits (not when its output closes: a
 * background service it starts may keep that open), with what it wrote by then.
 */
export const runProgram: Run = (command, args, { cwd, timeoutMs }) =>
  new Promise((done) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: error.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      // Let the last chunks already written arrive.
      setImmediate(() => done({ code, stdout, stderr }));
    });
  });

/** What CPR asks of Claude Code (V18); tests pass a fake. */
export interface ClaudeCode {
  /** The program, as found. */
  command: string;
  /** Starts a background session in `cwd` (`claude --bg`); its words when it does not start. */
  start(request: {
    cwd: string;
    name: string;
    prompt: string;
    permissionMode: PermissionMode;
    addDir: string;
    /** CPR's settings file (V18c): the hooks that record the thread. */
    settings?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Its sessions, finished ones included; null when it cannot list them. */
  sessions(): Promise<AgentSession[] | null>;
  /** Stops a background session (`claude stop <id>`); its words when it cannot. */
  stop(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Continues a session that is not running with `text` (`claude --bg --resume <session>
   * "<text>"`), with no other flag: any flag, or a running session, makes a copy without the
   * hooks (V18c spike).
   */
  resume(request: {
    sessionId: string;
    cwd: string;
    text: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Removes a background session (`claude rm <id>`); a worktree CPR made stays. */
  remove(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Whose account it runs on. */
  account(): Promise<string | undefined>;
}

/**
 * Claude Code at `command`. Sessions are asked for at most every 2 s (`claude agents --json`
 * takes 150 ms), the account every minute.
 */
export function claudeCode(
  command: string,
  { run = runProgram, cwd, model }: { run?: Run; cwd: string; model?: string },
): ClaudeCode {
  let sessions: { at: number; list: Promise<AgentSession[] | null> } | null = null;
  let account: { at: number; text: Promise<string | undefined> } | null = null;
  return {
    command,
    async start(request) {
      const args = [
        '--bg',
        '--name',
        request.name,
        '--add-dir',
        request.addDir,
        ...(request.settings ? ['--settings', request.settings] : []),
        ...(request.permissionMode === 'default'
          ? []
          : ['--permission-mode', request.permissionMode]),
        ...(model ? ['--model', model] : []),
        request.prompt,
      ];
      const result = await run(command, args, { cwd: request.cwd, timeoutMs: 60_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      return {
        ok: false,
        error: wordsOf(result) || `${basename(command)} exited with code ${result.code ?? 'none'}`,
      };
    },
    async stop(id) {
      const result = await run(command, ['stop', id], { cwd, timeoutMs: 20_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      return { ok: false, error: wordsOf(result) || `could not stop ${id}` };
    },
    async resume(request) {
      const args = ['--bg', '--resume', request.sessionId, request.text];
      const result = await run(command, args, { cwd: request.cwd, timeoutMs: 60_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      return { ok: false, error: wordsOf(result) || `could not continue ${request.sessionId}` };
    },
    async remove(id) {
      const result = await run(command, ['rm', id], { cwd, timeoutMs: 20_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      return { ok: false, error: wordsOf(result) || `could not remove ${id}` };
    },
    sessions() {
      if (!sessions || Date.now() - sessions.at > 2_000) {
        const list = run(command, ['agents', '--json', '--all'], { cwd, timeoutMs: 20_000 }).then(
          (result) => (result.code === 0 ? parseSessions(result.stdout) : null),
        );
        sessions = { at: Date.now(), list };
      }
      return sessions.list;
    },
    account() {
      if (!account || Date.now() - account.at > 60_000) {
        const text = run(command, ['auth', 'status'], { cwd, timeoutMs: 20_000 }).then((result) =>
          parseAccount(result.stdout),
        );
        account = { at: Date.now(), text };
      }
      return account.text;
    },
  };
}

/** The last lines a program wrote, its error output first. */
function wordsOf(result: { stdout: string; stderr: string }): string {
  return (result.stderr.trim() || result.stdout.trim()).split('\n').slice(-3).join('\n');
}

/** Claude Code's program: `CPR_CLAUDE` (a path or a command on PATH), else `claude` on PATH. */
export async function findClaude(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const host = localHost(env);
  const custom = env.CPR_CLAUDE?.trim();
  if (custom) {
    if (/[\\/]/.test(custom)) return (await host.isFile(custom)) ? custom : null;
    return onPath(host, custom);
  }
  return onPath(host, 'claude');
}

/** What `cpr/config.json` says of features and their agent; anything unknown is ignored. */
export interface FeatureConfig {
  branchPrefixes: Record<WorkKind, string>;
  worktrees?: string;
  permissionMode: PermissionMode;
  model?: string;
}

/**
 * `features.branchPrefixes` sets a kind's prefix (V24), each kind its own by default (`fix/`);
 * `features.branchPrefix`, from before V24, sets the Feature's unless `branchPrefixes` does.
 */
export function readFeatureConfig(root: string): FeatureConfig {
  const branchPrefixes = Object.fromEntries(WORK_KINDS.map((k) => [k, `${k}/`])) as Record<
    WorkKind,
    string
  >;
  const config: FeatureConfig = { branchPrefixes, permissionMode: 'default' };
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return config;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return config;
  }
  const v = (value && typeof value === 'object' ? value : {}) as {
    features?: { branchPrefix?: unknown; branchPrefixes?: unknown; worktrees?: unknown };
    agent?: unknown;
  };
  if (typeof v.features?.branchPrefix === 'string') {
    branchPrefixes.feature = v.features.branchPrefix;
  }
  const prefixes = v.features?.branchPrefixes;
  if (prefixes && typeof prefixes === 'object') {
    for (const kind of WORK_KINDS) {
      const prefix = (prefixes as Record<string, unknown>)[kind];
      if (typeof prefix === 'string') branchPrefixes[kind] = prefix;
    }
  }
  if (typeof v.features?.worktrees === 'string' && v.features.worktrees !== '') {
    config.worktrees = v.features.worktrees;
  }
  const agent = (v.agent && typeof v.agent === 'object' ? v.agent : {}) as {
    permissionMode?: unknown;
    model?: unknown;
  };
  const mode = PERMISSION_MODES.find((m) => m === agent.permissionMode);
  if (mode) config.permissionMode = mode;
  if (typeof agent.model === 'string' && agent.model !== '') config.model = agent.model;
  return config;
}

/**
 * A start request's brief, checked: made from its kind, title and parts (V24), empty parts left
 * out; or, from a request made before V24, its brief as given.
 */
function workOf(request: FeatureRequest): Pick<FeatureFile, 'brief' | 'kind' | 'title' | 'parts'> {
  const { kind, title, parts } = request;
  if (kind === undefined && title === undefined && parts === undefined) {
    const brief = request.brief ?? '';
    if (brief.trim() === '') {
      throw new FeatureRefused('a workspace needs a brief: what to build', 400);
    }
    if (brief.length > MAX_BRIEF) {
      throw new FeatureRefused('a brief is at most 20,000 characters', 400);
    }
    return { brief };
  }
  if (request.brief !== undefined) {
    throw new FeatureRefused('a workspace takes a brief or a kind of work, not both', 400);
  }
  if (!WORK_KINDS.includes(kind as WorkKind)) {
    throw new FeatureRefused(`unknown kind: ${String(kind)}`, 400);
  }
  const of = kind as WorkKind;
  const name = (title ?? '').trim();
  if (name === '') throw new FeatureRefused('a workspace needs a title', 400);
  if (/[\r\n]/.test(name)) throw new FeatureRefused('a title is one line', 400);
  if (name.length > MAX_TITLE) {
    throw new FeatureRefused(`a title is at most ${MAX_TITLE} characters`, 400);
  }
  const own = partsOf(of);
  const kept: BriefParts = {};
  for (const [part, text] of Object.entries(parts ?? {})) {
    if (!own.includes(part as BriefPart)) {
      const heading = Object.hasOwn(HEADINGS, part) ? HEADINGS[part as BriefPart] : part;
      throw new FeatureRefused(`a ${of} has no "${heading}"`, 400);
    }
    if (typeof text === 'string' && text.trim() !== '') kept[part as BriefPart] = text;
  }
  const required = KINDS[of].required;
  if (!kept[required]) {
    throw new FeatureRefused(`a ${of} needs "${HEADINGS[required]}"`, 400);
  }
  const brief = briefOf(of, name, kept);
  if (brief.length > MAX_BRIEF) {
    throw new FeatureRefused('a brief is at most 20,000 characters, its parts together', 400);
  }
  return { brief, kind: of, title: name, parts: kept };
}

/** What the server needs of features. */
export interface Features {
  options(): Promise<FeatureOptions>;
  list(): Promise<FeatureList>;
  /** Makes the branch, its worktree and record, then starts the agent. Rejects with `FeatureRefused`. */
  start(request: FeatureRequest): Promise<FeatureStart>;
  /** Starts a feature's agent again (after a failed start, or once it ended). */
  startAgent(branch: string): Promise<FeatureStart>;
  /** The prompt its agent was given, to copy. */
  prompt(branch: string): Promise<string>;
  /**
   * The check command guessed from the root files of the commit a workspace would start from
   * (V24b), for the start dialog's Done when; null when none is found.
   */
  check(at: string): Promise<CheckGuess | null>;
  /** Stops its agent while it works or waits. */
  stopAgent(branch: string): Promise<FeatureStart>;
  /** Opens its worktree's folder in the editor (V12's VS Code). */
  openWorktree(branch: string): Promise<void>;
  /** Whether its branch merges cleanly into the default branch (V17's check), once per pair. */
  merge(branch: string): Promise<BranchMerge>;
  /** Its thread (V18c): what its agent was given and reported, and its review's last verdict. */
  thread(branch: string): Promise<FeatureThread>;
  /** Sends a message to its agent: continues its session with the text (V18c). */
  reply(request: FeatureReply): Promise<FeatureReplied>;
  /**
   * Opens its agent's newest session in a terminal (V21): `claude attach <id>` in its worktree;
   * the terminal's ID. A stopped session continues, with no turn.
   */
  terminal(request: FeatureTerminalRequest): Promise<{ id: string }>;
  /**
   * Cleans it up (V18c): its agent's sessions, its worktree and, once merged, its branch; the
   * record stays, `finished`. Unmerged only when asked (`unmerged`); never with work not
   * committed.
   */
  clean(request: { branch: string; unmerged?: boolean }): Promise<{ finished: string }>;
}

/** The hooks CPR passes to every feature's agent (V18c): each event, recorded by `agent-hook.js`. */
const HOOKED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'PreToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
] as const;

/** A path as one word of a hook's command line (Claude Code runs it in a shell). */
function shellWord(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `"${path}"` : `'${path.replaceAll("'", "'\\''")}'`;
}

/**
 * CPR's settings file for its agents (V18c), `<cpr>/claude-settings.json`: every event runs
 * `agent-hook.js` with the `cpr/` folder; `PreToolUse` only for questions. It decides nothing.
 */
export function agentSettings(
  where: { node: string; hook: string; cpr: string },
  platform: NodeJS.Platform = process.platform,
): string {
  const command = [where.node, where.hook, where.cpr].map((p) => shellWord(p, platform)).join(' ');
  const hooks = Object.fromEntries(
    HOOKED_EVENTS.map((event) => [
      event,
      [
        {
          ...(event === 'PreToolUse' ? { matcher: 'AskUserQuestion' } : {}),
          hooks: [{ type: 'command', command, timeout: 30 }],
        },
      ],
    ]),
  );
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Opens a folder in the editor; why not when it cannot. */
export type OpenFolder = (
  folder: string,
) => Promise<{ opened: true } | { opened: false; message: string }>;

/** Features of `repo`, kept beside its reviews (`cpr/features/`, else CPR's cache). */
export function features(
  repo: GitRepo,
  cacheDir: string,
  {
    claude,
    now = () => new Date(),
    env = process.env,
    root = repo.root,
    openFolder,
    hook = fileURLToPath(new URL('./agent-hook.js', import.meta.url)),
    node = process.execPath,
    terminals,
  }: {
    /** Finds the agent (once a start or a list needs it); null when none is installed. */
    claude: () => Promise<ClaudeCode | null>;
    now?: () => Date;
    env?: Readonly<Record<string, string | undefined>>;
    /** Where `cpr/config.json` is read. */
    root?: string;
    openFolder?: OpenFolder;
    /** CPR's hook (`dist/agent-hook.js`) and the Node that runs it. */
    hook?: string;
    node?: string;
    /** Terminals on agents' sessions (V21); without them, none. */
    terminals?: Terminals;
  },
): Features {
  const place = () => reviewPlace(repo, cacheDir);
  const config = () => readFeatureConfig(root);
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  /** The folder holding `cpr/` (or its stand-in in the cache): the agent may read it. */
  const cprFolder = (where: ReviewPlace) => dirname(where.dir);
  const featuresDir = (where: ReviewPlace) => join(cprFolder(where), 'features');
  /** `features.worktrees` is relative to the checkout that holds `cpr/`. */
  const mainRoot = (where: ReviewPlace) =>
    where.place === 'repository' ? dirname(cprFolder(where)) : repo.root;

  /**
   * CPR's settings file, written when its text differs (CPR moved) or it is gone: a session that
   * wakes reads it again, and does not start without it (V18c spike). Its path.
   */
  async function settingsFile(where: ReviewPlace): Promise<string> {
    const path = join(cprFolder(where), 'claude-settings.json');
    const text = agentSettings({ node, hook, cpr: cprFolder(where) });
    if ((await readFile(path, 'utf8').catch(() => null)) !== text) {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, text);
      await rename(temp, path);
    }
    return path;
  }

  async function save(where: ReviewPlace, feature: FeatureFile): Promise<void> {
    const path = featurePath(featuresDir(where), feature.branch);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, serializeFeature(feature));
    await rename(temp, path);
  }

  async function records(where: ReviewPlace): Promise<FeatureFile[]> {
    const dir = featuresDir(where);
    const files = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
    const list: FeatureFile[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const feature = await readFeature(join(dir, file));
      // The file must be the branch's: a copied or renamed file is not that feature.
      if (feature && relative(dir, featurePath(dir, feature.branch)) === file) {
        list.push(feature);
      }
    }
    return list.sort(
      (a, b) => a.created.localeCompare(b.created) || a.branch.localeCompare(b.branch),
    );
  }

  async function summary(
    where: ReviewPlace,
    feature: FeatureFile,
    refs: RefList,
    trunk: string[],
    sessions: AgentSession[] | null,
  ): Promise<FeatureSummary> {
    const tip = refs.branches.find((b) => b.name === feature.branch)?.sha ?? null;
    let ahead = 0;
    let merged = false;
    if (tip && (await isCommit(repo, feature.base))) {
      ahead = (await commitsBetween(repo, feature.base, tip, 1)).count;
      for (const end of trunk) {
        if (ahead > 0 && !merged) merged = await isAncestor(repo, tip, end);
      }
    }
    const exists = existsSync(feature.worktree);
    const changed = exists ? await uncommittedFiles(feature.worktree).catch(() => null) : null;
    const thread = feature.agent ? await readThreadEnd(cprFolder(where), feature.branch) : [];
    // Blocked with nothing named: its thread tells a finished turn from a question (V18c).
    const session = newestSession(feature, sessions, real);
    const ended = session && isBlocked(session) && !session.waitingFor ? turnEnded(thread) : false;
    const acted = feature.agent ? (lastAction(thread) ?? feature.agent.started) : undefined;
    return {
      branch: feature.branch,
      ...(feature.kind ? { kind: feature.kind } : {}),
      ...(feature.title ? { title: feature.title } : {}),
      base: feature.base,
      ...(feature.from ? { from: feature.from } : {}),
      created: feature.created,
      planFirst: feature.planFirst,
      brief: feature.brief,
      worktree: { path: feature.worktree, exists, ...(changed === null ? {} : { changed }) },
      tip,
      ahead,
      merged,
      agent: agentState(feature, sessions, ahead, real, ended),
      ...(acted ? { lastAction: acted } : {}),
    };
  }

  /** The default branch's tips, local and remotes'. */
  async function trunkOf(refs: RefList): Promise<string[]> {
    const name = await defaultBranch(repo, refs);
    if (!name) return [];
    return [
      ...refs.branches.filter((b) => b.name === name).map((b) => b.sha),
      ...refs.remotes.filter((r) => r.branch === name).map((r) => r.sha),
    ];
  }

  /** The prompt a feature's agent is given. */
  async function promptOf(where: ReviewPlace, feature: FeatureFile): Promise<string> {
    return featurePrompt(feature, {
      record: featurePath(featuresDir(where), feature.branch),
      reviews: join(where.dir, ...feature.branch.split('/')),
      agents: where.agents,
      into: await defaultBranch(repo, await listRefs(repo)),
    });
  }

  /** A feature's record; 404 without one. */
  async function recorded(where: ReviewPlace, branch: string): Promise<FeatureFile> {
    const feature = await readFeature(featurePath(featuresDir(where), branch));
    if (!feature) throw new FeatureRefused(`no workspace ${branch}`, 404);
    return feature;
  }

  /** Merge checks by the default branch's tip and the feature's: they take seconds on some. */
  const merges = new Map<string, Promise<BranchMerge>>();
  /** Check commands by commit: a commit's files never change. */
  const checks = new Map<string, Promise<CheckGuess | null>>();

  /** Starts the feature's agent and records how that went; the prompt it was given. */
  async function launch(
    where: ReviewPlace,
    feature: FeatureFile,
    agent: ClaudeCode | null,
    permissionMode: PermissionMode,
  ): Promise<string> {
    const prompt = await promptOf(where, feature);
    if (!agent) {
      feature.agent = null;
    } else {
      // The session's first hooks run while `--bg` starts it: they look for this record.
      await save(where, feature);
      const result = await agent.start({
        cwd: feature.worktree,
        name: feature.branch,
        prompt,
        permissionMode,
        addDir: cprFolder(where),
        settings: await settingsFile(where),
      });
      feature.agent = result.ok
        ? { kind: 'claude', permissionMode, started: now().toISOString(), hooks: true }
        : { kind: 'claude', permissionMode, error: result.error };
    }
    await save(where, feature);
    return prompt;
  }

  async function started(
    where: ReviewPlace,
    feature: FeatureFile,
    prompt: string,
    agent: ClaudeCode | null,
  ) {
    const refs = await listRefs(repo);
    const sessions = feature.agent && agent ? await agent.sessions() : [];
    return { feature: await summary(where, feature, refs, await trunkOf(refs), sessions), prompt };
  }

  /** A feature's agent, found; a refusal the page can show when there is none. */
  async function agentOf(feature: FeatureFile): Promise<ClaudeCode> {
    const agent = feature.agent ? await claude() : null;
    if (!agent) {
      throw new FeatureRefused(
        'No agent to talk to: install Claude Code (claude on PATH), or set CPR_CLAUDE',
        409,
      );
    }
    return agent;
  }

  /** Whether a feature's commits are all in the default branch. */
  async function isMerged(feature: FeatureFile, refs: RefList): Promise<boolean> {
    const tip = refs.branches.find((b) => b.name === feature.branch)?.sha;
    if (!tip || !(await isCommit(repo, feature.base))) return false;
    if ((await commitsBetween(repo, feature.base, tip, 1)).count === 0) return false;
    for (const end of await trunkOf(refs)) if (await isAncestor(repo, tip, end)) return true;
    return false;
  }

  return {
    async options() {
      const [refs, agent] = await Promise.all([listRefs(repo), claude()]);
      const where = await place();
      const { branchPrefixes, worktrees, permissionMode } = config();
      const apiKey = Boolean(env.ANTHROPIC_API_KEY);
      const account = agent ? await agent.account() : undefined;
      return {
        base: await featureBase(repo, refs),
        branchPrefixes,
        kinds: workKinds(),
        worktrees: join(dirname(worktreeFolder(mainRoot(where), 'x', worktrees)), '<branch>'),
        agent: agent
          ? {
              kind: 'claude',
              command: agent.command,
              ...(account ? { account } : {}),
              ...(apiKey ? { apiKey } : {}),
              permissionMode,
            }
          : null,
        maxBrief: MAX_BRIEF,
      };
    },

    async list() {
      const where = await place();
      const list = (await records(where)).filter((f) => !f.finished);
      const head = { place: where.place, ...(where.note ? { note: where.note } : {}) };
      if (list.length === 0) return { features: [], ...head };
      // Agents may wake from agent view or `claude attach`: their settings file must be there.
      if (list.some((f) => f.agent?.hooks)) await settingsFile(where);
      const refs = await listRefs(repo);
      const trunk = await trunkOf(refs);
      const agent = list.some((f) => f.agent) ? await claude() : null;
      const sessions = agent ? await agent.sessions() : null;
      const summaries: FeatureSummary[] = [];
      for (const feature of list) {
        summaries.push(await summary(where, feature, refs, trunk, sessions));
      }
      const terminal = await terminals?.available();
      return { features: summaries, ...head, ...(terminal ? { terminal } : {}) };
    },

    async start(request) {
      const work = workOf(request);
      const permissionMode = request.permissionMode ?? config().permissionMode;
      if (!PERMISSION_MODES.includes(permissionMode)) {
        throw new FeatureRefused(`unknown permission mode: ${String(permissionMode)}`, 400);
      }
      const refs = await listRefs(repo);
      const problem = await branchNameProblem(repo, request.branch, refs);
      if (problem) {
        const taken =
          refs.branches.some((b) => b.name === request.branch) ||
          refs.remotes.some((r) => r.branch === request.branch);
        throw new FeatureRefused(problem, taken ? 409 : 400);
      }
      let base: { from?: string; sha: string };
      if (request.base !== undefined) {
        if (!FULL_SHA.test(request.base)) {
          throw new FeatureRefused(`the base must be a full SHA: ${request.base}`, 400);
        }
        if (!(await isCommit(repo, request.base))) {
          throw new FeatureRefused(`not a commit: ${request.base}`, 400);
        }
        base = { sha: request.base };
      } else {
        const found = await featureBase(repo, refs);
        if (!found) {
          throw new FeatureRefused('no default branch to start from: pick a commit', 400);
        }
        base = found;
      }
      const where = await place();
      const folder = worktreeFolder(mainRoot(where), request.branch, config().worktrees);
      if (existsSync(folder)) throw new FeatureRefused(`${folder} exists`, 409);
      try {
        await addWorktree(repo, { folder, branch: request.branch, base: base.sha });
      } catch (error) {
        if (error instanceof WorktreeRefused) throw new FeatureRefused(error.message, 409);
        throw error;
      }
      const by = await userEmail(repo);
      const feature: FeatureFile = {
        agent: null,
        base: base.sha,
        branch: request.branch,
        ...work,
        ...(by ? { by } : {}),
        created: now().toISOString(),
        ...(base.from ? { from: base.from } : {}),
        planFirst: request.planFirst,
        worktree: folder,
      };
      await prepareCprFolder(where);
      const agent = await claude();
      const prompt = await launch(where, feature, agent, permissionMode);
      return started(where, feature, prompt, agent);
    },

    async startAgent(branch) {
      const where = await place();
      const feature = await recorded(where, branch);
      const agent = await claude();
      if (!agent) {
        throw new FeatureRefused(
          'No agent to start: install Claude Code (claude on PATH), or set CPR_CLAUDE',
          409,
        );
      }
      if (!existsSync(feature.worktree)) {
        throw new FeatureRefused(`its worktree is gone: ${feature.worktree}`, 409);
      }
      const mode = feature.agent?.permissionMode ?? config().permissionMode;
      const prompt = await launch(where, feature, agent, mode);
      return started(where, feature, prompt, agent);
    },

    async prompt(branch) {
      const where = await place();
      return promptOf(where, await recorded(where, branch));
    },

    async check(at) {
      if (!FULL_SHA.test(at)) throw new FeatureRefused(`the commit must be a full SHA: ${at}`, 400);
      if (!(await isCommit(repo, at))) throw new FeatureRefused(`not a commit: ${at}`, 400);
      let guess = checks.get(at);
      if (!guess) {
        guess = treeAt(repo, at).then(guessCheck);
        checks.set(at, guess);
      }
      return guess;
    },

    async stopAgent(branch) {
      const where = await place();
      const feature = await recorded(where, branch);
      const agent = feature.agent ? await claude() : null;
      const sessions = agent ? await agent.sessions() : null;
      const live = agentState(feature, sessions, 0, real);
      if (!agent || !live.id || !['working', 'needs-you'].includes(live.state)) {
        throw new FeatureRefused('its agent is not running', 409);
      }
      const stopped = await agent.stop(live.id);
      if (!stopped.ok) throw new FeatureRefused(stopped.error, 409);
      return started(where, feature, await promptOf(where, feature), agent);
    },

    async openWorktree(branch) {
      const feature = await recorded(await place(), branch);
      if (!existsSync(feature.worktree)) {
        throw new FeatureRefused(`its worktree is gone: ${feature.worktree}`, 409);
      }
      if (!openFolder) throw new FeatureRefused('no editor to open it in', 409);
      const result = await openFolder(feature.worktree);
      if (!result.opened) throw new FeatureRefused(result.message, 502);
    },

    async merge(branch) {
      const feature = await recorded(await place(), branch);
      const refs = await listRefs(repo);
      const tip = refs.branches.find((b) => b.name === feature.branch)?.sha;
      if (!tip) throw new FeatureRefused(`its branch ${feature.branch} is gone`, 409);
      const into = await defaultBranch(repo, refs);
      if (!into) return { into: '', error: 'no default branch to merge into' };
      // The local default branch, where the merge is made; else a remote's.
      const target =
        refs.branches.find((b) => b.name === into) ?? refs.remotes.find((r) => r.branch === into);
      if (!target) return { into, error: `no branch ${into}` };
      const key = `${target.sha}:${tip}`;
      let check = merges.get(key);
      if (!check) {
        check = checkMerge(repo, target.sha, tip).then((result) => ({ into, ...result }));
        merges.set(key, check);
      }
      return check;
    },

    async thread(branch) {
      const where = await place();
      const feature = await recorded(where, branch);
      const entries = await readThread(cprFolder(where), branch);
      const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
      const verdict = review?.verdicts.at(-1);
      const shown = (path: string) =>
        where.place === 'repository' ? relative(repo.root, path).split(sep).join('/') : path;
      return {
        entries,
        recorded: feature.agent?.hooks === true,
        ...(review && verdict
          ? {
              verdict: {
                at: verdict.at,
                event: verdict.event,
                head: verdict.head,
                text: verdictText(review, review.reviewer, verdict, {
                  review: shown(reviewPath(where.dir, branch, where.reviewer)),
                  agents: shown(where.agents),
                }),
              },
            }
          : {}),
      };
    },

    async terminal({ branch, cols, rows }) {
      const where = await place();
      const feature = await recorded(where, branch);
      if (!terminals) throw new FeatureRefused('no terminals here', 409);
      const can = await terminals.available();
      if (!can.available) throw new FeatureRefused(can.reason, 409);
      const agent = await agentOf(feature);
      if (!existsSync(feature.worktree)) {
        throw new FeatureRefused(`its worktree is gone: ${feature.worktree}`, 409);
      }
      // A session that wakes reads its settings file again, and does not start without it.
      if (feature.agent?.hooks) await settingsFile(where);
      // `attach` to an ID Claude Code does not know exits 0, saying "No job matching…".
      const session = newestSession(feature, await agent.sessions(), real);
      if (!session?.id) {
        throw new FeatureRefused('its agent has no session to open: start the agent again', 409);
      }
      try {
        const id = await terminals.open({
          command: agent.command,
          args: ['attach', session.id],
          cwd: feature.worktree,
          cols,
          rows,
          env,
        });
        return { id };
      } catch (error) {
        if (error instanceof TerminalRefused) throw new FeatureRefused(error.message, 409);
        throw error;
      }
    },

    async reply({ branch, text, stop }) {
      if (text.trim() === '') throw new FeatureRefused('a message cannot be empty', 400);
      if (text.length > MAX_BRIEF) {
        throw new FeatureRefused('a message is at most 20,000 characters', 400);
      }
      const where = await place();
      const feature = await recorded(where, branch);
      const agent = await agentOf(feature);
      if (!existsSync(feature.worktree)) {
        throw new FeatureRefused(`its worktree is gone: ${feature.worktree}`, 409);
      }
      // A session that wakes reads its settings file again, and does not start without it.
      if (feature.agent?.hooks) await settingsFile(where);
      const session = newestSession(feature, await agent.sessions(), real);
      if (!session?.sessionId || !session.id) {
        throw new FeatureRefused(
          'its agent has no session to continue: start the agent again',
          409,
        );
      }
      // A live process is stopped first: a resume of a running session makes a copy.
      const alive = session.status !== undefined;
      const midTurn = alive && (session.status !== 'idle' || session.waitingFor !== undefined);
      if (midTurn && !stop) {
        const doing = session.waitingFor ? `waiting on a ${session.waitingFor}` : 'working';
        throw new FeatureRefused(`its agent is ${doing}: sending stops its turn`, 409);
      }
      if (alive) {
        const stopped = await agent.stop(session.id);
        if (!stopped.ok) throw new FeatureRefused(stopped.error, 409);
      }
      const resumed = await agent.resume({
        sessionId: session.sessionId,
        cwd: feature.worktree,
        text,
      });
      if (!resumed.ok) throw new FeatureRefused(resumed.error, 502);
      const refs = await listRefs(repo);
      const sessions = await agent.sessions();
      const newest = newestSession(feature, sessions, real);
      const copy = newest && newest.sessionId !== session.sessionId ? newest.id : undefined;
      return {
        feature: await summary(where, feature, refs, await trunkOf(refs), sessions),
        ...(copy ? { copy } : {}),
      };
    },

    async clean({ branch, unmerged }) {
      const where = await place();
      const feature = await recorded(where, branch);
      const merged = await isMerged(feature, await listRefs(repo));
      if (!merged && !unmerged) {
        throw new FeatureRefused(
          `${branch} is not merged into the default branch: clean up anyway to remove its worktree and keep the branch`,
          409,
        );
      }
      const exists = existsSync(feature.worktree);
      const changed = exists ? await uncommittedFiles(feature.worktree) : 0;
      if (changed > 0) {
        throw new FeatureRefused(
          `${plural(changed, 'file')} not committed in ${feature.worktree}: commit or remove ${changed === 1 ? 'it' : 'them'} first`,
          409,
        );
      }
      const agent = feature.agent ? await claude() : null;
      if (agent) {
        const folder = real(feature.worktree);
        for (const session of (await agent.sessions()) ?? []) {
          if (real(session.cwd) !== folder || !session.id) continue;
          if (session.status !== undefined) await agent.stop(session.id);
          const removed = await agent.remove(session.id);
          if (!removed.ok) throw new FeatureRefused(removed.error, 409);
        }
      }
      try {
        if (exists) await removeWorktree(repo, feature.worktree);
        if (merged) await deleteMergedBranch(repo, feature.branch);
      } catch (error) {
        if (error instanceof WorktreeRefused) throw new FeatureRefused(error.message, 409);
        throw error;
      }
      feature.finished = now().toISOString();
      await save(where, feature);
      return { finished: feature.finished };
    },
  };
}
