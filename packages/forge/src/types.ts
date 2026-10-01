export type ForgeKind = 'github' | 'gitlab';

/** A pull request (GitHub) or merge request (GitLab), as CPR needs it. */
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
}

export type ReviewEvent = 'comment' | 'approve' | 'request-changes';

/** A comment on one line of the change: a line of the head file, or of the base file for removed code. */
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
}

/** What a forge adapter reads from the environment: tokens and API URL overrides. */
export type Env = Readonly<Record<string, string | undefined>>;
