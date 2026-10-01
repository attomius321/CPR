import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitHubForge, GitLabForge, type ChangeRequest, type ReviewComment } from '../src/index.js';
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

describe('submitReview', () => {
  const request = (forge: 'github' | 'gitlab'): ChangeRequest => ({
    forge,
    number: 7,
    title: 'Add widgets',
    url: `https://${forge}.example.com/acme/widgets/7`,
    author: 'ada',
    state: 'open',
    draft: false,
    base: { ref: 'main', sha: START },
    head: { ref: 'feature', sha: HEAD },
    mergeBase: forge === 'gitlab' ? BASE : null,
    refs: { base: 'refs/heads/main', head: 'refs/pull/7/head' },
  });
  const comments: ReviewComment[] = [
    { side: 'head', path: 'src/a.ts', otherPath: 'src/a.ts', line: 3, body: 'Why here?' },
    // A removed line of a renamed file: base path old.ts, head path new.ts.
    { side: 'base', path: 'src/old.ts', otherPath: 'src/new.ts', line: 9, body: 'Still needed' },
  ];

  it('posts a GitHub review with inline comments in one call', async () => {
    const api = await mockApi({
      'POST /repos/acme/widgets/pulls/7/reviews': {
        body: { html_url: 'https://github.com/acme/widgets/pull/7#pullrequestreview-1' },
      },
    });
    const forge = new GitHubForge('github.com', 'acme/widgets', {
      GITHUB_API_URL: api.url,
      GITHUB_TOKEN: 't',
    });
    const result = await forge.submitReview(request('github'), {
      event: 'request-changes',
      body: 'A few things.',
      comments,
    });
    await api.close();

    expect(result.url).toBe('https://github.com/acme/widgets/pull/7#pullrequestreview-1');
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.body).toEqual({
      commit_id: HEAD,
      event: 'REQUEST_CHANGES',
      body: 'A few things.',
      comments: [
        { path: 'src/a.ts', line: 3, side: 'RIGHT', body: 'Why here?' },
        { path: 'src/old.ts', line: 9, side: 'LEFT', body: 'Still needed' },
      ],
    });
  });

  describe('GitLab', () => {
    const mr = '/projects/acme%2Fwidgets/merge_requests/7';
    async function gitlab(failDraft?: number) {
      let next = 0;
      const api = await mockApi({
        [`POST ${mr}/draft_notes`]: () => {
          next += 1;
          return next === failDraft
            ? { status: 400, body: { message: 'line_code is invalid' } }
            : { body: { id: 100 + next } };
        },
        [`DELETE ${mr}/draft_notes/101`]: { status: 204, body: '' },
        [`POST ${mr}/draft_notes/bulk_publish`]: { status: 204, body: '' },
        [`POST ${mr}/approve`]: { body: {} },
      });
      const forge = new GitLabForge('gitlab.example.com', 'acme/widgets', {
        GITLAB_API_URL: api.url,
        GITLAB_TOKEN: 't',
      });
      return { api, forge };
    }
    const calls = (api: Awaited<ReturnType<typeof mockApi>>) =>
      api.requests.map((r) => `${r.method} ${r.path.slice(mr.length)}`);

    it('publishes draft notes positioned on the diff, then approves', async () => {
      const { api, forge } = await gitlab();
      await forge.submitReview(request('gitlab'), { event: 'approve', body: 'LGTM', comments });
      await api.close();

      expect(calls(api)).toEqual([
        'POST /draft_notes',
        'POST /draft_notes',
        'POST /draft_notes',
        'POST /draft_notes/bulk_publish',
        'POST /approve',
      ]);
      const position = { position_type: 'text', base_sha: BASE, start_sha: START, head_sha: HEAD };
      expect(api.requests.map((r) => r.body)).toEqual([
        { note: 'LGTM' },
        {
          note: 'Why here?',
          position: { ...position, old_path: 'src/a.ts', new_path: 'src/a.ts', new_line: 3 },
        },
        {
          note: 'Still needed',
          position: { ...position, old_path: 'src/old.ts', new_path: 'src/new.ts', old_line: 9 },
        },
        undefined,
        { sha: HEAD },
      ]);
    });

    it('marks requested changes and withdraws an approval, if any', async () => {
      const { api, forge } = await gitlab();
      await forge.submitReview(request('gitlab'), {
        event: 'request-changes',
        body: 'Please split this.',
        comments: [],
      });
      await api.close();
      expect(calls(api)).toEqual([
        'POST /draft_notes',
        'POST /draft_notes/bulk_publish',
        'POST /unapprove', // 404 here: there was no approval, which is fine
      ]);
      expect(api.requests[0]?.body).toEqual({
        note: '**Changes requested.**\n\nPlease split this.',
      });
    });

    it('deletes its drafts when one is rejected', async () => {
      const { api, forge } = await gitlab(2);
      await expect(
        forge.submitReview(request('gitlab'), { event: 'comment', body: 'Hm', comments }),
      ).rejects.toThrow('line_code is invalid');
      await api.close();
      expect(calls(api)).toEqual([
        'POST /draft_notes',
        'POST /draft_notes',
        'DELETE /draft_notes/101',
      ]);
    });

    it('approves without notes when there is nothing to say', async () => {
      const { api, forge } = await gitlab();
      await forge.submitReview(request('gitlab'), { event: 'approve', body: '', comments: [] });
      await api.close();
      expect(calls(api)).toEqual(['POST /approve']);
    });
  });
});

describe('commentBodies', () => {
  const pr = { number: 7 } as ChangeRequest;

  it('reads every page of GitHub comments, reviews and conversation', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ body: `c${i}` }));
    const api = await mockApi({
      'GET /repos/acme/widgets/pulls/7/comments?per_page=100&page=1': { body: full },
      'GET /repos/acme/widgets/pulls/7/comments?per_page=100&page=2': { body: [{ body: 'last' }] },
      'GET /repos/acme/widgets/pulls/7/reviews?per_page=100&page=1': {
        body: [{ body: 'summary' }, { body: '' }, { body: null }],
      },
      'GET /repos/acme/widgets/issues/7/comments?per_page=100&page=1': { body: [{ body: 'talk' }] },
    });
    const forge = new GitHubForge('github.com', 'acme/widgets', {
      GITHUB_API_URL: api.url,
      GITHUB_TOKEN: 't',
    });
    const bodies = await forge.commentBodies(pr);
    await api.close();
    expect(bodies).toHaveLength(103);
    expect(bodies.slice(99)).toEqual(['c99', 'last', 'summary', 'talk']);
  });

  it('reads GitLab notes', async () => {
    const api = await mockApi({
      'GET /projects/acme%2Fwidgets/merge_requests/7/notes?per_page=100&page=1': {
        body: [{ body: 'one' }, { body: 'approved this merge request' }],
      },
    });
    const forge = new GitLabForge('gitlab.example.com', 'acme/widgets', {
      GITLAB_API_URL: api.url,
      GITLAB_TOKEN: 't',
    });
    expect(await forge.commentBodies(pr)).toEqual(['one', 'approved this merge request']);
    await api.close();
  });
});

describe('GitLab CI', () => {
  const pipeline = {
    CI_SERVER_HOST: 'gitlab.example.com',
    CI_API_V4_URL: 'https://gitlab.example.com:8443/api/v4',
    CI_JOB_TOKEN: 'job',
    CI_MERGE_REQUEST_IID: '7',
    CI_MERGE_REQUEST_TITLE: 'Add widgets',
    CI_MERGE_REQUEST_PROJECT_URL: 'https://gitlab.example.com:8443/acme/widgets',
    CI_MERGE_REQUEST_DIFF_BASE_SHA: BASE,
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
    CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature',
    CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: '', // set, but empty, outside merged-results pipelines
    CI_COMMIT_SHA: HEAD,
    GITLAB_USER_LOGIN: 'ada',
  };

  it("uses the instance's API URL", () => {
    const forge = new GitLabForge('gitlab.example.com', 'acme/widgets', pipeline);
    expect((forge as unknown as { apiBase: string }).apiBase).toBe(
      'https://gitlab.example.com:8443/api/v4',
    );
    const other = new GitLabForge('gitlab.com', 'acme/widgets', pipeline);
    expect((other as unknown as { apiBase: string }).apiBase).toBe('https://gitlab.com/api/v4');
  });

  it('reads its own merge request from the pipeline, without a token', async () => {
    const forge = new GitLabForge('gitlab.example.com', 'acme/widgets', pipeline);
    expect(await forge.getChangeRequest(7)).toEqual({
      forge: 'gitlab',
      number: 7,
      title: 'Add widgets',
      url: 'https://gitlab.example.com:8443/acme/widgets/-/merge_requests/7',
      author: 'ada',
      state: 'open',
      draft: false,
      base: { ref: 'main', sha: BASE },
      head: { ref: 'feature', sha: HEAD },
      mergeBase: BASE,
      refs: { base: 'refs/heads/main', head: 'refs/merge-requests/7/head' },
    });
  });

  it('says which token commenting needs', async () => {
    const forge = new GitLabForge('gitlab.example.com', 'acme/widgets', pipeline);
    const request = await forge.getChangeRequest(7);
    await expect(
      forge.submitReview(request, { event: 'comment', body: 'x', comments: [] }),
    ).rejects.toThrow(
      'Commenting on GitLab needs GITLAB_TOKEN (a personal or project access token with api scope); CI_JOB_TOKEN cannot comment on merge requests',
    );
    await expect(forge.commentBodies(request)).rejects.toThrow('Reading comments on GitLab needs');
  });
});
