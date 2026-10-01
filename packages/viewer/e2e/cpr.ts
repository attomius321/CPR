import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockApi, type Recorded } from '../../forge/test/mock-api.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const fixtures = join(root, 'packages/core/test/fixtures/diff');
const cli = join(root, 'packages/cli/dist/bin.js');

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'CPR Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'CPR Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

export interface Running {
  readonly url: string;
  stop(): void;
}

/** A fixture file's head version. */
export function fixtureFile(name: string, path: string): string {
  return readFileSync(join(fixtures, name, 'head', path), 'utf8');
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();

/** A fresh repo whose `main` holds a fixture's base/ and `feature` its head/. */
function fixtureRepo(name: string): { repo: string; base: string; head: string } {
  const repo = mkdtempSync(join(tmpdir(), 'cpr-e2e-'));
  git(repo, 'init', '-q', '-b', 'main');
  cpSync(join(fixtures, name, 'base'), repo, { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'checkout', '-q', '-b', 'feature');
  for (const entry of readdirSync(repo))
    if (entry !== '.git') rmSync(join(repo, entry), { recursive: true });
  cpSync(join(fixtures, name, 'head'), repo, { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'head');
  return { repo, base: git(repo, 'rev-parse', 'main'), head: git(repo, 'rev-parse', 'feature') };
}

/** Runs the built CLI until it prints the viewer's URL. */
async function startCpr(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string>,
): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [cli, ...args, '--no-open'], {
    cwd,
    env: { ...env, ...extraEnv },
  });
  const url = await new Promise<string>((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      const match = /CPR viewer: (\S+)/.exec(output);
      if (match?.[1]) resolve(match[1]);
    });
    child.stderr?.on('data', (data: Buffer) => (output += data.toString()));
    child.on('exit', (code) => reject(new Error(`cpr exited with ${code}:\n${output}`)));
  });
  return { url, child };
}

/**
 * Turns a fixture into two commits of a fresh repo and serves `cpr view HEAD~1 HEAD` from the
 * built CLI. Build first: `pnpm build`.
 */
export async function serveFixture(name: string): Promise<Running> {
  const { repo } = fixtureRepo(name);
  const cache = mkdtempSync(join(tmpdir(), 'cpr-e2e-cache-'));
  const { url, child } = await startCpr(['view', 'HEAD~1', 'HEAD'], repo, { CPR_CACHE_DIR: cache });
  return {
    url,
    stop() {
      child.kill('SIGINT');
      rmSync(repo, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    },
  };
}

export interface RunningPullRequest extends Running {
  /** What the mock GitHub API received. */
  requests: Recorded[];
  /**
   * Pushes a new version of the pull request (files to write) and restarts `cpr pr` on it,
   * with `--since <previous head>` when `since` is set.
   */
  push(files: Record<string, string>, options?: { since?: boolean }): Promise<void>;
}

/**
 * Serves `cpr pr 7` for a fixture as a GitHub pull request: the clone's `origin` says
 * github.com but git fetches from a local bare repo, and a mock API answers for GitHub.
 */
export async function servePullRequest(name: string): Promise<RunningPullRequest> {
  const { repo, base, head } = fixtureRepo(name);
  const bare = mkdtempSync(join(tmpdir(), 'cpr-e2e-bare-'));
  const clone = mkdtempSync(join(tmpdir(), 'cpr-e2e-clone-'));
  const cache = mkdtempSync(join(tmpdir(), 'cpr-e2e-cache-'));
  const remote = 'https://github.com/acme/widgets.git';
  git(bare, 'clone', '-q', '--bare', repo, '.');
  git(bare, 'update-ref', 'refs/pull/7/head', head);
  git(clone, 'clone', '-q', bare, '.');
  git(clone, 'config', 'remote.origin.url', remote);
  git(clone, 'config', `url.${bare}.insteadOf`, remote);

  let headSha = head;
  const api = await mockApi({
    'GET /repos/acme/widgets/pulls/7': () => ({
      body: {
        number: 7,
        title: 'Add perimeter and volume',
        html_url: 'https://github.com/acme/widgets/pull/7',
        user: { login: 'ada' },
        state: 'open',
        merged_at: null,
        draft: false,
        base: { ref: 'main', sha: base },
        head: { ref: 'feature', sha: headSha },
      },
    }),
    'POST /repos/acme/widgets/pulls/7/reviews': {
      body: { html_url: 'https://github.com/acme/widgets/pull/7#pullrequestreview-1' },
    },
  });
  const start = (args: string[] = []) =>
    startCpr(['pr', '7', ...args], clone, {
      CPR_CACHE_DIR: cache,
      GITHUB_API_URL: api.url,
      GITHUB_TOKEN: 'ghp_e2e',
    });
  let running = await start();

  return {
    get url() {
      return running.url;
    },
    requests: api.requests,
    async push(files, { since = false } = {}) {
      const previous = headSha;
      for (const [path, content] of Object.entries(files)) writeFileSync(join(repo, path), content);
      git(repo, 'commit', '-q', '-am', 'another push');
      headSha = git(repo, 'rev-parse', 'HEAD');
      git(bare, 'fetch', '-q', repo, '+feature:feature');
      git(bare, 'update-ref', 'refs/pull/7/head', headSha);
      const exited = new Promise((resolve) => running.child.once('exit', resolve));
      running.child.kill('SIGINT');
      await exited;
      running = await start(since ? ['--since', previous] : []);
    },
    stop() {
      running.child.kill('SIGINT');
      void api.close();
      for (const dir of [repo, bare, clone, cache]) rmSync(dir, { recursive: true, force: true });
    },
  };
}
