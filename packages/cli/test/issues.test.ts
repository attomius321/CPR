// IS1: the Issues page's service: origin's forge, its issues, and why there are none.
import { openRepo } from '@symbiote/core';
import { GitHubForge, GitLabForge, type Env } from '@symbiote/forge';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { mockApi, type Reply } from '../../forge/test/mock-api.js';
import { issueSnapshot } from '../src/issue-snapshot.js';
import { issuesService } from '../src/issues.js';

const repos: TestRepo[] = [];
let api: Awaited<ReturnType<typeof mockApi>> | undefined;
afterEach(async () => {
  for (const repo of repos.splice(0)) repo.cleanup();
  await api?.close();
  api = undefined;
});

function repository(origin?: string) {
  const repo = createRepo();
  repo.write({ 'a.txt': 'a\n' });
  repo.commit('A');
  if (origin) repo.git('remote', 'add', 'origin', origin);
  repos.push(repo);
  return repo;
}

const ISSUE = {
  number: 3,
  title: 'It breaks',
  html_url: 'https://github.com/acme/app/issues/3',
  user: { login: 'ada', type: 'User' },
  labels: [],
  state: 'open',
  comments: 0,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  author_association: 'OWNER',
  body: 'Steps',
};

/** origin's forge on a fake API: GitHub's or GitLab's, gh's own token never read. */
const make = (token: boolean) => (url: string, env: Env) =>
  url.includes('gitlab')
    ? new GitLabForge('gitlab.com', 'acme/app', {
        ...env,
        GITLAB_API_URL: api?.url,
        ...(token ? { GITLAB_TOKEN: 'x' } : {}),
      })
    : new GitHubForge(
        'github.com',
        'acme/app',
        { ...env, GITHUB_API_URL: api?.url, ...(token ? { GITHUB_TOKEN: 'x' } : {}) },
        () => undefined,
      );

async function serve(answer: (path: string) => Reply | undefined) {
  api = await mockApi({}, (request) => answer(request.path.split('?')[0] ?? ''));
}

const FORGE = { kind: 'github', host: 'github.com', project: 'acme/app' };

describe('the Issues page’s service (IS1)', () => {
  it('lists origin’s issues and reads one', async () => {
    await serve((path) =>
      path === '/repos/acme/app/issues'
        ? { body: [ISSUE, { ...ISSUE, number: 4, pull_request: {} }] }
        : path === '/repos/acme/app/issues/3'
          ? { body: ISSUE }
          : undefined,
    );
    const repo = await openRepo(repository('git@github.com:acme/app.git').root);
    const issues = issuesService(repo, {}, make(true));
    const list = await issues.list({ state: 'open' });
    expect(list).toEqual({
      forge: FORGE,
      token: true,
      issues: [
        expect.objectContaining({ number: 3, author: { login: 'ada', role: 'owner' } }) as unknown,
      ],
    });
    const one = await issues.one(3);
    expect(one).toEqual({
      forge: FORGE,
      token: true,
      issue: expect.objectContaining({
        number: 3,
        body: 'Steps',
        thread: [],
        moreComments: 0,
      }) as unknown,
      snapshot: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    });
    // The classifier's own hash of what it would read now (HV9c, decision 1057).
    expect(one.snapshot).toBe(issueSnapshot(one.issue!, '2026-11-14T00:00:00.000Z').hash);
  });

  it('reads public issues without a token, and says what to set', async () => {
    await serve((path) => (path === '/repos/acme/app/issues' ? { body: [ISSUE] } : undefined));
    const repo = await openRepo(repository('https://github.com/acme/app.git').root);
    const list = await issuesService(repo, {}, make(false)).list({ state: 'all' });
    expect(list).toMatchObject({
      forge: FORGE,
      token: false,
      tokenHint:
        'no GitHub token for github.com: set GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login',
      issues: [expect.objectContaining({ number: 3 })],
    });
    expect(api?.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('says there is no origin, or that it is on neither forge', async () => {
    const none = await openRepo(repository().root);
    expect(await issuesService(none, {}, make(true)).list({ state: 'open' })).toEqual({
      token: false,
      problem: { kind: 'no-origin', message: 'the repository has no remote named origin' },
    });
    const elsewhere = await openRepo(repository('/srv/git/app.git').root);
    expect(await issuesService(elsewhere, {}).one(1)).toEqual({
      token: false,
      problem: {
        kind: 'no-forge',
        message: expect.stringMatching(/^origin is not a GitHub or GitLab repository: /) as string,
      },
    });
  });

  it('gives the forge’s error in its words', async () => {
    await serve((path) =>
      path.endsWith('/issues/9')
        ? { status: 404, body: { message: '404 Issue Not Found' } }
        : { status: 500, body: { message: 'boom' } },
    );
    const repo = await openRepo(repository('git@gitlab.com:acme/app.git').root);
    const issues = issuesService(repo, {}, make(true));
    expect(await issues.list({ state: 'open' })).toEqual({
      forge: { kind: 'gitlab', host: 'gitlab.com', project: 'acme/app' },
      token: true,
      problem: { kind: 'forge', message: expect.stringContaining('answered 500') as string },
    });
    expect((await issues.one(9)).problem?.message).toMatch(/answered 404/);
  });

  it('finds origin once in a while, not on every read', async () => {
    await serve((path) => (path === '/repos/acme/app/issues' ? { body: [] } : undefined));
    const root = repository('git@github.com:acme/app.git');
    let made = 0;
    const counted = (url: string, env: Env) => {
      made++;
      return make(true)(url, env);
    };
    const issues = issuesService(await openRepo(root.root), {}, counted);
    await issues.list({ state: 'open' });
    await issues.list({ state: 'closed' });
    expect(made).toBe(1);
  });
});
