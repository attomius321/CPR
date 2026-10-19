import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addWorktree,
  AGENT_KINDS,
  branchNameProblem,
  checkMerge,
  commitFolders,
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
  type AgentOption,
  type BranchMerge,
  type BriefPart,
  type BriefParts,
  type CheckGuess,
  type AgentStateName,
  type WorkspaceAgentState,
  type WorkspaceList,
  type WorkspaceOptions,
  type WorkspaceReplied,
  type WorkspaceReply,
  type WorkspaceRequest,
  type WorkspaceStart,
  type WorkspaceSummary,
  type WorkspaceTerminalRequest,
  type WorkspaceThread,
  type GitRepo,
  type PermissionMode,
  type RefList,
  type WorkKind,
  type WorkKindSpec,
} from '@cpr/core';
import { guessCheck, treeAt } from './check.js';
import { codexState, processAlive, type Codex } from './codex.js';
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
import {
  appendThread,
  lastAction,
  readThread,
  readThreadEnd,
  threadPath,
  turnEnded,
} from './thread.js';

/** A workspace on disk: `cpr/features/<branch>.json` (V18), one per branch. */
export interface WorkspaceFile {
  /** The agent started for it; null when none was found. */
  agent: WorkspaceAgentRecord | null;
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
  /** The workspace's worktree folder. */
  worktree: string;
}

export interface WorkspaceAgentRecord {
  kind: AgentKind;
  /** Claude Code's permission mode. */
  permissionMode?: PermissionMode;
  /** When it last started: for Codex, its last run (V20a). */
  started?: string;
  /** Codex: its last run's ID, on the thread entries it wrote, and its runner's process (V20a). */
  run?: string;
  pid?: number;
  /** Why the last start failed, in the agent's words. */
  error?: string;
  /** Started with CPR's hooks (V18c): its thread is recorded. */
  hooks?: boolean;
}

/** Every workspace file's first key: where an agent that opens it finds its instructions. */
export const WORKSPACE_ABOUT =
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
export class WorkspaceRefused extends Error {
  override name = 'FeatureRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502,
  ) {
    super(message);
  }
}

/** A workspace's file: the branch's slashes as folders. */
export function workspacePath(dir: string, branch: string): string {
  const parts = branch.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new WorkspaceRefused(`not a branch name: ${branch}`, 400);
  }
  const last = parts.pop() as string;
  return join(dir, ...parts, `${last}.json`);
}

/** Sorted keys, two-space indent, a final newline; `about` first. */
export function serializeWorkspace(workspace: WorkspaceFile): string {
  return `${JSON.stringify(sortKeys({ ...workspace, about: WORKSPACE_ABOUT }), null, 2)}\n`;
}

/** A workspace file, or null when it is missing or not one. */
export async function readWorkspace(path: string): Promise<WorkspaceFile | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<Record<keyof WorkspaceFile, unknown>>;
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

function asAgent(value: unknown): WorkspaceAgentRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<Record<keyof WorkspaceAgentRecord, unknown>>;
  const kind = AGENT_KINDS.find((k) => k === v.kind);
  if (!kind) return null;
  const mode = PERMISSION_MODES.find((m) => m === v.permissionMode) ?? 'default';
  return {
    kind,
    ...(kind === 'claude' ? { permissionMode: mode } : {}),
    ...(typeof v.started === 'string' ? { started: v.started } : {}),
    ...(typeof v.run === 'string' && v.run !== '' ? { run: v.run } : {}),
    ...(typeof v.pid === 'number' && Number.isInteger(v.pid) && v.pid > 0 ? { pid: v.pid } : {}),
    ...(typeof v.error === 'string' ? { error: v.error } : {}),
    ...(v.hooks === true ? { hooks: true } : {}),
  };
}

/**
 * Where a workspace's worktree goes: beside the checkout, `../<checkout>.worktrees/<branch>`, the
 * branch's slashes as dashes; `pattern` (`workspaces.worktrees` in `cpr/config.json`, relative to
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
 * Where a workspace starts by default: the default branch's newest tip — of the local branch and
 * the remotes', the one that holds the others; the local one when they diverged.
 */
export async function workspaceBase(
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
 * record and reviews are. A record from before V24 is a workspace.
 */
export function workspacePrompt(
  workspace: WorkspaceFile,
  where: { record: string; reviews: string; agents: string; into: string | null },
): string {
  const kind = workspace.kind ?? 'feature';
  const start = workspace.from
    ? `${workspace.from} at ${workspace.base.slice(0, 7)}`
    : `the commit ${workspace.base.slice(0, 7)}`;
  const { line } = KINDS[kind];
  return [
    `You are starting a new ${kind} in this repository, on the branch ${workspace.branch}, ` +
      `started from ${start}. This folder is a git worktree of its own with that branch ` +
      'checked out: work only here.',
    '',
    "The person's brief:",
    '',
    workspace.brief.trim(),
    '',
    ...(line ? [line, ''] : []),
    workspace.planFirst
      ? 'First write a plan: what you will change and how you will check it, then stop and ' +
        "wait for the person's OK before changing anything."
      : "Plan it, build it and check it as the project's own instructions say.",
    '',
    kind === 'spike'
      ? 'Commit nothing unless the brief asks for it. When you have the answer, say it: the ' +
        'person reads your report in CPR.'
      : `Commit your work on ${workspace.branch} as you go. Push only if the project's instructions ` +
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

/** The newest session in a workspace's worktree, matched by real path. */
export function newestSession(
  workspace: WorkspaceFile,
  sessions: AgentSession[] | null,
  real: (path: string) => string,
): AgentSession | undefined {
  const folder = real(workspace.worktree);
  return (sessions ?? [])
    .filter((s) => real(s.cwd) === folder)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

/** Claude Code's word for a session waiting on the person, or for one whose turn ended there. */
const isBlocked = (session: AgentSession) =>
  ['blocked', 'waiting'].includes(session.state ?? session.status ?? '');

/**
 * What the page says of a workspace's agent: the newest session working in its worktree (matched
 * by real path), else why there is none. `ahead` (commits since the base) tells a finished plan
 * from finished work. `ended`: the thread says its last turn ended (V18c) — Claude Code reads a
 * finished plan as `blocked` with nothing named it waits for, so that is a finished turn. A
 * turn interrupted with Esc fires no hook and reads `idle` with `working` until the next one ends.
 */
export function agentState(
  workspace: WorkspaceFile,
  sessions: AgentSession[] | null,
  ahead: number,
  real: (path: string) => string,
  ended = false,
): WorkspaceAgentState {
  const { agent } = workspace;
  if (!agent) return { state: 'no-agent' };
  const kind = agent.kind;
  const session = newestSession(workspace, sessions, real);
  if (!session) {
    if (agent.error) return { state: 'not-started', kind, error: agent.error };
    if (sessions === null) {
      return { state: 'unknown', kind, error: 'Claude Code could not list its sessions' };
    }
    return { state: 'not-running', kind };
  }
  const id = session.id ? { id: session.id } : {};
  const finished = (): AgentStateName =>
    ahead > 0 ? 'ready' : workspace.planFirst ? 'plan-ready' : 'done';
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

/** What `cpr/config.json` says of workspaces and their agent; anything unknown is ignored. */
export interface WorkspaceConfig {
  branchPrefixes: Record<WorkKind, string>;
  worktrees?: string;
  /** The agent offered first (`agent.kind`, V20a). */
  agent?: AgentKind;
  /** Claude Code's permission mode and model. */
  permissionMode: PermissionMode;
  model?: string;
}

/**
 * `features.branchPrefixes` sets a kind's prefix (V24), each kind its own by default (`fix/`);
 * `features.branchPrefix`, from before V24, sets the Feature's unless `branchPrefixes` does.
 * `agent.kind` names the agent offered first (V20a); `agent.permissionMode` and `agent.model`
 * are Claude Code's.
 */
export function readWorkspaceConfig(root: string): WorkspaceConfig {
  const branchPrefixes = Object.fromEntries(WORK_KINDS.map((k) => [k, `${k}/`])) as Record<
    WorkKind,
    string
  >;
  const config: WorkspaceConfig = { branchPrefixes, permissionMode: 'default' };
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return config;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return config;
  }
  type Section = { branchPrefix?: unknown; branchPrefixes?: unknown; worktrees?: unknown };
  const v = (value && typeof value === 'object' ? value : {}) as {
    workspaces?: Section;
    /** The section's name before V25, still read when `workspaces` is not there. */
    features?: Section;
    agent?: unknown;
  };
  const section = v.workspaces ?? v.features;
  if (typeof section?.branchPrefix === 'string') {
    branchPrefixes.feature = section.branchPrefix;
  }
  const prefixes = section?.branchPrefixes;
  if (prefixes && typeof prefixes === 'object') {
    for (const kind of WORK_KINDS) {
      const prefix = (prefixes as Record<string, unknown>)[kind];
      if (typeof prefix === 'string') branchPrefixes[kind] = prefix;
    }
  }
  if (typeof section?.worktrees === 'string' && section.worktrees !== '') {
    config.worktrees = section.worktrees;
  }
  const agent = (v.agent && typeof v.agent === 'object' ? v.agent : {}) as {
    kind?: unknown;
    permissionMode?: unknown;
    model?: unknown;
  };
  const kind = AGENT_KINDS.find((k) => k === agent.kind);
  if (kind) config.agent = kind;
  const mode = PERMISSION_MODES.find((m) => m === agent.permissionMode);
  if (mode) config.permissionMode = mode;
  if (typeof agent.model === 'string' && agent.model !== '') config.model = agent.model;
  return config;
}

/**
 * A start request's brief, checked: made from its kind, title and parts (V24), empty parts left
 * out; or, from a request made before V24, its brief as given.
 */
function workOf(
  request: WorkspaceRequest,
): Pick<WorkspaceFile, 'brief' | 'kind' | 'title' | 'parts'> {
  const { kind, title, parts } = request;
  if (kind === undefined && title === undefined && parts === undefined) {
    const brief = request.brief ?? '';
    if (brief.trim() === '') {
      throw new WorkspaceRefused('a workspace needs a brief: what to build', 400);
    }
    if (brief.length > MAX_BRIEF) {
      throw new WorkspaceRefused('a brief is at most 20,000 characters', 400);
    }
    return { brief };
  }
  if (request.brief !== undefined) {
    throw new WorkspaceRefused('a workspace takes a brief or a kind of work, not both', 400);
  }
  if (!WORK_KINDS.includes(kind as WorkKind)) {
    throw new WorkspaceRefused(`unknown kind: ${String(kind)}`, 400);
  }
  const of = kind as WorkKind;
  const name = (title ?? '').trim();
  if (name === '') throw new WorkspaceRefused('a workspace needs a title', 400);
  if (/[\r\n]/.test(name)) throw new WorkspaceRefused('a title is one line', 400);
  if (name.length > MAX_TITLE) {
    throw new WorkspaceRefused(`a title is at most ${MAX_TITLE} characters`, 400);
  }
  const own = partsOf(of);
  const kept: BriefParts = {};
  for (const [part, text] of Object.entries(parts ?? {})) {
    if (!own.includes(part as BriefPart)) {
      const heading = Object.hasOwn(HEADINGS, part) ? HEADINGS[part as BriefPart] : part;
      throw new WorkspaceRefused(`a ${of} has no "${heading}"`, 400);
    }
    if (typeof text === 'string' && text.trim() !== '') kept[part as BriefPart] = text;
  }
  const required = KINDS[of].required;
  if (!kept[required]) {
    throw new WorkspaceRefused(`a ${of} needs "${HEADINGS[required]}"`, 400);
  }
  const brief = briefOf(of, name, kept);
  if (brief.length > MAX_BRIEF) {
    throw new WorkspaceRefused('a brief is at most 20,000 characters, its parts together', 400);
  }
  return { brief, kind: of, title: name, parts: kept };
}

/** An agent found for a workspace: Claude Code or Codex (V20a). */
type FoundAgent = { kind: 'claude'; claude: ClaudeCode } | { kind: 'codex'; codex: Codex };

/** Each agent's name, as messages say it. */
const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' };

/** What the server needs of workspaces. */
export interface Workspaces {
  options(): Promise<WorkspaceOptions>;
  list(): Promise<WorkspaceList>;
  /** Makes the branch, its worktree and record, then starts the agent. Rejects with `FeatureRefused`. */
  start(request: WorkspaceRequest): Promise<WorkspaceStart>;
  /** Starts a workspace's agent again (after a failed start, or once it ended). */
  startAgent(branch: string): Promise<WorkspaceStart>;
  /** The prompt its agent was given, to copy. */
  prompt(branch: string): Promise<string>;
  /**
   * The check command guessed from the root files of the commit a workspace would start from
   * (V24b), for the start dialog's Done when; null when none is found.
   */
  check(at: string): Promise<CheckGuess | null>;
  /**
   * The start dialog's draft (V24c, decision 128): kept in CPR's cache for the repository, so a
   * new `cpr view` (another port, other browser storage) has it; `{}` when none.
   */
  draft(): Promise<Record<string, unknown>>;
  saveDraft(value: Record<string, unknown>): Promise<void>;
  /** Stops its agent while it works or waits. */
  stopAgent(branch: string): Promise<WorkspaceStart>;
  /** Opens its worktree's folder in the editor (V12's VS Code). */
  openWorktree(branch: string): Promise<void>;
  /** Whether its branch merges cleanly into the default branch (V17's check), once per pair. */
  merge(branch: string): Promise<BranchMerge>;
  /** Its thread (V18c): what its agent was given and reported, and its review's last verdict. */
  thread(branch: string): Promise<WorkspaceThread>;
  /** Sends a message to its agent: continues its session with the text (V18c). */
  reply(request: WorkspaceReply): Promise<WorkspaceReplied>;
  /**
   * Opens its agent's newest session in a terminal (V21): `claude attach <id>` in its worktree;
   * the terminal's ID. A stopped session continues, with no turn.
   */
  terminal(request: WorkspaceTerminalRequest): Promise<{ id: string }>;
  /**
   * Cleans it up (V18c): its agent's sessions, its worktree and, once merged, its branch; the
   * record stays, `finished`. Unmerged only when asked (`unmerged`); never with work not
   * committed.
   */
  clean(request: { branch: string; unmerged?: boolean }): Promise<{ finished: string }>;
}

/** The hooks CPR passes to every workspace's agent (V18c): each event, recorded by `agent-hook.js`. */
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

/** Workspaces of `repo`, kept beside its reviews (`cpr/features/`, else CPR's cache). */
export function workspaces(
  repo: GitRepo,
  cacheDir: string,
  {
    claude,
    codex = () => Promise.resolve(null),
    now = () => new Date(),
    env = process.env,
    root = repo.root,
    openFolder,
    hook = fileURLToPath(new URL('./agent-hook.js', import.meta.url)),
    node = process.execPath,
    terminals,
  }: {
    /** Finds Claude Code (once a start or a list needs it); null when it is not installed. */
    claude: () => Promise<ClaudeCode | null>;
    /** Finds Codex (V20a), the same way; none by default. */
    codex?: () => Promise<Codex | null>;
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
): Workspaces {
  const place = () => reviewPlace(repo, cacheDir);
  const config = () => readWorkspaceConfig(root);
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  /** The folder holding `cpr/` (or its stand-in in the cache): the agent may read it. */
  const cprFolder = (where: ReviewPlace) => dirname(where.dir);
  const workspacesDir = (where: ReviewPlace) => join(cprFolder(where), 'features');
  /** `workspaces.worktrees` is relative to the checkout that holds `cpr/`. */
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

  async function save(where: ReviewPlace, workspace: WorkspaceFile): Promise<void> {
    const path = workspacePath(workspacesDir(where), workspace.branch);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, serializeWorkspace(workspace));
    await rename(temp, path);
  }

  async function records(where: ReviewPlace): Promise<WorkspaceFile[]> {
    const dir = workspacesDir(where);
    const files = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
    const list: WorkspaceFile[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const workspace = await readWorkspace(join(dir, file));
      // The file must be the branch's: a copied or renamed file is not that workspace.
      if (workspace && relative(dir, workspacePath(dir, workspace.branch)) === file) {
        list.push(workspace);
      }
    }
    return list.sort(
      (a, b) => a.created.localeCompare(b.created) || a.branch.localeCompare(b.branch),
    );
  }

  async function summary(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    refs: RefList,
    trunk: string[],
    sessions: AgentSession[] | null,
  ): Promise<WorkspaceSummary> {
    const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha ?? null;
    let ahead = 0;
    let merged = false;
    if (tip && (await isCommit(repo, workspace.base))) {
      ahead = (await commitsBetween(repo, workspace.base, tip, 1)).count;
      for (const end of trunk) {
        if (ahead > 0 && !merged) merged = await isAncestor(repo, tip, end);
      }
    }
    const exists = existsSync(workspace.worktree);
    const changed = exists ? await uncommittedFiles(workspace.worktree).catch(() => null) : null;
    const thread = workspace.agent ? await readThreadEnd(cprFolder(where), workspace.branch) : [];
    // Blocked with nothing named: its thread tells a finished turn from a question (V18c).
    const session = newestSession(workspace, sessions, real);
    const ended = session && isBlocked(session) && !session.waitingFor ? turnEnded(thread) : false;
    const acted = workspace.agent ? (lastAction(thread) ?? workspace.agent.started) : undefined;
    const agent =
      workspace.agent?.kind === 'codex'
        ? codexState(workspace, thread, await codexAlive(workspace), ahead)
        : agentState(workspace, sessions, ahead, real, ended);
    return {
      branch: workspace.branch,
      ...(workspace.kind ? { kind: workspace.kind } : {}),
      ...(workspace.title ? { title: workspace.title } : {}),
      base: workspace.base,
      ...(workspace.from ? { from: workspace.from } : {}),
      created: workspace.created,
      planFirst: workspace.planFirst,
      brief: workspace.brief,
      worktree: { path: workspace.worktree, exists, ...(changed === null ? {} : { changed }) },
      tip,
      ahead,
      merged,
      agent,
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

  /** The prompt a workspace's agent is given. */
  async function promptOf(where: ReviewPlace, workspace: WorkspaceFile): Promise<string> {
    return workspacePrompt(workspace, {
      record: workspacePath(workspacesDir(where), workspace.branch),
      reviews: join(where.dir, ...workspace.branch.split('/')),
      agents: where.agents,
      into: await defaultBranch(repo, await listRefs(repo)),
    });
  }

  /** A workspace's record; 404 without one. */
  async function recorded(where: ReviewPlace, branch: string): Promise<WorkspaceFile> {
    const workspace = await readWorkspace(workspacePath(workspacesDir(where), branch));
    if (!workspace) throw new WorkspaceRefused(`no workspace ${branch}`, 404);
    return workspace;
  }

  const draftFile = join(cacheDir, 'state', repo.id, 'start-draft.json');

  /** Merge checks by the default branch's tip and the workspace's: they take seconds on some. */
  const merges = new Map<string, Promise<BranchMerge>>();
  /** Check commands by commit: a commit's files never change. */
  const checks = new Map<string, Promise<CheckGuess | null>>();

  /** The agent of `kind`, when it is installed. */
  async function found(kind: AgentKind): Promise<FoundAgent | null> {
    if (kind === 'claude') {
      const agent = await claude();
      return agent ? { kind, claude: agent } : null;
    }
    const agent = await codex();
    return agent ? { kind, codex: agent } : null;
  }

  /** The agent a workspace gets unless one is picked: `agent.kind`, else Claude Code, else Codex. */
  async function defaultAgent(): Promise<FoundAgent | null> {
    const first = config().agent;
    for (const kind of first ? [first, ...AGENT_KINDS.filter((k) => k !== first)] : AGENT_KINDS) {
      const agent = await found(kind);
      if (agent) return agent;
    }
    return null;
  }

  /** Starts the workspace's agent and records how that went; the prompt it was given. */
  async function launch(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    agent: FoundAgent | null,
    permissionMode: PermissionMode,
  ): Promise<string> {
    const prompt = await promptOf(where, workspace);
    if (!agent) {
      workspace.agent = null;
    } else if (agent.kind === 'codex') {
      workspace.agent = await launchCodex(where, workspace, agent.codex, prompt);
      await save(where, workspace);
      await firstEntry(where, workspace);
    } else {
      // The session's first hooks run while `--bg` starts it: they look for this record.
      await save(where, workspace);
      const result = await agent.claude.start({
        cwd: workspace.worktree,
        name: workspace.branch,
        prompt,
        permissionMode,
        addDir: cprFolder(where),
        settings: await settingsFile(where),
      });
      workspace.agent = result.ok
        ? { kind: 'claude', permissionMode, started: now().toISOString(), hooks: true }
        : { kind: 'claude', permissionMode, error: result.error };
    }
    await save(where, workspace);
    return prompt;
  }

  /**
   * Starts Codex on a workspace (V20a): `codex exec` through CPR's runner, which records its
   * thread; its sandbox may also write what a commit on the branch writes (decision 130).
   */
  async function launchCodex(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    agent: Codex,
    prompt: string,
  ): Promise<WorkspaceAgentRecord> {
    // Not logged in, `exec` retries for about 25 s and fails with a 401 (V20a spike).
    if ((await agent.account()) === 'not logged in') {
      return {
        kind: 'codex',
        error: 'Codex is not logged in: run `codex login`, then start the agent.',
      };
    }
    const run = randomUUID();
    const started = now().toISOString();
    const result = await agent.start({
      cwd: workspace.worktree,
      thread: threadPath(cprFolder(where), workspace.branch),
      run,
      writable: await commitFolders(workspace.worktree, workspace.branch),
      prompt,
    });
    return result.ok
      ? { kind: 'codex', started, run, pid: result.pid }
      : { kind: 'codex', error: result.error };
  }

  /**
   * Waits for a Codex run's first thread entry, 3 s at most, unless its runner is gone: a start or
   * a reply then answers with its thread's ID and the message in its thread, as Claude Code's
   * hooks have them before `--bg` returns (measured with a real Codex: 5.3 s to the page's next
   * read without it; its thread starts 150 ms after the run, V20a spike).
   */
  async function firstEntry(where: ReviewPlace, workspace: WorkspaceFile): Promise<void> {
    const run = workspace.agent?.run;
    if (!run) return;
    for (let waited = 0; waited < 3_000; waited += 50) {
      const entries = await readThreadEnd(cprFolder(where), workspace.branch);
      if (entries.some((e) => e.run === run) || !(await codexAlive(workspace))) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Whether a Codex workspace's last run still runs (its runner's process). */
  async function codexAlive(workspace: WorkspaceFile): Promise<boolean> {
    const pid = workspace.agent?.pid;
    if (!pid) return false;
    return (await codex())?.alive(pid) ?? processAlive(pid);
  }

  /** Stops a Codex workspace's run; ends it in the thread when its runner could not. */
  async function stopCodex(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    agent: Codex,
  ): Promise<void> {
    if (workspace.agent?.pid) await agent.stop(workspace.agent.pid);
    const run = workspace.agent?.run;
    const entries = await readThreadEnd(cprFolder(where), workspace.branch);
    if (entries.some((e) => e.run === run && e.kind === 'end')) return;
    const session = entries.findLast((e) => e.kind === 'start')?.session ?? '';
    await appendThread(cprFolder(where), workspace.branch, {
      at: now().toISOString(),
      session,
      ...(run ? { run } : {}),
      kind: 'end',
      reason: 'stopped',
    });
  }

  async function started(where: ReviewPlace, workspace: WorkspaceFile, prompt: string) {
    const refs = await listRefs(repo);
    const agent = workspace.agent?.kind === 'claude' ? await claude() : null;
    const sessions = agent ? await agent.sessions() : [];
    return {
      workspace: await summary(where, workspace, refs, await trunkOf(refs), sessions),
      prompt,
    };
  }

  /** A workspace's agent, found; a refusal the page can show when there is none. */
  async function agentOf(workspace: WorkspaceFile): Promise<ClaudeCode> {
    const agent = workspace.agent ? await claude() : null;
    if (!agent) {
      throw new WorkspaceRefused(
        'No agent to talk to: install Claude Code (claude on PATH), or set CPR_CLAUDE',
        409,
      );
    }
    return agent;
  }

  /**
   * A message to Codex (V20a): its thread continued with the text (`exec resume`), its sandbox as
   * at the start; a run that lives is stopped first, only when asked (it loses its turn).
   */
  async function replyCodex(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    text: string,
    stop: boolean,
  ): Promise<WorkspaceReplied> {
    const agent = await codex();
    if (!agent) {
      throw new WorkspaceRefused(
        'No agent to talk to: install Codex (codex on PATH), or set CPR_CODEX',
        409,
      );
    }
    if (!existsSync(workspace.worktree)) {
      throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
    }
    const thread = await readThreadEnd(cprFolder(where), workspace.branch);
    const state = codexState(workspace, thread, await codexAlive(workspace), 0);
    if (!state.id) {
      throw new WorkspaceRefused(
        'its agent has no session to continue: start the agent again',
        409,
      );
    }
    if (state.state === 'working') {
      if (!stop) throw new WorkspaceRefused('its agent is working: sending stops its turn', 409);
      await stopCodex(where, workspace, agent);
    }
    const run = randomUUID();
    const startedAt = now().toISOString();
    const resumed = await agent.resume({
      cwd: workspace.worktree,
      thread: threadPath(cprFolder(where), workspace.branch),
      run,
      writable: await commitFolders(workspace.worktree, workspace.branch),
      sessionId: state.id,
      text,
    });
    if (!resumed.ok) throw new WorkspaceRefused(resumed.error, 502);
    workspace.agent = { kind: 'codex', started: startedAt, run, pid: resumed.pid };
    await save(where, workspace);
    await firstEntry(where, workspace);
    const refs = await listRefs(repo);
    return { workspace: await summary(where, workspace, refs, await trunkOf(refs), []) };
  }

  /** Whether a workspace's commits are all in the default branch. */
  async function isMerged(workspace: WorkspaceFile, refs: RefList): Promise<boolean> {
    const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha;
    if (!tip || !(await isCommit(repo, workspace.base))) return false;
    if ((await commitsBetween(repo, workspace.base, tip, 1)).count === 0) return false;
    for (const end of await trunkOf(refs)) if (await isAncestor(repo, tip, end)) return true;
    return false;
  }

  return {
    async options() {
      const [refs, claudeCode, codexAgent] = await Promise.all([listRefs(repo), claude(), codex()]);
      const where = await place();
      const { branchPrefixes, worktrees, permissionMode, agent: first } = config();
      const apiKey = Boolean(env.ANTHROPIC_API_KEY);
      const agents: AgentOption[] = [];
      if (claudeCode) {
        const account = await claudeCode.account();
        agents.push({
          kind: 'claude',
          command: claudeCode.command,
          ...(account ? { account } : {}),
          ...(apiKey ? { apiKey } : {}),
          permissionMode,
        });
      }
      if (codexAgent) {
        const account = await codexAgent.account();
        agents.push({
          kind: 'codex',
          command: codexAgent.command,
          ...(account ? { account } : {}),
        });
      }
      // The default first: `agent.kind`, else Claude Code, else Codex (decision 132).
      agents.sort((a, b) => Number(b.kind === first) - Number(a.kind === first));
      return {
        base: await workspaceBase(repo, refs),
        branchPrefixes,
        kinds: workKinds(),
        worktrees: join(dirname(worktreeFolder(mainRoot(where), 'x', worktrees)), '<branch>'),
        agents,
        maxBrief: MAX_BRIEF,
      };
    },

    async list() {
      const where = await place();
      const list = (await records(where)).filter((f) => !f.finished);
      const head = { place: where.place, ...(where.note ? { note: where.note } : {}) };
      if (list.length === 0) return { workspaces: [], ...head };
      // Agents may wake from agent view or `claude attach`: their settings file must be there.
      if (list.some((f) => f.agent?.hooks)) await settingsFile(where);
      const refs = await listRefs(repo);
      const trunk = await trunkOf(refs);
      const agent = list.some((f) => f.agent?.kind === 'claude') ? await claude() : null;
      const sessions = agent ? await agent.sessions() : null;
      const summaries: WorkspaceSummary[] = [];
      for (const workspace of list) {
        summaries.push(await summary(where, workspace, refs, trunk, sessions));
      }
      const terminal = await terminals?.available();
      return { workspaces: summaries, ...head, ...(terminal ? { terminal } : {}) };
    },

    async start(request) {
      const work = workOf(request);
      if (request.agent !== undefined && !AGENT_KINDS.includes(request.agent)) {
        throw new WorkspaceRefused(`unknown agent: ${String(request.agent)}`, 400);
      }
      const permissionMode = request.permissionMode ?? config().permissionMode;
      if (!PERMISSION_MODES.includes(permissionMode)) {
        throw new WorkspaceRefused(`unknown permission mode: ${String(permissionMode)}`, 400);
      }
      const agent = request.agent ? await found(request.agent) : await defaultAgent();
      if (request.agent && !agent) {
        throw new WorkspaceRefused(`${AGENT_NAMES[request.agent]} is not installed`, 409);
      }
      if (agent?.kind === 'codex' && request.permissionMode !== undefined) {
        throw new WorkspaceRefused(
          "a permission mode is Claude Code's: Codex runs in its sandbox",
          400,
        );
      }
      const refs = await listRefs(repo);
      const problem = await branchNameProblem(repo, request.branch, refs);
      if (problem) {
        const taken =
          refs.branches.some((b) => b.name === request.branch) ||
          refs.remotes.some((r) => r.branch === request.branch);
        throw new WorkspaceRefused(problem, taken ? 409 : 400);
      }
      let base: { from?: string; sha: string };
      if (request.base !== undefined) {
        if (!FULL_SHA.test(request.base)) {
          throw new WorkspaceRefused(`the base must be a full SHA: ${request.base}`, 400);
        }
        if (!(await isCommit(repo, request.base))) {
          throw new WorkspaceRefused(`not a commit: ${request.base}`, 400);
        }
        base = { sha: request.base };
      } else {
        const found = await workspaceBase(repo, refs);
        if (!found) {
          throw new WorkspaceRefused('no default branch to start from: pick a commit', 400);
        }
        base = found;
      }
      const where = await place();
      const folder = worktreeFolder(mainRoot(where), request.branch, config().worktrees);
      if (existsSync(folder)) throw new WorkspaceRefused(`${folder} exists`, 409);
      try {
        await addWorktree(repo, { folder, branch: request.branch, base: base.sha });
      } catch (error) {
        if (error instanceof WorktreeRefused) throw new WorkspaceRefused(error.message, 409);
        throw error;
      }
      const by = await userEmail(repo);
      const workspace: WorkspaceFile = {
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
      const prompt = await launch(where, workspace, agent, permissionMode);
      return started(where, workspace, prompt);
    },

    async startAgent(branch) {
      const where = await place();
      const workspace = await recorded(where, branch);
      // The agent it was started with; a workspace made without one gets the default.
      const kind = workspace.agent?.kind;
      const agent = kind ? await found(kind) : await defaultAgent();
      if (!agent) {
        throw new WorkspaceRefused(
          kind
            ? `No agent to start: ${AGENT_NAMES[kind]} is not installed`
            : 'No agent to start: install Claude Code (claude on PATH, or CPR_CLAUDE) or Codex (codex on PATH, or CPR_CODEX)',
          409,
        );
      }
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      const mode = workspace.agent?.permissionMode ?? config().permissionMode;
      const prompt = await launch(where, workspace, agent, mode);
      return started(where, workspace, prompt);
    },

    async prompt(branch) {
      const where = await place();
      return promptOf(where, await recorded(where, branch));
    },

    async draft() {
      try {
        const value = JSON.parse(await readFile(draftFile, 'utf8')) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
      } catch {
        // none yet, or not JSON
      }
      return {};
    },

    async saveDraft(value) {
      await mkdir(dirname(draftFile), { recursive: true });
      const temp = `${draftFile}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(value)}\n`);
      await rename(temp, draftFile);
    },

    async check(at) {
      if (!FULL_SHA.test(at))
        throw new WorkspaceRefused(`the commit must be a full SHA: ${at}`, 400);
      if (!(await isCommit(repo, at))) throw new WorkspaceRefused(`not a commit: ${at}`, 400);
      let guess = checks.get(at);
      if (!guess) {
        guess = treeAt(repo, at).then(guessCheck);
        checks.set(at, guess);
      }
      return guess;
    },

    async stopAgent(branch) {
      const where = await place();
      const workspace = await recorded(where, branch);
      if (workspace.agent?.kind === 'codex') {
        const agent = await codex();
        const thread = await readThreadEnd(cprFolder(where), branch);
        const live = codexState(workspace, thread, await codexAlive(workspace), 0);
        if (!agent || live.state !== 'working') {
          throw new WorkspaceRefused('its agent is not running', 409);
        }
        await stopCodex(where, workspace, agent);
        return started(where, workspace, await promptOf(where, workspace));
      }
      const agent = workspace.agent ? await claude() : null;
      const sessions = agent ? await agent.sessions() : null;
      const live = agentState(workspace, sessions, 0, real);
      if (!agent || !live.id || !['working', 'needs-you'].includes(live.state)) {
        throw new WorkspaceRefused('its agent is not running', 409);
      }
      const stopped = await agent.stop(live.id);
      if (!stopped.ok) throw new WorkspaceRefused(stopped.error, 409);
      return started(where, workspace, await promptOf(where, workspace));
    },

    async openWorktree(branch) {
      const workspace = await recorded(await place(), branch);
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      if (!openFolder) throw new WorkspaceRefused('no editor to open it in', 409);
      const result = await openFolder(workspace.worktree);
      if (!result.opened) throw new WorkspaceRefused(result.message, 502);
    },

    async merge(branch) {
      const workspace = await recorded(await place(), branch);
      const refs = await listRefs(repo);
      const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha;
      if (!tip) throw new WorkspaceRefused(`its branch ${workspace.branch} is gone`, 409);
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
      const workspace = await recorded(where, branch);
      const entries = await readThread(cprFolder(where), branch);
      const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
      const verdict = review?.verdicts.at(-1);
      const shown = (path: string) =>
        where.place === 'repository' ? relative(repo.root, path).split(sep).join('/') : path;
      return {
        entries,
        // Claude Code's hooks record it (V18c), CPR's runner records Codex's (V20a).
        recorded: workspace.agent?.hooks === true || workspace.agent?.kind === 'codex',
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
      const workspace = await recorded(where, branch);
      if (workspace.agent?.kind === 'codex') {
        throw new WorkspaceRefused(
          'Codex has no terminal in CPR: Talk copies `codex resume`, to run in yours',
          409,
        );
      }
      if (!terminals) throw new WorkspaceRefused('no terminals here', 409);
      const can = await terminals.available();
      if (!can.available) throw new WorkspaceRefused(can.reason, 409);
      const agent = await agentOf(workspace);
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      // A session that wakes reads its settings file again, and does not start without it.
      if (workspace.agent?.hooks) await settingsFile(where);
      // `attach` to an ID Claude Code does not know exits 0, saying "No job matching…".
      const session = newestSession(workspace, await agent.sessions(), real);
      if (!session?.id) {
        throw new WorkspaceRefused('its agent has no session to open: start the agent again', 409);
      }
      try {
        const id = await terminals.open({
          command: agent.command,
          args: ['attach', session.id],
          cwd: workspace.worktree,
          cols,
          rows,
          env,
        });
        return { id };
      } catch (error) {
        if (error instanceof TerminalRefused) throw new WorkspaceRefused(error.message, 409);
        throw error;
      }
    },

    async reply({ branch, text, stop }) {
      if (text.trim() === '') throw new WorkspaceRefused('a message cannot be empty', 400);
      if (text.length > MAX_BRIEF) {
        throw new WorkspaceRefused('a message is at most 20,000 characters', 400);
      }
      const where = await place();
      const workspace = await recorded(where, branch);
      if (workspace.agent?.kind === 'codex')
        return replyCodex(where, workspace, text, stop === true);
      const agent = await agentOf(workspace);
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      // A session that wakes reads its settings file again, and does not start without it.
      if (workspace.agent?.hooks) await settingsFile(where);
      const session = newestSession(workspace, await agent.sessions(), real);
      if (!session?.sessionId || !session.id) {
        throw new WorkspaceRefused(
          'its agent has no session to continue: start the agent again',
          409,
        );
      }
      // A live process is stopped first: a resume of a running session makes a copy.
      const alive = session.status !== undefined;
      const midTurn = alive && (session.status !== 'idle' || session.waitingFor !== undefined);
      if (midTurn && !stop) {
        const doing = session.waitingFor ? `waiting on a ${session.waitingFor}` : 'working';
        throw new WorkspaceRefused(`its agent is ${doing}: sending stops its turn`, 409);
      }
      if (alive) {
        const stopped = await agent.stop(session.id);
        if (!stopped.ok) throw new WorkspaceRefused(stopped.error, 409);
      }
      const resumed = await agent.resume({
        sessionId: session.sessionId,
        cwd: workspace.worktree,
        text,
      });
      if (!resumed.ok) throw new WorkspaceRefused(resumed.error, 502);
      const refs = await listRefs(repo);
      const sessions = await agent.sessions();
      const newest = newestSession(workspace, sessions, real);
      const copy = newest && newest.sessionId !== session.sessionId ? newest.id : undefined;
      return {
        workspace: await summary(where, workspace, refs, await trunkOf(refs), sessions),
        ...(copy ? { copy } : {}),
      };
    },

    async clean({ branch, unmerged }) {
      const where = await place();
      const workspace = await recorded(where, branch);
      const merged = await isMerged(workspace, await listRefs(repo));
      if (!merged && !unmerged) {
        throw new WorkspaceRefused(
          `${branch} is not merged into the default branch: clean up anyway to remove its worktree and keep the branch`,
          409,
        );
      }
      const exists = existsSync(workspace.worktree);
      const changed = exists ? await uncommittedFiles(workspace.worktree) : 0;
      if (changed > 0) {
        throw new WorkspaceRefused(
          `${plural(changed, 'file')} not committed in ${workspace.worktree}: commit or remove ${changed === 1 ? 'it' : 'them'} first`,
          409,
        );
      }
      const agent = workspace.agent?.kind === 'claude' ? await claude() : null;
      const codexAgent = workspace.agent?.kind === 'codex' ? await codex() : null;
      if (codexAgent) {
        if (await codexAlive(workspace)) await stopCodex(where, workspace, codexAgent);
        // Out of Codex's lists, not deleted (decision 134): an archived one fails the same way.
        const entries = await readThread(cprFolder(where), workspace.branch, Infinity);
        const threads = new Set(entries.filter((e) => e.kind === 'start').map((e) => e.session));
        for (const thread of threads) {
          if (thread !== '') await codexAgent.archive(thread).catch(() => undefined);
        }
      }
      if (agent) {
        const folder = real(workspace.worktree);
        for (const session of (await agent.sessions()) ?? []) {
          if (real(session.cwd) !== folder || !session.id) continue;
          if (session.status !== undefined) await agent.stop(session.id);
          const removed = await agent.remove(session.id);
          if (!removed.ok) throw new WorkspaceRefused(removed.error, 409);
        }
      }
      try {
        if (exists) await removeWorktree(repo, workspace.worktree);
        if (merged) await deleteMergedBranch(repo, workspace.branch);
      } catch (error) {
        if (error instanceof WorktreeRefused) throw new WorkspaceRefused(error.message, 409);
        throw error;
      }
      workspace.finished = now().toISOString();
      await save(where, workspace);
      return { finished: workspace.finished };
    },
  };
}
