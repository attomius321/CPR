import { spawnSync } from 'node:child_process';
import { api } from './http.js';
import type { ChangeRequest, Env, Forge } from './types.js';

const TOKEN_HINT = 'GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login';

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

  constructor(
    readonly host: string,
    readonly project: string,
    env: Env,
  ) {
    this.apiBase = (
      env.GITHUB_API_URL ??
      (host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`)
    ).replace(/\/+$/, '');
    this.token = env.GITHUB_TOKEN ?? env.GH_TOKEN ?? ghToken(host);
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

  private request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
    return api<T>(`${this.apiBase}${path}`, {
      method,
      body,
      tokenHint: TOKEN_HINT,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
    });
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
