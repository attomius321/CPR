// Scout (V35): a read-only agent in the checkout `symbiote view` runs in, one conversation per
// repository, asked from its page. Claude Code runs with read tools and Bash through Symbiote's gate
// (`scout-gate.ts`, decision 236); Codex in its read-only sandbox on its app server. Its record is
// `symbiote/scout.json`: the session's ID, by which it is found (never by its folder, where the
// person's own sessions run too, decision 239).
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_KINDS,
  type AgentKind,
  type GitRepo,
  type ScoutAgent,
  type ScoutAsk,
  type ScoutConversation,
  type ScoutState,
  type ScoutStateName,
  type ScoutTerminalRequest,
  type WorkspaceTerminalOpened,
} from '@symbiote/core';
import { AppServerStartFailed, type CodexServer } from './app-server.js';
import { asksTrust, type Codex } from './codex.js';
import { fillPrompt, readPrompts } from './prompts.js';
import { prepareSymbioteFolder, reviewPlace, type ReviewPlace } from './reviews.js';
import { TerminalRefused, type Terminals } from './terminal.js';
import {
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

/** `symbiote/scout.json`. */
interface ScoutRecord {
  about: string;
  agent: AgentKind;
  /** Claude Code: the session's ID (`claude attach`) and its session ID (`--resume`). */
  id?: string;
  sessionId?: string;
  /** Codex: its thread on the app server. */
  thread?: string;
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

/** What the server needs of Scout. */
export interface Scout {
  state(): Promise<ScoutState>;
  /** Starts a conversation with the question, or continues the one there is. */
  ask(request: ScoutAsk): Promise<ScoutState>;
  /** Ends the conversation: its session stopped and removed (Codex: archived), the record gone. */
  renew(): Promise<ScoutState>;
  /** Opens the conversation in a terminal (V21): `claude attach`, or Codex's TUI on its thread. */
  terminal(request: ScoutTerminalRequest): Promise<WorkspaceTerminalOpened>;
}

/**
 * Scout's settings file for Claude Code: the gate before every tool, and nothing else — no hook
 * records its thread (decision 238).
 */
export function scoutSettings(
  where: { node: string; gate: string },
  platform: NodeJS.Platform = process.platform,
): string {
  const command = [where.node, where.gate].map((p) => shellWord(p, platform)).join(' ');
  const hooks = {
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 30 }] }],
  };
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

/**
 * The session a start made: the background session named Scout in the checkout that `before` did
 * not list (the newest, if two were). `--bg`'s own text is not read (V18).
 */
export function newScoutSession(
  before: readonly AgentSession[],
  after: readonly AgentSession[],
  root: string,
  real: (path: string) => string,
): AgentSession | undefined {
  const known = new Set(before.map((s) => s.id));
  const folder = real(root);
  return after
    .filter(
      (s) =>
        s.kind === 'background' &&
        s.name === SCOUT_NAME &&
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

/** Scout in `repo`'s checkout, its record beside the reviews (`symbiote/`, else Symbiote's cache). */
export function scout(
  repo: GitRepo,
  cacheDir: string,
  {
    claude,
    codex = () => Promise.resolve(null),
    now = () => new Date(),
    env = process.env,
    root = repo.root,
    gate = fileURLToPath(new URL('./scout-hook.js', import.meta.url)),
    node = process.execPath,
    terminals,
  }: {
    claude: () => Promise<ClaudeCode | null>;
    codex?: () => Promise<Codex | null>;
    now?: () => Date;
    env?: Readonly<Record<string, string | undefined>>;
    /** The checkout Scout reads, where `symbiote/config.json` is read too. */
    root?: string;
    /** Scout's gate (`dist/scout-hook.js`) and the Node that runs it. */
    gate?: string;
    node?: string;
    terminals?: Terminals;
  },
): Scout {
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const place = () => reviewPlace(repo, cacheDir);
  const folder = (where: ReviewPlace) => dirname(where.dir);
  const recordPath = (where: ReviewPlace) => join(folder(where), 'scout.json');

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
    if (v.agent === 'claude' && text(v.id)) {
      const sessionId = text(v.sessionId);
      return {
        about: SCOUT_ABOUT,
        agent: 'claude',
        id: v.id,
        ...(sessionId ? { sessionId } : {}),
        started,
      };
    }
    if (v.agent === 'codex' && text(v.thread)) {
      return { about: SCOUT_ABOUT, agent: 'codex', thread: v.thread, started };
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
    const path = join(folder(where), 'scout-settings.json');
    const text = scoutSettings({ node, gate });
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

  /** Codex's app server, or why Scout cannot run on it. */
  async function serverOf(agent: Codex | null): Promise<CodexServer> {
    if (!agent) throw new ScoutRefused('Codex is not installed', 409);
    const server = await agent.server();
    if (!server) {
      throw new ScoutRefused(
        "Scout runs Codex on its app server, and none runs: `codex app-server daemon start` started none (it needs Codex 0.163 or later). Codex's terminal joins a thread there.",
        409,
      );
    }
    return server;
  }

  async function conversationOf(record: ScoutRecord): Promise<ScoutConversation> {
    const head = { kind: record.agent, started: record.started };
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

  /** Starts a conversation with `text` as the question. */
  async function start(where: ReviewPlace, text: string, kind: AgentKind | undefined) {
    const agents = await installed();
    const agent = kind ? agents.find((a) => a.kind === kind) : agents[0];
    if (!agent) {
      throw new ScoutRefused(
        kind
          ? `${AGENT_NAMES[kind]} is not installed`
          : 'Scout needs Claude Code or Codex: neither is installed',
        409,
      );
    }
    const prompt = fillPrompt(readPrompts(root).text.scout, { question: text });
    const started = now().toISOString();
    if (agent.claude) {
      // Copied: what Claude Code lists after the start is told from what it listed before.
      const before = [...((await agent.claude.sessions()) ?? [])];
      const settings = await settingsFile(where);
      const result = await agent.claude.startReadOnly({
        cwd: root,
        name: SCOUT_NAME,
        prompt,
        settings,
      });
      if (!result.ok) throw new ScoutRefused(result.error, 502);
      const session = newScoutSession(before, (await agent.claude.sessions()) ?? [], root, real);
      if (!session?.id) {
        throw new ScoutRefused(
          `Claude Code started no session Symbiote can find: \`claude agents\` lists none named ${SCOUT_NAME} in ${root}`,
          502,
        );
      }
      const record: ScoutRecord = {
        about: SCOUT_ABOUT,
        agent: 'claude',
        id: session.id,
        ...(session.sessionId ? { sessionId: session.sessionId } : {}),
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
        cwd: root,
        writable: [],
        name: SCOUT_NAME,
        prompt,
        readOnly: true,
      });
    } catch (error) {
      // A thread made before the failure goes out of Codex's lists.
      if (error instanceof AppServerStartFailed) await server.archive(error.thread).catch(() => {});
      throw new ScoutRefused(`Codex's app server: ${(error as Error).message}`, 502);
    }
    const record: ScoutRecord = { about: SCOUT_ABOUT, agent: 'codex', thread, started };
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
      throw new ScoutRefused("Scout's session is gone: start a new conversation", 409);
    }
    // A live process is stopped first: a resume of a running session makes a copy (V18c).
    const alive = session.status !== undefined;
    if (alive && (session.status !== 'idle' || session.waitingFor !== undefined)) {
      throw new ScoutRefused(
        'Scout is answering: wait for its answer, or type in its terminal',
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

    async ask({ text, agent }) {
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
      const where = await place();
      const record = await readRecord(where);
      // A session removed outside Symbiote: the question starts a new conversation.
      const gone = record ? (await conversationOf(record)).state === 'gone' : false;
      if (!record || gone) await start(where, text, agent);
      else if (agent !== undefined && agent !== record.agent) {
        throw new ScoutRefused(
          `this conversation is ${AGENT_NAMES[record.agent]}'s: start a new one for ${AGENT_NAMES[agent]}`,
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

    async terminal({ cols, rows }) {
      const where = await place();
      const record = await readRecord(where);
      if (!record) throw new ScoutRefused('Scout has no conversation: ask it something first', 409);
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
          throw new ScoutRefused("Scout's session is gone: start a new conversation", 409);
        }
        command = agent.command;
        args = ['attach', session.id];
      } else {
        const agent = await codex();
        const server = await serverOf(agent);
        command = agent?.command ?? 'codex';
        args = ['resume', record.thread ?? '', '--remote', server.address, '-C', root];
        // Codex asks to trust a folder first (V27b, decision 160): said, never answered here.
        asks = await server.trust(root).then(
          (entries) => asksTrust(entries, [root, real(root)]),
          () => false,
        );
      }
      try {
        const id = await terminals.open({ command, args, cwd: root, cols, rows, env });
        return { id, ...(asks ? { trusted: false as const } : {}) };
      } catch (error) {
        if (error instanceof TerminalRefused) throw new ScoutRefused(error.message, 409);
        throw error;
      }
    },
  };
}
