import { spawnSync } from 'node:child_process';
import { SymbioteError } from '@symbiote/core';
import { answered, api, ForgeError, paged, read, type ReadAnswer } from './http.js';
import {
  COMMENTS,
  cursorOf,
  ISSUES_PER_PAGE,
  knowLabel,
  labelKnown,
  labelOf,
  MAX_CALLS,
  readCursor,
  writeCursor,
  type Cursor,
} from './issues.js';
import type {
  ChangeRequest,
  Env,
  Forge,
  Issue,
  IssueAuthor,
  IssueAuthorRole,
  IssueCloseReason,
  IssueFilter,
  IssueLabelChange,
  IssuePage,
  IssueQuery,
  IssueSummary,
  IssueWriteState,
  NewChangeRequest,
  NewLabel,
  Review,
  TokenAccount,
} from './types.js';

const TOKEN_HINT = 'GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login';

/** What to set for a GitHub Enterprise host, whose token the environment does not name. */
const enterpriseHint = (host: string) =>
  `GH_ENTERPRISE_TOKEN with GH_HOST=${host}, or GITHUB_TOKEN with GITHUB_API_URL=https://${host}/api/v3, or log in with gh auth login --hostname ${host}`;

interface PullResponse {
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  state: 'open' | 'closed';
  merged_at: string | null;
  draft?: boolean;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  /** Whether it can be merged: null while GitHub works it out (after a push). */
  mergeable?: boolean | null;
  mergeable_state?: string;
  merge_commit_sha?: string | null;
}

/** An issue as GitHub's REST API gives it; pull requests come too, with `pull_request`. */
interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  user: GitHubUser | null;
  labels: ({ name?: string; color?: string | null } | string)[];
  state: 'open' | 'closed';
  comments?: number;
  created_at: string;
  updated_at: string;
  author_association?: string;
  body?: string | null;
  pull_request?: unknown;
  /** Its conversation is locked (HV11). */
  locked?: boolean;
}

interface GitHubUser {
  login: string;
  type?: string;
}

interface GitHubComment {
  html_url?: string;
  user: GitHubUser | null;
  created_at: string;
  author_association?: string;
  body?: string | null;
}

/** `author_association` in words (decision 951). */
const ROLES: Record<string, IssueAuthorRole> = {
  OWNER: 'owner',
  MEMBER: 'member',
  COLLABORATOR: 'collaborator',
  CONTRIBUTOR: 'contributor',
  FIRST_TIME_CONTRIBUTOR: 'first-time contributor',
  FIRST_TIMER: 'first-time contributor',
  MANNEQUIN: 'none',
  NONE: 'none',
};

function authorOf(user: GitHubUser | null, association: string | undefined): IssueAuthor {
  const role = association ? ROLES[association] : undefined;
  return {
    login: user?.login ?? 'ghost',
    ...(role ? { role } : {}),
    ...(user?.type === 'Bot' ? { bot: true as const } : {}),
  };
}

function summaryOf(issue: GitHubIssue): IssueSummary {
  return {
    forge: 'github',
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state === 'closed' ? 'closed' : 'open',
    labels: issue.labels.map(labelOf),
    author: authorOf(issue.user, issue.author_association),
    comments: issue.comments ?? 0,
    created: issue.created_at,
    updated: issue.updated_at,
  };
}

/** GitHub and GitHub Enterprise pull requests, and issues (IS1). */
export class GitHubForge implements Forge {
  readonly kind = 'github';
  private readonly apiBase: string;
  private readonly secret: string | undefined;
  private readonly tokenHint: string;

  constructor(
    readonly host: string,
    readonly project: string,
    env: Env,
    /** gh's token for a host (tests pass their own, so no real one is read). */
    stored: (host: string) => string | undefined = ghToken,
  ) {
    this.apiBase = (
      env.GITHUB_API_URL ??
      (host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`)
    ).replace(/\/+$/, '');
    this.secret = githubToken(host, env, stored);
    this.tokenHint = host === 'github.com' ? TOKEN_HINT : enterpriseHint(host);
  }

  get token(): boolean {
    return this.secret !== undefined;
  }

  async getChangeRequest(number: number): Promise<ChangeRequest> {
    return this.fromPull(
      await this.request<PullResponse>(`/repos/${this.project}/pulls/${number}`),
    );
  }

  async openChangeRequest({ head, base, title, body }: NewChangeRequest): Promise<ChangeRequest> {
    const pull = await this.request<PullResponse>(`/repos/${this.project}/pulls`, 'POST', {
      head,
      base,
      title,
      body,
      draft: false,
    });
    return this.fromPull(pull);
  }

  async findOpenRequest(head: string, base: string): Promise<ChangeRequest | null> {
    const owner = this.project.split('/')[0] ?? '';
    const filter = `state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`;
    const pulls = await paged((query) =>
      this.request<PullResponse[]>(`/repos/${this.project}/pulls?${filter}&${query}`),
    );
    const found = pulls.find((pull) => pull.head.ref === head) ?? pulls[0];
    return found ? this.fromPull(found) : null;
  }

  async updateDescription(request: ChangeRequest, body: string): Promise<void> {
    await this.request(`/repos/${this.project}/pulls/${request.number}`, 'PATCH', { body });
  }

  private fromPull(pull: PullResponse): ChangeRequest {
    const merged = !!pull.merged_at;
    return {
      forge: 'github',
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      author: pull.user?.login ?? 'unknown',
      state: merged ? 'merged' : pull.state,
      draft: pull.draft ?? false,
      base: { ref: pull.base.ref, sha: pull.base.sha },
      head: { ref: pull.head.ref, sha: pull.head.sha },
      mergeBase: null,
      refs: { base: `refs/heads/${pull.base.ref}`, head: `refs/pull/${pull.number}/head` },
      ...(!merged && pull.mergeable === false && pull.mergeable_state === 'dirty'
        ? { conflict: true as const }
        : {}),
      ...(merged && pull.merge_commit_sha ? { mergeCommit: pull.merge_commit_sha } : {}),
    };
  }

  /**
   * A page of issues (decision 946): the list of issues and pull requests read 100 at a time,
   * the pull requests dropped, until 30 issues or 3 calls; a page cut short goes on from where it
   * stopped. A search goes to the search API, which keeps pull requests out itself.
   */
  async listIssues({ state, search, cursor }: IssueQuery): Promise<IssuePage> {
    const at = cursor === undefined ? undefined : readCursor(cursor);
    const words = search?.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (words) return this.searchIssues(state, words, at);
    const issues: IssueSummary[] = [];
    let page: Cursor | undefined = at ?? { page: 1, skip: 0 };
    for (let calls = 0; page && calls < MAX_CALLS; calls++) {
      const where =
        page.page > 1 || page.after
          ? `&page=${page.page}${page.after ? `&after=${encodeURIComponent(page.after)}` : ''}`
          : '';
      const answer: ReadAnswer<GitHubIssue[]> = await this.read<GitHubIssue[]>(
        `/repos/${this.project}/issues?state=${state}&sort=updated&direction=desc&per_page=100${where}`,
      );
      const fresh = answer.body
        .filter((item) => !item.pull_request)
        .map(summaryOf)
        .slice(page.skip);
      const room = ISSUES_PER_PAGE - issues.length;
      if (fresh.length > room) {
        issues.push(...fresh.slice(0, room));
        return { issues, next: writeCursor({ ...page, skip: page.skip + room }) };
      }
      issues.push(...fresh);
      page = cursorOf(answer.next);
      if (issues.length === ISSUES_PER_PAGE) break;
    }
    return { issues, ...(page ? { next: writeCursor(page) } : {}) };
  }

  private async searchIssues(
    state: IssueFilter,
    words: string,
    at: Cursor | undefined,
  ): Promise<IssuePage> {
    const q = `repo:${this.project} is:issue in:title${state === 'all' ? '' : ` is:${state}`} "${words}"`;
    const answer = await this.read<{ items: GitHubIssue[] }>(
      `/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=${ISSUES_PER_PAGE}&page=${at?.page ?? 1}`,
    );
    const next = cursorOf(answer.next);
    return {
      issues: answer.body.items.filter((item) => !item.pull_request).map(summaryOf),
      ...(next ? { next: writeCursor(next) } : {}),
    };
  }

  /** An issue and its first 100 comments, oldest first (decision 948). */
  async getIssue(number: number): Promise<Issue> {
    const { body: issue } = await this.read<GitHubIssue>(`/repos/${this.project}/issues/${number}`);
    if (issue.pull_request) throw new SymbioteError(`#${number} is a pull request, not an issue`);
    const summary = summaryOf(issue);
    const comments =
      summary.comments > 0
        ? (
            await this.read<GitHubComment[]>(
              `/repos/${this.project}/issues/${number}/comments?per_page=${COMMENTS}`,
            )
          ).body
        : [];
    return {
      ...summary,
      body: issue.body ?? '',
      thread: comments.map((comment) => ({
        author: authorOf(comment.user, comment.author_association),
        body: comment.body ?? '',
        created: comment.created_at,
        ...(comment.html_url ? { url: comment.html_url } : {}),
      })),
      moreComments: Math.max(0, summary.comments - comments.length),
    };
  }

  /** Comments on an issue (HV11, decision 1018). */
  async commentOnIssue(number: number, body: string): Promise<{ url: string }> {
    this.requireToken('Commenting on an issue');
    const made = await this.request<{ html_url?: string }>(
      `/repos/${this.project}/issues/${number}/comments`,
      'POST',
      { body },
    );
    return { url: made?.html_url ?? `https://${this.host}/${this.project}/issues/${number}` };
  }

  /** Closes an issue with GitHub's reason (HV11). */
  async closeIssue(number: number, reason: IssueCloseReason): Promise<void> {
    this.requireToken('Closing an issue');
    await this.request(`/repos/${this.project}/issues/${number}`, 'PATCH', {
      state: 'closed',
      state_reason: reason === 'completed' ? 'completed' : 'not_planned',
    });
  }

  /**
   * Adds and removes labels (HV11). Each label to add is made first if missing, once a project:
   * GitHub's add would make it itself, grey and without its description.
   */
  async labelIssue(number: number, { add, remove }: IssueLabelChange): Promise<void> {
    this.requireToken('Labelling an issue');
    for (const label of add) await this.ensureLabel(label);
    const issue = `/repos/${this.project}/issues/${number}/labels`;
    if (add.length > 0) await this.request(issue, 'POST', { labels: add.map((l) => l.name) });
    for (const name of remove) {
      await this.request(`${issue}/${encodeURIComponent(name)}`, 'DELETE').catch(unless(404));
    }
  }

  /** Makes `label` in the project unless it is there; one made meanwhile (422) is taken. */
  private async ensureLabel(label: NewLabel): Promise<void> {
    if (labelKnown(this.apiBase, this.project, label.name)) return;
    const labels = `/repos/${this.project}/labels`;
    const found = await this.request(`${labels}/${encodeURIComponent(label.name)}`).then(
      () => true,
      unless(404, false),
    );
    if (!found) {
      await this.request(labels, 'POST', {
        name: label.name,
        color: label.color.replace(/^#/, ''),
        description: label.description,
      }).catch(unless(422));
    }
    knowLabel(this.apiBase, this.project, label.name);
  }

  /** An issue's state, lock and labels: a conditional read (HV11). */
  async issueState(number: number): Promise<IssueWriteState> {
    const { body: issue } = await this.read<GitHubIssue>(`/repos/${this.project}/issues/${number}`);
    if (issue.pull_request) throw new SymbioteError(`#${number} is a pull request, not an issue`);
    return {
      state: issue.state === 'closed' ? 'closed' : 'open',
      locked: issue.locked === true,
      labels: issue.labels.map((label) => labelOf(label).name),
    };
  }

  /**
   * Who the token is (decision 1077): a classic token lists its scopes in `x-oauth-scopes`, and
   * `repo` or `public_repo` writes to issues; a fine-grained token lists none.
   */
  async tokenAccount(): Promise<TokenAccount> {
    this.requireToken('Reading the account');
    const { body, headers } = await answered<{ login: string }>(`${this.apiBase}/user`, {
      tokenHint: this.tokenHint,
      headers: this.headers(),
    });
    const scopes = headers.get('x-oauth-scopes');
    const listed = scopes?.split(',').map((scope) => scope.trim()) ?? [];
    return {
      login: body.login,
      write:
        scopes === null
          ? 'unknown'
          : listed.includes('repo') || listed.includes('public_repo')
            ? 'yes'
            : 'no',
    };
  }

  private requireToken(what: string): void {
    if (this.secret) return;
    throw new SymbioteError(`${what} on GitHub needs a token: set ${this.tokenHint}`);
  }

  /** A conditional read (decision 950). */
  private read<T>(path: string): Promise<ReadAnswer<T>> {
    return read<T>(`${this.apiBase}${path}`, {
      tokenHint: this.tokenHint,
      headers: this.headers(),
    });
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(this.secret ? { authorization: `Bearer ${this.secret}` } : {}),
    };
  }

  /** One call: GitHub reviews carry their inline comments and the verdict together. */
  async submitReview(request: ChangeRequest, review: Review): Promise<{ url: string }> {
    const event = { comment: 'COMMENT', approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' }[
      review.event
    ];
    const created = await this.request<{ html_url?: string }>(
      `/repos/${this.project}/pulls/${request.number}/reviews`,
      'POST',
      {
        commit_id: request.head.sha,
        event,
        ...(review.body ? { body: review.body } : {}),
        comments: review.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side === 'head' ? 'RIGHT' : 'LEFT',
          body: comment.body,
        })),
      },
    );
    return { url: created?.html_url ?? request.url };
  }

  /** Inline comments, review summaries and conversation comments. */
  async commentBodies(request: ChangeRequest): Promise<string[]> {
    const lists = await Promise.all(
      [
        `pulls/${request.number}/comments`,
        `pulls/${request.number}/reviews`,
        `issues/${request.number}/comments`,
      ].map((list) =>
        paged((query) =>
          this.request<{ body?: string | null }[]>(`/repos/${this.project}/${list}?${query}`),
        ),
      ),
    );
    return lists.flat().flatMap((item) => (item.body ? [item.body] : []));
  }

  private request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<T> {
    return api<T>(`${this.apiBase}${path}`, {
      method,
      body,
      tokenHint: this.tokenHint,
      headers: this.headers(),
    });
  }
}

/**
 * A catch that takes the forge's `status` as an answer (`value`), and throws any other failure.
 */
export function unless<T = undefined>(status: number, value?: T) {
  return (error: unknown): T => {
    if (error instanceof ForgeError && error.status === status) return value as T;
    throw error;
  };
}

/**
 * The token for `host`'s API, only where the environment says it is for: `GITHUB_TOKEN` or
 * `GH_TOKEN` for github.com, the host GitHub Actions runs on (`GITHUB_SERVER_URL`) or an API
 * address set (`GITHUB_API_URL`, where the requests then go); `GH_ENTERPRISE_TOKEN` for the host
 * `GH_HOST` names, as gh has it. Any other host gets gh's token for that host, or none: the remote's
 * host is the repository's to name, and `github.com.evil.example` says "github" too.
 */
export function githubToken(
  host: string,
  env: Env,
  stored: (host: string) => string | undefined = ghToken,
): string | undefined {
  const own = env.GITHUB_TOKEN || env.GH_TOKEN || undefined;
  if (
    own &&
    (host === 'github.com' || env.GITHUB_API_URL || host === hostOf(env.GITHUB_SERVER_URL))
  )
    return own;
  if (env.GH_HOST && host === hostOf(env.GH_HOST)) {
    const enterprise = env.GH_ENTERPRISE_TOKEN || env.GITHUB_ENTERPRISE_TOKEN || own;
    if (enterprise) return enterprise;
  }
  return stored(host);
}

/** A host named alone or by an address (`github.acme.dev`, `https://github.acme.dev/`). */
export function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The GitHub CLI's token, if `gh` is installed and logged in to this host. */
function ghToken(host: string): string | undefined {
  try {
    const result = spawnSync('gh', ['auth', 'token', '--hostname', host], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const token = result.status === 0 ? result.stdout.trim() : '';
    return token || undefined;
  } catch {
    return undefined;
  }
}
