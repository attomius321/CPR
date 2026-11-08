// A fake GitHub or GitLab (HV8) over the fake API: requests opened, listed, read, updated and
// reviewed, kept in memory; a merge made on the bare `origin` as the forge would make it. Nothing
// leaves the machine. Imports nothing of the forge's sources: the viewer's e2e serves it too.
import { execFileSync } from 'node:child_process';
import { mockApi, type Recorded, type Reply } from './mock-api.js';

export type FakeForgeKind = 'github' | 'gitlab';

export interface FakeRequest {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  state: 'open' | 'closed' | 'merged';
  conflict: boolean;
  merge?: string;
}

/** An issue on the fake forge (IS1): its text, its labels, its comments. */
export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  author: string;
  /** GitHub's `author_association` (`OWNER`, `NONE`…); GitLab's access level from it. */
  role?: string;
  labels?: { name: string; color: string }[];
  comments?: { author: string; body: string; role?: string }[];
  /** ISO; issues are listed most recently updated first. */
  updated: string;
}

export interface FakeForge {
  kind: FakeForgeKind;
  /** Its API's address: `GITHUB_API_URL` or `GITLAB_API_URL`. */
  url: string;
  /** Its repository: a bare one, as `origin` is (set later where it is made later). */
  remote: string;
  requests: FakeRequest[];
  /** Its issues (IS1); the requests are listed among GitHub's too, as GitHub does. */
  issues: FakeIssue[];
  /** A status every issue read answers with, while set (IS1: the forge's error). */
  issuesFail?: number;
  /** Every call the forge got. */
  calls: Recorded[];
  /** The reviews posted: their event and summary. */
  reviews: { number: number; event: string; body: string }[];
  /** The person's merge on the forge: a merge commit of the branch on `origin`'s base. */
  merge(number: number): string;
  close(number: number): void;
  conflict(number: number, on?: boolean): void;
  close_(): Promise<void>;
}

const PROJECT = 'acme/app';

const gitIn = (dir: string, ...args: string[]) =>
  execFileSync('git', ['--git-dir', dir, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Forge',
      GIT_AUTHOR_EMAIL: 'forge@example.com',
      GIT_COMMITTER_NAME: 'Forge',
      GIT_COMMITTER_EMAIL: 'forge@example.com',
    },
  }).trim();

/** A fake forge of `kind` whose repository is the bare `remote`. */
export async function fakeForge(kind: FakeForgeKind, remote = ''): Promise<FakeForge> {
  const requests: FakeRequest[] = [];
  const reviews: FakeForge['reviews'] = [];
  const tip = (branch: string) => {
    // A forge with no repository yet (IS1's): its requests name no commit.
    if (!fake.remote) return '0'.repeat(40);
    try {
      return gitIn(fake.remote, 'rev-parse', `refs/heads/${branch}`);
    } catch {
      return '0'.repeat(40);
    }
  };
  const find = (n: number) => requests.find((r) => r.number === n);

  const github = (r: FakeRequest) => ({
    number: r.number,
    title: r.title,
    html_url: `https://github.com/${PROJECT}/pull/${r.number}`,
    user: { login: 'ada' },
    state: r.state === 'open' ? 'open' : 'closed',
    merged_at: r.state === 'merged' ? '2026-11-02T12:00:00Z' : null,
    draft: r.draft,
    body: r.body,
    base: { ref: r.base, sha: tip(r.base) },
    head: { ref: r.head, sha: tip(r.head) },
    mergeable: r.state === 'open' ? !r.conflict : null,
    mergeable_state: r.conflict ? 'dirty' : 'clean',
    merge_commit_sha: r.merge ?? null,
  });
  const gitlab = (r: FakeRequest) => ({
    iid: r.number,
    title: r.title,
    web_url: `https://gitlab.com/${PROJECT}/-/merge_requests/${r.number}`,
    author: { username: 'ada' },
    state: r.state === 'open' ? 'opened' : r.state,
    draft: r.draft,
    description: r.body,
    source_branch: r.head,
    target_branch: r.base,
    sha: tip(r.head),
    diff_refs: { base_sha: tip(r.base), head_sha: tip(r.head), start_sha: tip(r.base) },
    has_conflicts: r.conflict,
    detailed_merge_status: r.conflict ? 'conflict' : 'mergeable',
    merge_commit_sha: r.merge ?? null,
  });

  const open = (head: string, base: string, title: string, body: string, draft: boolean) => {
    const made: FakeRequest = {
      number: 12 + requests.length,
      head,
      base,
      title,
      body,
      draft,
      state: 'open',
      conflict: false,
    };
    requests.push(made);
    return made;
  };

  const issues: FakeIssue[] = [];
  const LEVELS: Record<string, number> = { OWNER: 50, MEMBER: 40, COLLABORATOR: 30 };
  const githubIssue = (i: FakeIssue) => ({
    number: i.number,
    title: i.title,
    html_url: `https://github.com/${PROJECT}/issues/${i.number}`,
    user: { login: i.author, type: i.author.endsWith('[bot]') ? 'Bot' : 'User' },
    labels: i.labels ?? [],
    state: i.state,
    comments: i.comments?.length ?? 0,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: i.updated,
    author_association: i.role ?? 'NONE',
    body: i.body,
  });
  const gitlabIssue = (i: FakeIssue) => ({
    iid: i.number,
    title: i.title,
    web_url: `https://gitlab.com/${PROJECT}/-/issues/${i.number}`,
    author: { id: 1000 + i.number, username: i.author },
    labels: (i.labels ?? []).map((label) => label.name),
    state: i.state === 'open' ? 'opened' : 'closed',
    user_notes_count: i.comments?.length ?? 0,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: i.updated,
    description: i.body,
  });
  const byUpdate = (list: FakeIssue[]) =>
    [...list].sort((a, b) => b.updated.localeCompare(a.updated) || b.number - a.number);
  /** A page of `items` by `per_page` and `page`, and whether there is another. */
  const pageOf = <T>(items: T[], params: URLSearchParams) => {
    const size = Number(params.get('per_page') ?? 30);
    const page = Number(params.get('page') ?? 1);
    return {
      items: items.slice((page - 1) * size, page * size),
      next: page * size < items.length ? page + 1 : 0,
    };
  };

  /** Issues (IS1): GitHub's list (pull requests among them), search, one and its comments; GitLab's. */
  const issueAnswer = (
    request: Recorded,
    path: string,
    params: URLSearchParams,
  ): Reply | undefined => {
    if (request.method !== 'GET') return undefined;
    if (kind === 'github') {
      const list = `/repos/${PROJECT}/issues`;
      const one = new RegExp(`^${list}/(\\d+)(/comments)?$`).exec(path);
      const issue = one ? issues.find((i) => i.number === Number(one[1])) : undefined;
      if (path !== list && path !== '/search/issues' && !issue) return undefined;
      if (fake.issuesFail) return { status: fake.issuesFail, body: { message: 'Server Error' } };
      if (path === list) {
        const state = params.get('state') ?? 'open';
        const shown = byUpdate(issues.filter((i) => state === 'all' || i.state === state));
        const pulls = requests
          .filter((r) => state === 'all' || (state === 'open') === (r.state === 'open'))
          .map((r) => ({
            ...github(r),
            comments: 0,
            labels: [],
            created_at: '2026-11-01T10:00:00Z',
            updated_at: '2026-11-09T00:00:00Z',
            pull_request: { url: 'x' },
          }));
        const { items, next } = pageOf([...pulls, ...shown.map(githubIssue)], params);
        return {
          body: items,
          ...(next
            ? {
                headers: {
                  link: `<${fake.url}${list}?state=${state}&per_page=${params.get('per_page')}&page=${next}>; rel="next"`,
                },
              }
            : {}),
        };
      }
      if (path === '/search/issues') {
        const q = params.get('q') ?? '';
        const words = (/"([^"]*)"/.exec(q)?.[1] ?? '').toLowerCase();
        const state = /is:(open|closed)/.exec(q)?.[1];
        const found = byUpdate(
          issues.filter(
            (i) => (!state || i.state === state) && i.title.toLowerCase().includes(words),
          ),
        );
        const { items, next } = pageOf(found.map(githubIssue), params);
        return {
          body: { total_count: found.length, incomplete_results: false, items },
          ...(next
            ? { headers: { link: `<${fake.url}/search/issues?page=${next}>; rel="next"` } }
            : {}),
        };
      }
      if (!issue) return undefined;
      if (!one?.[2]) return { body: githubIssue(issue) };
      return {
        body: (issue.comments ?? []).map((c, n) => ({
          html_url: `https://github.com/${PROJECT}/issues/${issue.number}#issuecomment-${n + 1}`,
          user: { login: c.author, type: 'User' },
          created_at: '2026-11-02T10:00:00Z',
          author_association: c.role ?? 'NONE',
          body: c.body,
        })),
      };
    }
    const project = `/projects/${encodeURIComponent(PROJECT)}`;
    const one = new RegExp(`^${project}/issues/(\\d+)(/notes)?$`).exec(path);
    const member = new RegExp(`^${project}/members/all/(\\d+)$`).exec(path);
    if (path !== `${project}/issues` && !one && !member) return undefined;
    if (fake.issuesFail) return { status: fake.issuesFail, body: { message: 'Server Error' } };
    if (member) {
      const role = issues.find((i) => 1000 + i.number === Number(member[1]))?.role ?? 'NONE';
      const level = LEVELS[role];
      return level
        ? { body: { access_level: level } }
        : { status: 404, body: { message: '404 Not found' } };
    }
    if (!one) {
      const state = params.get('state');
      const words = (params.get('search') ?? '').toLowerCase();
      const found = byUpdate(
        issues.filter(
          (i) =>
            (!state || (state === 'opened') === (i.state === 'open')) &&
            i.title.toLowerCase().includes(words),
        ),
      );
      const { items, next } = pageOf(found.map(gitlabIssue), params);
      return { body: items, ...(next ? { headers: { 'x-next-page': String(next) } } : {}) };
    }
    const issue = issues.find((i) => i.number === Number(one[1]));
    if (!issue) return { status: 404, body: { message: '404 Not found' } };
    if (!one[2]) return { body: gitlabIssue(issue) };
    if (!request.headers['private-token'])
      return { status: 401, body: { message: '401 Unauthorized' } };
    return {
      body: (issue.comments ?? []).map((c, n) => ({
        id: n + 1,
        body: c.body,
        author: { username: c.author },
        created_at: '2026-11-02T10:00:00Z',
        system: false,
      })),
    };
  };

  const answer = (request: Recorded): Reply | undefined => {
    const [path = '', query = ''] = request.path.split('?');
    const params = new URLSearchParams(query);
    const body = (request.body ?? {}) as Record<string, string | boolean>;
    const read = issueAnswer(request, path, params);
    if (read) return read;
    if (kind === 'github') {
      const base = `/repos/${PROJECT}/pulls`;
      if (request.method === 'POST' && path === base) {
        const made = open(
          String(body.head),
          String(body.base),
          String(body.title),
          String(body.body),
          body.draft === true,
        );
        return { status: 201, body: github(made) };
      }
      if (request.method === 'GET' && path === base) {
        const head = (params.get('head') ?? '').replace(/^acme:/, '');
        const list = requests.filter(
          (r) => r.state === 'open' && r.head === head && r.base === params.get('base'),
        );
        return { body: params.get('page') === '1' ? list.map(github) : [] };
      }
      const one = new RegExp(`^${base}/(\\d+)(/.*)?$`).exec(path);
      const issue = new RegExp(`^/repos/${PROJECT}/issues/(\\d+)/comments$`).exec(path);
      if (issue) return { body: [] };
      if (!one) return undefined;
      const r = find(Number(one[1]));
      if (!r) return undefined;
      const rest = one[2] ?? '';
      if (rest === '' && request.method === 'GET') return { body: github(r) };
      if (rest === '' && request.method === 'PATCH') {
        r.body = String(body.body);
        return { body: github(r) };
      }
      if (rest === '/reviews' && request.method === 'POST') {
        reviews.push({ number: r.number, event: String(body.event), body: String(body.body) });
        return { body: { html_url: `https://github.com/${PROJECT}/pull/${r.number}#review` } };
      }
      if (rest === '/reviews' || rest === '/comments') {
        const bodies = rest === '/reviews' ? reviews.filter((v) => v.number === r.number) : [];
        return { body: params.get('page') === '1' ? bodies : [] };
      }
      return undefined;
    }
    const base = `/projects/${encodeURIComponent(PROJECT)}/merge_requests`;
    if (request.method === 'POST' && path === base) {
      const made = open(
        String(body.source_branch),
        String(body.target_branch),
        String(body.title),
        String(body.description),
        false,
      );
      return { status: 201, body: gitlab(made) };
    }
    if (request.method === 'GET' && path === base) {
      const list = requests.filter(
        (r) =>
          r.state === 'open' &&
          r.head === params.get('source_branch') &&
          r.base === params.get('target_branch'),
      );
      return { body: params.get('page') === '1' ? list.map((r) => ({ iid: r.number })) : [] };
    }
    const one = new RegExp(`^${base.replace(/%/g, '%')}/(\\d+)(/.*)?$`).exec(path);
    if (!one) return undefined;
    const r = find(Number(one[1]));
    if (!r) return undefined;
    const rest = one[2] ?? '';
    if (rest === '' && request.method === 'GET') return { body: gitlab(r) };
    if (rest === '' && request.method === 'PUT') {
      r.body = String(body.description);
      return { body: gitlab(r) };
    }
    if (rest === '/notes') {
      const notes = reviews.filter((v) => v.number === r.number);
      return { body: params.get('page') === '1' ? notes : [] };
    }
    if (rest === '/draft_notes' && request.method === 'POST') {
      reviews.push({ number: r.number, event: 'comment', body: String(body.note) });
      return { body: { id: reviews.length } };
    }
    if (rest === '/draft_notes/bulk_publish') return { body: {} };
    return undefined;
  };

  const api = await mockApi({}, answer);
  const fake: FakeForge = {
    kind,
    url: api.url,
    remote,
    requests,
    issues,
    calls: api.requests,
    reviews,
    merge(number) {
      const r = find(number);
      if (!r) throw new Error(`no request ${number}`);
      const base = tip(r.base);
      const head = tip(r.head);
      const tree =
        gitIn(fake.remote, 'merge-tree', '--write-tree', base, head).split('\n')[0] ?? '';
      const merge = gitIn(
        fake.remote,
        'commit-tree',
        tree,
        '-p',
        base,
        '-p',
        head,
        '-m',
        `Merge ${kind === 'github' ? 'pull request #' : 'branch'}${r.number}`,
      );
      gitIn(fake.remote, 'update-ref', `refs/heads/${r.base}`, merge, base);
      r.state = 'merged';
      r.merge = merge;
      return merge;
    },
    close(number) {
      const r = find(number);
      if (r) r.state = 'closed';
    },
    conflict(number, on = true) {
      const r = find(number);
      if (r) r.conflict = on;
    },
    close_: api.close,
  };
  return fake;
}
