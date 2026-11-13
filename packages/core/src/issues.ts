// Issues as Symbiote reads them from GitHub or GitLab (IS1), and the Issues page's API: the forge
// package reads them, `symbiote view` serves them, the viewer draws them.

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
}
