// The agents a workspace runs (V18, V20a, V30b, V47): their kinds and permission modes, how one is
// doing, what it runs on, and the models and effort levels each lists. Types only.

/** How a workspace's agent is doing, as the commits page shows it. */
export type AgentStateName =
  /** Working on it. */
  | 'working'
  /** Waiting for the person: a permission prompt, an answer (`waitingFor`). */
  | 'needs-you'
  /** Finished with "plan first" and no commits yet: the plan waits for the person's OK. */
  | 'plan-ready'
  /** Finished with commits on the branch: ready for review. */
  | 'ready'
  /** Finished without commits. */
  | 'done'
  | 'failed'
  | 'stopped'
  /** Started once; no session is listed now (removed, or ended long ago). */
  | 'not-running'
  /** The start failed (`error` says why); the agent can be started again. */
  | 'not-started'
  /** No agent found to start: the workspace's prompt is copied instead. */
  | 'no-agent'
  /** The agents could not be listed (`error`). */
  | 'unknown';

export interface WorkspaceAgentState {
  state: AgentStateName;
  kind?: AgentKind;
  /** What a session that needs the person waits for, in Claude Code's words. */
  waitingFor?: string;
  /** Its turn was interrupted (Esc): it waits at its prompt, and no hook said so. */
  interrupted?: true;
  /**
   * Claude Code's short session ID, for `claude attach`; Codex's thread ID, for `codex resume`.
   */
  id?: string;
  /**
   * Codex on its app server (V27a): the server's address (`unix://…`), for `codex resume
   * --remote`. Turns typed there are in the thread, and a message while it works joins its turn.
   */
  remote?: string;
  /** Why the agent did not start, or why its state is unknown. */
  error?: string;
  /**
   * The effort level it was started at (V30b); absent for its own default. Its session may have
   * changed it since (Claude Code's `/effort`): Symbiote does not read it back.
   */
  effort?: string;
  /** The model it was started on (V47); absent for its default. Its session may change it since. */
  model?: string;
  /**
   * What it runs on, read back from its session (V83): Claude Code's newest answer in its
   * transcript, Codex's thread on its app server. Absent when nothing was read: then `model` and
   * `effort`, how it started, are all Symbiote knows.
   */
  runsOn?: AgentRunsOn;
}

/**
 * What an agent runs on (V83), as it says it: the model's own ID (`claude-opus-5-5`,
 * `gpt-6-luna`), the level, and as of when. A field it does not say is left out.
 */
export interface AgentRunsOn {
  model?: string;
  effort?: string;
  /** The answer it was read from (Claude Code), or the thread's last change (Codex). */
  at?: string;
}

/** The agents Symbiote starts: Claude Code (V18) and Codex (V20a). */
export type AgentKind = 'claude' | 'codex';

export const AGENT_KINDS: readonly AgentKind[] = ['claude', 'codex'];

/**
 * Claude Code's permission modes Symbiote may start an agent in, each passed by name: `default`
 * is the mode that asks, as Claude Code's `manual` where it lists that name (no longer its own
 * default: 2.1.323 started in `auto` when given none, fix/default-permission-mode).
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto';

export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto'];

/** An agent the start page offers (V20a). */
export interface AgentOption {
  kind: AgentKind;
  /** The program run, as found. */
  command: string;
  /**
   * Whose account it runs on (`claude auth status`, `codex login status`), e.g. "your Pro
   * subscription", "your ChatGPT account".
   */
  account?: string;
  /** Claude Code: an API key in `symbiote view`'s environment, which it may use instead. */
  apiKey?: boolean;
  /** Claude Code: the permission mode it starts in unless the person picks another. */
  permissionMode?: PermissionMode;
  /** The effort levels it takes (V30b) on its default model; absent when Symbiote cannot read
   * them: no choice is offered. */
  efforts?: AgentEfforts;
  /** The models it lists (V47), in its order; absent when Symbiote cannot read them: no choice. */
  models?: AgentModel[];
  /** The model it runs on when none is picked, when Symbiote knows it (V47). */
  defaultModel?: DefaultModel;
}

/**
 * A model as Symbiote passes it to an agent (V47): the agent's own ID (`opus`,
 * `claude-opus-4-6`, `gpt-6-luna`), never an option or a sentence.
 */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,99}$/;

/** A model an agent lists (V47): Claude Code's `initialize` answer, Codex's `model/list`. */
export interface AgentModel {
  /** What the agent takes: Claude Code's `--model`, Codex's `model`. */
  id: string;
  /** Its name in the agent's words: "Sonnet 5.5", "GPT-6-Luna". */
  name: string;
  description?: string;
  /** The levels it takes; absent: none (Claude Code's Haiku 4.5). */
  efforts?: AgentEfforts;
}

/** An agent's models (V47), and the one it runs on without a pick when it says (Codex). */
export interface AgentModels {
  models: AgentModel[];
  default?: string;
}

/**
 * The model an agent runs on when none is picked (V47), and whose choice it is: the agent's
 * configuration (Codex's), the project's (`agent.model`), or Symbiote's (the merger's `sonnet`).
 */
export interface DefaultModel {
  id: string;
  by: 'agent' | 'project' | 'symbiote';
}

/**
 * An effort level as Symbiote passes it to an agent (V30b): a lowercase word (`xhigh`), never an
 * option or a sentence. Both agents' levels are such words.
 */
export const EFFORT_LEVEL = /^[a-z][a-z-]{0,23}$/;

/** An agent's effort levels as it lists them (V30b): Claude Code's `--help`, Codex's models. */
export interface AgentEfforts {
  levels: string[];
  /** Its own level when none is given, when the agent says (Codex's configuration). */
  default?: string;
  /** Whose choice `default` is when not the agent's: Symbiote's (the advisor's `low`, V75c). */
  by?: 'symbiote';
}
