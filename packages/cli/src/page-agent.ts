// A page's agent (V35, V41): Nucleus (`nucleus.ts`) or Scribe (`scribe.ts`), an agent in the
// checkout `symbiote view` runs in, one conversation per repository, opened from its page. Its spec
// gives its name, tools, gate, instructions and record; this module starts it on Claude Code (a
// background session, `--tools` and its gate's settings file) or Codex (a thread on its app server),
// finds it again by its recorded ID (never by its folder, where the person's own sessions run too,
// decision 239), and opens it in a terminal. Since V50 a conversation can start with no question,
// its instructions its system prompt and its terminal taking the first.
import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  mainWorktree,
  MODEL_ID,
  type GitRepo,
  type NucleusActivity,
  type NucleusActivityLine,
  type PageAgentAsk,
  type EffortChange,
  type AgentLevels,
  type ModelChange,
  type PageAgentOpen,
  type PageAgentState,
  type PageAgentTerminalRequest,
  type WorkspaceTerminalOpened,
} from '@symbiote/core';
import { AppServerError } from './app-server.js';
import { asksTrust, type Codex } from './codex.js';
import { PromptRefused } from './prompts.js';
import { writeConfig } from './config-write.js';
import { prepareSymbioteFolder, reviewPlace, type ReviewPlace } from './reviews.js';
import { TerminalRefused, type Terminals } from './terminal.js';
import { real } from './thread.js';
import type { ClaudeCode } from './claude-code.js';
import { viewFile } from './mcp-bridge.js';
import { AGENT_NAMES, effortWordProblem, modelProblem, modelWordProblem } from './agent-levels.js';
import { appendActivity, readNucleusActivity, rotateActivity } from './nucleus-activity.js';
import { exportActivity, type ActivityExport, type ExportFormat } from './activity-export.js';
import { secretsOf } from './nucleus-record.js';
import { codexLines, rolloutTokens, seenOf } from './nucleus-codex.js';
import {
  type PageAgentSpec,
  type PageAgentRecord,
  type PageAgentContext,
  PageAgentRefused,
} from './page-agent-context.js';
import { isLevel, modelsOf, pageAgentLevels, PAGE_AGENTS } from './page-agent-levels.js';
import { pageAgentFiles } from './page-agent-files.js';
import { pageAgentConversation, findPageAgentSession } from './page-agent-conversation.js';

/** Longest question: it goes on Claude Code's command line with Nucleus's prompt (8,000 at most). */
export const MAX_QUESTION = 20_000;

/** How often Codex's thread is read for the activity while it works (NU2, decision 606). */
const CODEX_EVERY_MS = 2_000;

/** Codex's newest turns read for the activity: a turn's steered messages are in it. */
const CODEX_TURNS = 5;

/** How long Codex waits on one of Symbiote's tools (MC1): longer than an ask or a `wait`. */
const TOOL_TIMEOUT_SEC = 660;

/** What the server needs of Nucleus, or of Scribe (V41). */
export interface PageAgent {
  state(): Promise<PageAgentState>;
  /** Starts a conversation with the question, or continues the one there is. */
  ask(request: PageAgentAsk): Promise<PageAgentState>;
  /**
   * Starts a conversation with no question (V50), its terminal taking the first; the one there is
   * when it runs. Nucleus's only: Scribe starts with a request.
   */
  open(request: PageAgentOpen): Promise<PageAgentState>;
  /** Ends the conversation: its session stopped and removed (Codex: archived), the record gone. */
  renew(): Promise<PageAgentState>;
  /** Opens the conversation in a terminal (V21): `claude attach`, or Codex's TUI on its thread. */
  terminal(request: PageAgentTerminalRequest): Promise<WorkspaceTerminalOpened>;
  /** Each agent's levels and the project's (`nucleus.effort`); Codex's start its daemon. */
  efforts(): Promise<AgentLevels>;
  /** Sets the project's level in its config (null removes it), one Nucleus's default agent lists. */
  setEffort(change: EffortChange): Promise<AgentLevels>;
  /**
   * Sets the project's model in its config (V47, `nucleus.model`; null removes it), one Nucleus's
   * default agent lists.
   */
  setModel(change: ModelChange): Promise<AgentLevels>;
  /** What it did (NU2, decision 604): its activity file's newest megabyte; Nucleus's only. */
  activity?: () => Promise<NucleusActivity>;
  /**
   * What it did, taken out (V84): both its activity files whole, as Markdown or JSON Lines,
   * redacted; `maxBytes` as a workspace's export takes it. Nucleus's only.
   */
  exportActivity?: (
    format: ExportFormat,
    options?: { maxBytes?: number },
  ) => Promise<ActivityExport>;
  /** Records a line of Symbiote's own (its tools, a Confirm), redacted; Nucleus's only. */
  record?: (line: NucleusActivityLine) => void;
  /**
   * Stops reading Codex's thread for the activity and waits for what is being written: the server
   * closing, a test before it removes the repository (fix/git-page-feature-extend).
   */
  close?: () => Promise<void>;
}

/** What a page's agent is given: its agents, its clock, its gate, its terminals. */
export interface PageAgentOptions {
  claude: () => Promise<ClaudeCode | null>;
  codex?: () => Promise<Codex | null>;
  now?: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
  /** The checkout it works in, where `symbiote/config.json` is read too. */
  root?: string;
  /** Its gate (`dist/nucleus-hook.js`, `dist/scribe-hook.js`) and the Node that runs it. */
  gate?: string;
  node?: string;
  /** Symbiote's MCP bridge (`dist/mcp-stdio.js`, MC1), for an agent whose spec has `mcp`. */
  bridge?: string;
  terminals?: Terminals;
  /** Whether Hive mode is on (V82): a spec with `hiveName` is called so meanwhile (decision 687). */
  hive?: () => Promise<boolean>;
  /**
   * Nucleus's key (SC1, decision 931): set as `SYMBIOTE_NUCLEUS_KEY` in its MCP server's
   * environment alone, so its bridge's calls are Nucleus's; none, and they are an agent's.
   */
  nucleusKey?: string;
}

/**
 * A page's agent (`spec`: Nucleus, Scribe) in `repo`'s checkout: one conversation, its record beside
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
    bridge,
    terminals,
    hive,
    nucleusKey,
  }: PageAgentOptions,
): PageAgent {
  const { name } = spec;
  /** What it is called now: `hiveName` while Hive mode is on (decision 687), else `name`. */
  const called = async (): Promise<string> =>
    spec.hiveName && (await hive?.()) ? spec.hiveName : name;
  // Symbiote's MCP server (MC1): its bridge, told who calls and where `symbiote view` is.
  const symbioteServer =
    spec.mcp && bridge
      ? {
          command: node,
          args: [bridge, '--as', spec.mcp.as, '--view', viewFile(cacheDir, repo.commonDir)],
          ...(nucleusKey ? { env: { SYMBIOTE_NUCLEUS_KEY: nucleusKey } } : {}),
        }
      : undefined;
  /**
   * Codex's thread's configuration, read at each start and resume: Symbiote's server (MC1) and the
   * spec's own (Nucleus's web search, NU1); undefined for none.
   */
  const codexTools = (): Record<string, unknown> | undefined => {
    const own = spec.codexConfig?.(root) ?? {};
    const tools = symbioteServer
      ? {
          mcp_servers: {
            symbiote: {
              ...symbioteServer,
              // Symbiote asks the person itself (decision 361); Codex's approvals stay `never`.
              default_tools_approval_mode: 'approve',
              tool_timeout_sec: TOOL_TIMEOUT_SEC,
            },
          },
        }
      : {};
    const config = { ...tools, ...own };
    return Object.keys(config).length > 0 ? config : undefined;
  };
  const codexAt = spec.codex(root);
  const place = () => reviewPlace(repo, cacheDir);
  const folder = (where: ReviewPlace) => dirname(where.dir);
  const recordPath = (where: ReviewPlace) => join(folder(where), spec.record);
  /** Its record under its name before a rename, and that name's files (NU1). */
  const formerPaths = (where: ReviewPlace) =>
    spec.former
      ? [spec.former.record, ...spec.former.files].map((file) => join(folder(where), file))
      : [];

  /** Its activity file (NU2), or none. */
  const activityPath = (where: ReviewPlace) =>
    spec.activity ? join(folder(where), spec.activity) : undefined;
  /** Writes to the activity file one after another, in the order asked; never fails. */
  let writing: Promise<void> = Promise.resolve();
  function write(lines: readonly NucleusActivityLine[]): Promise<void> {
    if (!spec.activity || lines.length === 0) return writing;
    writing = writing
      .then(async () => {
        const where = await place();
        const path = activityPath(where);
        if (!path) return;
        await prepareSymbioteFolder(where, { agents: false });
        appendActivity(path, lines, env);
      })
      .catch(() => {});
    return writing;
  }
  /** The conversation a line is for: Claude Code's session ID (as its hooks name it), Codex's thread. */
  const conversationId = (record: PageAgentRecord) =>
    record.agent === 'claude' ? (record.sessionId ?? record.id) : record.thread;
  const ofRecord = (record: PageAgentRecord) => {
    const conversation = conversationId(record);
    return { ...(conversation ? { conversation } : {}), agent: record.agent };
  };

  const ctx: PageAgentContext = {
    spec,
    repo,
    cacheDir,
    claude,
    codex,
    now,
    env,
    root,
    gate,
    node,
    terminals,
    name,
    called,
    symbioteServer,
    codexTools,
    codexAt,
    place,
    folder,
    recordPath,
    formerPaths,
    write,
    ofRecord,
  };
  const levels = pageAgentLevels(ctx);
  const { installed, efforts, levelProblem } = levels;
  const files = pageAgentFiles(ctx);
  const { readRecord, dropFormer, settingsFile, mcpFile } = files;
  // Its conversation watches a Codex thread with this closure's loop (`watchCodex`).
  const { serverOf, conversationOf, state, readsOf, start, reply } = pageAgentConversation(ctx, {
    ...levels,
    ...files,
    watchCodex,
  });

  /** What of each Codex thread the activity holds (decision 606): read from the file at first. */
  const codexSeen = new Map<string, Set<string>>();
  /** The thread being read every 2 s, its last change read, and how to read it again now. */
  let watching: string | undefined;
  const changed = new Map<string, number>();
  let wake: (() => void) | undefined;
  /** The loop reading it, while one runs; none starts once closed (`close`). */
  let watched: Promise<void> | undefined;
  let closed = false;

  /** One read of Codex's thread for the activity: what is new written; whether a turn runs. */
  async function codexPass(where: ReviewPlace, thread: string): Promise<boolean> {
    const read = await (
      await serverOf(await codex())
    ).read(thread, { turns: CODEX_TURNS, items: 'full' });
    let seen = codexSeen.get(thread);
    if (!seen) {
      seen = seenOf((await readNucleusActivity(folder(where))).lines, thread);
      codexSeen.set(thread, seen);
    }
    const ending = read.turns.filter((t) => t.status !== 'inProgress' && !seen.has(`end:${t.id}`));
    const tokens =
      read.path && ending.length > 0
        ? await rolloutTokens(read.path, ending).catch(() => new Map())
        : new Map();
    await write(codexLines(read, seen, now().toISOString(), tokens));
    return read.status === 'active';
  }

  /**
   * Reads Codex's thread for the activity (decision 606): once when it changed since, and every
   * 2 s while a turn runs; a read asked while it is read again comes sooner.
   */
  function watchCodex(where: ReviewPlace, thread: string, status: string, updatedAt: number) {
    if (!spec.activity || closed) return;
    if (watching === thread) {
      wake?.();
      return;
    }
    if (status !== 'active' && changed.get(thread) === updatedAt) return;
    changed.set(thread, updatedAt);
    watching = thread;
    watched = (async () => {
      try {
        while (!closed && (await codexPass(where, thread))) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, CODEX_EVERY_MS);
            timer.unref();
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake = undefined;
        }
      } catch {
        // Read again at the next state's read.
        changed.delete(thread);
      } finally {
        watching = undefined;
      }
    })();
  }

  /** The activity's read (NU2): the file moved to its older one past 4 MB first. */
  async function activity(): Promise<NucleusActivity> {
    const where = await place();
    await writing;
    await rotateActivity(folder(where)).catch(() => false);
    return readNucleusActivity(folder(where));
  }

  /** Its activity taken out (V84): both files whole, after what is being written. */
  async function exportOwn(
    format: ExportFormat,
    { maxBytes }: { maxBytes?: number } = {},
  ): Promise<ActivityExport> {
    const where = await place();
    await writing;
    const { lines } = await readNucleusActivity(folder(where), Number.MAX_SAFE_INTEGER);
    return exportActivity(
      { of: 'nucleus', repository: basename(mainWorktree(repo)), lines },
      format,
      { now: now(), secrets: secretsOf(env), ...(maxBytes ? { maxBytes } : {}) },
    );
  }

  return {
    state,
    ...(spec.activity
      ? {
          activity,
          exportActivity: exportOwn,
          record: (line: NucleusActivityLine) => void write([line]),
        }
      : {}),

    async close() {
      closed = true;
      // A loop waiting its 2 s goes on at once, and ends.
      wake?.();
      await watched;
      await writing;
    },

    async ask({ text, agent, effort, model }) {
      if (text.trim() === '') throw new PageAgentRefused('a question cannot be empty', 400);
      if (text.length > MAX_QUESTION) {
        throw new PageAgentRefused(
          `a question is at most ${MAX_QUESTION.toLocaleString('en-US')} characters`,
          400,
        );
      }
      if (agent !== undefined && !PAGE_AGENTS.includes(agent)) {
        throw new PageAgentRefused(`unknown agent: ${String(agent)}`, 400);
      }
      if (effort !== undefined && effort !== null && !isLevel(effort)) {
        throw new PageAgentRefused(effortWordProblem(effort), 400);
      }
      if (model !== undefined && model !== null && !MODEL_ID.test(model)) {
        throw new PageAgentRefused(modelWordProblem(model), 400);
      }
      const where = await place();
      const record = await readRecord(where);
      // A session removed outside Symbiote: the question starts a new conversation.
      const gone = record ? (await conversationOf(record)).state === 'gone' : false;
      if (!record || gone) {
        await start(where, text, agent, effort, model);
        if (record?.former) await dropFormer(where);
      } else if (agent !== undefined && agent !== record.agent) {
        throw new PageAgentRefused(
          `this conversation is ${AGENT_NAMES[record.agent]}'s: start a new one for ${AGENT_NAMES[agent]}`,
          409,
        );
      } else if (effort !== undefined) {
        // Set at its start, kept by its session; `/effort` in its terminal changes it.
        throw new PageAgentRefused(
          'this conversation started at its level: change it in its terminal',
          409,
        );
      } else if (model !== undefined) {
        throw new PageAgentRefused(
          'this conversation started on its model: change it in its terminal',
          409,
        );
      } else await reply(where, record, text);
      return state();
    },

    async open({ agent, model, effort }) {
      if (!spec.instructions)
        throw new PageAgentRefused(`${await called()} starts with what you ask it`, 409);
      if (agent !== undefined && !PAGE_AGENTS.includes(agent)) {
        throw new PageAgentRefused(`unknown agent: ${String(agent)}`, 400);
      }
      if (effort !== undefined && effort !== null && !isLevel(effort)) {
        throw new PageAgentRefused(effortWordProblem(effort), 400);
      }
      if (model !== undefined && model !== null && !MODEL_ID.test(model)) {
        throw new PageAgentRefused(modelWordProblem(model), 400);
      }
      const where = await place();
      const record = await readRecord(where);
      // One that runs is kept: two pages opening Nucleus share it, as one under its former name
      // is until New conversation (decision 591).
      const gone = record ? (await conversationOf(record)).state === 'gone' : false;
      if (!record || gone) {
        await start(where, undefined, agent, effort, model);
        if (record?.former) await dropFormer(where);
      }
      return state();
    },

    async renew() {
      const where = await place();
      const record = await readRecord(where);
      if (record?.agent === 'claude') {
        const agent = await claude();
        const session = agent
          ? findPageAgentSession(record, (await agent.sessions()) ?? [])
          : undefined;
        if (agent && session?.id) {
          if (session.status !== undefined) await agent.stop(session.id);
          // Out of Claude Code's list; its transcript stays (`claude --resume` opens it).
          const removed = await agent.remove(session.id);
          if (!removed.ok) throw new PageAgentRefused(removed.error, 409);
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
      if (record) await write([{ at: now().toISOString(), ...ofRecord(record), kind: 'renewed' }]);
      await rm(recordPath(where), { force: true });
      if (record?.former) await dropFormer(where);
      return state();
    },

    efforts,

    async setEffort({ effort }) {
      if (effort !== null) {
        if (!isLevel(effort)) throw new PageAgentRefused(effortWordProblem(effort), 400);
        // The level Settings offers: the default agent's.
        const agent = (await installed())[0];
        if (!agent) {
          throw new PageAgentRefused(
            `${await called()} needs Claude Code or Codex: neither is installed`,
            409,
          );
        }
        const problem = await levelProblem(agent, effort);
        if (problem) throw new PageAgentRefused(problem, 400);
      }
      try {
        await writeConfig(root, spec.effort.key, effort ?? undefined, spec.effort.older);
      } catch (error) {
        if (error instanceof PromptRefused) throw new PageAgentRefused(error.message, error.status);
        throw error;
      }
      return efforts();
    },

    async setModel({ model }) {
      if (model !== null) {
        if (typeof model !== 'string' || !MODEL_ID.test(model)) {
          throw new PageAgentRefused(modelWordProblem(model), 400);
        }
        // The model Settings offers: the default agent's.
        const agent = (await installed())[0];
        if (!agent) {
          throw new PageAgentRefused(
            `${await called()} needs Claude Code or Codex: neither is installed`,
            409,
          );
        }
        const problem = modelProblem(
          model,
          AGENT_NAMES[agent.kind],
          (await modelsOf(agent))?.models,
        );
        if (problem) throw new PageAgentRefused(problem, 400);
      }
      try {
        await writeConfig(root, spec.model.key, model ?? undefined, spec.model.older);
      } catch (error) {
        if (error instanceof PromptRefused) throw new PageAgentRefused(error.message, error.status);
        throw error;
      }
      return efforts();
    },

    async terminal({ cols, rows }) {
      const where = await place();
      const record = await readRecord(where);
      if (!record)
        throw new PageAgentRefused(`${await called()} has no conversation: open it first`, 409);
      if (!terminals) throw new PageAgentRefused('no terminals here', 409);
      const can = await terminals.available();
      if (!can.available) throw new PageAgentRefused(can.reason, 409);
      let command: string;
      let args: string[];
      let asks = false;
      if (record.agent === 'claude') {
        const agent = await claude();
        if (!agent) throw new PageAgentRefused('Claude Code is not installed', 409);
        // A session that wakes reads its settings file again, and does not start without it.
        await settingsFile(where, record.name ?? name);
        await mcpFile(where);
        // `attach` to an ID Claude Code does not know exits 0, saying "No job matching…".
        const session = findPageAgentSession(record, (await agent.sessions()) ?? []);
        if (!session?.id) {
          throw new PageAgentRefused(
            `${await called()}'s session is gone: start a new conversation`,
            409,
          );
        }
        command = agent.command;
        args = ['attach', session.id];
      } else {
        const agent = await codex();
        const app = await serverOf(agent);
        // Loaded with Symbiote's MCP server and its web first, and the folders it reads (V80): the
        // terminal joins the thread as it is (MC1), read-only.
        const config = codexTools();
        const reads = readsOf(where, agent);
        if (config || reads.reads) {
          try {
            await app.load({ thread: record.thread ?? '', config: config ?? {}, ...reads });
          } catch (error) {
            if (error instanceof AppServerError) {
              throw new PageAgentRefused(`Codex's app server: ${error.message}`, 502);
            }
            throw error;
          }
        }
        command = agent?.command ?? 'codex';
        args = ['resume', record.thread ?? '', '--remote', app.address, '-C', codexAt.cwd];
        // Codex asks to trust a folder first (V27b, decision 160): said, never answered here.
        asks = await app.trust(codexAt.cwd).then(
          (entries) => asksTrust(entries, [codexAt.cwd, real(codexAt.cwd)]),
          () => false,
        );
      }
      try {
        const cwd = record.agent === 'codex' ? codexAt.cwd : root;
        const id = await terminals.open({ command, args, cwd, cols, rows, env });
        return { id, ...(asks ? { trusted: false as const } : {}) };
      } catch (error) {
        if (error instanceof TerminalRefused) throw new PageAgentRefused(error.message, 409);
        throw error;
      }
    },
  };
}
