import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitHubForge, GitLabForge } from '../src/index.js';
import { mockApi } from './mock-api.js';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const START = 'c'.repeat(40);

describe('GitHubForge', () => {
  let api: Awaited<ReturnType<typeof mockApi>>;
  beforeAll(async () => {
    api = await mockApi({
      'GET /repos/acme/widgets/pulls/7': {
        body: {
          number: 7,
          title: 'Add widgets',
          html_url: 'https://github.com/acme/widgets/pull/7',
          user: { login: 'ada' },
          state: 'closed',
          merged_at: '2026-09-30T10:00:00Z',
          draft: false,
          base: { ref: 'main', sha: BASE },
          head: { ref: 'feature', sha: HEAD },
        },
      },
      'GET /repos/acme/widgets/pulls/8': { status: 401, body: { message: 'Bad credentials' } },
    });
  });
  afterAll(() => api.close());

  const forge = () =>
    new GitHubForge('github.com', 'acme/widgets', {
      GITHUB_API_URL: api.url,
      GITHUB_TOKEN: 'ghp_x',
    });

  it('reads a pull request', async () => {
    expect(await forge().getChangeRequest(7)).toEqual({
      forge: 'github',
      number: 7,
      title: 'Add widgets',
      url: 'https://github.com/acme/widgets/pull/7',
      author: 'ada',
      state: 'merged',
      draft: false,
      base: { ref: 'main', sha: BASE },
      head: { ref: 'feature', sha: HEAD },
      mergeBase: null,
      refs: { base: 'refs/heads/main', head: 'refs/pull/7/head' },
    });
    expect(api.requests[0]?.headers.authorization).toBe('Bearer ghp_x');
    expect(api.requests[0]?.headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('explains missing access', async () => {
    await expect(forge().getChangeRequest(8)).rejects.toThrow(
      'authentication failed (set GITHUB_TOKEN',
    );
    await expect(forge().getChangeRequest(9)).rejects.toThrow('not found, or no access');
  });

  it('derives the GitHub Enterprise API URL from the host', () => {
    const enterprise = new GitHubForge('github.acme.dev', 'a/b', { GITHUB_TOKEN: 't' });
    expect((enterprise as unknown as { apiBase: string }).apiBase).toBe(
      'https://github.acme.dev/api/v3',
    );
  });
});

describe('GitLabForge', () => {
  let api: Awaited<ReturnType<typeof mockApi>>;
  beforeAll(async () => {
    api = await mockApi({
      'GET /projects/acme%2Ftools%2Fwidgets/merge_requests/7': {
        body: {
          iid: 7,
          title: 'Draft: Add widgets',
          web_url: 'https://gitlab.example.com/acme/tools/widgets/-/merge_requests/7',
          author: { username: 'ada' },
          state: 'opened',
          draft: true,
          source_branch: 'feature',
          target_branch: 'main',
          sha: HEAD,
          diff_refs: { base_sha: BASE, head_sha: HEAD, start_sha: START },
        },
      },
    });
  });
  afterAll(() => api.close());

  it('reads a merge request, with the base GitLab diffs against', async () => {
    const forge = new GitLabForge('gitlab.example.com', 'acme/tools/widgets', {
      GITLAB_API_URL: api.url,
      GITLAB_TOKEN: 'glpat-x',
    });
    expect(await forge.getChangeRequest(7)).toEqual({
      forge: 'gitlab',
      number: 7,
      title: 'Draft: Add widgets',
      url: 'https://gitlab.example.com/acme/tools/widgets/-/merge_requests/7',
      author: 'ada',
      state: 'open',
      draft: true,
      base: { ref: 'main', sha: START },
      head: { ref: 'feature', sha: HEAD },
      mergeBase: BASE,
      refs: { base: 'refs/heads/main', head: 'refs/merge-requests/7/head' },
    });
    expect(api.requests[0]?.headers['private-token']).toBe('glpat-x');
  });

  it('uses the CI job token inside GitLab CI', async () => {
    const forge = new GitLabForge('gitlab.example.com', 'acme/tools/widgets', {
      GITLAB_API_URL: api.url,
      CI_JOB_TOKEN: 'job-1',
    });
    await forge.getChangeRequest(7);
    expect(api.requests.at(-1)?.headers['job-token']).toBe('job-1');
  });
});
