// Claude Code as Symbiote drives it (V18): its background sessions, what it lists and answers
// (sessions, effort levels, models, account), a workspace's agent read from its sessions, and
// the settings file whose hooks record a workspace's thread (V18c). Codex's is `codex.ts`.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  EFFORT_LEVEL,
  MODEL_ID,
  type AgentModel,
  type AgentStateName,
  type PermissionMode,
  type WorkspaceAgentState,
} from '@symbiote/core';
import { localHost, onPath } from './editor.js';
import { runProgram, runWithInput, type Run, type RunWithInput } from './programs.js';
import type { WorkspaceFile } from './workspace-record.js';

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

/**
 * The levels `claude --help` lists for `--effort` (V30b), in its order: the parenthesis in that
 * option's description, which runs until the next option. Null when there is no such option, or
 * its list holds anything but lowercase words: no level then rather than a wrong one, since Claude
 * Code ignores one it does not know without failing (V30 spike).
 */
export function parseEffortLevels(help: string): string[] | null {
  const lines = help.split('\n');
  const at = lines.findIndex((line) => /^\s*--effort\b/.test(line));
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  const next = rest.findIndex((line) => /^\s*-/.test(line));
  const description = [lines[at], ...(next < 0 ? rest : rest.slice(0, next))].join(' ');
  const list = /\(([^)]*)\)/.exec(description)?.[1];
  if (!list) return null;
  const levels = list.split(',').map((level) => level.trim());
  return levels.every((level) => EFFORT_LEVEL.test(level)) ? levels : null;
}

/**
 * Claude Code's models from its answer to `initialize` (V47): the `models` of its
 * `control_response`, as its SDK's `supportedModels()` reads them — each one's `value` (what
 * `--model` takes), `displayName`, `description` and `supportedEffortLevels`. Its own "default"
 * entry is left out: it is the account's recommended model, not the person's setting (V47 spike,
 * decision 337). Null when there is no such answer or no model in it; IDs that are not `MODEL_ID`s
 * and levels that are not words are left out.
 */
export function parseClaudeModels(stdout: string): AgentModel[] | null {
  for (const line of stdout.split('\n')) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const v = (value ?? {}) as { type?: unknown; response?: { response?: { models?: unknown } } };
    if (v.type !== 'control_response') continue;
    const listed = v.response?.response?.models;
    if (!Array.isArray(listed)) return null;
    const models = (listed as Record<string, unknown>[])
      .map((m): AgentModel | null => {
        const id = typeof m?.value === 'string' ? m.value : '';
        if (id === 'default' || !MODEL_ID.test(id)) return null;
        const name = typeof m.displayName === 'string' && m.displayName !== '' ? m.displayName : id;
        const description =
          typeof m.description === 'string' && m.description !== '' ? m.description : undefined;
        const levels = (
          Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels : []
        ).filter((level): level is string => typeof level === 'string' && EFFORT_LEVEL.test(level));
        return {
          id,
          name,
          ...(description ? { description } : {}),
          ...(levels.length > 0 ? { efforts: { levels } } : {}),
        };
      })
      .filter((m): m is AgentModel => m !== null);
    return models.length > 0 ? models : null;
  }
  return null;
}

/** How Claude Code is asked for its models (V47): its SDK's handshake, with no turn after it. */
const MODEL_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  // Nothing written: no transcript for a session that never takes a turn.
  '--no-session-persistence',
  // Without the person's hooks, plugins and MCP servers; settings, login and models as ever.
  '--safe-mode',
  '--strict-mcp-config',
  '--tools',
  '',
];
const INITIALIZE = `${JSON.stringify({
  type: 'control_request',
  request_id: 'symbiote-models',
  request: { subtype: 'initialize' },
})}\n`;

/** A list of models kept this long is read again, in the background (decision 340: a day). */
export const MODELS_KEPT_MS = 24 * 60 * 60_000;

/** Where Claude Code at `command` keeps its models in Symbiote's cache (V47), for every view. */
export const claudeModelsFile = (cacheDir: string, command: string): string =>
  join(
    cacheDir,
    'agents',
    `claude-models-${createHash('sha256').update(command).digest('hex').slice(0, 12)}.json`,
  );

/** Models kept in `file` and when they were read; null when there are none it can trust. */
function readKeptModels(file: string): { at: number; models: AgentModel[] } | null {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as { read?: unknown; models?: unknown };
    const at = typeof v.read === 'string' ? Date.parse(v.read) : NaN;
    // Read back as Claude Code's own answer would be: what it could not pass stays out.
    const models = parseClaudeModels(
      JSON.stringify({
        type: 'control_response',
        response: {
          response: {
            models: (Array.isArray(v.models) ? (v.models as Partial<AgentModel>[]) : []).map(
              (m) => ({
                value: m?.id,
                displayName: m?.name,
                description: m?.description,
                supportedEffortLevels: m?.efforts?.levels,
              }),
            ),
          },
        },
      }),
    );
    return Number.isFinite(at) && models ? { at, models } : null;
  } catch {
    return null;
  }
}

/**
 * Whose account Claude Code runs on, from `claude auth status`; undefined when unknown. A
 * subscription's plan is `plan`, its profile's (`readClaudeProfile`), when known: the status
 * says its token's, kept from login.
 */
export function parseAccount(text: string, plan?: string): string | undefined {
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
    const kept = typeof v.subscriptionType === 'string' ? v.subscriptionType : '';
    const name = plan ?? (kept ? `${kept.charAt(0).toUpperCase()}${kept.slice(1)}` : '');
    return name ? `your ${name} subscription` : 'your Claude subscription';
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
export const isBlocked = (session: AgentSession) =>
  ['blocked', 'waiting'].includes(session.state ?? session.status ?? '');

/**
 * What the page says of a workspace's agent: the newest session working in its worktree (matched
 * by real path), else why there is none. `ahead` (commits since the fork point) tells a finished
 * plan from finished work. `ended`: the thread says its last turn ended (V18c) — Claude Code reads
 * a finished plan as `blocked` with nothing named it waits for, so that is a finished turn. A
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

/** What Symbiote asks of Claude Code (V18); tests pass a fake. */
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
    /** Symbiote's settings file (V18c): the hooks that record the thread. */
    settings?: string;
    /** Its effort level (V30b, `--effort`): the session keeps it, through a resume too. */
    effort?: string;
    /** Its model (V47, `--model`), over the project's: the session keeps it, as its level. */
    model?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Starts a page's agent as a background session in `cwd`: Scout (V35, decision 236), read tools
   * and Bash, nothing asked (`dontAsk`); Scribe (V41, decision 275), Write and Edit too, in
   * `default`, where Claude Code asks before a write into `.claude`. Every tool through the gate in
   * `settings`, no MCP server. A wake keeps all of it (V35 spike). Without a prompt the session
   * waits for its first, typed in its terminal (V50). Its words when it does not start.
   */
  startPageAgent(request: {
    cwd: string;
    name: string;
    /** Its first message; absent, none: it waits, and no turn runs (V50 spike). */
    prompt?: string;
    /** Its instructions (V50, decision 383): appended to the system prompt, kept by a wake. */
    instructions?: string;
    /**
     * The session whose conversation it continues (`--resume`, V50, decision 384): Claude Code
     * starts a copy of it with these options, under a new ID; the original stays listed.
     */
    from?: string;
    settings: string;
    tools: readonly string[];
    permissionMode: 'dontAsk' | 'default';
    /** Its MCP servers' file (`--mcp-config`, MC1): Scout's, Symbiote's; none otherwise. */
    mcpConfig?: string;
    /** Its effort level (`--effort`), kept as a workspace's is. */
    effort?: string;
    /** Its model (V47, `--model`), over the project's. */
    model?: string;
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
  /** Removes a background session (`claude rm <id>`); a worktree Symbiote made stays. */
  remove(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Whose account it runs on. */
  account(): Promise<string | undefined>;
  /** The effort levels its `--help` lists (V30b); null when it lists none Symbiote can read. */
  efforts(): Promise<string[] | null>;
  /**
   * The models it lists (V47), in its order, from its answer to `initialize`; null when Symbiote
   * has none and cannot read them.
   */
  models(): Promise<AgentModel[] | null>;
}

/**
 * Claude Code at `command`. Sessions are asked for at most every 2 s (`claude agents --json`
 * takes 150 ms), the account every minute, with `plan`, its profile's, when given; its effort
 * levels once (`--help`, 70–90 ms). Its models (1.2 s to read, V47 spike) are kept in
 * `modelsFile` for every view on the machine, and read again in the background once a day
 * (decision 340); a use waits for the read only when none is kept.
 */
export function claudeCode(
  command: string,
  {
    run = runProgram,
    runInput = runWithInput,
    cwd,
    model,
    plan,
    modelsFile,
    now = Date.now,
  }: {
    run?: Run;
    runInput?: RunWithInput;
    cwd: string;
    /** The project's model (`agent.model`), for a start that picks none. */
    model?: string;
    plan?: () => Promise<string | undefined>;
    modelsFile?: string;
    now?: () => number;
  },
): ClaudeCode {
  let sessions: { at: number; list: Promise<AgentSession[] | null> } | null = null;
  let account: { at: number; text: Promise<string | undefined> } | null = null;
  let efforts: Promise<string[] | null> | null = null;
  let kept: { at: number; models: AgentModel[] } | null = null;
  let reading: Promise<AgentModel[] | null> | null = null;
  /** Asks Claude Code, one read at a time; keeps what it answers. A failure keeps the old list. */
  const readModels = () => {
    reading ??= runInput(command, MODEL_ARGS, { cwd, input: INITIALIZE, timeoutMs: 20_000 })
      .then((result) => parseClaudeModels(result.stdout))
      .catch(() => null)
      .then(async (models) => {
        if (models) {
          kept = { at: now(), models };
          if (modelsFile) {
            const text = JSON.stringify(
              {
                about: `Claude Code's models (${command}), as it lists them: Symbiote reads them again once a day (V47).`,
                read: new Date(kept.at).toISOString(),
                models,
              },
              null,
              2,
            );
            await mkdir(dirname(modelsFile), { recursive: true })
              .then(() => writeFile(`${modelsFile}.${process.pid}.tmp`, `${text}\n`))
              .then(() => rename(`${modelsFile}.${process.pid}.tmp`, modelsFile))
              .catch(() => undefined);
          }
        }
        reading = null;
        return models ?? kept?.models ?? null;
      });
    return reading;
  };
  const fresh = (list: typeof kept) => list !== null && now() - list.at < MODELS_KEPT_MS;
  const choose = (...args: (string | undefined)[]) => {
    const picked = args.find((value) => value !== undefined);
    return picked ? ['--model', picked] : [];
  };
  return {
    command,
    efforts() {
      efforts ??= run(command, ['--help'], { cwd, timeoutMs: 20_000 })
        .then((result) => (result.code === 0 ? parseEffortLevels(result.stdout) : null))
        .catch(() => null);
      return efforts;
    },
    models() {
      // Another view may have read them since: the file first, when the list in hand is old.
      if (!fresh(kept) && modelsFile) {
        const onDisk = readKeptModels(modelsFile);
        if (onDisk && (!kept || onDisk.at > kept.at)) kept = onDisk;
      }
      if (!kept) return readModels();
      if (!fresh(kept)) void readModels();
      return Promise.resolve(kept.models);
    },
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
        ...choose(request.model, model),
        ...(request.effort ? ['--effort', request.effort] : []),
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
    async startPageAgent(request) {
      const args = [
        '--bg',
        ...(request.from ? ['--resume', request.from] : []),
        '--name',
        request.name,
        '--tools',
        request.tools.join(','),
        '--permission-mode',
        request.permissionMode,
        '--strict-mcp-config',
        ...(request.mcpConfig ? ['--mcp-config', request.mcpConfig] : []),
        '--settings',
        request.settings,
        ...choose(request.model, model),
        ...(request.effort ? ['--effort', request.effort] : []),
        ...(request.instructions ? ['--append-system-prompt', request.instructions] : []),
        ...(request.prompt === undefined ? [] : [request.prompt]),
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
        const text = Promise.all([
          run(command, ['auth', 'status'], { cwd, timeoutMs: 20_000 }),
          plan?.(),
        ]).then(([result, name]) => parseAccount(result.stdout, name));
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

/** Claude Code's program: `SYMBIOTE_CLAUDE` (a path or a command on PATH), else `claude` on PATH.
 * */
export async function findClaude(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const host = localHost(env);
  const custom = env.SYMBIOTE_CLAUDE?.trim();
  if (custom) {
    if (/[\\/]/.test(custom)) return (await host.isFile(custom)) ? custom : null;
    return onPath(host, custom);
  }
  return onPath(host, 'claude');
}

/** The hooks Symbiote passes to every workspace's agent (V18c): each event, recorded by
 * `agent-hook.js`. */
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
export function shellWord(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `"${path}"` : `'${path.replaceAll("'", "'\\''")}'`;
}

/**
 * Symbiote's settings file for its agents (V18c), `<symbiote>/claude-settings.json`: every event
 * runs
 * `agent-hook.js` with the `symbiote/` folder; `PreToolUse` only for questions. It decides nothing.
 */
export function agentSettings(
  where: { node: string; hook: string; symbiote: string },
  platform: NodeJS.Platform = process.platform,
): string {
  const command = [where.node, where.hook, where.symbiote]
    .map((p) => shellWord(p, platform))
    .join(' ');
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
