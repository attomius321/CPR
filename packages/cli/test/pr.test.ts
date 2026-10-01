import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
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
function cloneAs(bare: string, url: string): string {
  const local = tempDir();
  git(local, 'clone', '--quiet', bare, '.');
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
    });
  });

  afterAll(async () => {
    await api.close();
    repo.cleanup();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

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

  it('reports usage errors and missing remotes', async () => {
    expect((await cpr(repo.root, 'pr')).code).toBe(2);
    expect((await cpr(repo.root, 'pr', 'abc')).stderr).toContain(
      "not a pull/merge request number: 'abc'",
    );
    expect((await cpr(repo.root, 'pr', '7', '--forge', 'bitbucket')).code).toBe(2);
    const noRemote = await cpr(repo.root, 'pr', '7');
    expect(noRemote).toMatchObject({ code: 1, stderr: "cpr: no git remote named 'origin'\n" });
  });
});
