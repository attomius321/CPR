// Features started from the commits page (V18): what `cpr view`'s server answers and the viewer
// reads. Types only; the CLI keeps the records and starts the agents.

/** How a feature's agent is doing, as the commits page shows it. */
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
  /** No agent found to start: the feature's prompt is copied instead. */
  | 'no-agent'
  /** The agents could not be listed (`error`). */
  | 'unknown';

export interface FeatureAgentState {
  state: AgentStateName;
  kind?: AgentKind;
  /** What a session that needs the person waits for, in Claude Code's words. */
  waitingFor?: string;
  /** Claude Code's short session ID, for `claude attach`. */
  id?: string;
  /** Why the agent did not start, or why its state is unknown. */
  error?: string;
}

export type AgentKind = 'claude';

/** Claude Code's permission modes CPR may start an agent in; `default` passes none. */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto';
export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto'];

/** A feature and its agent, for the commits page. */
export interface FeatureSummary {
  branch: string;
  /** The commit the branch started at, and the branch it was taken from (absent: a picked row). */
  base: string;
  from?: string;
  created: string;
  planFirst: boolean;
  brief: string;
  worktree: { path: string; exists: boolean };
  /** The branch's tip; null once the branch is gone. */
  tip: string | null;
  /** The branch's commits since its base. */
  ahead: number;
  /** Its commits are all in the default branch. */
  merged: boolean;
  agent: FeatureAgentState;
}

export interface FeatureList {
  features: FeatureSummary[];
  /** Where features are kept: `cpr/features/`, else CPR's cache (`note` says why). */
  place: 'repository' | 'cache';
  note?: string;
}

/** What the start dialog needs. */
export interface FeatureOptions {
  /** The default branch's tip, where a feature starts unless a row is picked. */
  base: { from: string; sha: string } | null;
  /** Proposed names start with it (`feature/`). */
  branchPrefix: string;
  /** Where a worktree goes, `<branch>` standing for the branch's folder name. */
  worktrees: string;
  /** The agent CPR starts; null when none is installed. */
  agent: {
    kind: AgentKind;
    /** The program run, as found. */
    command: string;
    /** Whose account it runs on (`claude auth status`), e.g. "your Pro subscription". */
    account?: string;
    /** An API key in `cpr view`'s environment, which the agent may use instead. */
    apiKey?: boolean;
    permissionMode: PermissionMode;
  } | null;
  /** Longest brief accepted. */
  maxBrief: number;
}

/** `POST /api/features`. */
export interface FeatureRequest {
  brief: string;
  branch: string;
  /** A full SHA; the default branch's tip when absent. */
  base?: string;
  planFirst: boolean;
  permissionMode?: PermissionMode;
}

/** A feature just made or restarted, with the prompt its agent was given (to copy). */
export interface FeatureStart {
  feature: FeatureSummary;
  prompt: string;
}
