// HV11a (decision 1018): Symbiote writes to an issue — a comment, its closing, its labels — and
// reads its state and the token's account first, on GitHub and GitLab. No answer to a write can be
// recorded without writing to a real forge: the write answers are made by hand in each API's
// documented shape (GitHub REST 2022-11-28, GitLab REST v4), as IS1's `gitlab-notes.json` was.
// The issue reads are IS1's recordings (test/fixtures/issues), their lock set where a test needs it.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeError, GitHubForge, GitLabForge, type Forge, type NewLabel } from '../src/index.js';
import { clearConditional } from '../src/http.js';
import { clearKnownLabels } from '../src/issues.js';
import { fakeForge } from './fake-forge.js';
import { mockApi, type Recorded, type Reply } from './mock-api.js';

const recorded = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/issues/${name}.json`, import.meta.url), 'utf8')) as T;

const githubIssue = recorded<Record<string, unknown>>('github-issue');
const gitlabIssue = recorded<Record<string, unknown>>('gitlab-issue');

let api: Awaited<ReturnType<typeof mockApi>> | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
  clearConditional();
  clearKnownLabels();
});

async function serve(answer: (r: Recorded, path: string) => Reply | undefined) {
  api = await mockApi({}, (request) => answer(request, request.path.split('?')[0] ?? ''));
  return api;
}

const WORKING: NewLabel = {
  name: 'symbiote: working',
  color: '#6e56cf',
  description: "Symbiote's Hive is working on this",
};
const STOPPED = 'symbiote: stopped';

const github = (env: Record<string, string> = { GITHUB_TOKEN: 'ghp_x' }) =>
  new GitHubForge('github.com', 'acme/app', { GITHUB_API_URL: api?.url, ...env }, () => undefined);

/** Typed as the interface: GitLab's own close takes no reason. */
const gitlab = (env: Record<string, string> = { GITLAB_TOKEN: 'glpat-x' }): Forge =>
  new GitLabForge('gitlab.com', 'acme/app', { GITLAB_API_URL: api?.url, ...env });

const calls = () => (api?.requests ?? []).map((r) => `${r.method} ${r.path}`);

describe('GitHub writes to an issue (HV11a)', () => {
  const ISSUE = '/repos/acme/app/issues/7';

  it('comments, with the token, and returns the comment’s page', async () => {
    await serve((r, path) =>
      r.method === 'POST' && path === `${ISSUE}/comments`
        ? {
            status: 201,
            body: {
              id: 1,
              html_url: 'https://github.com/acme/app/issues/7#issuecomment-1',
              body: (r.body as { body: string }).body,
            },
          }
        : undefined,
    );
    expect(await github().commentOnIssue(7, 'Landed.')).toEqual({
      url: 'https://github.com/acme/app/issues/7#issuecomment-1',
    });
    expect(api?.requests[0]?.body).toEqual({ body: 'Landed.' });
    expect(api?.requests[0]?.headers.authorization).toBe('Bearer ghp_x');
  });

  it('closes as completed or as not planned', async () => {
    await serve((r, path) =>
      r.method === 'PATCH' && path === ISSUE ? { body: { ...githubIssue, number: 7 } } : undefined,
    );
    await github().closeIssue(7, 'completed');
    await github().closeIssue(7, 'not-planned');
    expect(api?.requests.map((r) => r.body)).toEqual([
      { state: 'closed', state_reason: 'completed' },
      { state: 'closed', state_reason: 'not_planned' },
    ]);
  });

  it('makes a missing label once per project, then adds and removes', async () => {
    const made = new Set<string>();
    await serve((r, path) => {
      const one = /^\/repos\/acme\/app\/labels\/(.+)$/.exec(path);
      if (r.method === 'GET' && one) {
        const name = decodeURIComponent(one[1] ?? '');
        return made.has(name)
          ? { body: { name, color: '6e56cf' } }
          : { status: 404, body: { message: 'Not Found' } };
      }
      if (r.method === 'POST' && path === '/repos/acme/app/labels') {
        made.add((r.body as { name: string }).name);
        return { status: 201, body: r.body };
      }
      if (r.method === 'POST' && path === `${ISSUE}/labels`) return { body: [] };
      if (r.method === 'DELETE' && path.startsWith(`${ISSUE}/labels/`)) {
        return { status: 404, body: { message: 'Label does not exist' } };
      }
      return undefined;
    });
    await github().labelIssue(7, { add: [WORKING], remove: [STOPPED] });
    // Another forge of the same project, as Symbiote makes one a call: the label is known.
    await github().labelIssue(7, { add: [WORKING], remove: [] });
    expect(calls()).toEqual([
      'GET /repos/acme/app/labels/symbiote%3A%20working',
      'POST /repos/acme/app/labels',
      `POST ${ISSUE}/labels`,
      `DELETE ${ISSUE}/labels/symbiote%3A%20stopped`,
      `POST ${ISSUE}/labels`,
    ]);
    expect(api?.requests[1]?.body).toEqual({
      name: 'symbiote: working',
      color: '6e56cf',
      description: "Symbiote's Hive is working on this",
    });
    expect(api?.requests[2]?.body).toEqual({ labels: ['symbiote: working'] });
  });

  it('takes a label another made meanwhile (422 already_exists)', async () => {
    await serve((r, path) => {
      if (r.method === 'GET' && path.startsWith('/repos/acme/app/labels/'))
        return { status: 404, body: { message: 'Not Found' } };
      if (r.method === 'POST' && path === '/repos/acme/app/labels')
        return {
          status: 422,
          body: { message: 'Validation Failed', errors: [{ code: 'already_exists' }] },
        };
      if (r.method === 'POST' && path === `${ISSUE}/labels`) return { body: [] };
      return undefined;
    });
    await github().labelIssue(7, { add: [WORKING], remove: [] });
    expect(calls().at(-1)).toBe(`POST ${ISSUE}/labels`);
  });

  it("reads an issue's state, its lock and its labels", async () => {
    await serve((r, path) =>
      path === ISSUE
        ? {
            body: {
              ...githubIssue,
              number: 7,
              state: 'closed',
              locked: true,
              active_lock_reason: 'spam',
            },
          }
        : undefined,
    );
    expect(await github().issueState(7)).toEqual({
      state: 'closed',
      locked: true,
      labels: ['pending triage'],
    });
  });

  it('refuses a pull request’s number', async () => {
    await serve((r, path) =>
      path === ISSUE
        ? { body: { ...githubIssue, number: 7, pull_request: { url: 'x' } } }
        : undefined,
    );
    await expect(github().issueState(7)).rejects.toThrow('#7 is a pull request, not an issue');
  });

  it('keeps the status and the forge’s answer of a refused write', async () => {
    await serve(() => ({
      status: 403,
      body: { message: 'Resource not accessible by personal access token' },
    }));
    const error = await github()
      .commentOnIssue(7, 'Landed.')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForgeError);
    expect((error as ForgeError).status).toBe(403);
    expect((error as ForgeError).answer).toContain(
      'Resource not accessible by personal access token',
    );
  });

  it('writes nothing without a token', async () => {
    await serve(() => undefined);
    await expect(github({}).commentOnIssue(7, 'x')).rejects.toThrow(/needs a token/);
    await expect(github({}).labelIssue(7, { add: [WORKING], remove: [] })).rejects.toThrow(
      /needs a token/,
    );
    await expect(github({}).closeIssue(7, 'completed')).rejects.toThrow(/needs a token/);
    expect(api?.requests).toEqual([]);
  });

  it('names the account and whether a classic token may write; a fine-grained one, unknown', async () => {
    let scopes: string | undefined = 'read:org, repo';
    await serve((r, path) =>
      path === '/user'
        ? {
            body: { login: 'ada', id: 1, type: 'User' },
            ...(scopes === undefined ? {} : { headers: { 'x-oauth-scopes': scopes } }),
          }
        : undefined,
    );
    expect(await github().tokenAccount()).toEqual({ login: 'ada', write: 'yes' });
    scopes = 'public_repo';
    expect(await github().tokenAccount()).toEqual({ login: 'ada', write: 'yes' });
    scopes = 'read:org, gist';
    expect(await github().tokenAccount()).toEqual({ login: 'ada', write: 'no' });
    scopes = undefined;
    expect(await github().tokenAccount()).toEqual({ login: 'ada', write: 'unknown' });
  });
});

describe('GitLab writes to an issue (HV11a)', () => {
  const PROJECT = '/projects/acme%2Fapp';
  const ISSUE = `${PROJECT}/issues/7`;

  it('comments with a note and returns its page', async () => {
    await serve((r, path) =>
      r.method === 'POST' && path === `${ISSUE}/notes`
        ? {
            status: 201,
            body: {
              id: 55,
              body: (r.body as { body: string }).body,
              noteable_iid: 7,
              noteable_type: 'Issue',
              system: false,
            },
          }
        : undefined,
    );
    expect(await gitlab().commentOnIssue(7, 'Landed.')).toEqual({
      url: 'https://gitlab.com/acme/app/-/issues/7#note_55',
    });
    expect(api?.requests[0]?.body).toEqual({ body: 'Landed.' });
    expect(api?.requests[0]?.headers['private-token']).toBe('glpat-x');
  });

  it('closes, with no reason kept', async () => {
    await serve((r, path) =>
      r.method === 'PUT' && path === ISSUE ? { body: { ...gitlabIssue, iid: 7 } } : undefined,
    );
    await gitlab().closeIssue(7, 'completed');
    expect(api?.requests[0]?.body).toEqual({ state_event: 'close' });
  });

  it('makes a missing label once per project, then adds and removes in one edit', async () => {
    await serve((r, path) => {
      if (r.method === 'GET' && path.startsWith(`${PROJECT}/labels/`))
        return { status: 404, body: { message: '404 Label Not Found' } };
      if (r.method === 'POST' && path === `${PROJECT}/labels`)
        return { status: 201, body: { id: 1, ...(r.body as object) } };
      if (r.method === 'PUT' && path === ISSUE) return { body: { ...gitlabIssue, iid: 7 } };
      return undefined;
    });
    await gitlab().labelIssue(7, { add: [WORKING], remove: [STOPPED] });
    await gitlab().labelIssue(7, { add: [WORKING], remove: [] });
    await gitlab().labelIssue(7, { add: [], remove: [WORKING.name] });
    expect(calls()).toEqual([
      `GET ${PROJECT}/labels/symbiote%3A%20working`,
      `POST ${PROJECT}/labels`,
      `PUT ${ISSUE}`,
      `PUT ${ISSUE}`,
      `PUT ${ISSUE}`,
    ]);
    expect(api?.requests[1]?.body).toEqual({
      name: 'symbiote: working',
      color: '#6e56cf',
      description: "Symbiote's Hive is working on this",
    });
    expect(api?.requests.slice(2).map((r) => r.body)).toEqual([
      { add_labels: 'symbiote: working', remove_labels: 'symbiote: stopped' },
      { add_labels: 'symbiote: working' },
      { remove_labels: 'symbiote: working' },
    ]);
  });

  it('takes a label another made meanwhile (409)', async () => {
    await serve((r, path) => {
      if (r.method === 'GET' && path.startsWith(`${PROJECT}/labels/`))
        return { status: 404, body: { message: '404 Label Not Found' } };
      if (r.method === 'POST' && path === `${PROJECT}/labels`)
        return { status: 409, body: { message: 'Label already exists' } };
      if (r.method === 'PUT' && path === ISSUE) return { body: { ...gitlabIssue, iid: 7 } };
      return undefined;
    });
    await gitlab().labelIssue(7, { add: [WORKING], remove: [] });
    expect(calls().at(-1)).toBe(`PUT ${ISSUE}`);
  });

  it("reads an issue's state, its locked discussion and its labels", async () => {
    await serve((r, path) =>
      path === ISSUE
        ? { body: { ...gitlabIssue, iid: 7, state: 'opened', discussion_locked: true } }
        : undefined,
    );
    expect(await gitlab().issueState(7)).toEqual({
      state: 'open',
      locked: true,
      labels: gitlabIssue.labels,
    });
  });

  it('keeps the status and the forge’s answer of a refused write', async () => {
    await serve(() => ({ status: 403, body: { message: '403 Forbidden' } }));
    const error = await gitlab()
      .closeIssue(7, 'completed')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForgeError);
    expect((error as ForgeError).status).toBe(403);
    expect((error as ForgeError).answer).toContain('403 Forbidden');
  });

  it('writes nothing with the CI job token alone', async () => {
    await serve(() => undefined);
    const job = gitlab({ CI_JOB_TOKEN: 'job-1', CI_SERVER_HOST: 'gitlab.com' });
    await expect(job.commentOnIssue(7, 'x')).rejects.toThrow(/needs GITLAB_TOKEN/);
    await expect(job.closeIssue(7, 'completed')).rejects.toThrow(/needs GITLAB_TOKEN/);
    expect(api?.requests).toEqual([]);
  });

  it("names the account and whether its token's scopes may write; unknown when not read", async () => {
    let self: Reply = { body: { id: 3, name: 'symbiote', scopes: ['api'], active: true } };
    await serve((r, path) => {
      if (path === '/user') return { body: { id: 9, username: 'ada' } };
      if (path === '/personal_access_tokens/self') return self;
      return undefined;
    });
    expect(await gitlab().tokenAccount()).toEqual({ login: 'ada', write: 'yes' });
    self = { body: { id: 3, scopes: ['read_api', 'read_repository'], active: true } };
    expect(await gitlab().tokenAccount()).toEqual({ login: 'ada', write: 'no' });
    self = { status: 404, body: { message: '404 Not Found' } };
    expect(await gitlab().tokenAccount()).toEqual({ login: 'ada', write: 'unknown' });
  });
});

describe('the fake forge answers as the adapters write (HV11)', () => {
  for (const kind of ['github', 'gitlab'] as const) {
    it(`${kind}: a comment, labels made once, a close, the state and the account`, async () => {
      const fake = await fakeForge(kind);
      try {
        fake.issues.push({
          number: 7,
          title: 'A bug',
          body: 'It breaks.',
          state: 'open',
          author: 'grace',
          updated: '2026-11-14T10:00:00Z',
        });
        const forge: Forge =
          kind === 'github'
            ? new GitHubForge(
                'github.com',
                'acme/app',
                { GITHUB_API_URL: fake.url, GITHUB_TOKEN: 'ghp_x' },
                () => undefined,
              )
            : new GitLabForge('gitlab.com', 'acme/app', {
                GITLAB_API_URL: fake.url,
                GITLAB_TOKEN: 'glpat-x',
              });
        await forge.commentOnIssue(7, 'Taken.');
        await forge.labelIssue(7, { add: [WORKING], remove: [STOPPED] });
        clearKnownLabels();
        await forge.labelIssue(7, { add: [WORKING], remove: [] });
        expect(await forge.issueState(7)).toEqual({
          state: 'open',
          locked: false,
          labels: ['symbiote: working'],
        });
        await forge.labelIssue(7, { add: [], remove: [WORKING.name] });
        await forge.closeIssue(7, 'completed');
        expect(fake.labels.map((l) => l.name)).toEqual(['symbiote: working']);
        expect(fake.issues[0]).toMatchObject({
          state: 'closed',
          closedBy: 'api',
          labels: [],
          comments: [{ author: 'ada', body: 'Taken.' }],
        });
        expect(await forge.tokenAccount()).toEqual({ login: 'ada', write: 'yes' });
        fake.writesFail = 403;
        await expect(forge.commentOnIssue(7, 'x')).rejects.toBeInstanceOf(ForgeError);
      } finally {
        await fake.close_();
      }
    });
  }
});
