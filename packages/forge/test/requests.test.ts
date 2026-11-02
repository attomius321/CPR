// HV8: what Hive needs of a forge to land through a request — open, find, update, read whether it
// merged, closed or conflicts — against the fake API, for GitHub and GitLab both.
import { afterEach, describe, expect, it } from 'vitest';
import { GitHubForge, GitLabForge } from '../src/index.js';
import { mockApi } from './mock-api.js';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const START = 'c'.repeat(40);
const MERGE = 'd'.repeat(40);

let api: Awaited<ReturnType<typeof mockApi>> | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const pull = (extra: Record<string, unknown> = {}) => ({
  number: 12,
  title: 'Add widgets',
  html_url: 'https://github.com/acme/widgets/pull/12',
  user: { login: 'ada' },
  state: 'open',
  merged_at: null,
  draft: false,
  base: { ref: 'main', sha: BASE },
  head: { ref: 'feature/widgets', sha: HEAD },
  ...extra,
});

const noStored = () => undefined;

describe('GitHub requests', () => {
  const forge = (env: Record<string, string> = { GITHUB_TOKEN: 'ghp_x' }) =>
    new GitHubForge('github.com', 'acme/widgets', { GITHUB_API_URL: api!.url, ...env }, noStored);

  it('opens a pull request, ready, from the branch into its base', async () => {
    api = await mockApi({ 'POST /repos/acme/widgets/pulls': { status: 201, body: pull() } });
    const opened = await forge().openChangeRequest({
      head: 'feature/widgets',
      base: 'main',
      title: 'Add widgets',
      body: 'The brief',
    });
    expect(api.requests[0]?.body).toEqual({
      head: 'feature/widgets',
      base: 'main',
      title: 'Add widgets',
      body: 'The brief',
      draft: false,
    });
    expect(opened).toMatchObject({ number: 12, state: 'open', draft: false });
    expect(opened.url).toBe('https://github.com/acme/widgets/pull/12');
  });

  it('finds the open pull request of a branch, or none', async () => {
    api = await mockApi({
      'GET /repos/acme/widgets/pulls?state=open&head=acme%3Afeature%2Fwidgets&base=main&per_page=100&page=1':
        { body: [pull()] },
      'GET /repos/acme/widgets/pulls?state=open&head=acme%3Aother&base=main&per_page=100&page=1': {
        body: [],
      },
    });
    expect((await forge().findOpenRequest('feature/widgets', 'main'))?.number).toBe(12);
    expect(await forge().findOpenRequest('other', 'main')).toBeNull();
  });

  it('updates its description', async () => {
    api = await mockApi({ 'PATCH /repos/acme/widgets/pulls/12': { body: pull() } });
    await forge().updateDescription({ ...base(), number: 12 }, 'New text');
    expect(api.requests[0]).toMatchObject({ method: 'PATCH', body: { body: 'New text' } });
  });

  it('says it conflicts, and the merge commit once merged', async () => {
    api = await mockApi({
      'GET /repos/acme/widgets/pulls/12': {
        body: pull({ mergeable: false, mergeable_state: 'dirty' }),
      },
      'GET /repos/acme/widgets/pulls/13': {
        body: pull({ number: 13, mergeable: null, mergeable_state: 'unknown' }),
      },
      'GET /repos/acme/widgets/pulls/14': {
        body: pull({
          number: 14,
          state: 'closed',
          merged_at: '2026-11-02T10:00:00Z',
          merge_commit_sha: MERGE,
        }),
      },
      'GET /repos/acme/widgets/pulls/15': {
        body: pull({ number: 15, state: 'closed', merge_commit_sha: MERGE }),
      },
    });
    expect((await forge().getChangeRequest(12)).conflict).toBe(true);
    expect((await forge().getChangeRequest(13)).conflict).toBeUndefined();
    const merged = await forge().getChangeRequest(14);
    expect(merged).toMatchObject({ state: 'merged', mergeCommit: MERGE });
    const closed = await forge().getChangeRequest(15);
    expect(closed.state).toBe('closed');
    expect(closed.mergeCommit).toBeUndefined();
  });

  it('says whether it has a token', async () => {
    api = await mockApi({});
    expect(forge().token).toBe(true);
    expect(forge({}).token).toBe(false);
  });
});

const mr = (extra: Record<string, unknown> = {}) => ({
  iid: 12,
  title: 'Add widgets',
  web_url: 'https://gitlab.example.com/acme/widgets/-/merge_requests/12',
  author: { username: 'ada' },
  state: 'opened',
  draft: false,
  source_branch: 'feature/widgets',
  target_branch: 'main',
  sha: HEAD,
  diff_refs: { base_sha: BASE, head_sha: HEAD, start_sha: START },
  ...extra,
});

describe('GitLab requests', () => {
  const PATH = '/projects/acme%2Fwidgets';
  const forge = (env: Record<string, string> = { GITLAB_TOKEN: 'glpat-x' }) =>
    new GitLabForge('gitlab.example.com', 'acme/widgets', { GITLAB_API_URL: api!.url, ...env });

  it('opens a merge request, ready, from the branch into its base', async () => {
    api = await mockApi({
      [`POST ${PATH}/merge_requests`]: { status: 201, body: mr({ diff_refs: null }) },
    });
    const opened = await forge().openChangeRequest({
      head: 'feature/widgets',
      base: 'main',
      title: 'Add widgets',
      body: 'The brief',
    });
    expect(api.requests[0]?.body).toEqual({
      source_branch: 'feature/widgets',
      target_branch: 'main',
      title: 'Add widgets',
      description: 'The brief',
    });
    expect(api.requests[0]?.headers['private-token']).toBe('glpat-x');
    expect(opened).toMatchObject({ number: 12, state: 'open', draft: false, mergeBase: null });
  });

  it('finds the open merge request of a branch, read whole, or none', async () => {
    api = await mockApi({
      [`GET ${PATH}/merge_requests?state=opened&source_branch=feature%2Fwidgets&target_branch=main&per_page=100&page=1`]:
        { body: [{ iid: 12 }] },
      [`GET ${PATH}/merge_requests?state=opened&source_branch=other&target_branch=main&per_page=100&page=1`]:
        { body: [] },
      [`GET ${PATH}/merge_requests/12`]: { body: mr() },
    });
    const found = await forge().findOpenRequest('feature/widgets', 'main');
    expect(found).toMatchObject({ number: 12, mergeBase: BASE });
    expect(await forge().findOpenRequest('other', 'main')).toBeNull();
  });

  it('updates its description', async () => {
    api = await mockApi({ [`PUT ${PATH}/merge_requests/12`]: { body: mr() } });
    await forge().updateDescription({ ...base(), forge: 'gitlab', number: 12 }, 'New text');
    expect(api.requests[0]).toMatchObject({ method: 'PUT', body: { description: 'New text' } });
  });

  it('says it conflicts, and the merge commit once merged', async () => {
    api = await mockApi({
      [`GET ${PATH}/merge_requests/12`]: {
        body: mr({ has_conflicts: true, detailed_merge_status: 'conflict' }),
      },
      [`GET ${PATH}/merge_requests/13`]: {
        body: mr({ iid: 13, has_conflicts: false, detailed_merge_status: 'mergeable' }),
      },
      [`GET ${PATH}/merge_requests/14`]: {
        body: mr({ iid: 14, state: 'merged', merge_commit_sha: MERGE }),
      },
      [`GET ${PATH}/merge_requests/15`]: {
        body: mr({ iid: 15, state: 'merged', merge_commit_sha: null, squash_commit_sha: MERGE }),
      },
    });
    expect((await forge().getChangeRequest(12)).conflict).toBe(true);
    expect((await forge().getChangeRequest(13)).conflict).toBeUndefined();
    expect(await forge().getChangeRequest(14)).toMatchObject({
      state: 'merged',
      mergeCommit: MERGE,
    });
    expect((await forge().getChangeRequest(15)).mergeCommit).toBe(MERGE);
  });

  it('says whether it has a token, and opens none without one', async () => {
    api = await mockApi({});
    expect(forge().token).toBe(true);
    expect(forge({}).token).toBe(false);
    await expect(
      forge({}).openChangeRequest({ head: 'x', base: 'main', title: 't', body: 'b' }),
    ).rejects.toThrow('Opening a merge request on GitLab needs GITLAB_TOKEN');
    expect(api.requests).toHaveLength(0);
  });
});

function base() {
  return {
    forge: 'github' as const,
    number: 0,
    title: 'Add widgets',
    url: '',
    author: 'ada',
    state: 'open' as const,
    draft: false,
    base: { ref: 'main', sha: BASE },
    head: { ref: 'feature/widgets', sha: HEAD },
    mergeBase: null,
    refs: { base: 'refs/heads/main', head: '' },
  };
}
