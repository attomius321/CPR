// Issues read on both forges (IS1, decisions 944–951), on responses recorded from vitejs/vite
// and gitlab-org/gitlab-runner on 2026-11-08 (trimmed: test/fixtures/issues). gitlab.com answered
// 401 for notes without a token: `gitlab-notes.json` is made by hand in the Notes API's shape.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GitHubForge, GitLabForge } from '../src/index.js';
import { clearConditional } from '../src/http.js';
import { mockApi, type Recorded, type Reply } from './mock-api.js';

const recorded = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/issues/${name}.json`, import.meta.url), 'utf8')) as T;

type Item = Record<string, unknown> & { number: number };
const githubIssues = recorded<Item[]>('github-issues');
const githubIssue = recorded<Item>('github-issue');
/** The recorded list's first issue: its first three items are pull requests. */
const firstIssue = githubIssues.find((item) => !item.pull_request) as Item;
const githubComments = recorded<Record<string, unknown>[]>('github-comments');
const gitlabIssues = recorded<Record<string, unknown>[]>('gitlab-issues');
const gitlabIssue = recorded<Record<string, unknown>>('gitlab-issue');
const gitlabNotes = recorded<Record<string, unknown>[]>('gitlab-notes');

let api: Awaited<ReturnType<typeof mockApi>> | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
  clearConditional();
});

/** A fake API answering by path, its query given apart. */
async function serve(
  answer: (path: string, query: URLSearchParams, r: Recorded) => Reply | undefined,
) {
  api = await mockApi({}, (request) => {
    const [path = '', query = ''] = request.path.split('?');
    return answer(path, new URLSearchParams(query), request);
  });
  return api;
}

const github = (token = true) =>
  new GitHubForge(
    'github.com',
    'vitejs/vite',
    { GITHUB_API_URL: api?.url, ...(token ? { GITHUB_TOKEN: 'ghp_x' } : {}) },
    () => undefined,
  );

const gitlab = (token = true) =>
  new GitLabForge('gitlab.com', 'gitlab-org/gitlab-runner', {
    GITLAB_API_URL: api?.url,
    ...(token ? { GITLAB_TOKEN: 'glpat-x' } : {}),
  });

/** `n` made-up issues numbered down from `from`, every other one a pull request when `prs`. */
const made = (from: number, n: number, prs = false): Item[] =>
  Array.from({ length: n }, (_, i) => ({
    ...firstIssue,
    number: from - i,
    title: `Issue ${from - i}`,
    ...(prs && i % 2 === 1 ? { pull_request: { url: 'x' } } : {}),
  }));

describe('GitHub issues (IS1)', () => {
  const ISSUES = '/repos/vitejs/vite/issues';
  const link = (page: number, after: string) =>
    `<https://api.github.com/repositories/257485422/issues?state=open&per_page=100&after=${encodeURIComponent(after)}&page=${page}>; rel="next"`;

  it('reads an issue of the list as recorded, pull requests dropped', async () => {
    await serve((path, query) =>
      path === ISSUES && !query.get('page') ? { body: githubIssues } : undefined,
    );
    const page = await github().listIssues({ state: 'open' });
    expect(page.issues.map((issue) => issue.number)).toEqual([24019, 24017, 24015]);
    expect(page.next).toBeUndefined();
    expect(page.issues[0]).toEqual({
      forge: 'github',
      number: 24019,
      title: 'Skip JSON import warning on type-only imports',
      url: 'https://github.com/vitejs/vite/issues/24019',
      state: 'open',
      labels: [{ name: 'pending triage', color: '#b3c4dd' }],
      author: { login: 'lethargistic', role: 'none' },
      comments: 0,
      created: firstIssue.created_at,
      updated: '2026-11-07T21:37:29Z',
    });
    const asked = new URLSearchParams(api?.requests[0]?.path.split('?')[1]);
    expect(Object.fromEntries(asked)).toEqual({
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: '100',
    });
  });

  it('fills a page of 30 from at most 3 calls, and goes on where it stopped', async () => {
    // Page 1 as recorded (3 issues of 10 items), then 40 items each, half pull requests.
    const pages: Record<string, Item[]> = {
      '': githubIssues,
      '2': made(23000, 40, true),
      '3': made(22000, 40, true),
      '4': made(21000, 40, true),
    };
    await serve((path, query) => {
      if (path !== ISSUES) return undefined;
      const page = query.get('page') ?? '';
      const items = pages[page];
      if (!items) return undefined;
      if (page) expect(query.get('after')).toBe(`cur+${page}/=`);
      const next = Number(page || 1) + 1;
      return {
        body: items,
        ...(pages[String(next)] ? { headers: { link: link(next, `cur+${next}/=`) } } : {}),
      };
    });
    const first = await github().listIssues({ state: 'open' });
    expect(first.issues).toHaveLength(30);
    expect(api?.requests).toHaveLength(3);
    expect(first.issues.at(-1)?.number).toBe(22000 - 12);
    expect(first.next).toBeDefined();

    const second = await github().listIssues({ state: 'open', cursor: first.next ?? '' });
    // Page 3's 20 issues less the 7 shown, then page 4's 20.
    expect(second.issues[0]?.number).toBe(22000 - 14);
    expect(second.issues).toHaveLength(30);
    const numbers = [...first.issues, ...second.issues].map((issue) => issue.number);
    expect(new Set(numbers).size).toBe(60);
  });

  it('stops after 3 calls with what it has, and a cursor to the next', async () => {
    await serve((path, query) => {
      const page = Number(query.get('page') ?? 1);
      return path === ISSUES
        ? {
            body: made(30000 - page * 100, 10, true),
            headers: { link: link(page + 1, `c${page + 1}`) },
          }
        : undefined;
    });
    const page = await github().listIssues({ state: 'all' });
    expect(api?.requests).toHaveLength(3);
    expect(page.issues).toHaveLength(15);
    expect(page.next).toBeDefined();
    expect(new URLSearchParams(api?.requests[0]?.path.split('?')[1]).get('state')).toBe('all');
  });

  it('refuses a cursor that is not one of its own', async () => {
    await serve(() => undefined);
    for (const cursor of ['https://evil.example/x', '2~a&b=c~0', '1~x~-1', '']) {
      await expect(github().listIssues({ state: 'open', cursor })).rejects.toThrow(
        /not a page of this list/,
      );
    }
    expect(api?.requests).toHaveLength(0);
  });

  it('searches titles through the search API, issues only', async () => {
    await serve((path, query) => {
      if (path !== '/search/issues') return undefined;
      expect(query.get('q')).toBe('repo:vitejs/vite is:issue in:title is:open "watcher open"');
      return {
        body: { total_count: 31, incomplete_results: false, items: [githubIssue] },
        headers: {
          link: '<https://api.github.com/search/issues?q=x&per_page=30&page=2>; rel="next"',
        },
      };
    });
    const page = await github().listIssues({ state: 'open', search: 'watcher "open' });
    expect(page.issues.map((issue) => issue.number)).toEqual([23965]);
    expect(page.next).toBeDefined();
  });

  it('reads one issue with its comments, roles in words', async () => {
    await serve((path, query) => {
      if (path === `${ISSUES}/23965`) return { body: githubIssue };
      if (path === `${ISSUES}/23965/comments`) {
        expect(query.get('per_page')).toBe('100');
        return { body: githubComments };
      }
      return undefined;
    });
    const issue = await github().getIssue(23965);
    expect(issue).toMatchObject({
      number: 23965,
      title: githubIssue.title,
      body: githubIssue.body,
      author: { login: 'materwelonDhruv', role: 'none' },
      comments: 7,
      moreComments: 0,
    });
    expect(issue.thread).toHaveLength(7);
    expect(issue.thread.map((comment) => comment.author.role)).toEqual([
      'member',
      'none',
      'member',
      'none',
      'member',
      'none',
      'none',
    ]);
    expect(issue.thread[0]).toEqual({
      author: { login: (githubComments[0]?.user as { login: string }).login, role: 'member' },
      body: githubComments[0]?.body,
      created: githubComments[0]?.created_at,
      url: githubComments[0]?.html_url,
    });
  });

  it('says how many comments it did not read past the first 100', async () => {
    await serve((path) => {
      if (path === `${ISSUES}/23965`) return { body: { ...githubIssue, comments: 130 } };
      if (path === `${ISSUES}/23965/comments`) {
        return { body: Array.from({ length: 100 }, () => githubComments[0]) };
      }
      return undefined;
    });
    const issue = await github().getIssue(23965);
    expect(issue.thread).toHaveLength(100);
    expect(issue.moreComments).toBe(30);
    expect(api?.requests).toHaveLength(2);
  });

  it('refuses a pull request asked for as an issue', async () => {
    await serve((path) =>
      path === `${ISSUES}/24018`
        ? { body: { ...githubIssue, number: 24018, pull_request: {} } }
        : undefined,
    );
    await expect(github().getIssue(24018)).rejects.toThrow('#24018 is a pull request');
  });

  it('keeps only a label colour that is one', async () => {
    const odd = { ...firstIssue, labels: [{ name: 'a', color: 'red;x' }, { name: 'b' }, 'c'] };
    await serve((path) => (path === ISSUES ? { body: [odd] } : undefined));
    const [issue] = (await github().listIssues({ state: 'open' })).issues;
    expect(issue?.labels).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  });

  it('marks a bot', async () => {
    const bot = { ...firstIssue, user: { login: 'renovate[bot]', type: 'Bot' } };
    await serve((path) => (path === ISSUES ? { body: [bot] } : undefined));
    const [issue] = (await github().listIssues({ state: 'open' })).issues;
    expect(issue?.author).toEqual({ login: 'renovate[bot]', role: 'none', bot: true });
  });

  it('asks again with the ETag, and takes a 304 from what it kept', async () => {
    await serve((path, _query, request) => {
      if (path !== ISSUES) return undefined;
      return request.headers['if-none-match'] === '"v1"'
        ? { status: 304, body: undefined, headers: { etag: '"v1"' } }
        : { body: githubIssues, headers: { etag: '"v1"' } };
    });
    const first = await github().listIssues({ state: 'open' });
    const again = await github().listIssues({ state: 'open' });
    expect(again).toEqual(first);
    expect(api?.requests.map((r) => r.headers['if-none-match'])).toEqual([undefined, '"v1"']);
  });

  it('keeps one token’s answer from another', async () => {
    await serve((path, _query, request) =>
      path === ISSUES
        ? request.headers['if-none-match']
          ? { status: 304, body: undefined }
          : { body: githubIssues, headers: { etag: '"v1"' } }
        : undefined,
    );
    await github(true).listIssues({ state: 'open' });
    await github(false).listIssues({ state: 'open' });
    expect(api?.requests.map((r) => r.headers['if-none-match'])).toEqual([undefined, undefined]);
  });

  it('reads without a token, and sends none', async () => {
    await serve((path) => (path === ISSUES ? { body: githubIssues } : undefined));
    const forge = github(false);
    expect(forge.token).toBe(false);
    expect((await forge.listIssues({ state: 'open' })).issues).toHaveLength(3);
    expect(api?.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('says a rate limit is used up, when it resets and what to set', async () => {
    await serve(() => ({
      status: 403,
      body: { message: 'API rate limit exceeded for 203.0.113.9.' },
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793966400' },
    }));
    await expect(github(false).listIssues({ state: 'open' })).rejects.toThrow(
      /rate limit is used up; it resets at 2026-11-06 12:00 UTC \(set GITHUB_TOKEN or GH_TOKEN/,
    );
  });
});

describe('GitLab issues (IS1)', () => {
  const PROJECT = `/projects/${encodeURIComponent('gitlab-org/gitlab-runner')}`;

  it('reads an issue of the list as recorded, and the next page', async () => {
    await serve((path, query) => {
      if (path !== `${PROJECT}/issues`) return undefined;
      return query.get('page') === '2'
        ? { body: [] }
        : { body: gitlabIssues, headers: { 'x-next-page': '2' } };
    });
    const page = await gitlab().listIssues({ state: 'open' });
    expect(page.issues.map((issue) => issue.number)).toEqual([40247, 40017, 40257, 37837]);
    expect(page.issues[0]).toEqual({
      forge: 'gitlab',
      number: 40247,
      title: gitlabIssues[0]?.title,
      url: 'https://gitlab.com/gitlab-org/gitlab-runner/-/work_items/40247',
      state: 'open',
      labels: (gitlabIssues[0]?.labels as string[]).map((name) => ({ name })),
      author: { login: 'daniel-keenan' },
      comments: 3,
      created: gitlabIssues[0]?.created_at,
      updated: gitlabIssues[0]?.updated_at,
    });
    expect(Object.fromEntries(new URLSearchParams(api?.requests[0]?.path.split('?')[1]))).toEqual({
      state: 'opened',
      order_by: 'updated_at',
      sort: 'desc',
      per_page: '30',
    });
    const next = await gitlab().listIssues({ state: 'open', cursor: page.next ?? '' });
    expect(next.issues).toEqual([]);
    expect(new URLSearchParams(api?.requests[1]?.path.split('?')[1]).get('page')).toBe('2');
  });

  it('asks every state with no state, and searches titles', async () => {
    await serve((path) => (path === `${PROJECT}/issues` ? { body: [] } : undefined));
    await gitlab().listIssues({ state: 'all', search: 'docker' });
    await gitlab().listIssues({ state: 'closed' });
    const [all, closed] = (api?.requests ?? []).map(
      (r) => new URLSearchParams(r.path.split('?')[1]),
    );
    expect(all?.get('state')).toBeNull();
    expect(all?.get('search')).toBe('docker');
    expect(all?.get('in')).toBe('title');
    expect(closed?.get('state')).toBe('closed');
  });

  it('reads one issue with its notes, system notes dropped, the author’s role', async () => {
    await serve((path, query) => {
      if (path === `${PROJECT}/issues/40247`) return { body: gitlabIssue };
      if (path === `${PROJECT}/issues/40247/notes`) {
        expect(Object.fromEntries(query)).toEqual({
          sort: 'asc',
          order_by: 'created_at',
          per_page: '100',
        });
        return { body: gitlabNotes };
      }
      if (path === `${PROJECT}/members/all/35011548`) return { body: { access_level: 30 } };
      if (path === `${PROJECT}/members/all/1001`) return { body: { access_level: 40 } };
      return undefined;
    });
    const issue = await gitlab().getIssue(40247);
    expect(issue).toMatchObject({
      number: 40247,
      body: gitlabIssue.description,
      author: { login: 'daniel-keenan', role: 'member', level: 30 },
      comments: 3,
      moreComments: 0,
    });
    expect(issue.commentsNeedToken).toBeUndefined();
    expect(issue.thread.map((note) => note.author.login)).toEqual([
      'runner-maintainer',
      'daniel-keenan',
      'haraldF',
    ]);
    // Each note's author with their access level (HV9b, decision 1043): a member is Developer
    // (30) or above; someone outside the project has none. One read a person, not a note.
    expect(issue.thread.map((note) => note.author)).toEqual([
      { login: 'runner-maintainer', role: 'maintainer', level: 40 },
      { login: 'daniel-keenan', role: 'member', level: 30 },
      { login: 'haraldF', role: 'none' },
    ]);
    const levels = api?.requests.filter((r) => r.path.includes('/members/all/')) ?? [];
    expect(levels.map((r) => r.path).sort()).toEqual(
      ['1001', '2002', '35011548'].map((id) => `${PROJECT}/members/all/${id}`),
    );
    expect(issue.thread[0]).toEqual({
      author: { login: 'runner-maintainer', role: 'maintainer', level: 40 },
      body: 'Can you share the job log with `CI_DEBUG_TRACE` on?',
      created: '2026-11-05T09:12:44.120Z',
      url: 'https://gitlab.com/gitlab-org/gitlab-runner/-/work_items/40247#note_2871000001',
    });
  });

  it('names maintainers and owners, and someone outside the project', async () => {
    const levels: Record<string, Reply> = {
      '50': { body: { access_level: 50 } },
      '40': { body: { access_level: 40 } },
      none: { status: 404, body: { message: '404 Not found' } },
    };
    for (const [level, role] of [
      ['50', 'owner'],
      ['40', 'maintainer'],
      ['none', 'none'],
    ] as const) {
      await serve((path) => {
        if (path === `${PROJECT}/issues/40247`) return { body: gitlabIssue };
        if (path === `${PROJECT}/issues/40247/notes`) return { body: [] };
        if (path === `${PROJECT}/members/all/35011548`) return levels[level];
        return undefined;
      });
      expect((await gitlab().getIssue(40247)).author.role).toBe(role);
      await api?.close();
      api = undefined;
    }
  });

  it('reads the issue without a token, and says its comments need one', async () => {
    await serve((path) => (path === `${PROJECT}/issues/40247` ? { body: gitlabIssue } : undefined));
    const issue = await gitlab(false).getIssue(40247);
    expect(issue).toMatchObject({
      number: 40247,
      thread: [],
      moreComments: 3,
      commentsNeedToken: true,
      author: { login: 'daniel-keenan' },
    });
    expect(api?.requests.map((r) => r.path)).toEqual([`${PROJECT}/issues/40247`]);
    expect(api?.requests[0]?.headers['private-token']).toBeUndefined();
  });
});
