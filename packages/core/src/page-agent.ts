// A page's agent (V35, V41): Nucleus or Scribe, an agent in the checkout `symbiote view` runs in,
// opened from its page. Types only; the CLI starts the agent, keeps its record in `symbiote/` and
// serves its API (`/api/nucleus`, `/api/scribe`).
import type {
  AgentEfforts,
  AgentKind,
  AgentModel,
  DefaultModel,
  TerminalAvailability,
} from './workspaces.js';

/** What Nucleus's agent is doing, as its page and the sidenav say it. */
export type PageAgentStateName =
  /** Started with no question (V50): its terminal takes the first. */
  | 'ready'
  | 'working'
  | 'answered'
  /** Its turn waits on the person: a dialog in its terminal. */
  | 'needs-you'
  /** Esc in its terminal ended the turn (V21: no hook fires, it reads `working` and idle). */
  | 'interrupted'
  /** Its process ended: its terminal starts it again, with no turn. */
  | 'stopped'
  | 'failed'
  /** Its session is no longer listed: removed outside Symbiote. */
  | 'gone'
  | 'unknown';

/** Nucleus's conversation: one per repository, kept until the person starts a new one. */
export interface PageAgentConversation {
  kind: AgentKind;
  started: string;
  state: PageAgentStateName;
  /** Claude Code's session, as `claude attach` takes it; Codex's thread. Absent once gone. */
  id?: string;
  /** The effort level it started at; absent: the agent's own. Its terminal may change it since. */
  effort?: string;
  /** The model it started on (V47); absent: its default. Its terminal may change it since. */
  model?: string;
  /** Why its state is unknown. */
  error?: string;
  /**
   * The name it was started under when that was another (NU1: `Scout`, its record `scout.json`):
   * it keeps that one's tools until New conversation (decision 591).
   */
  startedAs?: string;
}

/** An agent Nucleus can run, installed here. */
export interface InstalledAgent {
  kind: AgentKind;
  command: string;
}

/** `GET /api/nucleus`, and what a question or a new conversation answers. */
export interface PageAgentState {
  /** The folder Nucleus reads: the checkout `symbiote view` runs in. */
  checkout: string;
  /** The agents installed, the one Nucleus runs unless another is picked first. */
  agents: InstalledAgent[];
  conversation: PageAgentConversation | null;
  /**
   * Whether its terminal can run (V21), with no conversation too (V50): the page shows it, or the
   * question box. Absent where Symbiote runs no terminals.
   */
  terminal?: TerminalAvailability;
}

/** `POST /api/nucleus/ask`: a question; it starts a conversation, or continues the one there is. */
export interface PageAgentAsk {
  text: string;
  /** The agent to start (a new conversation only); the default one when absent. */
  agent?: AgentKind;
  /**
   * The effort level to start at (a new conversation only), one the agent lists; null: the agent's
   * own. Absent: the project's (`nucleus.effort`, `scribe.effort`) when the agent lists it, else the
   * agent's own.
   */
  effort?: string | null;
  /**
   * The model to start on (a new conversation only, V50: Nucleus's head where no terminal runs), one
   * the agent lists; null: its default. Absent: the project's (`nucleus.model`).
   */
  model?: string | null;
}

/**
 * `POST /api/nucleus/open` (V50): a conversation with no question, its terminal taking the first;
 * the one there is when it runs.
 */
export interface PageAgentOpen {
  /** The agent to start; the default one when absent. */
  agent?: AgentKind;
  /** Its model, one the agent lists; null: its default. Absent: the project's (`nucleus.model`). */
  model?: string | null;
  /** Its level on that model; null: the agent's own. Absent: the project's (`nucleus.effort`). */
  effort?: string | null;
}

/**
 * `GET /api/nucleus/efforts`: the levels Nucleus can start at, and its models (V47); also Scribe's and
 * the merger's. Read only where they are shown: Codex's are on its app server, whose daemon a read
 * starts.
 */
export interface AgentLevels {
  /**
   * The agents installed, Nucleus's default first; each one's levels on the model it would start
   * on, its models and the model it runs on without the project's, when Symbiote can read them.
   */
  agents: {
    kind: AgentKind;
    efforts?: AgentEfforts;
    models?: AgentModel[];
    defaultModel?: DefaultModel;
  }[];
  /** `nucleus.effort` (`scribe.effort`, `merge.effort`) in the project's config: the level used. */
  effort?: string;
  /** `nucleus.model` (`scribe.model`, `merge.model`) in the project's config (V47). */
  model?: string;
  /** The project's config file, repo-relative: `symbiote/config.json`. */
  file: string;
}

/**
 * `POST /api/nucleus/effort`: Nucleus's level in the project's config (Scribe's, the merger's); null
 * removes it.
 */
export interface EffortChange {
  effort: string | null;
}

/** `POST /api/nucleus/model` (V47): Nucleus's model in the project's config; null removes it. */
export interface ModelChange {
  model: string | null;
}

/** `POST /api/nucleus/terminal`: a terminal on Nucleus's session, at that size. */
export interface PageAgentTerminalRequest {
  cols: number;
  rows: number;
}
