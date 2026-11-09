// A page agent's conversation (V35, V41, V50): its state, started on Claude Code or Codex, a
// message sent, its session or thread found again.
import type {
  AgentKind,
  InstalledAgent,
  PageAgentConversation,
  PageAgentState,
  PageAgentStateName,
} from '@symbiote/core';
import { AppServerError, AppServerStartFailed, type CodexServer } from './app-server.js';
import { codexFolders, type Codex } from './codex.js';
import type { ReviewPlace } from './reviews.js';
import { real } from './thread.js';
import type { AgentSession, ClaudeCode } from './claude-code.js';
import { AGENT_NAMES } from './agent-levels.js';
import {
  type PageAgentRecord,
  type ReadRecord,
  type PageAgentContext,
  PageAgentRefused,
} from './page-agent-context.js';
import { commandOf, checkModel, type PageAgentLevels } from './page-agent-levels.js';
import { put, type PageAgentFiles } from './page-agent-files.js';

/**
 * The session a start made: the background session named `name` in the checkout that
 * `before` did not list (the newest, if two were). `--bg`'s own text is not read (V18).
 */
export function newPageAgentSession(
  before: readonly AgentSession[],
  after: readonly AgentSession[],
  root: string,
  real: (path: string) => string,
  name: string,
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

/** A page agent's session by its recorded ID. */
export function findPageAgentSession(
  record: { id?: string },
  sessions: readonly AgentSession[],
): AgentSession | undefined {
  return record.id ? sessions.find((s) => s.id === record.id) : undefined;
}

/**
 * What Claude Code says of Nucleus's session, in Nucleus's words (V35 spike: `working`/`busy` while it
 * answers, `done`/`idle` after). `working` and idle is a turn ended by Esc (V21); `working` with no
 * process, one that ended mid-turn.
 */
export function pageAgentState(session: AgentSession | undefined): PageAgentStateName {
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

/** Codex's thread in Nucleus's words: one with no turn was opened and asked nothing yet (V50). */
function threadState(
  status: string,
  waiting: string | undefined,
  turns: number,
): PageAgentStateName {
  if (status === 'active') return waiting ? 'needs-you' : 'working';
  if (status === 'systemError') return 'failed';
  return turns === 0 ? 'ready' : 'answered';
}

/** The page agent's conversation. */
export function pageAgentConversation(
  {
    called,
    claude,
    codex,
    codexAt,
    codexTools,
    name,
    now,
    ofRecord,
    place,
    recordPath,
    root,
    spec,
    terminals,
    write,
  }: Pick<
    PageAgentContext,
    | 'called'
    | 'claude'
    | 'codex'
    | 'codexAt'
    | 'codexTools'
    | 'name'
    | 'now'
    | 'ofRecord'
    | 'place'
    | 'recordPath'
    | 'root'
    | 'spec'
    | 'terminals'
    | 'write'
  >,
  {
    installed,
    levelFor,
    modelFor,
    asked,
    mcpFile,
    readRecord,
    settingsFile,
    watchCodex,
  }: Pick<PageAgentLevels, 'installed' | 'levelFor' | 'modelFor'> &
    Pick<PageAgentFiles, 'asked' | 'mcpFile' | 'readRecord' | 'settingsFile'> & {
      watchCodex: (where: ReviewPlace, thread: string, status: string, updatedAt: number) => void;
    },
) {
  /** Codex's app server, or why Nucleus cannot run on it. */
  async function serverOf(agent: Codex | null): Promise<CodexServer> {
    if (!agent) throw new PageAgentRefused('Codex is not installed', 409);
    const server = await agent.server();
    if (!server) {
      throw new PageAgentRefused(
        `${await called()} runs Codex on its app server, and none runs: \`codex app-server daemon start\` started none (it needs Codex 0.163 or later). Codex's terminal joins a thread there.`,
        409,
      );
    }
    return server;
  }

  /** What the conversation is doing; `where` given, a fresh one seen at a turn is recorded so. */
  async function conversationOf(
    record: ReadRecord,
    where?: ReviewPlace,
  ): Promise<PageAgentConversation> {
    const head = {
      kind: record.agent,
      started: record.started,
      ...(record.effort ? { effort: record.effort } : {}),
      ...(record.model ? { model: record.model } : {}),
      ...(record.former && spec.former ? { startedAs: spec.former.name } : {}),
      ...(record.name ? { name: record.name } : {}),
    };
    const unknown = (error: string): PageAgentConversation => ({
      ...head,
      state: 'unknown',
      error,
    });
    if (record.agent === 'claude') {
      const agent = await claude();
      if (!agent) return unknown('Claude Code is not installed');
      const sessions = await agent.sessions();
      if (!sessions) return unknown('Claude Code could not list its sessions');
      const session = findPageAgentSession(record, sessions);
      let state = pageAgentState(session);
      if (record.fresh && session) {
        // Asked nothing yet: `blocked` and idle as Claude Code starts it with no prompt (V50).
        const waits = session.state === 'blocked' && session.status === 'idle';
        if (waits && !session.waitingFor) state = 'ready';
        else if (where && !['stopped', 'failed'].includes(state)) await asked(where, record);
      }
      return { ...head, state, ...(session ? { id: record.id } : {}) };
    }
    const thread = record.thread ?? '';
    try {
      const read = await (
        await serverOf(await codex())
      ).read(thread, {
        turns: 1,
        items: 'summary',
      });
      if (where) watchCodex(where, thread, read.status, read.updatedAt);
      return {
        ...head,
        state: threadState(read.status, read.waiting, read.turns.length),
        id: thread,
      };
    } catch (error) {
      return unknown((error as Error).message);
    }
  }

  async function state(): Promise<PageAgentState> {
    const where = await place();
    const record = await readRecord(where);
    const agents: InstalledAgent[] = (await installed()).map((a) => ({
      kind: a.kind,
      command: commandOf(a),
    }));
    const terminal = await terminals?.available();
    const conversation = record ? await conversationOf(record, where) : null;
    return { checkout: root, agents, conversation, ...(terminal ? { terminal } : {}) };
  }

  /**
   * Starts Claude Code's session, and finds the one it made: the new background session named
   * `name` in the checkout (decision 239).
   */
  async function claudeStart(
    where: ReviewPlace,
    agent: ClaudeCode,
    request: { prompt?: string; effort?: string; model?: string },
    as: string,
  ): Promise<AgentSession & { id: string }> {
    // Copied: what Claude Code lists after the start is told from what it listed before.
    const before = [...((await agent.sessions()) ?? [])];
    const settings = await settingsFile(where, as);
    const mcpConfig = await mcpFile(where);
    const instructions = spec.instructions?.(root, as);
    const addDirs = spec.folders?.(root) ?? [];
    const result = await agent.startPageAgent({
      cwd: root,
      name,
      ...request,
      ...(instructions ? { instructions } : {}),
      settings,
      ...(mcpConfig ? { mcpConfig } : {}),
      ...(addDirs.length > 0 ? { addDirs } : {}),
      tools: spec.tools(root),
      permissionMode: spec.permissionMode,
    });
    if (!result.ok) throw new PageAgentRefused(result.error, 502);
    const session = newPageAgentSession(before, (await agent.sessions()) ?? [], root, real, name);
    if (!session?.id) {
      throw new PageAgentRefused(
        `Claude Code started no session Symbiote can find: \`claude agents\` lists none named ${name} in ${root}`,
        502,
      );
    }
    return { ...session, id: session.id };
  }

  /** How Codex's thread is sandboxed: read-only (Nucleus), or writing in its folder (Scribe). */
  const codexSandbox = () =>
    codexAt.writes ? { confined: true as const } : { readOnly: true as const };

  /**
   * The folders Codex's thread reads now (V80): Codex's program's and the spec's, read again at
   * each start, message and load; none for a spec without (Codex's read-only mode).
   */
  const readsOf = (where: ReviewPlace, agent: Codex | null) =>
    spec.codexReads
      ? { reads: [...codexFolders(agent?.command ?? ''), ...spec.codexReads(root, where)] }
      : {};

  /**
   * Starts a conversation with `text` as the question (none: it waits for one, V50), at the level
   * asked (`levelFor`), on the model asked (`asked`; absent: the project's).
   */
  async function start(
    where: ReviewPlace,
    text: string | undefined,
    kind: AgentKind | undefined,
    effort: string | null | undefined,
    asked?: string | null,
  ) {
    const agents = await installed();
    const agent = kind ? agents.find((a) => a.kind === kind) : agents[0];
    if (!agent) {
      throw new PageAgentRefused(
        kind
          ? `${AGENT_NAMES[kind]} is not installed`
          : `${await called()} needs Claude Code or Codex: neither is installed`,
        409,
      );
    }
    await checkModel(agent, asked);
    const level = await levelFor(agent, effort, asked);
    const model = asked === undefined ? await modelFor(agent) : (asked ?? undefined);
    const at = { ...(level ? { effort: level } : {}), ...(model ? { model } : {}) };
    const first = text === undefined ? {} : { prompt: spec.prompt(root, text) };
    // Its name for this conversation, kept in its record when not its own (decision 686).
    const as = await called();
    const named = as === name ? {} : { name: as };
    const instructions = spec.instructions?.(root, as);
    const config = codexTools();
    const started = now().toISOString();
    await spec.prepare?.(root);
    if (agent.claude) {
      const session = await claudeStart(where, agent.claude, { ...first, ...at }, as);
      const record: PageAgentRecord = {
        about: spec.about,
        agent: 'claude',
        ...named,
        id: session.id,
        ...(session.sessionId ? { sessionId: session.sessionId } : {}),
        ...at,
        ...(text === undefined ? { fresh: true as const } : {}),
        started,
      };
      await put(where, recordPath(where), `${JSON.stringify(record, null, 2)}\n`);
      await write([{ at: started, ...ofRecord(record), kind: 'opened', ...at }]);
      return;
    }
    const codexAgent = agent.codex ?? null;
    // Not logged in, Codex fails a turn only after retrying (V20a spike).
    if ((await codexAgent?.account()) === 'not logged in') {
      throw new PageAgentRefused('Codex is not logged in: run `codex login`, then ask again', 409);
    }
    const server = await serverOf(codexAgent);
    let thread: string;
    try {
      thread = await server.start({
        cwd: codexAt.cwd,
        writable: codexAt.writes ? (spec.folders?.(root) ?? []) : [],
        name,
        ...first,
        ...(instructions ? { instructions } : {}),
        ...codexSandbox(),
        ...readsOf(where, codexAgent),
        ...(config ? { config } : {}),
        ...at,
      });
    } catch (error) {
      // A thread made before the failure goes out of Codex's lists.
      if (error instanceof AppServerStartFailed) await server.archive(error.thread).catch(() => {});
      throw new PageAgentRefused(`Codex's app server: ${(error as Error).message}`, 502);
    }
    const record: PageAgentRecord = {
      about: spec.about,
      agent: 'codex',
      ...named,
      thread,
      ...at,
      started,
    };
    await put(where, recordPath(where), `${JSON.stringify(record, null, 2)}\n`);
    await write([{ at: started, ...ofRecord(record), kind: 'opened', ...at }]);
  }

  /** Continues the conversation with `text`: where no terminal runs, the page's box does (V18c). */
  async function reply(where: ReviewPlace, record: ReadRecord, text: string): Promise<void> {
    if (record.agent === 'codex') {
      const config = codexTools();
      const agent = await codex();
      try {
        await (
          await serverOf(agent)
        ).send({
          thread: record.thread ?? '',
          text,
          ...(config ? { config } : {}),
          ...readsOf(where, agent),
        });
      } catch (error) {
        if (error instanceof AppServerError) {
          throw new PageAgentRefused(`Codex's app server: ${error.message}`, 502);
        }
        throw error;
      }
      return;
    }
    const agent = await claude();
    if (!agent) throw new PageAgentRefused('Claude Code is not installed', 409);
    const session = findPageAgentSession(record, (await agent.sessions()) ?? []);
    const sessionId = record.sessionId ?? session?.sessionId;
    if (!session || !sessionId) {
      throw new PageAgentRefused(
        `${await called()}'s session is gone: start a new conversation`,
        409,
      );
    }
    // A live process is stopped first: a resume of a running session makes a copy (V18c).
    const alive = session.status !== undefined;
    if (alive && (session.status !== 'idle' || session.waitingFor !== undefined)) {
      throw new PageAgentRefused(
        `${await called()} is answering: wait for its answer, or type in its terminal`,
        409,
      );
    }
    if (alive && session.id) {
      const stopped = await agent.stop(session.id);
      if (!stopped.ok) throw new PageAgentRefused(stopped.error, 409);
    }
    // The session wakes reading its files again: its gate in the name it started under.
    await settingsFile(where, record.name ?? name);
    await mcpFile(where);
    const resumed = await agent.resume({ sessionId, cwd: root, text });
    if (!resumed.ok) throw new PageAgentRefused(resumed.error, 502);
  }

  return { serverOf, conversationOf, state, readsOf, start, reply };
}
