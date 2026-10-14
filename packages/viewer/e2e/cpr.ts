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

/**
 * A fresh repo whose `main` holds a fixture's base/ and `feature` its head/. A name is a fixture
 * of `packages/core`; a path relative to the repo root names another one.
 */
function fixtureRepo(name: string): { repo: string; base: string; head: string } {
  const dir = name.includes('/') ? join(root, name) : join(fixtures, name);
  const repo = mkdtempSync(join(tmpdir(), 'cpr-e2e-'));
  git(repo, 'init', '-q', '-b', 'main');
  cpSync(join(dir, 'base'), repo, { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'checkout', '-q', '-b', 'feature');
  for (const entry of readdirSync(repo))
    if (entry !== '.git') rmSync(join(repo, entry), { recursive: true });
  cpSync(join(dir, 'head'), repo, { recursive: true });
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

export interface RunningFixture extends Running {
  /** The repository's folder, its working copy at head (as `git rev-parse` names it). */
  repo: string;
}

/**
 * Turns a fixture into two commits of a fresh repo and serves `cpr view HEAD~1 HEAD` from the
 * built CLI, with `args` (e.g. `--plugin angular`) and `extraEnv` (e.g. `CPR_CODE`). Build
 * first: `pnpm build`.
 */
export async function serveFixture(
  name: string,
  args: readonly string[] = [],
  extraEnv: Record<string, string> = {},
): Promise<RunningFixture> {
  const { repo } = fixtureRepo(name);
  const cache = mkdtempSync(join(tmpdir(), 'cpr-e2e-cache-'));
  const { url, child } = await startCpr(['view', 'HEAD~1', 'HEAD', ...args], repo, {
    CPR_CACHE_DIR: cache,
    ...extraEnv,
  });
  return {
    url,
    repo: git(repo, 'rev-parse', '--show-toplevel'),
    stop() {
      child.kill('SIGINT');
      rmSync(repo, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    },
  };
}

export interface RunningCommits extends Running {
  /** The commits, oldest first. */
  shas: string[];
  /** The repository's folder (V11's tests change its working tree). */
  repo: string;
}

/** Commits with `git commit`, dated `minutes` after the fixture's own commits. */
function commitAt(repo: string, minutes: number, ...args: string[]): void {
  const date = `@${Math.floor(Date.now() / 1000) + minutes * 60} +0000`;
  execFileSync('git', ['commit', '-q', ...args], {
    cwd: repo,
    env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    stdio: 'pipe',
  });
}

export interface RunningAgent extends Running {
  repo: string;
  /** The bare repository `origin` points at (V16: Approve pushes there). */
  origin: string;
  /** main's commit (the fork point), then the agent's commits, oldest first. */
  shas: string[];
  /** Stops `cpr view` and starts it again on the same repository (a new port): its URL. */
  restart(): Promise<string>;
}

/**
 * `main` with the `callers` fixture's base, pushed to a bare `origin` and tracking it, and
 * `agent`, a branch an agent wrote from it (not pushed): "Agent: add square", then "Agent: add
 * cube" (two functions in `src/math.ts`). The reviewer is reviewer@example.com. Served by `cpr
 * view` without revisions: the commits page.
 */
export async function serveAgentBranch(
  extraEnv: Record<string, string> = {},
): Promise<RunningAgent> {
  const { repo } = fixtureRepo('callers');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'branch', '-q', '-D', 'feature');
  git(repo, 'config', 'user.email', 'reviewer@example.com');
  const origin = mkdtempSync(join(tmpdir(), 'cpr-e2e-origin-'));
  git(origin, 'init', '-q', '--bare');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  git(repo, 'checkout', '-q', '-b', 'agent');
  let math = readFileSync(join(repo, 'src/math.ts'), 'utf8');
  for (const [minutes, name, body] of [
    [1, 'square', 'a * a'],
    [2, 'cube', 'a * a * a'],
  ] as const) {
    math += `\nexport function ${name}(a: number): number {\n  return ${body};\n}\n`;
    writeFileSync(join(repo, 'src/math.ts'), math);
    commitAt(repo, minutes, '-am', `Agent: add ${name}`);
  }
  git(repo, 'checkout', '-q', 'main');
  const shas = [
    git(repo, 'rev-parse', 'main'),
    ...git(repo, 'rev-list', '--reverse', 'main..agent').split('\n'),
  ];
  const cache = mkdtempSync(join(tmpdir(), 'cpr-e2e-cache-'));
  let running = await startCpr(['view'], repo, { CPR_CACHE_DIR: cache, ...extraEnv });
  return {
    get url() {
      return running.url;
    },
    repo,
    origin,
    shas,
    async restart() {
      running.child.kill('SIGINT');
      running = await startCpr(['view'], repo, { CPR_CACHE_DIR: cache, ...extraEnv });
      return running.url;
    },
    stop() {
      running.child.kill('SIGINT');
      // The server may still be saving the review (cleared drafts after a verdict): retry.
      rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      rmSync(origin, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    },
  };
}

/**
 * Five commits on `main` — the `callers` fixture's base and head, then three functions added
 * one by one to `src/math.ts` ("Add half, and a subject …" the last) — and other branches, each
 * newer: `wip` ("Try a wobble") from "Add square", the remote-only `origin/topic` ("Sketch a
 * topic") from head. `feature` points at head; tag `v1` at "Add cube", `r1` to `r4` at base; tag
 * `v0` at a commit no branch reaches ("Old release"). Served by `cpr view` without revisions: the commits page.
 */
export async function serveCommits(): Promise<RunningCommits> {
  const { repo } = fixtureRepo('callers');
  git(repo, 'checkout', '-q', '-B', 'main');
  let math = readFileSync(join(repo, 'src/math.ts'), 'utf8');
  for (const [minutes, name, body] of [
    [1, 'square', 'a * a'],
    [2, 'cube', 'square(a) * a'],
    [3, 'half', 'a / 2'],
  ] as const) {
    math += `\nexport function ${name}(a: number): number {\n  return ${body};\n}\n`;
    writeFileSync(join(repo, 'src/math.ts'), math);
    // One subject far longer than the page is wide, as real histories have.
    const more = name === 'half' ? `, ${'and a subject that runs on '.repeat(12)}` : '';
    commitAt(repo, minutes, '-am', `Add ${name}${more}`);
  }
  const shas = git(repo, 'rev-list', '--reverse', 'HEAD').split('\n');
  const [base = '', head = '', square = '', cube = ''] = shas;
  git(repo, 'tag', 'v1', cube);
  // More refs than a row shows: folded into "+2".
  for (const tag of ['r1', 'r2', 'r3', 'r4']) git(repo, 'tag', tag, base);
  const aside = (from: string, minutes: number, subject: string) => {
    git(repo, 'checkout', '-q', '--detach', from);
    commitAt(repo, minutes, '--allow-empty', '-m', subject);
    return git(repo, 'rev-parse', 'HEAD');
  };
  git(repo, 'branch', 'wip', aside(square, 4, 'Try a wobble'));
  // A remote (never fetched), so origin/topic can be tracked.
  git(repo, 'remote', 'add', 'origin', 'https://example.com/never-fetched.git');
  git(repo, 'update-ref', 'refs/remotes/origin/topic', aside(head, 5, 'Sketch a topic'));
  git(repo, 'tag', 'v0', aside(base, 6, 'Old release'));
  git(repo, 'checkout', '-q', 'main');
  const cache = mkdtempSync(join(tmpdir(), 'cpr-e2e-cache-'));
  const { url, child } = await startCpr(['view'], repo, { CPR_CACHE_DIR: cache });
  return {
    url,
    shas,
    repo,
    stop() {
      child.kill('SIGINT');
      rmSync(repo, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    },
  };
}

/**
 * `rows` commits on `main` ("commit 1" the oldest) and `old`, one newer commit forked from
 * "commit 10": its line spans the whole history. Written with `git fast-import` (fast), served
 * by `cpr view` without revisions.
 */
export async function serveLongHistory(rows: number): Promise<Running> {
  const repo = mkdtempSync(join(tmpdir(), 'cpr-e2e-'));
  git(repo, 'init', '-q', '-b', 'main');
  const start = Math.floor(Date.now() / 1000) - rows * 60;
  const commit = (ref: string, mark: number, time: number, subject: string, from?: number) =>
    `commit ${ref}\nmark :${mark}\ncommitter CPR Test <test@example.com> ${time} +0000\n` +
    `data ${Buffer.byteLength(subject)}\n${subject}\n${from ? `from :${from}\n` : ''}\n`;
  let stream = '';
  for (let i = 1; i <= rows; i++) {
    stream += commit(
      'refs/heads/main',
      i,
      start + i * 60,
      `commit ${i}`,
      i > 1 ? i - 1 : undefined,
    );
  }
  stream += commit('refs/heads/old', rows + 1, start + (rows + 1) * 60, 'Old idea', 10);
  execFileSync('git', ['fast-import', '--quiet'], { cwd: repo, env, input: stream });
  git(repo, 'checkout', '-q', '-f', 'main');
  const cache = mkdtempSync(join(tmpdir(), 'cpr-e2e-cache-'));
  const { url, child } = await startCpr(['view'], repo, { CPR_CACHE_DIR: cache });
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
  /** The clone `cpr pr` runs in (as `git rev-parse` names it). */
  clone: string;
}

/**
 * Serves `cpr pr 7` for a fixture as a GitHub pull request: the clone's `origin` says
 * github.com but git fetches from a local bare repo, and a mock API answers for GitHub.
 * `args` go to every `cpr pr` run (e.g. `--plugin angular`), `extraEnv` too (e.g. `CPR_CODE`).
 */
export async function servePullRequest(
  name: string,
  args: readonly string[] = [],
  extraEnv: Record<string, string> = {},
): Promise<RunningPullRequest> {
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
  const start = (more: string[] = []) =>
    startCpr(['pr', '7', ...args, ...more], clone, {
      CPR_CACHE_DIR: cache,
      GITHUB_API_URL: api.url,
      GITHUB_TOKEN: 'ghp_e2e',
      ...extraEnv,
    });
  let running = await start();

  return {
    get url() {
      return running.url;
    },
    requests: api.requests,
    clone: git(clone, 'rev-parse', '--show-toplevel'),
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

export interface RunningDiverged extends Running {
  /** "Add square" on `main`, where `topic` forked; main's tip ("Add half"); topic's ("Change square"). */
  fork: string;
  main: string;
  topic: string;
}

/**
 * Two lines that diverged (V10c): `main` — the `callers` fixture's base, "Add square", then
 * "Add cube" and "Add half" — and `topic`, forked at "Add square": "Add twice", then "Change
 * square" (its body). All in `src/math.ts`. `checkout` is the branch checked out. Served by
 * `cpr view` without revisions: the commits page.
 */
export async function serveDiverged(checkout: 'main' | 'topic' = 'main'): Promise<RunningDiverged> {
  const { repo } = fixtureRepo('callers');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'branch', '-q', '-D', 'feature');
  const path = join(repo, 'src/math.ts');
  const fn = (name: string, body: string) =>
    `\nexport function ${name}(a: number): number {\n  return ${body};\n}\n`;
  const start = readFileSync(path, 'utf8') + fn('square', 'a * a');
  writeFileSync(path, start);
  commitAt(repo, 1, '-am', 'Add square');
  const fork = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(path, start + fn('cube', 'a * a * a'));
  commitAt(repo, 2, '-am', 'Add cube');
  writeFileSync(path, start + fn('cube', 'a * a * a') + fn('half', 'a / 2'));
  commitAt(repo, 3, '-am', 'Add half');
  const main = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', '-b', 'topic', fork);
  writeFileSync(path, start + fn('twice', 'a * 2'));
  commitAt(repo, 4, '-am', 'Add twice');
  writeFileSync(
    path,
    start.replace('return a * a;', 'return twice(a) * a / 2;') + fn('twice', 'a * 2'),
  );
  commitAt(repo, 5, '-am', 'Change square');
  const topic = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', checkout);
  const cache = mkdtempSync(join(tmpdir(), 'cpr-e2e-cache-'));
  const { url, child } = await startCpr(['view'], repo, { CPR_CACHE_DIR: cache });
  return {
    url,
    fork,
    main,
    topic,
    stop() {
      child.kill('SIGINT');
      rmSync(repo, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    },
  };
}
