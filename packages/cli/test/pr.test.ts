import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Graph } from '@cpr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBranchedRepo, tempDir } from '../../core/test/helpers/git-repo.js';
import { mockApi } from '../../forge/test/mock-api.js';
import { run } from '../src/main.js';

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim();

/**
 * A "forge" remote: a bare repo whose pull/merge request refs point at the feature branch,
 * cloned locally with a github.com / gitlab URL that git rewrites (insteadOf) to the bare repo.
 */
function cloneAs(bare: string, url: string, { copyObjects = true } = {}): string {
  const local = tempDir();
  // A local clone copies every object; --no-local fetches only what branches reach, like a
  // clone from a real forge.
  git(local, 'clone', '--quiet', ...(copyObjects ? [] : ['--no-local']), bare, '.');
  git(local, 'config', 'remote.origin.url', url);
  git(local, 'config', `url.${bare}.insteadOf`, url);
  return local;
}

describe('cpr pr', () => {
  const { repo, shas } = createBranchedRepo();
  const bare = tempDir();
  const cache = tempDir();
  const dirs: string[] = [bare, cache];
  let api: Awaited<ReturnType<typeof mockApi>>;
  /** What the "forges" received as reviews; listed back as existing comments. */
  const reviews: { github: string[]; gitlab: string[] } = { github: [], gitlab: [] };
  /** Makes the mock GitHub refuse inline comments, like lines outside its diff. */
  let refuseInline = false;
  const asComments = (bodies: string[]) => ({ body: bodies.map((body) => ({ body })) });

  beforeAll(async () => {
    git(bare, 'clone', '--quiet', '--bare', repo.root, '.');
    git(bare, 'update-ref', 'refs/pull/7/head', shas.feature);
    git(bare, 'update-ref', 'refs/merge-requests/7/head', shas.feature);
    api = await mockApi({
      'GET /repos/acme/widgets/pulls/7': {
        body: {
          number: 7,
          title: 'Add widgets',
          html_url: 'https://github.com/acme/widgets/pull/7',
          user: { login: 'ada' },
          state: 'open',
          merged_at: null,
          draft: false,
          base: { ref: 'main', sha: shas.main },
          head: { ref: 'feature', sha: shas.feature },
        },
      },
      'GET /projects/acme%2Ftools%2Fwidgets/merge_requests/7': {
        body: {
          iid: 7,
          title: 'Add widgets',
          web_url: 'https://gitlab.example.com/acme/tools/widgets/-/merge_requests/7',
          author: { username: 'ada' },
          state: 'opened',
          draft: false,
          source_branch: 'feature',
          target_branch: 'main',
          sha: shas.feature,
          diff_refs: { base_sha: shas.root, head_sha: shas.feature, start_sha: shas.main },
        },
      },
      'GET /repos/acme/widgets/pulls/7/comments?per_page=100&page=1': () =>
        asComments(reviews.github),
      'GET /repos/acme/widgets/pulls/7/reviews?per_page=100&page=1': () => asComments([]),
      'GET /repos/acme/widgets/issues/7/comments?per_page=100&page=1': () => asComments([]),
      'POST /repos/acme/widgets/pulls/7/reviews': (request) => {
        const review = request.body as { body: string; comments: { body: string }[] };
        if (refuseInline && review.comments.length > 0) {
          return { status: 422, body: { message: 'Line could not be resolved' } };
        }
        reviews.github.push(review.body, ...review.comments.map((c) => c.body));
        return { body: { html_url: 'https://github.com/acme/widgets/pull/7#pullrequestreview-1' } };
      },
      'GET /projects/acme%2Ftools%2Fwidgets/merge_requests/7/notes?per_page=100&page=1': () =>
        asComments(reviews.gitlab),
      'POST /projects/acme%2Ftools%2Fwidgets/merge_requests/7/draft_notes': (request) => {
        reviews.gitlab.push((request.body as { note: string }).note);
        return { body: { id: reviews.gitlab.length } };
      },
      'POST /projects/acme%2Ftools%2Fwidgets/merge_requests/7/draft_notes/bulk_publish': {
        status: 204,
        body: '',
      },
    });
  });

  afterAll(async () => {
    await api.close();
    repo.cleanup();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** More environment for the next runs, e.g. a CI job's. */
  let jobEnv: Record<string, string> = {};

  async function cpr(cwd: string, ...argv: string[]) {
    let stdout = '';
    let stderr = '';
    const code = await run(argv, {
      cwd,
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      openUrl: () => undefined,
      waitForExit: () => Promise.resolve(),
      env: {
        GITHUB_API_URL: api.url,
        GITHUB_TOKEN: 'ghp_test',
        GITLAB_API_URL: api.url,
        GITLAB_TOKEN: 'glpat-test',
        CPR_CACHE_DIR: cache,
        ...jobEnv,
      },
    });
    return { code, stdout, stderr };
  }

  it('reviews a GitHub pull request', async () => {
    const local = cloneAs(bare, 'https://github.com/acme/widgets.git');
    dirs.push(local);
    const { code, stdout, stderr } = await cpr(local, 'pr', '7', '--summary');
    expect(stderr).toContain('#7 Add widgets (open, by ada)');
    expect(code).toBe(0);
    const [title, revisions, counts] = stdout.split('\n');
    expect(title).toBe('#7 Add widgets  https://github.com/acme/widgets/pull/7');
    expect(revisions).toBe(
      `main (${shas.main.slice(0, 7)}) → #7 feature (${shas.feature.slice(0, 7)}), merge-base ${shas.root.slice(0, 7)}`,
    );
    expect(counts).toBe('4 files changed · 3 symbols changed: 1 added, 2 modified');
    // The pull request's head was fetched into a local ref.
    expect(git(local, 'rev-parse', 'refs/cpr/github/7/head')).toBe(shas.feature);
  });

  it("reviews a GitLab merge request as JSON, diffed against GitLab's base", async () => {
    const local = cloneAs(bare, 'https://gitlab.example.com/acme/tools/widgets.git');
    dirs.push(local);
    const { code, stdout } = await cpr(local, 'mr', '!7', '--json');
    expect(code).toBe(0);
    const graph = JSON.parse(stdout) as Graph;
    expect(graph.changeRequest).toEqual({
      forge: 'gitlab',
      number: 7,
      title: 'Add widgets',
      url: 'https://gitlab.example.com/acme/tools/widgets/-/merge_requests/7',
      author: 'ada',
      state: 'open',
      draft: false,
    });
    expect(graph.revisions.base).toEqual({ ref: 'main', sha: shas.root, mergeBase: null });
    expect(graph.revisions.head.ref).toBe('!7 feature');
    expect(graph.stats.filesChanged).toBe(4);
  });

  const posts = (path: string) =>
    api.requests.filter((r) => r.method === 'POST' && r.path.startsWith(path));
  const marker = '<!-- cpr:finding orphan%2Dadded%3Asrc%2Fadded.ts%23added -->';

  it('posts new findings to a GitHub pull request, once', async () => {
    const local = cloneAs(bare, 'https://github.com/acme/widgets.git');
    dirs.push(local);
    const first = await cpr(local, 'pr', '7', '--post-findings', 'warning');
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('orphan-added  src/added.ts#added'); // the summary, as usual
    expect(first.stderr).toContain(
      'Posted 1 finding: https://github.com/acme/widgets/pull/7#pullrequestreview-1',
    );
    const [review] = posts('/repos/acme/widgets/pulls/7/reviews');
    expect(review?.body).toEqual({
      commit_id: shas.feature,
      event: 'COMMENT',
      body: '**CPR** · 1 new finding (1 warning)',
      comments: [
        {
          path: 'src/added.ts',
          line: 1,
          side: 'RIGHT',
          body: `**⚠ warning · orphan-added**\n\nadded is new and nothing references it\n\n${marker}`,
        },
      ],
    });

    const second = await cpr(local, 'pr', '7', '--post-findings', 'warning');
    expect(second.stderr).toContain('No new findings to post (1 already posted)');
    expect(posts('/repos/acme/widgets/pulls/7/reviews')).toHaveLength(1);
  });

  it('falls back to the summary when GitHub refuses the inline comments', async () => {
    reviews.github = [];
    refuseInline = true;
    const local = cloneAs(bare, 'https://github.com/acme/widgets.git');
    dirs.push(local);
    const { stderr } = await cpr(local, 'pr', '7', '--post-findings', 'warning');
    refuseInline = false;
    expect(stderr).toContain('warning: inline comments were refused');
    expect(stderr).toContain('Posted 1 finding');
    expect(reviews.github).toEqual([
      '**CPR** · 1 new finding (1 warning)\n\n' +
        `- ⚠ **orphan-added** \`src/added.ts#added\`: added is new and nothing references it ${marker}`,
    ]);
  });

  it('posts new findings to a GitLab merge request, then fails the job', async () => {
    const local = cloneAs(bare, 'https://gitlab.example.com/acme/tools/widgets.git');
    dirs.push(local);
    const args = ['mr', '7', '--post-findings', 'warning', '--fail-on', 'warning'];
    const first = await cpr(local, ...args);
    expect(first.code).toBe(1);
    const drafts = posts('/projects/acme%2Ftools%2Fwidgets/merge_requests/7/draft_notes');
    expect(drafts.map((r) => r.path.split('/').pop())).toEqual([
      'draft_notes',
      'draft_notes',
      'bulk_publish',
    ]);
    expect(drafts[1]?.body).toMatchObject({
      position: {
        new_path: 'src/added.ts',
        new_line: 1,
        base_sha: shas.root,
        head_sha: shas.feature,
      },
    });

    const second = await cpr(local, ...args);
    expect(second).toMatchObject({ code: 1 });
    expect(second.stderr).toContain('No new findings to post (1 already posted)');
    expect(posts('/projects/acme%2Ftools%2Fwidgets/merge_requests/7/draft_notes')).toHaveLength(3);
  });

  it('compares with an earlier head that only the forge still has', async () => {
    // The pull request's previous version (before a force-push): \`a\` was changed differently.
    repo.git('switch', '--quiet', '--create', 'previous', shas.root);
    repo.write({ 'src/a.ts': 'export const a = 3;\n' });
    const previous = repo.commit('previous version');
    repo.git('switch', '--quiet', 'main');
    git(bare, 'fetch', '--quiet', repo.root, `${previous}:refs/pull/7/previous`);

    const local = cloneAs(bare, 'https://github.com/acme/widgets.git', { copyObjects: false });
    dirs.push(local);
    expect(() => git(local, 'cat-file', '-e', previous)).toThrow();
    const { code, stdout } = await cpr(local, 'pr', '7', '--summary', '--since', previous);
    expect(code).toBe(0);
    expect(stdout).toContain(`since ${previous} (${previous.slice(0, 7)}): 2 new, 1 updated\n`);
    expect(stdout).toContain('~ variable    a  (body)  [updated]');
    expect(stdout).toContain('+ variable    added  [new]');
  });

  it('finds the pull request of a GitHub Actions job', async () => {
    const local = cloneAs(bare, 'https://github.com/acme/widgets.git');
    dirs.push(local);
    const event = join(local, '.git', 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { number: 7 } }));
    jobEnv = { GITHUB_EVENT_PATH: event };
    const { code, stderr } = await cpr(local, 'pr', '--summary');
    jobEnv = {};
    expect(code).toBe(0);
    expect(stderr).toContain('#7 Add widgets');
  });

  it('reports usage errors and missing remotes', async () => {
    const missing = await cpr(repo.root, 'pr');
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('missing <number> (and not in a pull/merge request CI job)');
    expect((await cpr(repo.root, 'pr', 'abc')).stderr).toContain(
      "not a pull/merge request number: 'abc'",
    );
    expect((await cpr(repo.root, 'pr', '7', '--forge', 'bitbucket')).code).toBe(2);
    expect((await cpr(repo.root, 'pr', '7', '--post-findings', 'all')).stderr).toContain(
      "--post-findings must be error, warning or info, got 'all'",
    );
    const noRemote = await cpr(repo.root, 'pr', '7');
    expect(noRemote).toMatchObject({ code: 1, stderr: "cpr: no git remote named 'origin'\n" });
  });
});
