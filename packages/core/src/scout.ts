// Scout (V35): a read-only agent in the checkout `symbiote view` runs in, asked from its page. Types
// only; the CLI starts the agent, keeps its record in `symbiote/scout.json` and serves `/api/scout`.
import type { AgentKind, TerminalAvailability } from './workspaces.js';

/** What Scout's agent is doing, as its page and the sidenav say it. */
export type ScoutStateName =
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

/** Scout's conversation: one per repository, kept until the person starts a new one. */
export interface ScoutConversation {
  kind: AgentKind;
  started: string;
  state: ScoutStateName;
  /** Claude Code's session, as `claude attach` takes it; Codex's thread. Absent once gone. */
  id?: string;
  /** Why its state is unknown. */
  error?: string;
}

/** An agent Scout can run, installed here. */
export interface ScoutAgent {
  kind: AgentKind;
  command: string;
}

/** `GET /api/scout`, and what a question or a new conversation answers. */
export interface ScoutState {
  /** The folder Scout reads: the checkout `symbiote view` runs in. */
  checkout: string;
  /** The agents installed, the one Scout runs unless another is picked first. */
  agents: ScoutAgent[];
  conversation: ScoutConversation | null;
  /** Whether its terminal can run (V21); absent until there is a conversation. */
  terminal?: TerminalAvailability;
}

/** `POST /api/scout/ask`: a question; it starts a conversation, or continues the one there is. */
export interface ScoutAsk {
  text: string;
  /** The agent to start (a new conversation only); the default one when absent. */
  agent?: AgentKind;
}

/** `POST /api/scout/terminal`: a terminal on Scout's session, at that size. */
export interface ScoutTerminalRequest {
  cols: number;
  rows: number;
}
