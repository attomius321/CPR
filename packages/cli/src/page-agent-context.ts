// What a page agent (Nucleus, Scribe) is and what its modules share (decision 962): its spec and
// options, what it is called, where its record and files are, its activity's writer. A module takes
// a `Pick<>` of `PageAgentContext` (decision 963).
import type { AgentKind, GitRepo, NucleusActivityLine } from '@symbiote/core';
import type { Codex } from './codex.js';
import type { ReviewPlace } from './reviews.js';
import type { Terminals } from './terminal.js';
import type { ClaudeCode } from './claude-code.js';

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

/** A setting of the project's config: its value, its path, its path before a rename. */
interface ConfigSetting {
  read(root: string): string | undefined;
  key: readonly string[];
  older?: readonly string[];
}

/** What makes a page's agent Nucleus or Scribe (V41): its name, record, tools, gate and prompt. */
export interface PageAgentSpec {
  /** Its session's and thread's name, and how it speaks of itself. */
  name: string;
  /**
   * Its name while Hive mode is on (Nucleus's, Alpha Ceph, decision 682): what it is called and
   * calls itself; its session and thread keep `name`, how Symbiote finds them.
   */
  hiveName?: string;
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
   * (V80, decision 596), `--web` when it has the web (NU1), and the conversation's name when not
   * its own (Alpha Ceph, decision 686).
   */
  gateArgs(root: string, where: ReviewPlace, name: string): string[];
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
  instructions?(root: string, name: string): string;
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

/** `symbiote/nucleus.json` (or `scout.json`, NU1), or a page agent's record. */
export interface PageAgentRecord {
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
  /** The name it started under when not its own: Alpha Ceph, in Hive mode (decision 686). */
  name?: string;
  started: string;
}

/** A record as read: `former` when it is the agent's under its name before a rename (NU1). */
export type ReadRecord = PageAgentRecord & { former?: true };

/** What `pageAgent`'s modules share. */
export interface PageAgentContext {
  spec: PageAgentSpec;
  repo: GitRepo;
  cacheDir: string;
  claude: () => Promise<ClaudeCode | null>;
  codex: () => Promise<Codex | null>;
  now: () => Date;
  env: Readonly<Record<string, string | undefined>>;
  root: string;
  gate: string;
  node: string;
  terminals: Terminals | undefined;
  name: string;
  /** What it is called now: `hiveName` while Hive mode is on (decision 687), else `name`. */
  called: () => Promise<string>;
  /** Symbiote's MCP server (MC1): its bridge, told who calls and where `symbiote view` is. */
  symbioteServer: { command: string; args: string[] } | undefined;
  /** Codex's thread's configuration: Symbiote's server and the spec's own; undefined for none. */
  codexTools: () => Record<string, unknown> | undefined;
  codexAt: ReturnType<PageAgentSpec['codex']>;
  place: () => Promise<ReviewPlace>;
  folder: (where: ReviewPlace) => string;
  recordPath: (where: ReviewPlace) => string;
  /** Its record under its name before a rename, and that name's files (NU1). */
  formerPaths: (where: ReviewPlace) => string[];
  /** Writes to the activity file one after another, in the order asked; never fails. */
  write: (lines: readonly NucleusActivityLine[]) => Promise<void>;
  /** A line's conversation and agent. */
  ofRecord: (record: PageAgentRecord) => { conversation?: string; agent: PageAgentRecord['agent'] };
}
