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
}

/** What a forge adapter reads from the environment: tokens and API URL overrides. */
export type Env = Readonly<Record<string, string | undefined>>;
