export type ForgeKind = 'github' | 'gitlab';

/** A pull request (GitHub) or merge request (GitLab), as Symbiote needs it. */
export interface ChangeRequest {
  forge: ForgeKind;
  /** `#12` on GitHub, `!12` on GitLab. */
  number: number;
  title: string;
  /** Web page of the change request. */
  url: string;
  author: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  /** Target branch and its commit when the change request was last updated. */
  base: { ref: string; sha: string };
  /** Source branch and its latest commit. */
  head: { ref: string; sha: string };
  /** The commit the forge shows the diff against, when it says (GitLab's `base_sha`). */
  mergeBase: string | null;
  /** Remote refs to fetch so both commits exist locally. */
  refs: { base: string; head: string };
  /** The forge says it cannot be merged: it conflicts with its base (HV8); absent when not known. */
  conflict?: true;
  /** The commit its merge made, once merged (HV8). */
  mergeCommit?: string;
}

/** A pull or merge request to open (HV8): from `head` into `base`, ready, not a draft. */
export interface NewChangeRequest {
  head: string;
  base: string;
  title: string;
  body: string;
}

export type ReviewEvent = 'comment' | 'approve' | 'request-changes';

/** A comment on one line of the change: a line of the head file, or of the base file for removed
 * code. */
export interface ReviewComment {
  side: 'head' | 'base';
  /** Repo-relative path on that side. */
  path: string;
  /** The same file's path on the other side (differs for renames). */
  otherPath: string;
  line: number;
  body: string;
}

export interface Review {
  event: ReviewEvent;
  /** Summary text; may be empty for a plain approval. */
  body: string;
  comments: ReviewComment[];
}

export interface Forge {
  readonly kind: ForgeKind;
  /** `owner/repo` or `group/subgroup/project`. */
  readonly project: string;
  readonly host: string;
  getChangeRequest(number: number): Promise<ChangeRequest>;
  /** Publishes a review with inline comments; returns where to see it. */
  submitReview(request: ChangeRequest, review: Review): Promise<{ url: string }>;
  /** The text of every comment, review and note on the change request so far. */
  commentBodies(request: ChangeRequest): Promise<string[]>;
  /** Whether a token for this host's API is found (HV8): without one, nothing is opened. */
  readonly token: boolean;
  /** Opens a request from `head` into `base`, ready for review (HV8). */
  openChangeRequest(request: NewChangeRequest): Promise<ChangeRequest>;
  /** The open request from `head` into `base`, read whole, or null (HV8). */
  findOpenRequest(head: string, base: string): Promise<ChangeRequest | null>;
  /** Replaces the request's description (HV8). */
  updateDescription(request: ChangeRequest, body: string): Promise<void>;
  /** A page of the project's issues, most recently updated first; never a pull request (IS1). */
  listIssues(query: IssueQuery): Promise<IssuePage>;
  /** One issue whole: its text and its first 100 comments (IS1). */
  getIssue(number: number): Promise<Issue>;
}

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
  forge: ForgeKind;
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

/** What a forge adapter reads from the environment: tokens and API URL overrides. */
export type Env = Readonly<Record<string, string | undefined>>;
