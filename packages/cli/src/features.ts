import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  addWorktree,
  branchNameProblem,
  commitsBetween,
  defaultBranch,
  isAncestor,
  isCommit,
  listRefs,
  PERMISSION_MODES,
  userEmail,
  WorktreeRefused,
  type AgentKind,
  type AgentStateName,
  type FeatureAgentState,
  type FeatureList,
  type FeatureOptions,
  type FeatureRequest,
  type FeatureStart,
  type FeatureSummary,
  type GitRepo,
  type PermissionMode,
  type RefList,
} from '@cpr/core';
import { localHost, onPath } from './editor.js';
import { CONFIG_FILES } from './plugins.js';
import { prepareCprFolder, reviewPlace, sortKeys, type ReviewPlace } from './reviews.js';

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
  planFirst: boolean;
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
}

/** Every feature file's first key: where an agent that opens it finds its instructions. */
export const FEATURE_ABOUT =
  'A feature started in CPR. Agents: read cpr/AGENTS.md before acting on it.';

/** Longest brief: it goes on the agent's command line (Windows takes 32,767 characters). */
export const MAX_BRIEF = 20_000;

const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** A request the server answers with `status` and the message. */
export class FeatureRefused extends Error {
  override name = 'FeatureRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
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
    planFirst: v.planFirst === true,
    worktree: text(v.worktree),
  };
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

/** What the agent is told: the brief, its branch and worktree, where its record and reviews are. */
export function featurePrompt(
  feature: FeatureFile,
  where: { record: string; reviews: string; agents: string; into: string | null },
): string {
  const start = feature.from
    ? `${feature.from} at ${feature.base.slice(0, 7)}`
    : `the commit ${feature.base.slice(0, 7)}`;
  return [
    `You are starting a new feature in this repository, on the branch ${feature.branch}, ` +
      `started from ${start}. This folder is a git worktree of its own with that branch ` +
      'checked out: work only here.',
    '',
    "The person's brief:",
    '',
    feature.brief.trim(),
    '',
    feature.planFirst
      ? 'First write a plan: what you will change and how you will check it, then stop and ' +
        "wait for the person's OK before changing anything."
      : "Plan it, build it and check it as the project's own instructions say.",
    '',
    `Commit your work on ${feature.branch} as you go. Push only if the project's instructions ` +
      'say so. When it is ready, say so: the person reviews the branch in CPR' +
      (where.into ? `, and an approved commit is merged into ${where.into}.` : '.'),
    '',
    `This feature's record: ${where.record}. Reviews of the branch will be in ${where.reviews}; ` +
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

/**
 * What the page says of a feature's agent: the newest session working in its worktree (matched
 * by real path), else why there is none. `ahead` (commits since the base) tells a finished plan
 * from finished work.
 */
export function agentState(
  feature: FeatureFile,
  sessions: AgentSession[] | null,
  ahead: number,
  real: (path: string) => string,
): FeatureAgentState {
  const { agent } = feature;
  if (!agent) return { state: 'no-agent' };
  const kind = agent.kind;
  const folder = real(feature.worktree);
  const session = (sessions ?? [])
    .filter((s) => real(s.cwd) === folder)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
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
    case 'busy':
      return { state: 'working', kind, ...id };
    case 'blocked':
    case 'waiting':
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
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Its sessions, finished ones included; null when it cannot list them. */
  sessions(): Promise<AgentSession[] | null>;
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
        ...(request.permissionMode === 'default'
          ? []
          : ['--permission-mode', request.permissionMode]),
        ...(model ? ['--model', model] : []),
        request.prompt,
      ];
      const result = await run(command, args, { cwd: request.cwd, timeoutMs: 60_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      const words = (result.stderr.trim() || result.stdout.trim()).split('\n').slice(-3).join('\n');
      return {
        ok: false,
        error: words || `${basename(command)} exited with code ${result.code ?? 'none'}`,
      };
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
  branchPrefix: string;
  worktrees?: string;
  permissionMode: PermissionMode;
  model?: string;
}

export function readFeatureConfig(root: string): FeatureConfig {
  const config: FeatureConfig = { branchPrefix: 'feature/', permissionMode: 'default' };
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return config;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return config;
  }
  const v = (value && typeof value === 'object' ? value : {}) as {
    features?: { branchPrefix?: unknown; worktrees?: unknown };
    agent?: unknown;
  };
  if (typeof v.features?.branchPrefix === 'string') config.branchPrefix = v.features.branchPrefix;
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

/** What the server needs of features. */
export interface Features {
  options(): Promise<FeatureOptions>;
  list(): Promise<FeatureList>;
  /** Makes the branch, its worktree and record, then starts the agent. Rejects with `FeatureRefused`. */
  start(request: FeatureRequest): Promise<FeatureStart>;
  /** Starts a feature's agent again (after a failed start, or once it ended). */
  startAgent(branch: string): Promise<FeatureStart>;
}

/** Features of `repo`, kept beside its reviews (`cpr/features/`, else CPR's cache). */
export function features(
  repo: GitRepo,
  cacheDir: string,
  {
    claude,
    now = () => new Date(),
    env = process.env,
    root = repo.root,
  }: {
    /** Finds the agent (once a start or a list needs it); null when none is installed. */
    claude: () => Promise<ClaudeCode | null>;
    now?: () => Date;
    env?: Readonly<Record<string, string | undefined>>;
    /** Where `cpr/config.json` is read. */
    root?: string;
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
    return {
      branch: feature.branch,
      base: feature.base,
      ...(feature.from ? { from: feature.from } : {}),
      created: feature.created,
      planFirst: feature.planFirst,
      brief: feature.brief,
      worktree: { path: feature.worktree, exists: existsSync(feature.worktree) },
      tip,
      ahead,
      merged,
      agent: agentState(feature, sessions, ahead, real),
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

  /** Starts the feature's agent and records how that went; the prompt it was given. */
  async function launch(
    where: ReviewPlace,
    feature: FeatureFile,
    agent: ClaudeCode | null,
    permissionMode: PermissionMode,
  ): Promise<string> {
    const refs = await listRefs(repo);
    const prompt = featurePrompt(feature, {
      record: featurePath(featuresDir(where), feature.branch),
      reviews: join(where.dir, ...feature.branch.split('/')),
      agents: where.agents,
      into: await defaultBranch(repo, refs),
    });
    if (!agent) {
      feature.agent = null;
    } else {
      const result = await agent.start({
        cwd: feature.worktree,
        name: feature.branch,
        prompt,
        permissionMode,
        addDir: cprFolder(where),
      });
      feature.agent = result.ok
        ? { kind: 'claude', permissionMode, started: now().toISOString() }
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
    return { feature: await summary(feature, refs, await trunkOf(refs), sessions), prompt };
  }

  return {
    async options() {
      const [refs, agent] = await Promise.all([listRefs(repo), claude()]);
      const where = await place();
      const { branchPrefix, worktrees, permissionMode } = config();
      const apiKey = Boolean(env.ANTHROPIC_API_KEY);
      const account = agent ? await agent.account() : undefined;
      return {
        base: await featureBase(repo, refs),
        branchPrefix,
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
      const list = await records(where);
      const head = { place: where.place, ...(where.note ? { note: where.note } : {}) };
      if (list.length === 0) return { features: [], ...head };
      const refs = await listRefs(repo);
      const trunk = await trunkOf(refs);
      const agent = list.some((f) => f.agent) ? await claude() : null;
      const sessions = agent ? await agent.sessions() : null;
      const summaries: FeatureSummary[] = [];
      for (const feature of list) summaries.push(await summary(feature, refs, trunk, sessions));
      return { features: summaries, ...head };
    },

    async start(request) {
      const brief = request.brief.trim();
      if (brief === '') throw new FeatureRefused('a feature needs a brief: what to build', 400);
      if (request.brief.length > MAX_BRIEF) {
        throw new FeatureRefused('a brief is at most 20,000 characters', 400);
      }
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
        brief: request.brief,
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
      const feature = await readFeature(featurePath(featuresDir(where), branch));
      if (!feature) throw new FeatureRefused(`no feature ${branch}`, 404);
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
  };
}
