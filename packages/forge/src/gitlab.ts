import { api } from './http.js';
import type { ChangeRequest, Env, Forge } from './types.js';

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
}

/** GitLab.com and self-managed GitLab merge requests. */
export class GitLabForge implements Forge {
  readonly kind = 'gitlab';
  private readonly apiBase: string;
  private readonly headers: Record<string, string>;

  constructor(
    readonly host: string,
    readonly project: string,
    env: Env,
  ) {
    this.apiBase = (env.GITLAB_API_URL ?? `https://${host}/api/v4`).replace(/\/+$/, '');
    // A personal/project token, or the job token inside GitLab CI.
    this.headers = env.GITLAB_TOKEN
      ? { 'private-token': env.GITLAB_TOKEN }
      : env.CI_JOB_TOKEN
        ? { 'job-token': env.CI_JOB_TOKEN }
        : {};
  }

  async getChangeRequest(number: number): Promise<ChangeRequest> {
    const mr = await this.request<MergeRequestResponse>(`/merge_requests/${number}`);
    const refs = mr.diff_refs;
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
    };
  }

  /** Project-scoped API path; the project is addressed by its URL-encoded full path. */
  private request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
    const project = encodeURIComponent(this.project);
    return api<T>(`${this.apiBase}/projects/${project}${path}`, {
      method,
      body,
      tokenHint: TOKEN_HINT,
      headers: this.headers,
    });
  }
}
