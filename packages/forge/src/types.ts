import type { Issue, IssuePage, IssueQuery } from '@symbiote/core';

export type ForgeKind = 'github' | 'gitlab';

export type {
  Issue,
  IssueAuthor,
  IssueAuthorRole,
  IssueComment,
  IssueFilter,
  IssueLabel,
  IssuePage,
  IssueQuery,
  IssueSummary,
} from '@symbiote/core';

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

/** Why an issue is closed (HV11): GitHub's `state_reason`; GitLab keeps none. */
export type IssueCloseReason = 'completed' | 'not-planned';

/** What Symbiote reads of an issue before it writes to it (HV11, decision 1022). */
export interface IssueWriteState {
  state: 'open' | 'closed';
  /** Its conversation is locked: only members may comment (GitHub's `locked`, GitLab's
   * `discussion_locked`). */
  locked: boolean;
  /** The names of its labels. */
  labels: string[];
}

/** A label Symbiote sets (HV11): made in the project with this colour and description if missing. */
export interface NewLabel {
  name: string;
  /** `#rrggbb`. */
  color: string;
  description: string;
}

/** Labels to add to an issue and to remove from it (HV11). */
export interface IssueLabelChange {
  add: NewLabel[];
  remove: string[];
}

/**
 * The account a token writes as (HV11, decision 1077), and whether it may write to issues:
 * `unknown` where the forge does not say (a fine-grained GitHub token).
 */
export interface TokenAccount {
  login: string;
  write: 'yes' | 'no' | 'unknown';
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
  /** Comments on issue `number`; returns the comment's page (HV11, decision 1018). */
  commentOnIssue(number: number, body: string): Promise<{ url: string }>;
  /** Closes issue `number` (HV11); GitLab keeps no reason. */
  closeIssue(number: number, reason: IssueCloseReason): Promise<void>;
  /**
   * Adds and removes labels (HV11): a label to add is made in the project first, once, if it is
   * missing; removing one the issue does not have is no error.
   */
  labelIssue(number: number, change: IssueLabelChange): Promise<void>;
  /** Issue `number`'s state, whether it is locked, its labels: a conditional read (HV11). */
  issueState(number: number): Promise<IssueWriteState>;
  /** Who the token writes as, and whether it may write to issues (HV11, decision 1077). */
  tokenAccount(): Promise<TokenAccount>;
}

/** What a forge adapter reads from the environment: tokens and API URL overrides. */
export type Env = Readonly<Record<string, string | undefined>>;
