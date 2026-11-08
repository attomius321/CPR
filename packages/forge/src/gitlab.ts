import { SymbioteError } from '@symbiote/core';
import { hostOf } from './github.js';
import { api, paged, read, type ReadAnswer } from './http.js';
import { COMMENTS, ISSUES_PER_PAGE, labelOf, readCursor, writeCursor } from './issues.js';
import type {
  ChangeRequest,
  Env,
  Forge,
  Issue,
  IssueAuthorRole,
  IssuePage,
  IssueQuery,
  IssueSummary,
  NewChangeRequest,
  Review,
} from './types.js';

const TOKEN_HINT = 'GITLAB_TOKEN (a personal or project access token with api scope)';

interface MergeRequestResponse {
  iid: number;
  title: string;
  web_url: string;
  author: { username: string } | null;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  draft?: boolean;
  work_in_progress?: boolean;
  source_branch: string;
  target_branch: string;
  sha: string;
  diff_refs: { base_sha: string; head_sha: string; start_sha: string } | null;
  has_conflicts?: boolean;
  detailed_merge_status?: string;
  merge_commit_sha?: string | null;
  squash_commit_sha?: string | null;
}

/** An issue as GitLab's REST API gives it (IS1). */
interface GitLabIssue {
  iid: number;
  title: string;
  web_url: string;
  author: { id?: number; username: string; bot?: boolean } | null;
  labels: ({ name?: string; color?: string | null } | string)[];
  state: 'opened' | 'closed' | 'locked';
  user_notes_count?: number;
  created_at: string;
  updated_at: string;
  description?: string | null;
}

interface GitLabNote {
  id: number;
  body?: string | null;
  author: { username: string; bot?: boolean } | null;
  created_at: string;
  system?: boolean;
}

/** A member's access level in words (decision 951): developer, reporter and guest are members. */
function roleOf(level: number | undefined): IssueAuthorRole {
  if (level === undefined) return 'none';
  return level >= 50 ? 'owner' : level >= 40 ? 'maintainer' : 'member';
}

function summaryOf(issue: GitLabIssue): IssueSummary {
  return {
    forge: 'gitlab',
    number: issue.iid,
    title: issue.title,
    url: issue.web_url,
    state: issue.state === 'closed' ? 'closed' : 'open',
    labels: issue.labels.map(labelOf),
    author: {
      login: issue.author?.username ?? 'ghost',
      ...(issue.author?.bot ? { bot: true as const } : {}),
    },
    comments: issue.user_notes_count ?? 0,
    created: issue.created_at,
    updated: issue.updated_at,
  };
}

/**
 * The token for `host`'s API, only where the environment says it is for: `GITLAB_TOKEN` for
 * gitlab.com, GitLab CI's own server (`CI_SERVER_HOST`), an API address set (`GITLAB_API_URL`,
 * where the requests then go) or the host `GITLAB_HOST` names, as glab has it; else the CI job
 * token, to its own server or the API address set. Any other host gets none: the remote's host is the repository's to name.
 */
export function gitlabHeaders(host: string, env: Env): Record<string, string> {
  const ci = !!env.CI_SERVER_HOST && host === env.CI_SERVER_HOST.toLowerCase();
  const set = !!env.GITLAB_API_URL;
  const named = host === 'gitlab.com' || set || ci || host === hostOf(env.GITLAB_HOST);
  if (env.GITLAB_TOKEN && named) return { 'private-token': env.GITLAB_TOKEN };
  if (env.CI_JOB_TOKEN && (ci || set)) return { 'job-token': env.CI_JOB_TOKEN };
  return {};
}

/** GitLab.com and self-managed GitLab merge requests. */
export class GitLabForge implements Forge {
  readonly kind = 'gitlab';
  private readonly apiBase: string;
  private readonly headers: Record<string, string>;

  constructor(
    readonly host: string,
    readonly project: string,
    private readonly env: Env,
  ) {
    // Inside GitLab CI, the instance's own API URL (it knows ports and path prefixes).
    const ci = env.CI_SERVER_HOST === host ? env.CI_API_V4_URL : undefined;
    this.apiBase = (env.GITLAB_API_URL ?? ci ?? `https://${host}/api/v4`).replace(/\/+$/, '');
    this.headers = gitlabHeaders(host, env);
  }

  async getChangeRequest(number: number): Promise<ChangeRequest> {
    // The merge request's own pipeline, without GITLAB_TOKEN: the job token may not read merge
    // requests, but the pipeline's variables say all that is needed.
    const pipeline = this.env.GITLAB_TOKEN ? undefined : fromPipeline(this.env, number);
    if (pipeline) return pipeline;
    return fromMergeRequest(await this.request<MergeRequestResponse>(`/merge_requests/${number}`));
  }

  get token(): boolean {
    return !!this.env.GITLAB_TOKEN && 'private-token' in this.headers;
  }

  async openChangeRequest({ head, base, title, body }: NewChangeRequest): Promise<ChangeRequest> {
    this.requireToken('Opening a merge request');
    const mr = await this.request<MergeRequestResponse>('/merge_requests', 'POST', {
      source_branch: head,
      target_branch: base,
      title,
      description: body,
    });
    return fromMergeRequest(mr);
  }

  /** The list's items lack the diff refs: the one found is read whole. */
  async findOpenRequest(head: string, base: string): Promise<ChangeRequest | null> {
    const filter = `state=opened&source_branch=${encodeURIComponent(head)}&target_branch=${encodeURIComponent(base)}`;
    const list = await paged((query) =>
      this.request<{ iid: number }[]>(`/merge_requests?${filter}&${query}`),
    );
    const found = list[0];
    return found ? this.getChangeRequest(found.iid) : null;
  }

  async updateDescription(request: ChangeRequest, body: string): Promise<void> {
    this.requireToken('Editing a merge request');
    await this.request(`/merge_requests/${request.number}`, 'PUT', { description: body });
  }

  /** A page of 30 issues, by GitLab's page numbers; a search on titles at GitLab (decision 947). */
  async listIssues({ state, search, cursor }: IssueQuery): Promise<IssuePage> {
    const page = cursor === undefined ? 1 : readCursor(cursor).page;
    const words = search?.replace(/\s+/g, ' ').trim();
    const query = [
      ...(state === 'all' ? [] : [`state=${state === 'open' ? 'opened' : 'closed'}`]),
      'order_by=updated_at',
      'sort=desc',
      `per_page=${ISSUES_PER_PAGE}`,
      ...(page > 1 ? [`page=${page}`] : []),
      ...(words ? [`search=${encodeURIComponent(words)}`, 'in=title'] : []),
    ].join('&');
    const answer = await this.read<GitLabIssue[]>(`/issues?${query}`);
    const next = Number(answer.nextPage);
    return {
      issues: answer.body.map(summaryOf),
      ...(next > page ? { next: writeCursor({ page: next, skip: 0 }) } : {}),
    };
  }

  /**
   * An issue, and with a token its first 100 notes by people, oldest first, and its author's
   * access level (decisions 948, 951): gitlab.com answers 401 for notes without one.
   */
  async getIssue(number: number): Promise<Issue> {
    const { body: issue } = await this.read<GitLabIssue>(`/issues/${number}`);
    const summary = summaryOf(issue);
    const base = { ...summary, body: issue.description ?? '' };
    if (!this.token) {
      return {
        ...base,
        thread: [],
        moreComments: summary.comments,
        ...(summary.comments > 0 ? { commentsNeedToken: true as const } : {}),
      };
    }
    const [notes, level] = await Promise.all([
      this.read<GitLabNote[]>(
        `/issues/${number}/notes?sort=asc&order_by=created_at&per_page=${COMMENTS}`,
      ).then((answer) => answer.body),
      issue.author?.id === undefined ? undefined : this.accessLevel(issue.author.id),
    ]);
    const thread = notes
      .filter((note) => !note.system)
      .map((note) => ({
        author: {
          login: note.author?.username ?? 'ghost',
          ...(note.author?.bot ? { bot: true as const } : {}),
        },
        body: note.body ?? '',
        created: note.created_at,
        url: `${issue.web_url}#note_${note.id}`,
      }));
    return {
      ...base,
      author: { ...summary.author, role: roleOf(level) },
      thread,
      moreComments: Math.max(0, summary.comments - thread.length),
    };
  }

  /** A user's access level in the project, inherited ones too; undefined outside it. */
  private async accessLevel(user: number): Promise<number | undefined> {
    try {
      return (await this.read<{ access_level?: number }>(`/members/all/${user}`)).body.access_level;
    } catch {
      return undefined;
    }
  }

  /** A conditional read of the project's API (decision 950). */
  private read<T>(path: string): Promise<ReadAnswer<T>> {
    const project = encodeURIComponent(this.project);
    return read<T>(`${this.apiBase}/projects/${project}${path}`, {
      tokenHint: TOKEN_HINT,
      headers: this.headers,
    });
  }

  /**
   * GitLab's review: draft notes (inline ones carry a text position on the diff), published
   * together, then the verdict. The REST API has no stable "request changes", so that event
   * publishes the review marked as such and withdraws a previous approval.
   */
  async submitReview(request: ChangeRequest, review: Review): Promise<{ url: string }> {
    this.requireToken('Commenting');
    if (!request.mergeBase) throw new SymbioteError(`!${request.number} has no diff refs yet`);
    const path = `/merge_requests/${request.number}`;
    const marker = review.event === 'request-changes' ? '**Changes requested.**' : '';
    const summary = [marker, review.body].filter(Boolean).join('\n\n');

    const drafts: number[] = [];
    const draft = async (note: Record<string, unknown>) => {
      const created = await this.request<{ id: number }>(`${path}/draft_notes`, 'POST', note);
      drafts.push(created.id);
    };
    try {
      if (summary) await draft({ note: summary });
      for (const comment of review.comments) {
        const [oldPath, newPath] =
          comment.side === 'head'
            ? [comment.otherPath, comment.path]
            : [comment.path, comment.otherPath];
        await draft({
          note: comment.body,
          position: {
            position_type: 'text',
            base_sha: request.mergeBase,
            start_sha: request.base.sha,
            head_sha: request.head.sha,
            old_path: oldPath,
            new_path: newPath,
            ...(comment.side === 'head' ? { new_line: comment.line } : { old_line: comment.line }),
          },
        });
      }
    } catch (error) {
      // Leave no half review behind in the reviewer's pending drafts.
      await Promise.allSettled(
        drafts.map((id) => this.request(`${path}/draft_notes/${id}`, 'DELETE')),
      );
      throw error;
    }
    if (summary || review.comments.length > 0) {
      await this.request(`${path}/draft_notes/bulk_publish`, 'POST');
    }
    if (review.event === 'approve') {
      await this.request(`${path}/approve`, 'POST', { sha: request.head.sha });
    } else if (review.event === 'request-changes') {
      await this.unapprove(path);
    }
    return { url: request.url };
  }

  /** All notes: diff notes, summaries, and system notes (which never carry markers). */
  async commentBodies(request: ChangeRequest): Promise<string[]> {
    this.requireToken('Reading comments');
    const notes = await paged((query) =>
      this.request<{ body?: string | null }[]>(`/merge_requests/${request.number}/notes?${query}`),
    );
    return notes.flatMap((note) => (note.body ? [note.body] : []));
  }

  private requireToken(what: string): void {
    if (this.env.GITLAB_TOKEN) return;
    throw new SymbioteError(
      `${what} on GitLab needs ${TOKEN_HINT}` +
        (this.env.CI_JOB_TOKEN ? '; CI_JOB_TOKEN cannot comment on merge requests' : ''),
    );
  }

  /** Withdraws the token owner's approval; fine if there was none. */
  private async unapprove(path: string): Promise<void> {
    try {
      await this.request(`${path}/unapprove`, 'POST');
    } catch {
      // not approved before
    }
  }

  /** Project-scoped API path; the project is addressed by its URL-encoded full path. */
  private request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<T> {
    const project = encodeURIComponent(this.project);
    return api<T>(`${this.apiBase}/projects/${project}${path}`, {
      method,
      body,
      tokenHint: TOKEN_HINT,
      headers: this.headers,
    });
  }
}

/**
 * A merge request as its own pipeline describes it (`CI_MERGE_REQUEST_*`), or undefined outside
 * that pipeline. Merged-results pipelines name the source and target commits; others build the
 * source commit itself.
 */
function fromPipeline(env: Env, number: number): ChangeRequest | undefined {
  if (env.CI_MERGE_REQUEST_IID !== String(number) || !env.CI_MERGE_REQUEST_DIFF_BASE_SHA) {
    return undefined;
  }
  const target = env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ?? '';
  const source = env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME ?? '';
  const mergeBase = env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
  return {
    forge: 'gitlab',
    number,
    title: env.CI_MERGE_REQUEST_TITLE ?? `!${number}`,
    url: `${env.CI_MERGE_REQUEST_PROJECT_URL ?? ''}/-/merge_requests/${number}`,
    // Who started the pipeline: usually, not always, the author.
    author: env.GITLAB_USER_LOGIN ?? 'unknown',
    state: 'open',
    draft: env.CI_MERGE_REQUEST_DRAFT === 'true',
    base: { ref: target, sha: env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA || mergeBase },
    head: {
      ref: source,
      sha: env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA || env.CI_COMMIT_SHA || '',
    },
    mergeBase,
    refs: { base: `refs/heads/${target}`, head: `refs/merge-requests/${number}/head` },
  };
}

/** A merge request as the API returns it, as Symbiote reads it. */
function fromMergeRequest(mr: MergeRequestResponse): ChangeRequest {
  const refs = mr.diff_refs;
  const merged = mr.state === 'merged';
  const conflict =
    !merged && (mr.has_conflicts === true || mr.detailed_merge_status === 'conflict');
  const mergeCommit = mr.merge_commit_sha || mr.squash_commit_sha;
  return {
    forge: 'gitlab',
    number: mr.iid,
    title: mr.title,
    url: mr.web_url,
    author: mr.author?.username ?? 'unknown',
    state: mr.state === 'opened' || mr.state === 'locked' ? 'open' : mr.state,
    draft: mr.draft ?? mr.work_in_progress ?? false,
    base: { ref: mr.target_branch, sha: refs?.start_sha ?? '' },
    head: { ref: mr.source_branch, sha: refs?.head_sha ?? mr.sha },
    mergeBase: refs?.base_sha ?? null,
    refs: { base: `refs/heads/${mr.target_branch}`, head: `refs/merge-requests/${mr.iid}/head` },
    ...(conflict ? { conflict: true as const } : {}),
    ...(merged && mergeCommit ? { mergeCommit } : {}),
  };
}
