import { spawnSync } from 'node:child_process';
import { api, paged } from './http.js';
import type { ChangeRequest, Env, Forge, Review } from './types.js';

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
}

/** GitHub and GitHub Enterprise pull requests. */
export class GitHubForge implements Forge {
  readonly kind = 'github';
  private readonly apiBase: string;
  private readonly token: string | undefined;
  private readonly tokenHint: string;

  constructor(
    readonly host: string,
    readonly project: string,
    env: Env,
  ) {
    this.apiBase = (
      env.GITHUB_API_URL ??
      (host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`)
    ).replace(/\/+$/, '');
    this.token = githubToken(host, env);
    this.tokenHint = host === 'github.com' ? TOKEN_HINT : enterpriseHint(host);
  }

  async getChangeRequest(number: number): Promise<ChangeRequest> {
    const pull = await this.request<PullResponse>(`/repos/${this.project}/pulls/${number}`);
    return {
      forge: 'github',
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      author: pull.user?.login ?? 'unknown',
      state: pull.merged_at ? 'merged' : pull.state,
      draft: pull.draft ?? false,
      base: { ref: pull.base.ref, sha: pull.base.sha },
      head: { ref: pull.head.ref, sha: pull.head.sha },
      mergeBase: null,
      refs: { base: `refs/heads/${pull.base.ref}`, head: `refs/pull/${pull.number}/head` },
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

  private request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
    return api<T>(`${this.apiBase}${path}`, {
      method,
      body,
      tokenHint: this.tokenHint,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
    });
  }
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
