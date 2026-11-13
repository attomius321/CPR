// Issues as Symbiote reads them from GitHub or GitLab (IS1), and the Issues page's API: the forge
// package reads them, `symbiote view` serves them, the viewer draws them.
import type { AgentLevels } from './page-agent.js';
import type { WorkKind } from './workspaces.js';

/** Which issues a list holds (IS1). */
export type IssueFilter = 'open' | 'closed' | 'all';

export interface IssueQuery {
  state: IssueFilter;
  /** Words to find in titles, at the forge. */
  search?: string;
  /** Where the list goes on: a page's `next`, as the forge gave it. */
  cursor?: string;
}

export interface IssuePage {
  issues: IssueSummary[];
  /** The cursor of the next page; absent on the last. */
  next?: string;
}

/**
 * The author's standing in the project (IS1, decision 951): GitHub's `author_association` in
 * words; on GitLab, the access level (`member` for guest to developer).
 */
export type IssueAuthorRole =
  | 'owner'
  | 'maintainer'
  | 'member'
  | 'collaborator'
  | 'contributor'
  | 'first-time contributor'
  | 'none';

export interface IssueAuthor {
  login: string;
  /** Absent where the forge does not say (GitLab's list; GitLab without a token). */
  role?: IssueAuthorRole;
  /**
   * GitLab's access level in the project, read with a token (HV9b, decision 1043): Developer is
   * 30. Absent on GitHub and for someone outside the project.
   */
  level?: number;
  bot?: true;
}

export interface IssueLabel {
  name: string;
  /** `#rrggbb`, only when the forge gives one that is. */
  color?: string;
}

/**
 * An issue as a list shows it (IS1): what a later brief or workspace record takes from it too.
 * Its text is the issue author's, untrusted.
 */
export interface IssueSummary {
  forge: 'github' | 'gitlab';
  /** `#12` on both forges (GitLab's `iid`). */
  number: number;
  title: string;
  /** Its page on the forge. */
  url: string;
  state: 'open' | 'closed';
  labels: IssueLabel[];
  author: IssueAuthor;
  /** How many comments it has (GitLab: notes by people, not the system's). */
  comments: number;
  /** ISO times. */
  created: string;
  updated: string;
}

export interface IssueComment {
  author: IssueAuthor;
  /** Markdown, untrusted. */
  body: string;
  created: string;
  /** Its place on the forge's page. */
  url?: string;
}

/** One issue whole (IS1). */
export interface Issue extends IssueSummary {
  /** Markdown, untrusted; empty when the issue has none. */
  body: string;
  /** The first 100 comments, oldest first. */
  thread: IssueComment[];
  /** Comments not read: past the first 100, or every one when they need a token. */
  moreComments: number;
  /** GitLab reads notes only with a token: none was found. */
  commentsNeedToken?: true;
}

/** Why the page cannot list issues: no `origin`, a remote on neither forge, the forge's error. */
export interface IssueProblem {
  kind: 'no-origin' | 'no-forge' | 'forge';
  message: string;
}

/** The forge an answer came from, and whether a token for it was found (decision 945). */
export interface IssueSource {
  forge?: { kind: 'github' | 'gitlab'; host: string; project: string };
  token: boolean;
  /** What to set for a token, when none was found. */
  tokenHint?: string;
  problem?: IssueProblem;
}

/** `GET /api/issues`: a page of the list, or its problem. */
export interface IssueListAnswer extends IssueSource {
  issues?: IssueSummary[];
  next?: string;
}

/** `GET /api/issues/<number>`: the issue whole, or its problem. */
export interface IssueAnswer extends IssueSource {
  issue?: Issue;
  /**
   * The hash of the snapshot the classifier would read of it now (HV9c, decision 1057): a record
   * whose `snapshot.hash` differs was classified on other text.
   */
  snapshot?: string;
}

// The classifier's record (HV9b; types here since HV9c, for the Issues page and Settings).

/** What the issue asks beyond a change to the code: p2's flags (decisions 1003, 1035). */
export const CLASSIFIER_FLAGS = [
  'agent-instructions',
  'secrets',
  'outside-actions',
  'ci-or-release',
  'new-dependency',
  'weakens-checks',
] as const;
export type ClassifierFlag = (typeof CLASSIFIER_FLAGS)[number];

/** Why an issue is refused, in a word (decision 1003); `none` for an answer that does not refuse. */
export const CLASSIFIER_REFUSALS = [
  'none',
  'not-a-change',
  'out-of-scope',
  'too-large',
  'unsafe',
] as const;
export type ClassifierRefusal = Exclude<(typeof CLASSIFIER_REFUSALS)[number], 'none'>;

/** What Symbiote flags itself, before the model (decision 1005). */
export type IssueSnapshotFlag = 'hidden-text' | 'cut';

/** The classifier's answer, as its schema holds it (HV9's table). */
export interface ClassifierAnswer {
  decision: 'take' | 'ask' | 'refuse';
  reasons: string[];
  refusal: (typeof CLASSIFIER_REFUSALS)[number];
  question: string;
  kind: WorkKind;
  title: string;
  parts: Record<string, string>;
  size: 'small' | 'medium' | 'large';
  model: string;
  effort: string;
  flags: ClassifierFlag[];
}

/** Why a take waits for a click: a holding flag, or a brief that names the person (1034, 1042). */
export type ClassifierHold = 'new-dependency' | 'weakens-checks' | IssueSnapshotFlag | 'personal';

/** What the person's own names an answer holds, by name (decisions 1037, 1042). */
export interface ClassifierPersonal {
  question?: string[];
  brief?: string[];
}

/** The snapshot of an issue the classifier read, kept in its record (decision 1001). */
export interface IssueSnapshot {
  /** SHA-256 of what was read, raw: any edit to it changes the hash. */
  hash: string;
  /** When it was taken. */
  at: string;
  /** The text between `<issue>` tags. */
  text: string;
  /** How many comments were read: the members' and the author's. */
  read: { members: number; author: number };
  /** Comments left out: by people outside the project, past the first 100, or needing a token. */
  outside: number;
  /** GitLab reads no comment without a token. */
  commentsNeedToken?: true;
  /** Symbiote's own flags (decision 1005). */
  flags: IssueSnapshotFlag[];
}

/** Who classified: what a repository's count is kept for (decisions 1040, 1041). */
export interface ClassifierIdentity {
  agent: 'claude';
  /** Claude Code's version: recorded, not part of `identity`. */
  version?: string;
  model: string;
  effort?: string;
  /** SHA-256 of the prompt's text, of the card's, and of them with the model, effort and rules. */
  prompt: string;
  card: string;
  rules: number;
  identity: string;
}

/** One classification: the snapshot, the run, the answer and the decision after Symbiote's rules. */
export interface IssueClassification {
  snapshot: IssueSnapshot;
  decision: ClassifierAnswer['decision'] | 'failed';
  refusal?: ClassifierRefusal;
  /** The flags that refused it as unsafe, whatever the model decided (decision 1005). */
  refusedBy?: ClassifierFlag[];
  /** Why a take waits for the person's click (decisions 1034, 1042). */
  held?: ClassifierHold[];
  /** Why it failed: what did not fit, `declined`, `no answer`, `exit <code>`. */
  failed?: string;
  /** The model's last answer, as given. */
  answer?: ClassifierAnswer;
  personal?: ClassifierPersonal;
  /** For a take: what the writer would get in place of the issue's text (decision 1004). */
  brief?: string;
  classifier: ClassifierIdentity;
  run: {
    at: string;
    ms: number;
    /** Claude Code's `total_cost_usd`, both tries. */
    cost: number;
    tries: number;
    /** What did not fit the first time, when it was asked again. */
    retried?: string;
    usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  };
}

/** The forge an issue is on: a record of another is never read. */
export interface IssueForge {
  kind: 'github' | 'gitlab';
  host: string;
  project: string;
}

/** `symbiote/issues/<number>.json` (decision 1007), and `GET /api/issues/<n>/classification`. */
export interface IssueRecord extends IssueClassification {
  about?: string;
  forge: IssueForge;
  number: number;
  url: string;
  title: string;
  state: 'open' | 'closed';
}

/** A row's decision (HV9c, decision 1055): the record's, short. */
export interface IssueDecision {
  number: number;
  decision: IssueRecord['decision'];
  held?: ClassifierHold[];
  refusal?: ClassifierRefusal;
  /** When it ran. */
  at: string;
}

/** `GET /api/issues/classifications` (HV9c): every record's decision, and what classifying needs. */
export interface IssueDecisions {
  decisions: IssueDecision[];
  /** Whether `hive.issues.about` is set: without it, classifying is refused (decision 1038). */
  about: boolean;
  /** The classifier's identity now (1041); absent without a forge, Claude Code or `about`. */
  identity?: string;
}

/** How many judged takes a repository needs, and the share right, before 1040's bar is met. */
export const CLASSIFIER_BAR = { takes: 20, right: 0.95 } as const;

/** A repository's standing against decision 1040's bar (HV9c, decision 1059). */
export interface ClassifierStanding {
  /** The classifier's identity now. */
  identity: string;
  /** The first classification under it. */
  since?: string;
  /** Records under the identity by decision; `held` counts takes that wait for a click. */
  classified: { take: number; held: number; ask: number; refuse: number; failed: number };
  /** Takes under the identity judged by how they ended (`judged` events, from HV10 on). */
  judged: { right: number; wrong: number };
  bar: typeof CLASSIFIER_BAR;
  /** HV9a's hostile sets run with this identity: null until something runs them (HV13). */
  hostile: { taken: number; of: number; at: string } | null;
  /** Whether the repository meets the bar: work may start from an issue with no click (HV13). */
  meets: boolean;
}

/** `GET /api/hive/classifier` (HV9c): Settings' Issues group. */
export interface ClassifierSettings {
  /** `hive.issues.about` as written; null when unset. */
  about: string | null;
  /** The longest it may be saved (decision 1060). */
  maxAbout: number;
  /** Claude Code's models and levels, the classifier's `model` and `effort` as set. */
  levels: AgentLevels;
  /** Null when there is no identity to count under: `why` says what is missing. */
  standing: ClassifierStanding | null;
  why?: string;
}
