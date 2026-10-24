// Scout (V35): a read-only agent in the checkout `symbiote view` runs in, one conversation per
// repository, asked from its page. Claude Code runs with read tools and Bash through Symbiote's gate
// (`scout-gate.ts`, decision 236); Codex in its read-only sandbox on its app server. Its record is
// `symbiote/scout.json`: the session's ID, by which it is found (never by its folder, where the
// person's own sessions run too, decision 239). Scribe (V41, `scribe.ts`) is the same conversation
// with its own name, tools, gate and prompt (`pageAgent`).
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_KINDS,
  EFFORT_LEVEL,
  MODEL_ID,
  type AgentEfforts,
  type AgentKind,
  type AgentModels,
  type DefaultModel,
  type GitRepo,
  type ScoutAgent,
  type ScoutAsk,
  type ScoutConversation,
  type ScoutEffortChange,
  type ScoutEfforts,
  type ScoutModelChange,
  type ScoutState,
  type ScoutStateName,
  type ScoutTerminalRequest,
  type WorkspaceTerminalOpened,
} from '@symbiote/core';
import { AppServerStartFailed, type CodexServer } from './app-server.js';
import { asksTrust, type Codex } from './codex.js';
import { fillPrompt, PromptRefused, readPrompts, writeConfig } from './prompts.js';
import { prepareSymbioteFolder, reviewPlace, type ReviewPlace } from './reviews.js';
import { TerminalRefused, type Terminals } from './terminal.js';
import {
  effortOnProblem,
  effortWordProblem,
  levelsOn,
  modelProblem,
  modelWordProblem,
  readWorkspaceConfig,
  shellWord,
  type AgentSession,
  type ClaudeCode,
} from './workspaces.js';

/** The name Scout's session and thread are given: how a new one is told from the person's. */
export const SCOUT_NAME = 'Scout';

/** The record's first key: what it is, for anyone who opens it. */
export const SCOUT_ABOUT =
  "Scout's conversation in this checkout (V35): a read-only agent started in Symbiote. Not a workspace.";

/** Longest question: it goes on Claude Code's command line with Scout's prompt (8,000 at most). */
export const MAX_QUESTION = 20_000;

/** What makes a page's agent Scout or Scribe (V41): its name, record, tools, gate and prompt. */
export interface PageAgentSpec {
  /** Its session's and thread's name, and how it speaks of itself. */
  name: string;
  /** Its record's first key. */
  about: string;
  /** Its record and its settings file, in `symbiote/`. */
  record: string;
  settings: string;
  /** Claude Code's tools and mode for it. */
  tools: readonly string[];
  permissionMode: 'dontAsk' | 'default';
  /** What its gate is given after its script: Scribe's, the skills' folder. */
  gateArgs(root: string): string[];
  /** Claude Code's settings besides the gate (Scribe: its edits in the checkout). */
  claudeSettings?: Readonly<Record<string, unknown>>;
  /** Its first prompt: the project's text, the person's words in it. */
  prompt(root: string, text: string): string;
  /**
   * Where Codex's thread runs: in the checkout read-only (Scout), or writing in that folder and
   * nowhere else (Scribe, its skills; decision 275).
   */
  codex(root: string): { cwd: string; writes: boolean };
  /** Made before a start: Scribe's skills folder. */
  prepare?(root: string): Promise<void>;
  /** The project's level in its config (`scout.effort`), and where it is set. */
  effort?: { read(root: string): string | undefined; key: readonly string[] };
  /** The project's model in its config (`scout.model`, `scribe.model`, V47), and where it is set. */
  model: { read(root: string): string | undefined; key: readonly string[] };
}

/** Scout's: read-only in the checkout, `prompts.scout`, `scout.effort`. */
const SCOUT: PageAgentSpec = {
  name: SCOUT_NAME,
  about: SCOUT_ABOUT,
  record: 'scout.json',
  settings: 'scout-settings.json',
  tools: ['Read', 'Grep', 'Glob', 'Bash'],
  permissionMode: 'dontAsk',
  gateArgs: () => [],
  prompt: (root, text) => fillPrompt(readPrompts(root).text.scout, { question: text }),
  codex: (root) => ({ cwd: root, writes: false }),
  effort: { read: (root) => readWorkspaceConfig(root).scoutEffort, key: ['scout', 'effort'] },
  model: { read: (root) => readWorkspaceConfig(root).scoutModel, key: ['scout', 'model'] },
};

/** `symbiote/scout.json`, or a page agent's record. */
interface ScoutRecord {
  about: string;
  agent: AgentKind;
  /** Claude Code: the session's ID (`claude attach`) and its session ID (`--resume`). */
  id?: string;
  sessionId?: string;
  /** Codex: its thread on the app server. */
  thread?: string;
  /** The effort level it started at; absent: the agent's own. */
  effort?: string;
  /** The model it started on (V47): the project's; absent: its default. */
  model?: string;
  started: string;
}

/** A question Scout cannot take, or a conversation it cannot act on: its status and why. */
export class ScoutRefused extends Error {
  override name = 'ScoutRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502,
  ) {
    super(message);
  }
}

/** What the server needs of Scout, or of Scribe (V41). */
export interface Scout {
  state(): Promise<ScoutState>;
  /** Starts a conversation with the question, or continues the one there is. */
  ask(request: ScoutAsk): Promise<ScoutState>;
  /** Ends the conversation: its session stopped and removed (Codex: archived), the record gone. */
  renew(): Promise<ScoutState>;
  /** Opens the conversation in a terminal (V21): `claude attach`, or Codex's TUI on its thread. */
  terminal(request: ScoutTerminalRequest): Promise<WorkspaceTerminalOpened>;
  /** Each agent's levels and the project's (`scout.effort`); Codex's start its daemon. */
  efforts(): Promise<ScoutEfforts>;
  /** Sets the project's level in its config (null removes it), one Scout's default agent lists. */
  setEffort(change: ScoutEffortChange): Promise<ScoutEfforts>;
  /**
   * Sets the project's model in its config (V47, `scout.model`; null removes it), one Scout's
   * default agent lists.
   */
  setModel(change: ScoutModelChange): Promise<ScoutEfforts>;
}

/**
 * Scout's settings file for Claude Code: the gate before every tool, and nothing else — no hook
 * records its thread (decision 238).
 */
export function scoutSettings(
  where: { node: string; gate: string; args?: readonly string[] },
  platform: NodeJS.Platform = process.platform,
  more: Readonly<Record<string, unknown>> = {},
): string {
  const command = [where.node, where.gate, ...(where.args ?? [])]
    .map((p) => shellWord(p, platform))
    .join(' ');
  const hooks = {
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 30 }] }],
  };
  return `${JSON.stringify({ ...more, hooks }, null, 2)}\n`;
}

/**
 * The session a start made: the background session named Scout (or `name`) in the checkout that
 * `before` did not list (the newest, if two were). `--bg`'s own text is not read (V18).
 */
export function newScoutSession(
  before: readonly AgentSession[],
  after: readonly AgentSession[],
  root: string,
  real: (path: string) => string,
  name = SCOUT_NAME,
): AgentSession | undefined {
  const known = new Set(before.map((s) => s.id));
  const folder = real(root);
  return after
    .filter(
      (s) =>
        s.kind === 'background' &&
        s.name === name &&
        s.id !== undefined &&
        !known.has(s.id) &&
        real(s.cwd) === folder,
    )
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

/** Scout's session by its recorded ID. */
export function findScoutSession(
  record: { id?: string },
  sessions: readonly AgentSession[],
): AgentSession | undefined {
  return record.id ? sessions.find((s) => s.id === record.id) : undefined;
}

/**
 * What Claude Code says of Scout's session, in Scout's words (V35 spike: `working`/`busy` while it
 * answers, `done`/`idle` after). `working` and idle is a turn ended by Esc (V21); `working` with no
 * process, one that ended mid-turn.
 */
export function scoutState(session: AgentSession | undefined): ScoutStateName {
  if (!session) return 'gone';
  const { state, status, waitingFor } = session;
  if (status === 'busy') return 'working';
  if (state === 'failed') return 'failed';
  if (state === 'stopped') return 'stopped';
  if (state === 'working') {
    return status === 'idle' ? 'interrupted' : status === undefined ? 'stopped' : 'working';
  }
  return waitingFor ? 'needs-you' : 'answered';
}

/** Codex's thread in Scout's words. */
function threadState(status: string, waiting: string | undefined): ScoutStateName {
  if (status === 'active') return waiting ? 'needs-you' : 'working';
  if (status === 'systemError') return 'failed';
  return 'answered';
}

const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' };

/** An effort level's word (V30b): what a request may name, before the agent's list is read. */
const isLevel = (value: unknown): value is string =>
  typeof value === 'string' && EFFORT_LEVEL.test(value);

/** What a page's agent is given: its agents, its clock, its gate, its terminals. */
export interface PageAgentOptions {
  claude: () => Promise<ClaudeCode | null>;
  codex?: () => Promise<Codex | null>;
  now?: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
  /** The checkout it works in, where `symbiote/config.json` is read too. */
  root?: string;
  /** Its gate (`dist/scout-hook.js`, `dist/scribe-hook.js`) and the Node that runs it. */
  gate?: string;
  node?: string;
  terminals?: Terminals;
}

/** Scout in `repo`'s checkout, its record beside the reviews (`symbiote/`, else Symbiote's cache). */
export function scout(repo: GitRepo, cacheDir: string, options: PageAgentOptions): Scout {
  return pageAgent(SCOUT, repo, cacheDir, {
    gate: fileURLToPath(new URL('./scout-hook.js', import.meta.url)),
    ...options,
  });
}

/**
 * A page's agent (`spec`: Scout, Scribe) in `repo`'s checkout: one conversation, its record beside
 * the reviews (`symbiote/`, else Symbiote's cache).
 */
export function pageAgent(
  spec: PageAgentSpec,
  repo: GitRepo,
  cacheDir: string,
  {
    claude,
    codex = () => Promise.resolve(null),
    now = () => new Date(),
    env = process.env,
    root = repo.root,
    gate = '',
    node = process.execPath,
    terminals,
  }: PageAgentOptions,
): Scout {
  const { name } = spec;
  const codexAt = spec.codex(root);
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const place = () => reviewPlace(repo, cacheDir);
  const folder = (where: ReviewPlace) => dirname(where.dir);
  const recordPath = (where: ReviewPlace) => join(folder(where), spec.record);

  async function readRecord(where: ReviewPlace): Promise<ScoutRecord | null> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(recordPath(where), 'utf8'));
    } catch {
      return null;
    }
    const v = (value && typeof value === 'object' ? value : {}) as Partial<ScoutRecord>;
    const text = (x: unknown) => (typeof x === 'string' && x !== '' ? x : undefined);
    const started = text(v.started) ?? '';
    const level = {
      ...(isLevel(v.effort) ? { effort: v.effort } : {}),
      ...(typeof v.model === 'string' && MODEL_ID.test(v.model) ? { model: v.model } : {}),
    };
    if (v.agent === 'claude' && text(v.id)) {
      const sessionId = text(v.sessionId);
      return {
        about: spec.about,
        agent: 'claude',
        id: v.id,
        ...(sessionId ? { sessionId } : {}),
        ...level,
        started,
      };
    }
    if (v.agent === 'codex' && text(v.thread)) {
      return { about: spec.about, agent: 'codex', thread: v.thread, ...level, started };
    }
    return null;
  }

  /** Writes a file of Scout's in `symbiote/`, its `.gitignore` first: the checkout stays clean. */
  async function put(where: ReviewPlace, path: string, text: string): Promise<void> {
    await prepareSymbioteFolder(where, { agents: false });
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, text);
    await rename(temp, path);
  }

  /**
   * Scout's settings file, written when its text differs or it is gone: a session that wakes reads
   * it again, and does not start without it (V18c spike). Its path.
   */
  async function settingsFile(where: ReviewPlace): Promise<string> {
    const path = join(folder(where), spec.settings);
    const text = scoutSettings(
      { node, gate, args: spec.gateArgs(root) },
      process.platform,
      spec.claudeSettings,
    );
    if ((await readFile(path, 'utf8').catch(() => null)) !== text) await put(where, path, text);
    return path;
  }

  /** The agents installed: `agent.kind` first, else Claude Code, else Codex (decision 240). */
  async function installed(): Promise<{ kind: AgentKind; claude?: ClaudeCode; codex?: Codex }[]> {
    const first = readWorkspaceConfig(root).agent;
    const order = first ? [first, ...AGENT_KINDS.filter((k) => k !== first)] : AGENT_KINDS;
    const found: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex }[] = [];
    for (const kind of order) {
      if (kind === 'claude') {
        const agent = await claude();
        if (agent) found.push({ kind, claude: agent });
      } else {
        const agent = await codex();
        if (agent) found.push({ kind, codex: agent });
      }
    }
    return found;
  }
  const commandOf = (agent: { claude?: ClaudeCode; codex?: Codex }) =>
    agent.claude?.command ?? agent.codex?.command ?? '';

  /** The models an agent lists (V47); null unread. */
  async function modelsOf(agent: {
    claude?: ClaudeCode;
    codex?: Codex;
  }): Promise<AgentModels | null> {
    if (agent.codex) return agent.codex.models();
    const models = (await agent.claude?.models()) ?? null;
    return models ? { models } : null;
  }

  /**
   * The model a new conversation starts on (V47): the project's (`scout.model`) when its agent
   * lists it — the box may pick the other agent, whose list will not have it —, else none passed
   * (Claude Code's `agent.model`, or the agent's own).
   */
  async function modelFor(agent: {
    claude?: ClaudeCode;
    codex?: Codex;
  }): Promise<string | undefined> {
    const project = spec.model.read(root);
    if (!project) return undefined;
    return (await modelsOf(agent))?.models.some((m) => m.id === project) ? project : undefined;
  }

  /** The model an agent runs on without the project's (V47), when Symbiote knows it. */
  async function defaultModelOf(agent: {
    kind: AgentKind;
    codex?: Codex;
  }): Promise<DefaultModel | undefined> {
    if (agent.kind === 'claude') {
      const project = readWorkspaceConfig(root).model;
      return project ? { id: project, by: 'project' } : undefined;
    }
    const listed = await agent.codex?.models();
    return listed?.default ? { id: listed.default, by: 'agent' } : undefined;
  }

  /** The levels an agent takes (V30b): Claude Code's `--help`, Codex's app server; null unread. */
  async function defaultLevelsOf(agent: {
    claude?: ClaudeCode;
    codex?: Codex;
  }): Promise<AgentEfforts | null> {
    if (agent.codex) return agent.codex.efforts();
    const levels = (await agent.claude?.efforts()) ?? null;
    return levels ? { levels } : null;
  }

  /**
   * The model an agent's new conversation runs on (V47) — the project's when it lists it, else
   * Claude Code's `agent.model` — and the levels it takes there; the default's without one.
   */
  async function onModel(agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex }): Promise<{
    model: string | undefined;
    models: AgentModels | null;
    fallback: AgentEfforts | null;
  }> {
    const picked = await modelFor(agent);
    const model = picked ?? (agent.kind === 'claude' ? readWorkspaceConfig(root).model : undefined);
    return {
      model,
      models: model ? await modelsOf(agent) : null,
      fallback: await defaultLevelsOf(agent),
    };
  }

  /** The levels an agent takes on the model its new conversation would start on (V30b, V47). */
  async function levelsOf(agent: {
    kind: AgentKind;
    claude?: ClaudeCode;
    codex?: Codex;
  }): Promise<AgentEfforts | null> {
    const { model, models, fallback } = await onModel(agent);
    return levelsOn(models?.models, model, fallback);
  }

  /** Why `effort` cannot start a conversation of `agent`'s, on its model, or null. */
  async function levelProblem(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    effort: string,
  ): Promise<string | null> {
    const { model, models, fallback } = await onModel(agent);
    return effortOnProblem(effort, AGENT_NAMES[agent.kind], models?.models, model, fallback);
  }

  /**
   * The level a new conversation starts at: the one asked, if the agent lists it; none for null;
   * else the project's (`scout.effort`) when the agent lists it, its own otherwise — the project's
   * file may name another agent's level, or an older one's.
   */
  async function levelFor(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    effort: string | null | undefined,
  ): Promise<string | undefined> {
    if (effort === null) return undefined;
    if (effort === undefined) {
      const project = spec.effort?.read(root);
      if (!project) return undefined;
      return (await levelsOf(agent))?.levels.includes(project) ? project : undefined;
    }
    const problem = await levelProblem(agent, effort);
    if (problem) throw new ScoutRefused(problem, 400);
    return effort;
  }

  async function efforts(): Promise<ScoutEfforts> {
    const agents = await Promise.all(
      (await installed()).map(async (agent) => {
        const [efforts, listed, defaultModel] = await Promise.all([
          levelsOf(agent),
          modelsOf(agent),
          defaultModelOf(agent),
        ]);
        return {
          kind: agent.kind,
          ...(efforts ? { efforts } : {}),
          ...(listed ? { models: listed.models } : {}),
          ...(defaultModel ? { defaultModel } : {}),
        };
      }),
    );
    const effort = spec.effort?.read(root);
    const model = spec.model.read(root);
    return {
      agents,
      ...(effort ? { effort } : {}),
      ...(model ? { model } : {}),
      file: readPrompts(root).file,
    };
  }

  /** Codex's app server, or why Scout cannot run on it. */
  async function serverOf(agent: Codex | null): Promise<CodexServer> {
    if (!agent) throw new ScoutRefused('Codex is not installed', 409);
    const server = await agent.server();
    if (!server) {
      throw new ScoutRefused(
        `${name} runs Codex on its app server, and none runs: \`codex app-server daemon start\` started none (it needs Codex 0.163 or later). Codex's terminal joins a thread there.`,
        409,
      );
    }
    return server;
  }

  async function conversationOf(record: ScoutRecord): Promise<ScoutConversation> {
    const head = {
      kind: record.agent,
      started: record.started,
      ...(record.effort ? { effort: record.effort } : {}),
      ...(record.model ? { model: record.model } : {}),
    };
    const unknown = (error: string): ScoutConversation => ({ ...head, state: 'unknown', error });
    if (record.agent === 'claude') {
      const agent = await claude();
      if (!agent) return unknown('Claude Code is not installed');
      const sessions = await agent.sessions();
      if (!sessions) return unknown('Claude Code could not list its sessions');
      const session = findScoutSession(record, sessions);
      return { ...head, state: scoutState(session), ...(session ? { id: record.id } : {}) };
    }
    const thread = record.thread ?? '';
    try {
      const read = await (
        await serverOf(await codex())
      ).read(thread, {
        turns: 1,
        items: 'summary',
      });
      return { ...head, state: threadState(read.status, read.waiting), id: thread };
    } catch (error) {
      return unknown((error as Error).message);
    }
  }

  async function state(): Promise<ScoutState> {
    const where = await place();
    const record = await readRecord(where);
    const agents: ScoutAgent[] = (await installed()).map((a) => ({
      kind: a.kind,
      command: commandOf(a),
    }));
    if (!record) return { checkout: root, agents, conversation: null };
    const conversation = await conversationOf(record);
    const terminal = await terminals?.available();
    return { checkout: root, agents, conversation, ...(terminal ? { terminal } : {}) };
  }

  /** Starts a conversation with `text` as the question, at the level asked (`levelFor`). */
  async function start(
    where: ReviewPlace,
    text: string,
    kind: AgentKind | undefined,
    effort: string | null | undefined,
  ) {
    const agents = await installed();
    const agent = kind ? agents.find((a) => a.kind === kind) : agents[0];
    if (!agent) {
      throw new ScoutRefused(
        kind
          ? `${AGENT_NAMES[kind]} is not installed`
          : `${name} needs Claude Code or Codex: neither is installed`,
        409,
      );
    }
    const level = await levelFor(agent, effort);
    const model = await modelFor(agent);
    const at = { ...(level ? { effort: level } : {}), ...(model ? { model } : {}) };
    const prompt = spec.prompt(root, text);
    const started = now().toISOString();
    await spec.prepare?.(root);
    if (agent.claude) {
      // Copied: what Claude Code lists after the start is told from what it listed before.
      const before = [...((await agent.claude.sessions()) ?? [])];
      const settings = await settingsFile(where);
      const result = await agent.claude.startPageAgent({
        cwd: root,
        name,
        prompt,
        settings,
        tools: spec.tools,
        permissionMode: spec.permissionMode,
        ...at,
      });
      if (!result.ok) throw new ScoutRefused(result.error, 502);
      const session = newScoutSession(
        before,
        (await agent.claude.sessions()) ?? [],
        root,
        real,
        name,
      );
      if (!session?.id) {
        throw new ScoutRefused(
          `Claude Code started no session Symbiote can find: \`claude agents\` lists none named ${name} in ${root}`,
          502,
        );
      }
      const record: ScoutRecord = {
        about: spec.about,
        agent: 'claude',
        id: session.id,
        ...(session.sessionId ? { sessionId: session.sessionId } : {}),
        ...at,
        started,
      };
      await put(where, recordPath(where), `${JSON.stringify(record, null, 2)}\n`);
      return;
    }
    const codexAgent = agent.codex ?? null;
    // Not logged in, Codex fails a turn only after retrying (V20a spike).
    if ((await codexAgent?.account()) === 'not logged in') {
      throw new ScoutRefused('Codex is not logged in: run `codex login`, then ask again', 409);
    }
    const server = await serverOf(codexAgent);
    let thread: string;
    try {
      thread = await server.start({
        cwd: codexAt.cwd,
        writable: [],
        name,
        prompt,
        ...(codexAt.writes ? { confined: true as const } : { readOnly: true as const }),
        ...at,
      });
    } catch (error) {
      // A thread made before the failure goes out of Codex's lists.
      if (error instanceof AppServerStartFailed) await server.archive(error.thread).catch(() => {});
      throw new ScoutRefused(`Codex's app server: ${(error as Error).message}`, 502);
    }
    const record: ScoutRecord = { about: spec.about, agent: 'codex', thread, ...at, started };
    await put(where, recordPath(where), `${JSON.stringify(record, null, 2)}\n`);
  }

  /** Continues the conversation with `text`: where no terminal runs, the page's box does (V18c). */
  async function reply(record: ScoutRecord, text: string): Promise<void> {
    if (record.agent === 'codex') {
      await (await serverOf(await codex())).send({ thread: record.thread ?? '', text });
      return;
    }
    const agent = await claude();
    if (!agent) throw new ScoutRefused('Claude Code is not installed', 409);
    const session = findScoutSession(record, (await agent.sessions()) ?? []);
    const sessionId = record.sessionId ?? session?.sessionId;
    if (!session || !sessionId) {
      throw new ScoutRefused(`${name}'s session is gone: start a new conversation`, 409);
    }
    // A live process is stopped first: a resume of a running session makes a copy (V18c).
    const alive = session.status !== undefined;
    if (alive && (session.status !== 'idle' || session.waitingFor !== undefined)) {
      throw new ScoutRefused(
        `${name} is answering: wait for its answer, or type in its terminal`,
        409,
      );
    }
    if (alive && session.id) {
      const stopped = await agent.stop(session.id);
      if (!stopped.ok) throw new ScoutRefused(stopped.error, 409);
    }
    const resumed = await agent.resume({ sessionId, cwd: root, text });
    if (!resumed.ok) throw new ScoutRefused(resumed.error, 502);
  }

  return {
    state,

    async ask({ text, agent, effort }) {
      if (text.trim() === '') throw new ScoutRefused('a question cannot be empty', 400);
      if (text.length > MAX_QUESTION) {
        throw new ScoutRefused(
          `a question is at most ${MAX_QUESTION.toLocaleString('en-US')} characters`,
          400,
        );
      }
      if (agent !== undefined && !AGENT_KINDS.includes(agent)) {
        throw new ScoutRefused(`unknown agent: ${String(agent)}`, 400);
      }
      if (effort !== undefined && effort !== null && !isLevel(effort)) {
        throw new ScoutRefused(effortWordProblem(effort), 400);
      }
      const where = await place();
      const record = await readRecord(where);
      // A session removed outside Symbiote: the question starts a new conversation.
      const gone = record ? (await conversationOf(record)).state === 'gone' : false;
      if (!record || gone) await start(where, text, agent, effort);
      else if (agent !== undefined && agent !== record.agent) {
        throw new ScoutRefused(
          `this conversation is ${AGENT_NAMES[record.agent]}'s: start a new one for ${AGENT_NAMES[agent]}`,
          409,
        );
      } else if (effort !== undefined) {
        // Set at its start, kept by its session; `/effort` in its terminal changes it.
        throw new ScoutRefused(
          'this conversation started at its level: change it in its terminal',
          409,
        );
      } else await reply(record, text);
      return state();
    },

    async renew() {
      const where = await place();
      const record = await readRecord(where);
      if (record?.agent === 'claude') {
        const agent = await claude();
        const session = agent
          ? findScoutSession(record, (await agent.sessions()) ?? [])
          : undefined;
        if (agent && session?.id) {
          if (session.status !== undefined) await agent.stop(session.id);
          // Out of Claude Code's list; its transcript stays (`claude --resume` opens it).
          const removed = await agent.remove(session.id);
          if (!removed.ok) throw new ScoutRefused(removed.error, 409);
        }
      } else if (record?.agent === 'codex' && record.thread) {
        const agent = await codex();
        const server = agent ? await agent.server() : null;
        if (server) await server.interrupt(record.thread).catch(() => false);
        const archived = server
          ? await server.archive(record.thread).then(
              () => true,
              () => false,
            )
          : false;
        if (!archived) await agent?.archive(record.thread).catch(() => undefined);
      }
      await rm(recordPath(where), { force: true });
      return state();
    },

    efforts,

    async setEffort({ effort }) {
      if (effort !== null) {
        if (!isLevel(effort)) throw new ScoutRefused(effortWordProblem(effort), 400);
        // The level Settings offers: the default agent's.
        const agent = (await installed())[0];
        if (!agent) {
          throw new ScoutRefused(`${name} needs Claude Code or Codex: neither is installed`, 409);
        }
        const problem = await levelProblem(agent, effort);
        if (problem) throw new ScoutRefused(problem, 400);
      }
      if (!spec.effort) throw new ScoutRefused(`${name} has no level in the project's config`, 400);
      try {
        await writeConfig(root, spec.effort.key, effort ?? undefined);
      } catch (error) {
        if (error instanceof PromptRefused) throw new ScoutRefused(error.message, error.status);
        throw error;
      }
      return efforts();
    },

    async setModel({ model }) {
      if (model !== null) {
        if (typeof model !== 'string' || !MODEL_ID.test(model)) {
          throw new ScoutRefused(modelWordProblem(model), 400);
        }
        // The model Settings offers: the default agent's.
        const agent = (await installed())[0];
        if (!agent) {
          throw new ScoutRefused(`${name} needs Claude Code or Codex: neither is installed`, 409);
        }
        const problem = modelProblem(
          model,
          AGENT_NAMES[agent.kind],
          (await modelsOf(agent))?.models,
        );
        if (problem) throw new ScoutRefused(problem, 400);
      }
      try {
        await writeConfig(root, spec.model.key, model ?? undefined);
      } catch (error) {
        if (error instanceof PromptRefused) throw new ScoutRefused(error.message, error.status);
        throw error;
      }
      return efforts();
    },

    async terminal({ cols, rows }) {
      const where = await place();
      const record = await readRecord(where);
      if (!record)
        throw new ScoutRefused(`${name} has no conversation: ask it something first`, 409);
      if (!terminals) throw new ScoutRefused('no terminals here', 409);
      const can = await terminals.available();
      if (!can.available) throw new ScoutRefused(can.reason, 409);
      let command: string;
      let args: string[];
      let asks = false;
      if (record.agent === 'claude') {
        const agent = await claude();
        if (!agent) throw new ScoutRefused('Claude Code is not installed', 409);
        // A session that wakes reads its settings file again, and does not start without it.
        await settingsFile(where);
        // `attach` to an ID Claude Code does not know exits 0, saying "No job matching…".
        const session = findScoutSession(record, (await agent.sessions()) ?? []);
        if (!session?.id) {
          throw new ScoutRefused(`${name}'s session is gone: start a new conversation`, 409);
        }
        command = agent.command;
        args = ['attach', session.id];
      } else {
        const agent = await codex();
        const server = await serverOf(agent);
        command = agent?.command ?? 'codex';
        args = ['resume', record.thread ?? '', '--remote', server.address, '-C', codexAt.cwd];
        // Codex asks to trust a folder first (V27b, decision 160): said, never answered here.
        asks = await server.trust(codexAt.cwd).then(
          (entries) => asksTrust(entries, [codexAt.cwd, real(codexAt.cwd)]),
          () => false,
        );
      }
      try {
        const cwd = record.agent === 'codex' ? codexAt.cwd : root;
        const id = await terminals.open({ command, args, cwd, cols, rows, env });
        return { id, ...(asks ? { trusted: false as const } : {}) };
      } catch (error) {
        if (error instanceof TerminalRefused) throw new ScoutRefused(error.message, 409);
        throw error;
      }
    },
  };
}
