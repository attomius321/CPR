import { CprError } from '@cpr/core';
import { api, paged } from './http.js';
import type { ChangeRequest, Env, Forge, Review } from './types.js';

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

  /**
   * GitLab's review: draft notes (inline ones carry a text position on the diff), published
   * together, then the verdict. The REST API has no stable "request changes", so that event
   * publishes the review marked as such and withdraws a previous approval.
   */
  async submitReview(request: ChangeRequest, review: Review): Promise<{ url: string }> {
    if (!request.mergeBase) throw new CprError(`!${request.number} has no diff refs yet`);
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
    const notes = await paged((query) =>
      this.request<{ body?: string | null }[]>(`/merge_requests/${request.number}/notes?${query}`),
    );
    return notes.flatMap((note) => (note.body ? [note.body] : []));
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
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
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
