import { execFileSync, execSync, spawn, type ChildProcess } from 'node:child_process';
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

/**
 * Branches for the panel (V10b), written with `git fast-import`: `main` ("commit 1" to "commit
 * 300"), remote `origin` (never fetched) with `feature/deep` ("Deep feature", dated just after
 * "commit 20": its row is near the bottom), `fix/one` and `fix/two`, `topic` ("Topic work") and
 * `wip` ("Remote wip"); local `wip` ("Local wip 1", "Local wip 2" from "commit 250": ahead 2 and
 * behind 1 of `origin/wip`) and `old` (at "commit 100", its upstream `origin/old` gone); a branch
 * with a long name, local and remote, at "commit 298". `main` is checked out. Served by `cpr
 * view` without revisions.
 */
export async function serveBranches(): Promise<Running> {
  const repo = mkdtempSync(join(tmpdir(), 'cpr-e2e-'));
  git(repo, 'init', '-q', '-b', 'main');
  const start = Math.floor(Date.now() / 1000) - 400 * 60;
  let mark = 0;
  let stream = '';
  const marks = new Map<number, number>();
  const commit = (ref: string, minutes: number, subject: string, from?: number): number => {
    mark++;
    stream +=
      `commit ${ref}\nmark :${mark}\ncommitter CPR Test <test@example.com> ${start + minutes * 60} +0000\n` +
      `data ${Buffer.byteLength(subject)}\n${subject}\n${from ? `from :${from}\n` : ''}\n`;
    return mark;
  };
  for (let i = 1; i <= 300; i++) {
    marks.set(i, commit('refs/heads/main', i, `commit ${i}`, i > 1 ? marks.get(i - 1) : undefined));
  }
  const on = (i: number) => marks.get(i);
  commit('refs/remotes/origin/feature/deep', 20.5, 'Deep feature', on(20));
  commit('refs/remotes/origin/fix/one', 301, 'Fix one', on(290));
  commit('refs/remotes/origin/fix/two', 302, 'Fix two', on(295));
  commit('refs/remotes/origin/topic', 303, 'Topic work', on(299));
  // Two long badges on one row: a local branch and its remote.
  const long = 'a-branch-whose-name-runs-on-long-enough-to-crowd-its-row';
  stream += `reset refs/heads/${long}\nfrom :${on(298)}\n\nreset refs/remotes/origin/${long}\nfrom :${on(298)}\n\n`;
  commit('refs/remotes/origin/wip', 304, 'Remote wip', on(250));
  const local = commit('refs/heads/wip', 305, 'Local wip 1', on(250));
  commit('refs/heads/wip', 306, 'Local wip 2', local);
  stream += `reset refs/heads/old\nfrom :${on(100)}\n\n`;
  execFileSync('git', ['fast-import', '--quiet'], { cwd: repo, env, input: stream });
  git(repo, 'remote', 'add', 'origin', 'https://example.com/never-fetched.git');
  for (const branch of ['wip', 'old']) {
    git(repo, 'config', `branch.${branch}.remote`, 'origin');
    git(repo, 'config', `branch.${branch}.merge`, `refs/heads/${branch}`);
  }
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

/** What the fake Claude Code was asked to start: its arguments and folder. */
export interface FakeClaudeCall {
  args: string[];
  cwd: string;
}

export interface RunningWorkspaces extends Running {
  repo: string;
  /** `main`'s commits, oldest first: the fixture's base and head. */
  shas: string[];
  /** What the fake Claude Code started. */
  calls(): FakeClaudeCall[];
  /** The sessions the fake stopped, by ID. */
  stops(): string[];
  /** From now on the fake refuses to start, with Claude Code's trust message. */
  distrust(): void;
  /** A workspace's worktree folder. */
  folder(branch: string): string;
  /** Sets what the fake says of the newest session in a workspace's worktree. */
  session(branch: string, patch: { state: string; waitingFor?: string }): void;
  /**
   * The newest session in a workspace's worktree is interrupted (Esc): as the real one did in the
   * V21 spike, no hook runs and it reads `working` and idle until its next turn ends.
   */
  interrupt(branch: string): void;
  /**
   * The newest session in a workspace's worktree ends its turn with `text` (V18c): its `Stop`
   * hook runs, and it reads `blocked` and idle, as Claude Code reads a finished plan.
   */
  report(branch: string, text: string): void;
  /** Runs the newest session's hooks for one event (`hook_event_name` and its fields). */
  hook(branch: string, input: Record<string, unknown>): void;
  /** The sessions the fake removed (`claude rm`), by ID. */
  removed(): string[];
  /** The sessions attached to (`claude attach`, V21), and those whose client was hung up. */
  attaches(): string[];
  hangups(): string[];
  /** Commits a file in a workspace's worktree (as its agent would); its SHA. */
  commit(branch: string, file: string, text: string, subject: string): string;
  /** What the fake VS Code was asked to open, newest last. */
  opened(): string[][];
  /** What the fake Codex was asked to run (V20a): `exec` and `exec resume`, with their folders. */
  codexCalls(): FakeClaudeCall[];
  /**
   * Ends the fake Codex's turn in a workspace's worktree: its last message `text`, or a failed
   * turn in Codex's words (`fail`).
   */
  codexTurn(branch: string, turn: { text: string } | { fail: string }): void;
  /** The threads the fake Codex archived. */
  codexArchived(): string[];
}

/**
 * A fake Claude Code (V18): `--bg` records its arguments and folder and lists a working session
 * there (or, distrusted, prints Claude Code's trust refusal and exits 1); `agents --json` lists
 * the sessions, `auth status` a Pro subscription. As the real one did in the V18c spike, a
 * session runs the hooks of the `--settings` file it started with (`SessionStart`,
 * `UserPromptSubmit`; `SessionEnd` when stopped), `--bg --resume <session> "<text>"` continues
 * a stopped session under its ID and copies a live one (without its settings), and `rm` removes
 * one. Its state lives in `dir`.
 */
function fakeClaude(dir: string): string {
  const script = join(dir, 'claude');
  writeFileSync(
    script,
    `#!/usr/bin/env node
const { execSync } = require('node:child_process');
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const dir = ${JSON.stringify(dir)};
const sessions = join(dir, 'sessions.json');
const list = () => (existsSync(sessions) ? JSON.parse(readFileSync(sessions, 'utf8')) : []);
const save = (all) => writeFileSync(sessions, JSON.stringify(all));
const args = process.argv.slice(2);
// A session's hooks for one event, as Claude Code runs them: each command in a shell, the event on stdin.
const hooks = (session, input) => {
  if (!session.settings) return;
  const event = { session_id: session.sessionId, cwd: session.cwd, ...input };
  const entries = JSON.parse(readFileSync(session.settings, 'utf8')).hooks[event.hook_event_name] || [];
  for (const entry of entries) {
    if (entry.matcher && entry.matcher !== event.tool_name) continue;
    for (const hook of entry.hooks) execSync(hook.command, { input: JSON.stringify(event), stdio: ['pipe', 'ignore', 'inherit'] });
  }
};
const started = (fields) => {
  const n = list().length;
  const session = { id: 'fake' + n, sessionId: 'session-' + n, kind: 'background', startedAt: Date.now() + n, state: 'working', status: 'busy', ...fields };
  save([...list(), session]);
  return session;
};
if (args[0] === '--bg' && args[1] === '--resume') {
  appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
  const [, , id, text] = args;
  const all = list();
  const session = all.find((s) => s.sessionId === id);
  if (!session) {
    process.stderr.write('No conversation found with session ID: ' + id + '\\n');
    process.exit(1);
  }
  if (session.status) {
    // Running: a copy, which keeps none of the original's options.
    const copy = started({ cwd: process.cwd(), name: session.name });
    process.stdout.write('note: session ' + session.id + ' is already running in the background, so this started a copy as ' + copy.id + '.\\n');
  } else {
    Object.assign(session, { state: 'working', status: 'busy' });
    delete session.waitingFor;
    save(all);
    hooks(session, { hook_event_name: 'SessionStart', source: 'resume' });
    hooks(session, { hook_event_name: 'UserPromptSubmit', prompt: text });
    process.stdout.write('note: woke session ' + session.id + ' with its saved options.\\n');
  }
} else if (args[0] === '--bg') {
  if (existsSync(join(dir, 'distrust'))) {
    process.stderr.write('Workspace not trusted. Run \`claude\` in ' + process.cwd() + ' once and accept the trust prompt, then retry.\\n');
    process.exit(1);
  }
  appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
  const at = args.indexOf('--settings');
  const session = started({ cwd: process.cwd(), name: args[2], ...(at >= 0 ? { settings: args[at + 1] } : {}) });
  hooks(session, { hook_event_name: 'SessionStart', source: 'startup' });
  hooks(session, { hook_event_name: 'UserPromptSubmit', prompt: args.at(-1) });
  process.stdout.write('backgrounded · ' + session.id + ' · ' + args[2] + '\\n');
} else if (args[0] === 'agents') {
  process.stdout.write(JSON.stringify(list().map(({ settings, ...shown }) => shown)));
} else if (args[0] === 'stop') {
  appendFileSync(join(dir, 'stops.txt'), args[1] + '\\n');
  const all = list();
  for (const session of all) {
    if (session.id !== args[1]) continue;
    session.state = 'stopped';
    delete session.status;
    hooks(session, { hook_event_name: 'SessionEnd', reason: 'other' });
  }
  save(all);
} else if (args[0] === 'rm') {
  appendFileSync(join(dir, 'removed.txt'), args[1] + '\\n');
  save(list().filter((s) => s.id !== args[1]));
  process.stdout.write('removed ' + args[1] + '\\n');
} else if (args[0] === 'auth') {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }));
} else if (args[0] === 'attach') {
  // V21: a client of the session in a terminal. Like the real one: an unknown ID exits 0, a
  // stopped session restarts without a turn, a hang-up leaves the session, a stop ends it.
  const id = args[1];
  const all = list();
  const session = all.find((s) => s.id === id);
  if (!session) {
    process.stdout.write('No job matching ' + id + '\\n');
    process.exit(0);
  }
  appendFileSync(join(dir, 'attaches.txt'), id + '\\n');
  if (!session.status) {
    session.status = 'idle';
    save(all);
    hooks(session, { hook_event_name: 'SessionStart', source: 'resume' });
  }
  const size = () => '[' + process.stdout.columns + 'x' + process.stdout.rows + ']';
  process.stdout.write('Fake Claude Code · ' + id + ' ' + size() + '\\r\\n> ');
  process.stdout.on('resize', () => process.stdout.write('\\r\\n' + size() + '\\r\\n> '));
  process.on('SIGHUP', () => {
    appendFileSync(join(dir, 'hangups.txt'), id + '\\n');
    process.exit(129);
  });
  let line = '';
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (keys) => {
    for (const key of keys) {
      if (key === '\\r') {
        process.stdout.write('\\r\\ngot: ' + line + '\\r\\n> ');
        hooks(session, { hook_event_name: 'UserPromptSubmit', prompt: line });
        line = '';
      } else {
        line += key;
        process.stdout.write(key);
      }
    }
  });
  setInterval(() => {
    const now = list().find((s) => s.id === id);
    if (now && now.status) return;
    process.stdout.write('\\r\\nSession ' + id + ' has exited\\r\\n');
    process.exit(0);
  }, 200);
} else {
  process.exit(2);
}
`,
    { mode: 0o755 },
  );
  return script;
}

/**
 * A fake Codex (V20a), as CPR's runner runs it: `login status` says ChatGPT; `exec` and `exec
 * resume` record their arguments and folder, print Codex 0.163's first events (a new thread is
 * `thread-<n>`), then wait until the test ends the turn (`codex-turn-<worktree folder>.json`):
 * the turn's message and `turn.completed`, or `turn.failed`; it exits once the test's folders
 * are removed. `archive` records the thread.
 */
function fakeCodex(dir: string): string {
  const script = join(dir, 'codex');
  writeFileSync(
    script,
    `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, rmSync } = require('node:fs');
const { basename, join } = require('node:path');
const dir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
const out = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
if (args[0] === 'login') {
  process.stderr.write('Logged in using ChatGPT\\n');
  process.exit(0);
}
if (args[0] === 'archive') {
  appendFileSync(join(dir, 'codex-archived.txt'), args[1] + '\\n');
  process.stderr.write('Archived session ' + args[1] + '.\\n');
  process.exit(0);
}
if (args[0] !== 'exec') process.exit(2);
const calls = join(dir, 'codex-calls.jsonl');
const started = existsSync(calls) ? readFileSync(calls, 'utf8').split('\\n').filter((l) => l && !l.includes('"resume"')).length : 0;
appendFileSync(calls, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const resumed = args[1] === 'resume';
out({ type: 'thread.started', thread_id: resumed ? args[args.indexOf('--') + 1] : 'thread-' + started });
out({ type: 'turn.started' });
const turn = join(dir, 'codex-turn-' + basename(process.cwd()) + '.json');
const wait = setInterval(() => {
  // The test is over (its folders removed): the turn never ends.
  if (!existsSync(dir)) process.exit(1);
  if (!existsSync(turn)) return;
  const ended = JSON.parse(readFileSync(turn, 'utf8'));
  rmSync(turn);
  clearInterval(wait);
  if (ended.fail) {
    out({ type: 'turn.failed', error: { message: ended.fail } });
    process.exit(1);
  }
  out({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: ended.text } });
  out({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
  process.exit(0);
}, 50);
`,
    { mode: 0o755 },
  );
  return script;
}

/**
 * `main` with the `callers` fixture's base and head, pushed to a bare `origin` (its default
 * branch), and a fake Claude Code as `CPR_CLAUDE` (`agent: false`: one that is not installed;
 * `terminal: false`: no terminals, V21); a fake Codex as `CPR_CODEX` with `codex: true` (V20a),
 * else none, whatever is installed.
 * Served by `cpr view` without revisions; workspaces' worktrees land beside the repository and go
 * with it.
 */
export async function serveWorkspaces({
  agent = true,
  terminal = true,
  codex = false,
} = {}): Promise<RunningWorkspaces> {
  const { repo } = fixtureRepo('callers');
  git(repo, 'checkout', '-q', '-B', 'main');
  git(repo, 'branch', '-q', '-D', 'feature');
  git(repo, 'config', 'user.email', 'reviewer@example.com');
  const origin = mkdtempSync(join(tmpdir(), 'cpr-e2e-origin-'));
  git(origin, 'init', '-q', '--bare');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  const shas = git(repo, 'rev-list', '--reverse', 'main').split('\n');
  const fake = mkdtempSync(join(tmpdir(), 'cpr-e2e-claude-'));
  const claude = agent ? fakeClaude(fake) : join(fake, 'not-installed');
  const cache = mkdtempSync(join(tmpdir(), 'cpr-e2e-cache-'));
  // A fake VS Code: records what it is asked to open.
  const code = join(fake, 'code');
  writeFileSync(
    code,
    `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(join(fake, 'code.jsonl'))}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
    { mode: 0o755 },
  );
  const { url, child } = await startCpr(['view'], repo, {
    CPR_CACHE_DIR: cache,
    CPR_CLAUDE: claude,
    CPR_CODEX: codex ? fakeCodex(fake) : join(fake, 'no-codex'),
    CPR_CODE: code,
    // V21: terminals turned off, as where node-pty cannot run.
    ...(terminal ? {} : { CPR_TERMINAL: 'off' }),
  });
  const lines = (file: string) =>
    readFileSync(join(fake, file), { encoding: 'utf8', flag: 'a+' })
      .split('\n')
      .filter((line) => line !== '');
  const folder = (branch: string) => `${repo}.worktrees/${branch.replaceAll('/', '-')}`;
  interface FakeSession {
    cwd: string;
    sessionId: string;
    settings?: string;
    state?: string;
    status?: string;
    waitingFor?: string;
  }
  /** The newest session in a workspace's worktree, changed by `change` and saved. */
  const newest = (branch: string, change: (session: FakeSession) => void): FakeSession => {
    const file = join(fake, 'sessions.json');
    const sessions = JSON.parse(readFileSync(file, 'utf8')) as FakeSession[];
    const mine = sessions.filter((s) => s.cwd === folder(branch)).at(-1);
    if (!mine) throw new Error(`no session in ${folder(branch)}`);
    change(mine);
    writeFileSync(file, JSON.stringify(sessions));
    return mine;
  };
  /** A session's hooks for one event, run as the fake (and Claude Code) runs them. */
  const runHooks = (session: FakeSession, input: Record<string, unknown>) => {
    if (!session.settings) return;
    const event: Record<string, unknown> = {
      session_id: session.sessionId,
      cwd: session.cwd,
      ...input,
    };
    const settings = JSON.parse(readFileSync(session.settings, 'utf8')) as {
      hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    };
    for (const entry of settings.hooks[String(event.hook_event_name)] ?? []) {
      if (entry.matcher && entry.matcher !== event.tool_name) continue;
      for (const hook of entry.hooks) execSync(hook.command, { input: JSON.stringify(event) });
    }
  };
  return {
    url,
    repo,
    shas,
    folder,
    stops: () => lines('stops.txt'),
    opened: () => lines('code.jsonl').map((line) => JSON.parse(line) as string[]),
    session(branch, patch) {
      newest(branch, (mine) => {
        Object.assign(mine, patch);
        // Claude Code's status follows: busy while it works, waiting on a prompt, idle after.
        if (patch.state === 'working') mine.status = 'busy';
        else if (patch.state === 'stopped' || patch.state === 'failed') delete mine.status;
        else mine.status = patch.waitingFor ? 'waiting' : 'idle';
      });
    },
    interrupt(branch) {
      newest(branch, (mine) => Object.assign(mine, { state: 'working', status: 'idle' }));
    },
    report(branch, text) {
      const mine = newest(branch, (s) => Object.assign(s, { state: 'blocked', status: 'idle' }));
      runHooks(mine, { hook_event_name: 'Stop', last_assistant_message: text });
    },
    hook(branch, input) {
      runHooks(
        newest(branch, () => {}),
        input,
      );
    },
    removed: () => lines('removed.txt'),
    attaches: () => lines('attaches.txt'),
    hangups: () => lines('hangups.txt'),
    commit(branch, file, text, subject) {
      writeFileSync(join(folder(branch), file), text);
      git(folder(branch), 'add', file);
      git(folder(branch), 'commit', '-q', '-m', subject);
      return git(folder(branch), 'rev-parse', 'HEAD');
    },
    calls() {
      const file = join(fake, 'calls.jsonl');
      return readFileSync(file, { encoding: 'utf8', flag: 'a+' })
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as FakeClaudeCall);
    },
    distrust() {
      writeFileSync(join(fake, 'distrust'), '');
    },
    codexCalls: () => lines('codex-calls.jsonl').map((line) => JSON.parse(line) as FakeClaudeCall),
    codexTurn(branch, turn) {
      writeFileSync(
        join(fake, `codex-turn-${branch.replaceAll('/', '-')}.json`),
        JSON.stringify(turn),
      );
    },
    codexArchived: () => lines('codex-archived.txt'),
    stop() {
      child.kill('SIGINT');
      for (const dir of [repo, `${repo}.worktrees`, origin, fake, cache]) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      }
    },
  };
}
