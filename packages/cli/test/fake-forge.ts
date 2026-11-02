// A fake GitHub or GitLab (HV8) over the forge package's fake API: requests opened, listed, read,
// updated and reviewed, kept in memory; a merge made on the bare `origin` as the forge would make
// it. Nothing leaves the machine.
import { execFileSync } from 'node:child_process';
import { GitHubForge, GitLabForge, type Forge, type ForgeKind } from '@symbiote/forge';
import { mockApi, type Recorded, type Reply } from '../../forge/test/mock-api.js';

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

export interface FakeForge {
  kind: ForgeKind;
  url: string;
  requests: FakeRequest[];
  /** Every call the forge got. */
  calls: Recorded[];
  /** The reviews posted: their event and summary. */
  reviews: { number: number; event: string; body: string }[];
  /** A forge client on this fake, with a token or without. */
  forge(token?: boolean): Forge;
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
export async function fakeForge(kind: ForgeKind, remote: string): Promise<FakeForge> {
  const requests: FakeRequest[] = [];
  const reviews: FakeForge['reviews'] = [];
  const tip = (branch: string) => {
    try {
      return gitIn(remote, 'rev-parse', `refs/heads/${branch}`);
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

  const answer = (request: Recorded): Reply | undefined => {
    const [path = '', query = ''] = request.path.split('?');
    const params = new URLSearchParams(query);
    const body = (request.body ?? {}) as Record<string, string | boolean>;
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
  return {
    kind,
    url: api.url,
    requests,
    calls: api.requests,
    reviews,
    forge(token = true) {
      return kind === 'github'
        ? new GitHubForge(
            'github.com',
            PROJECT,
            { GITHUB_API_URL: api.url, ...(token ? { GITHUB_TOKEN: 'ghp_fake' } : {}) },
            () => undefined,
          )
        : new GitLabForge('gitlab.com', PROJECT, {
            GITLAB_API_URL: api.url,
            ...(token ? { GITLAB_TOKEN: 'glpat-fake' } : {}),
          });
    },
    merge(number) {
      const r = find(number);
      if (!r) throw new Error(`no request ${number}`);
      const base = tip(r.base);
      const head = tip(r.head);
      const tree = gitIn(remote, 'merge-tree', '--write-tree', base, head).split('\n')[0] ?? '';
      const merge = gitIn(
        remote,
        'commit-tree',
        tree,
        '-p',
        base,
        '-p',
        head,
        '-m',
        `Merge ${kind === 'github' ? 'pull request #' : 'branch'}${r.number}`,
      );
      gitIn(remote, 'update-ref', `refs/heads/${r.base}`, merge, base);
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
}
