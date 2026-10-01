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

export interface Forge {
  readonly kind: ForgeKind;
  /** `owner/repo` or `group/subgroup/project`. */
  readonly project: string;
  readonly host: string;
  getChangeRequest(number: number): Promise<ChangeRequest>;
}

/** What a forge adapter reads from the environment: tokens and API URL overrides. */
export type Env = Readonly<Record<string, string | undefined>>;
