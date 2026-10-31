// A page's agent (V35, V41): Nucleus (`nucleus.ts`) or Scribe (`scribe.ts`), an agent in the
// checkout `symbiote view` runs in, one conversation per repository, opened from its page. Its spec
// gives its name, tools, gate, instructions and record; this module starts it on Claude Code (a
// background session, `--tools` and its gate's settings file) or Codex (a thread on its app server),
// finds it again by its recorded ID (never by its folder, where the person's own sessions run too,
// decision 239), and opens it in a terminal. Since V50 a conversation can start with no question,
// its instructions its system prompt and its terminal taking the first.
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  EFFORT_LEVEL,
  MODEL_ID,
  type AgentEfforts,
  type AgentKind,
  type AgentModels,
  type DefaultModel,
  type GitRepo,
  type InstalledAgent,
  type NucleusActivity,
  type NucleusActivityLine,
  type PageAgentAsk,
  type PageAgentConversation,
  type EffortChange,
  type AgentLevels,
  type ModelChange,
  type PageAgentOpen,
  type PageAgentState,
  type PageAgentStateName,
  type PageAgentTerminalRequest,
  type WorkspaceTerminalOpened,
} from '@symbiote/core';
import { AppServerError, AppServerStartFailed, type CodexServer } from './app-server.js';
import { asksTrust, codexFolders, type Codex } from './codex.js';
import { PromptRefused, readPrompts, writeConfig } from './prompts.js';
import { prepareSymbioteFolder, reviewPlace, type ReviewPlace } from './reviews.js';
import { TerminalRefused, type Terminals } from './terminal.js';
import { real } from './thread.js';
import { readWorkspaceConfig } from './workspaces.js';
import { shellWord, type AgentSession, type ClaudeCode } from './claude-code.js';
import { viewFile } from './mcp-bridge.js';
import {
  AGENT_NAMES,
  effortOnProblem,
  effortWordProblem,
  levelsOn,
  modelProblem,
  modelWordProblem,
} from './agent-levels.js';
import { writeFileWhole } from './file-write.js';
import { appendActivity, readNucleusActivity, rotateActivity } from './nucleus-activity.js';
import { codexLines, rolloutTokens, seenOf } from './nucleus-codex.js';

/** Longest question: it goes on Claude Code's command line with Nucleus's prompt (8,000 at most). */
export const MAX_QUESTION = 20_000;

/** What makes a page's agent Nucleus or Scribe (V41): its name, record, tools, gate and prompt. */
export interface PageAgentSpec {
  /** Its session's and thread's name, and how it speaks of itself. */
  name: string;
  /** Its record's first key. */
  about: string;
  /** Its record and its settings file, in `symbiote/`. */
  record: string;
  settings: string;
  /** Claude Code's tools and mode for it, read at each start (Nucleus's web, NU1). */
  tools(root: string): readonly string[];
  permissionMode: 'dontAsk' | 'default';
  /**
   * What its gate is given after its script, at each start and wake: Scribe's, the skills' folder
   * and `folders`; Nucleus's, the checkout and the workspaces' records, whose worktrees it opens
   * (V80, decision 596), and `--web` when it has the web (NU1).
   */
  gateArgs(root: string, where: ReviewPlace): string[];
  /**
   * Folders outside the checkout it works in too, read at each start (Scribe: the skill library,
   * SK1): Claude Code's `--add-dir`, folders Codex's sandbox may also write.
   */
  folders?(root: string): string[];
  /** Claude Code's settings besides the gate (Scribe: its edits in the checkout). */
  claudeSettings?: Readonly<Record<string, unknown>>;
  /** Its first prompt: the person's words; in the project's text when it has no `instructions`. */
  prompt(root: string, text: string): string;
  /**
   * Its system prompt (Nucleus, V50, decision 383; Scribe, V78, 570): Claude Code's appended one,
   * Codex's developer instructions. With it a conversation starts with no question (`open`), its
   * terminal taking the first; without it a conversation starts with what the person asks.
   */
  instructions?(root: string): string;
  /**
   * Where Codex's thread runs: in the checkout read-only (Nucleus), or writing in that folder and
   * nowhere else (Scribe, its skills; decision 275).
   */
  codex(root: string): { cwd: string; writes: boolean };
  /**
   * The folders Codex's read-only thread reads (Nucleus, V80, decision 599), Codex's own program's
   * added: a permission profile given at its start and at each message and load; absent, Codex's
   * read-only mode, which reads every folder.
   */
  codexReads?(root: string, where: ReviewPlace): string[];
  /** Made before a start: Scribe's skills folder. */
  prepare?(root: string): Promise<void>;
  /**
   * The project's level in its config (`nucleus.effort`, `scribe.effort`), where it is set, and
   * where it was before a rename (`scout.effort`): removed in the same write (decision 590).
   */
  effort: ConfigSetting;
  /** The project's model in its config (`nucleus.model`, `scribe.model`, V47), as `effort`. */
  model: ConfigSetting;
  /**
   * Symbiote's MCP server for it (MC1): Claude Code's file in `symbiote/`, and who the bridge says
   * calls (`--as nucleus`); absent, none.
   */
  mcp?: { file: string; as: string };
  /** Codex's thread's own configuration besides Symbiote's server, at each start and resume. */
  codexConfig?(root: string): Readonly<Record<string, unknown>>;
  /**
   * Its name, record and files in `symbiote/` before a rename (NU1: Scout's, decision 591): that
   * record is its conversation while it has none of its own; New conversation removes it all.
   */
  former?: { name: string; record: string; files: readonly string[] };
  /** What it did, recorded beside its record (NU2, decision 604): Nucleus's. */
  activity?: string;
}

/** A setting of the project's config: its value, its path, its path before a rename. */
interface ConfigSetting {
  read(root: string): string | undefined;
  key: readonly string[];
  older?: readonly string[];
}

/** How often Codex's thread is read for the activity while it works (NU2, decision 606). */
const CODEX_EVERY_MS = 2_000;

/** Codex's newest turns read for the activity: a turn's steered messages are in it. */
const CODEX_TURNS = 5;

/** How long Codex waits on one of Symbiote's tools (MC1): longer than an ask or a `wait`. */
const TOOL_TIMEOUT_SEC = 660;

/**
 * The agents a page agent runs (decision 421): Claude Code and Codex. A workspace's Hermes (V58) is
 * not one: a page agent starts with no question and read-only tools, not measured for Hermes.
 */
const PAGE_AGENTS: readonly AgentKind[] = ['claude', 'codex'];

/** `symbiote/nucleus.json` (or `scout.json`, NU1), or a page agent's record. */
interface PageAgentRecord {
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
  /**
   * Opened with no question (V50), and no turn seen since: Claude Code reads such a session as it
   * reads one whose turn ended on a refused tool, `blocked` and idle. Gone at the first turn seen.
   */
  fresh?: true;
  started: string;
}

/** A record as read: `former` when it is the agent's under its name before a rename (NU1). */
type ReadRecord = PageAgentRecord & { former?: true };

/** A question Nucleus cannot take, or a conversation it cannot act on: its status and why. */
export class PageAgentRefused extends Error {
  override name = 'PageAgentRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502,
  ) {
    super(message);
  }
}

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
  /** Records a line of Symbiote's own (its tools, a Confirm), redacted; Nucleus's only. */
  record?: (line: NucleusActivityLine) => void;
  /**
   * Stops reading Codex's thread for the activity and waits for what is being written: the server
   * closing, a test before it removes the repository (fix/git-page-feature-extend).
   */
  close?: () => Promise<void>;
}

/** The young generation the recording gate starts with, in MB (NU2). */
const SEMI_SPACE_MB = 4;

/** The events Nucleus's activity records besides the gate's (NU2): Claude Code's, in the background. */
const RECORDED_EVENTS = [
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
  'PostCompact',
  'Notification',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
] as const;

/**
 * A page agent's settings file for Claude Code: the gate before every tool. With `activity`
 * (Nucleus's, NU2, decision 605, which revisits 238), the gate records each call and its decision
 * there, and the other events run it in the background (`async`) to record them.
 */
export function pageAgentSettings(
  where: { node: string; gate: string; args?: readonly string[]; activity?: string },
  platform: NodeJS.Platform = process.platform,
  more: Readonly<Record<string, unknown>> = {},
): string {
  const command = [
    where.node,
    // Recording takes the gate's heap past V8's first young-generation limit: one 3.5 ms scavenge
    // on every call (NU2 measured), which a larger start avoids for ~0.7 ms.
    ...(where.activity ? [`--min-semi-space-size=${SEMI_SPACE_MB}`] : []),
    where.gate,
    ...(where.args ?? []),
    ...(where.activity ? [`--activity=${where.activity}`] : []),
  ]
    .map((p) => shellWord(p, platform))
    .join(' ');
  const hooks: Record<string, unknown[]> = {
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 30 }] }],
  };
  if (where.activity) {
    for (const event of RECORDED_EVENTS) {
      const tools = event.includes('Tool') || event === 'PermissionDenied';
      hooks[event] = [
        {
          ...(tools ? { matcher: '*' } : {}),
          hooks: [{ type: 'command', command, timeout: 30, async: true }],
        },
      ];
    }
  }
  return `${JSON.stringify({ ...more, hooks }, null, 2)}\n`;
}

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
  /** Its gate (`dist/nucleus-hook.js`, `dist/scribe-hook.js`) and the Node that runs it. */
  gate?: string;
  node?: string;
  /** Symbiote's MCP bridge (`dist/mcp-stdio.js`, MC1), for an agent whose spec has `mcp`. */
  bridge?: string;
  terminals?: Terminals;
}

/** A page agent's MCP servers' file for Claude Code (MC1): Symbiote's, through its bridge. */
export function symbioteMcpConfig(server: { command: string; args: readonly string[] }): string {
  const symbiote = { type: 'stdio', command: server.command, args: server.args };
  return `${JSON.stringify({ mcpServers: { symbiote } }, null, 2)}\n`;
}

/** The models an agent lists (V47); null unread. */
async function modelsOf(agent: {
  claude?: ClaudeCode;
  codex?: Codex;
}): Promise<AgentModels | null> {
  if (agent.codex) return agent.codex.models();
  const models = (await agent.claude?.models()) ?? null;
  return models ? { models } : null;
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
  }: PageAgentOptions,
): PageAgent {
  const { name } = spec;
  // Symbiote's MCP server (MC1): its bridge, told who calls and where `symbiote view` is.
  const symbioteServer =
    spec.mcp && bridge
      ? {
          command: node,
          args: [bridge, '--as', spec.mcp.as, '--view', viewFile(cacheDir, repo.commonDir)],
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

  /** Its record; while there is none, the one under its former name (decision 591). */
  async function readRecord(where: ReviewPlace): Promise<ReadRecord | null> {
    const own = await readRecordAt(recordPath(where));
    if (own || !spec.former) return own;
    const former = await readRecordAt(join(folder(where), spec.former.record));
    return former ? { ...former, former: true } : null;
  }

  async function readRecordAt(path: string): Promise<PageAgentRecord | null> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return null;
    }
    const v = (value && typeof value === 'object' ? value : {}) as Partial<PageAgentRecord>;
    const text = (x: unknown) => (typeof x === 'string' && x !== '' ? x : undefined);
    const started = text(v.started) ?? '';
    const level = {
      ...(isLevel(v.effort) ? { effort: v.effort } : {}),
      ...(typeof v.model === 'string' && MODEL_ID.test(v.model) ? { model: v.model } : {}),
      ...(v.fresh === true ? { fresh: true as const } : {}),
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

  /** Writes a file of Nucleus's in `symbiote/`, its `.gitignore` first: the checkout stays clean. */
  async function put(where: ReviewPlace, path: string, text: string): Promise<void> {
    await prepareSymbioteFolder(where, { agents: false });
    await writeFileWhole(path, text);
  }

  /**
   * Nucleus's settings file, written when its text differs or it is gone: a session that wakes reads
   * it again, and does not start without it (V18c spike). Its path.
   */
  async function settingsFile(where: ReviewPlace): Promise<string> {
    const path = join(folder(where), spec.settings);
    const text = pageAgentSettings(
      {
        node,
        gate,
        args: spec.gateArgs(root, where),
        ...(spec.activity ? { activity: join(folder(where), spec.activity) } : {}),
      },
      process.platform,
      spec.claudeSettings,
    );
    if ((await readFile(path, 'utf8').catch(() => null)) !== text) await put(where, path, text);
    return path;
  }

  /**
   * Its MCP servers' file for Claude Code (MC1), written as the settings file is, before a start
   * and each wake; its path, or undefined for an agent without Symbiote's server.
   */
  async function mcpFile(where: ReviewPlace): Promise<string | undefined> {
    if (!spec.mcp || !symbioteServer) return undefined;
    const path = join(folder(where), spec.mcp.file);
    const text = symbioteMcpConfig(symbioteServer);
    if ((await readFile(path, 'utf8').catch(() => null)) !== text) await put(where, path, text);
    return path;
  }

  /** The agents installed: `agent.kind` first, else Claude Code, else Codex (decision 240). */
  async function installed(): Promise<{ kind: AgentKind; claude?: ClaudeCode; codex?: Codex }[]> {
    const first = readWorkspaceConfig(root).agent;
    // `agent.kind` first when it is one of theirs (a stable sort keeps the others' order).
    const order = [...PAGE_AGENTS].sort((a, b) => Number(b === first) - Number(a === first));
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

  /**
   * The model a new conversation starts on (V47): the project's (`nucleus.model`) when its agent
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

  /**
   * The model an agent's new conversation runs on (V47) — `asked` (V50; null: none), else the
   * project's when it lists it; without one, Claude Code's `agent.model` — and the levels it takes
   * there; the default's without one.
   */
  async function onModel(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    asked?: string | null,
  ): Promise<{
    model: string | undefined;
    models: AgentModels | null;
    fallback: AgentEfforts | null;
  }> {
    const picked = asked === undefined ? await modelFor(agent) : (asked ?? undefined);
    const model = picked ?? (agent.kind === 'claude' ? readWorkspaceConfig(root).model : undefined);
    return {
      model,
      models: model ? await modelsOf(agent) : null,
      fallback: await defaultLevelsOf(agent),
    };
  }

  /**
   * The levels an agent takes on the model its new conversation would start on (V30b, V47), or on
   * the one asked (V50).
   */
  async function levelsOf(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    asked?: string | null,
  ): Promise<AgentEfforts | null> {
    const { model, models, fallback } = await onModel(agent, asked);
    return levelsOn(models?.models, model, fallback);
  }

  /** Why `effort` cannot start a conversation of `agent`'s, on its model (or `asked`), or null. */
  async function levelProblem(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    effort: string,
    asked?: string | null,
  ): Promise<string | null> {
    const { model, models, fallback } = await onModel(agent, asked);
    return effortOnProblem(effort, AGENT_NAMES[agent.kind], models?.models, model, fallback);
  }

  /**
   * The level a new conversation starts at: the one asked, if the agent lists it; none for null;
   * else the project's (`nucleus.effort`, `scribe.effort`) when the agent lists it, its own
   * otherwise — the project's file may name another agent's level, or an older one's.
   */
  async function levelFor(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    effort: string | null | undefined,
    asked?: string | null,
  ): Promise<string | undefined> {
    if (effort === null) return undefined;
    if (effort === undefined) {
      const project = spec.effort.read(root);
      if (!project) return undefined;
      return (await levelsOf(agent, asked))?.levels.includes(project) ? project : undefined;
    }
    const problem = await levelProblem(agent, effort, asked);
    if (problem) throw new PageAgentRefused(problem, 400);
    return effort;
  }

  /** The model asked for (V50): checked against the agent's list; null and absent pass. */
  async function checkModel(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    asked: string | null | undefined,
  ): Promise<void> {
    if (!asked) return;
    const problem = modelProblem(asked, AGENT_NAMES[agent.kind], (await modelsOf(agent))?.models);
    if (problem) throw new PageAgentRefused(problem, 400);
  }

  async function efforts(): Promise<AgentLevels> {
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
    const effort = spec.effort.read(root);
    const model = spec.model.read(root);
    return {
      agents,
      ...(effort ? { effort } : {}),
      ...(model ? { model } : {}),
      file: readPrompts(root).file,
    };
  }

  /** Codex's app server, or why Nucleus cannot run on it. */
  async function serverOf(agent: Codex | null): Promise<CodexServer> {
    if (!agent) throw new PageAgentRefused('Codex is not installed', 409);
    const server = await agent.server();
    if (!server) {
      throw new PageAgentRefused(
        `${name} runs Codex on its app server, and none runs: \`codex app-server daemon start\` started none (it needs Codex 0.163 or later). Codex's terminal joins a thread there.`,
        409,
      );
    }
    return server;
  }

  /** The record written again without `fresh`, where it was read: a turn was seen (V50). */
  async function asked(where: ReviewPlace, record: ReadRecord): Promise<void> {
    const rest: ReadRecord = { ...record };
    delete rest.fresh;
    delete rest.former;
    const path =
      record.former && spec.former ? join(folder(where), spec.former.record) : recordPath(where);
    await put(where, path, `${JSON.stringify(rest, null, 2)}\n`).catch(() => {});
  }

  /** A conversation under the former name is over: its record and its files go (decision 591). */
  async function dropFormer(where: ReviewPlace): Promise<void> {
    await Promise.all(formerPaths(where).map((path) => rm(path, { force: true })));
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
  ): Promise<AgentSession & { id: string }> {
    // Copied: what Claude Code lists after the start is told from what it listed before.
    const before = [...((await agent.sessions()) ?? [])];
    const settings = await settingsFile(where);
    const mcpConfig = await mcpFile(where);
    const instructions = spec.instructions?.(root);
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
          : `${name} needs Claude Code or Codex: neither is installed`,
        409,
      );
    }
    await checkModel(agent, asked);
    const level = await levelFor(agent, effort, asked);
    const model = asked === undefined ? await modelFor(agent) : (asked ?? undefined);
    const at = { ...(level ? { effort: level } : {}), ...(model ? { model } : {}) };
    const first = text === undefined ? {} : { prompt: spec.prompt(root, text) };
    const instructions = spec.instructions?.(root);
    const config = codexTools();
    const started = now().toISOString();
    await spec.prepare?.(root);
    if (agent.claude) {
      const session = await claudeStart(where, agent.claude, { ...first, ...at });
      const record: PageAgentRecord = {
        about: spec.about,
        agent: 'claude',
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
    const record: PageAgentRecord = { about: spec.about, agent: 'codex', thread, ...at, started };
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
      throw new PageAgentRefused(`${name}'s session is gone: start a new conversation`, 409);
    }
    // A live process is stopped first: a resume of a running session makes a copy (V18c).
    const alive = session.status !== undefined;
    if (alive && (session.status !== 'idle' || session.waitingFor !== undefined)) {
      throw new PageAgentRefused(
        `${name} is answering: wait for its answer, or type in its terminal`,
        409,
      );
    }
    if (alive && session.id) {
      const stopped = await agent.stop(session.id);
      if (!stopped.ok) throw new PageAgentRefused(stopped.error, 409);
    }
    // The session wakes reading its files again.
    await settingsFile(where);
    await mcpFile(where);
    const resumed = await agent.resume({ sessionId, cwd: root, text });
    if (!resumed.ok) throw new PageAgentRefused(resumed.error, 502);
  }

  /** The activity's read (NU2): the file moved to its older one past 4 MB first. */
  async function activity(): Promise<NucleusActivity> {
    const where = await place();
    await writing;
    await rotateActivity(folder(where)).catch(() => false);
    return readNucleusActivity(folder(where));
  }

  return {
    state,
    ...(spec.activity
      ? { activity, record: (line: NucleusActivityLine) => void write([line]) }
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
        throw new PageAgentRefused(`${name} starts with what you ask it`, 409);
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
            `${name} needs Claude Code or Codex: neither is installed`,
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
            `${name} needs Claude Code or Codex: neither is installed`,
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
      if (!record) throw new PageAgentRefused(`${name} has no conversation: open it first`, 409);
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
        await settingsFile(where);
        await mcpFile(where);
        // `attach` to an ID Claude Code does not know exits 0, saying "No job matching…".
        const session = findPageAgentSession(record, (await agent.sessions()) ?? []);
        if (!session?.id) {
          throw new PageAgentRefused(`${name}'s session is gone: start a new conversation`, 409);
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
