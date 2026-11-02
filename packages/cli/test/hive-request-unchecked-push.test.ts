// HV8: a pull or merge request the forge cannot merge goes back to the writer, who merges the
// start branch in and fixes it; then "the rounds again, push; the request updates itself" (the
// brief). The open request is what the person merges from its link, so a commit the check has not
// passed must not reach it. The harness is hive-runner.test.ts's.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { openRepo, type GitRepo, type Graph, type MergeEntry } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { repositoryHive, type HiveRecord } from '../src/hive.js';
import { hiveRunner, type HiveRunner } from '../src/hive-runner.js';
import { readHive, readHives } from '../src/hive-record.js';
import type { Confine } from '../src/hive-review.js';
import { hiveRequests, type HiveRequests } from '../src/hive-request.js';
import { GitHubForge, GitLabForge, type Forge } from '@symbiote/forge';
import { fakeForge, type FakeForge } from '../../forge/test/fake-forge.js';
import { merger, type Merger } from '../src/merges.js';
import { branchReviews, reviewPlace, type ReviewPlace } from '../src/reviews.js';
import { recordEvent } from '../src/thread.js';
import { symbioteFolder } from '../src/workspace-record.js';
import { workspaces, type Workspaces } from '../src/workspaces.js';
import type { AgentSession, ClaudeCode } from '../src/claude-code.js';

const HOOK = '/opt/symbiote/dist/agent-hook.js';

const repos: TestRepo[] = [];
const folders: string[] = [];
const runners: HiveRunner[] = [];
let cache: string;
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  cache = tempDir();
  folders.push(cache);
});
afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.close();
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** A clock that moves a second each time it is read: every record and hook in order. */
function clock() {
  let at = Date.parse('2026-10-31T10:00:00.000Z');
  return () => new Date((at += 1000));
}

/**
 * A fake Claude Code: a start or a resume is a working session whose prompt the hooks record, as
 * `UserPromptSubmit` does; `endTurn` commits (or leaves files) in the worktree and records the
 * report, as `Stop` does; a stop is a stopped session. As the real one (V18c spike, the honeycomb
 * workspace's copy on 2026-10-31): a resume of a session whose process still lives starts a copy
 * under a new ID, without the original's settings, so its hooks record nothing; `linger` keeps a
 * stopped session's process listed for that many more listings; `deafen` silences every hook (a
 * settings file whose hook is gone); `copies` makes every resume a copy.
 */
function fakeClaude(symbiote: string, now: () => Date) {
  const listed: AgentSession[] = [];
  /** Sessions whose hooks record nothing: the copies. */
  const deaf = new Set<string>();
  let allDeaf = false;
  let lingering = 0;
  let copying = false;
  /** Stopped sessions whose process is still listed, and for how many more listings. */
  const ending = new Map<AgentSession, number>();
  const hook = (session: AgentSession, input: Record<string, unknown>) =>
    allDeaf || deaf.has(session.sessionId ?? '')
      ? Promise.resolve()
      : recordEvent(
          symbiote,
          { session_id: session.sessionId, cwd: session.cwd, ...input },
          now().toISOString(),
        );
  const add = (cwd: string): AgentSession => {
    const n = listed.length + 1;
    const session: AgentSession = {
      cwd,
      kind: 'background',
      startedAt: n,
      id: `s${n}`,
      sessionId: `session-${n}`,
      state: 'working',
      status: 'busy',
    };
    listed.push(session);
    return session;
  };
  const start = vi.fn<ClaudeCode['start']>(async ({ cwd, prompt }) => {
    const session = add(cwd);
    await hook(session, { hook_event_name: 'UserPromptSubmit', prompt });
    return { ok: true };
  });
  const resume = vi.fn<ClaudeCode['resume']>(async ({ sessionId, text }) => {
    const session = listed.find((s) => s.sessionId === sessionId);
    if (!session) return { ok: false, error: 'no such session' };
    if (copying || session.status !== undefined) {
      // A copy with the conversation, not the settings: it works, and nothing is recorded.
      const copy = add(session.cwd);
      deaf.add(copy.sessionId ?? '');
      return { ok: true };
    }
    Object.assign(session, { state: 'working', status: 'busy' });
    await hook(session, { hook_event_name: 'UserPromptSubmit', prompt: text });
    return { ok: true };
  });
  const stop = vi.fn<ClaudeCode['stop']>((id) => {
    for (const session of listed) {
      if (session.id !== id) continue;
      if (lingering > 0 && session.status !== undefined) {
        ending.set(session, lingering);
        continue;
      }
      session.state = 'stopped';
      delete session.status;
    }
    return Promise.resolve({ ok: true });
  });
  const sessions = vi.fn<ClaudeCode['sessions']>(() => {
    for (const [session, left] of ending) {
      if (left > 0) {
        ending.set(session, left - 1);
        continue;
      }
      ending.delete(session);
      session.state = 'stopped';
      delete session.status;
    }
    return Promise.resolve(listed);
  });
  const claude: ClaudeCode = {
    command: '/usr/bin/claude',
    start,
    startPageAgent: () => Promise.reject(new Error('Hive never starts a page agent')),
    sessions,
    stop,
    resume,
    remove: () => Promise.resolve({ ok: true }),
    account: () => Promise.resolve('your Pro subscription'),
    efforts: () => Promise.resolve(['low', 'medium', 'high']),
    models: () => Promise.resolve([]),
  };
  /** The newest session in `worktree`. */
  const sessionIn = (worktree: string) => listed.filter((s) => s.cwd === worktree).at(-1);
  /** Ends the writer's turn: files written (committed unless `commit: false`), then its report. */
  const endTurn = async (
    worktree: string,
    { files = {}, commit = true }: { files?: Record<string, string>; commit?: boolean } = {},
  ) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(worktree, path)), { recursive: true });
      writeFileSync(join(worktree, path), text);
    }
    if (commit && Object.keys(files).length > 0) {
      gitIn(worktree, 'add', '-A');
      gitIn(worktree, 'commit', '-qm', `wrote ${Object.keys(files).join(', ')}`);
    }
    const session = sessionIn(worktree);
    if (!session) throw new Error(`no session in ${worktree}`);
    Object.assign(session, { state: 'blocked', status: 'idle' });
    await hook(session, { hook_event_name: 'Stop', last_assistant_message: 'Done.' });
  };
  return {
    claude,
    listed,
    start,
    resume,
    stop,
    sessions,
    sessionIn,
    endTurn,
    /** A stopped session's process is listed for `listings` more listings. */
    linger: (listings: number) => (lingering = listings),
    /** From now on no hook records anything. */
    deafen: () => (allDeaf = true),
    /** Every resume starts a copy. */
    copies: () => (copying = true),
  };
}

/** One run of the fake reviewer: the files it writes in its copy, then its answer or its failure. */
interface ReviewerAnswer {
  write?: Record<string, string>;
  answer?: {
    summary: string;
    ran: string;
    findings: { defect: string; test: string; command: string; files: string[] }[];
  };
  cost?: number;
  /** Milliseconds before it answers: Hive off, a message or a killed runner meanwhile. */
  sleep?: number;
  /** Lines of its stream it prints at once, before it waits (Hive's live progress). */
  stream?: unknown[];
  /** A file it waits for before it answers. */
  gate?: string;
  stderr?: string;
  exit?: number;
}

/** A run of the fake reviewer, as it recorded itself. */
interface ReviewerCall {
  args: string[];
  cwd: string;
  input: string;
  pid: number;
}

/**
 * A fake Claude Code as Hive's running reviewer (HV3): a real program, run as `claude -p` is, that
 * answers each run with the next of its answers (the last again when none is left; an approval
 * when none was given) in `stream-json`, after writing its files into its copy. It records its
 * arguments, folder, prompt and pid.
 */
function fakeReviewer(dir: string) {
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'claude');
  writeFileSync(
    script,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = ${JSON.stringify(dir)};
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const count = path.join(dir, 'count');
  const n = Number(fs.existsSync(count) ? fs.readFileSync(count, 'utf8') : '0');
  fs.writeFileSync(count, String(n + 1));
  const file = path.join(dir, 'answers.json');
  const answers = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const a = answers[Math.min(n, answers.length - 1)] || {};
  fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input, pid: process.pid }) + '\\n');
  for (const [name, text] of Object.entries(a.write || {})) {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, text);
  }
  const answer = () => {
    if (a.stderr) process.stderr.write(a.stderr + '\\n');
    if (a.exit) process.exit(a.exit);
    const out = a.answer || { summary: 'Nothing found.', ran: 'Its tests.', findings: [] };
    console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-fake' }));
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: a.cost === undefined ? 0.5 : a.cost, result: JSON.stringify(out), structured_output: out }));
  };
  for (const line of a.stream || []) console.log(JSON.stringify(line));
  const wait = () => (fs.existsSync(a.gate) ? answer() : setTimeout(wait, 50));
  if (a.gate) wait();
  else if (a.sleep) setTimeout(answer, a.sleep);
  else answer();
});
`,
  );
  chmodSync(script, 0o755);
  return {
    script,
    answers(list: ReviewerAnswer[]) {
      writeFileSync(join(dir, 'answers.json'), JSON.stringify(list));
    },
    calls(): ReviewerCall[] {
      const file = join(dir, 'calls.jsonl');
      return existsSync(file)
        ? readFileSync(file, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as ReviewerCall)
        : [];
    },
  };
}

/** A rerun as the tests run it: unconfined (bubblewrap's own command is tested apart). */
const unconfined: Confine = (command) => command;

/** Git in a worktree, as the writer (its own name: the repository has none). */
const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Writer', '-c', 'user.email=writer@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

/** A repository with a commit, a git user, and `merge.checks` set to `checks`. */
function repository(checks: string[]) {
  const repo = createRepo();
  repo.write({ 'src/a.ts': 'export const a = 1;\n' });
  repo.commit('A');
  repo.git('config', 'user.email', 'ada@example.com');
  // The merge queue's merge commits (HV4) need a name too.
  repo.git('config', 'user.name', 'Ada');
  repos.push(repo);
  folders.push(join(dirname(repo.root), `${basename(repo.root)}.worktrees`));
  setChecks(repo, checks);
  return repo;
}

/** The project's check (`merge.checks` in `symbiote/config.json`), not committed. */
function setChecks(repo: TestRepo, checks: string[]) {
  mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
  writeFileSync(
    join(repo.root, 'symbiote', 'config.json'),
    `${JSON.stringify({ merge: { checks } })}\n`,
  );
}

interface Setup {
  git: GitRepo;
  where: ReviewPlace;
  hive: HiveRecord;
  service: Workspaces;
  fake: ReturnType<typeof fakeClaude>;
  reviewer: ReturnType<typeof fakeReviewer>;
  /** Where the reviews' copies are, in Symbiote's cache. */
  copies: string;
  now: () => Date;
  /** The merge queue's entries, as the runner reads them (decision 717). */
  queue: MergeEntry[];
  /** With `land` (HV4): the real merge queue Hive lands through. */
  merges?: Merger;
  runner: (options?: { pid?: number; unseenMs?: number }) => HiveRunner;
  /** Turns Hive on or off as Settings does: the record, then this process's runner told. */
  turn: (on: boolean, runner?: HiveRunner) => Promise<void>;
  start: (branch: string, more?: { planFirst?: boolean; kind?: 'spike' }) => Promise<string>;
}

async function setup(
  repo: TestRepo,
  {
    confine = unconfined,
    stopWaitMs,
    land = false,
    requests,
  }: {
    confine?: Confine | null;
    stopWaitMs?: number;
    land?: boolean;
    /** HV8: how Hive lands by request, with the fake forge. */
    requests?: HiveRequests;
  } = {},
): Promise<Setup> {
  const git = await openRepo(repo.root);
  const now = clock();
  const where = await reviewPlace(git, cache);
  const hive = repositoryHive(git, cache, { now });
  const fake = fakeClaude(symbioteFolder(where), now);
  const reviewer = fakeReviewer(join(cache, 'fake-reviewer'));
  const queue: MergeEntry[] = [];
  // HV4: Hive lands through the real merge queue and records its approval in the branch's review.
  const merges = land ? merger(git, cache, { now }) : undefined;
  const reviews = land ? branchReviews(git, cache, { now }) : undefined;
  const service = workspaces(git, cache, {
    claude: () => Promise.resolve(fake.claude),
    now,
    env: { PATH: '/usr/bin' },
    hook: HOOK,
    node: '/usr/bin/node',
    hive: () => hive.on(),
    ...(stopWaitMs === undefined ? {} : { stopWaitMs }),
  });
  const runner = ({ pid, unseenMs }: { pid?: number; unseenMs?: number } = {}) => {
    const made = hiveRunner(git, cache, {
      hive,
      workspaces: service,
      now,
      interval: 0,
      merges: merges ? () => merges.list().then((l) => l.merges) : () => Promise.resolve(queue),
      ...(merges && reviews
        ? {
            lander: { merges, reviews, ...(requests ? { requests } : {}) },
            landRetryMs: 0,
            requestPollMs: 0,
          }
        : {}),
      ...(pid ? { pid } : {}),
      ...(unseenMs === undefined ? {} : { unseenMs }),
      reviewer: {
        claude: () => Promise.resolve(reviewer.script),
        confine: () => Promise.resolve(confine),
      },
    });
    runners.push(made);
    return made;
  };
  return {
    git,
    where,
    hive,
    service,
    fake,
    reviewer,
    copies: join(cache, 'worktrees', git.id, 'hive-review'),
    now,
    queue,
    ...(merges ? { merges } : {}),
    runner,
    async turn(on, made) {
      await hive.set(on);
      made?.switched(on);
    },
    async start(branch, more = {}) {
      const { workspace } = await service.start({
        branch,
        planFirst: more.planFirst ?? false,
        ...(more.kind
          ? { kind: more.kind, title: branch, parts: { question: 'Why?' } }
          : { brief: `Write ${branch}.` }),
      });
      return workspace.worktree.path;
    },
  };
}

/** A bare `origin` with `main` pushed and tracked. */
function origin(repo: TestRepo): string {
  const remote = tempDir();
  folders.push(remote);
  repo.git('init', '--quiet', '--bare', remote);
  repo.git('remote', 'add', 'origin', remote);
  repo.git('push', '--quiet', '-u', 'origin', 'main');
  return remote;
}

/** Looks, waits for what the look started and for the merge queue, until `done` holds. */
async function settle(
  runner: HiveRunner,
  s: Setup,
  done: () => Promise<boolean>,
  what: string,
): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await runner.tick();
    await runner.idle();
    await s.merges?.idle();
    if (await done()) return;
  }
  const record = JSON.stringify(
    (await readHives(s.where)).map((r) => [r.branch, r.step, r.note, r.landings?.at(-1)]),
  );
  throw new Error(`did not settle: ${what}: ${record}`);
}

/** A forge client on the fake forge, with a token or without; gh's token never read. */
function clientOf(fake: FakeForge, token: boolean): Forge {
  return fake.kind === 'github'
    ? new GitHubForge(
        'github.com',
        'acme/app',
        { GITHUB_API_URL: fake.url, ...(token ? { GITHUB_TOKEN: 'ghp_fake' } : {}) },
        () => undefined,
      )
    : new GitLabForge('gitlab.com', 'acme/app', {
        GITLAB_API_URL: fake.url,
        ...(token ? { GITLAB_TOKEN: 'glpat-fake' } : {}),
      });
}

/** A graph with one warning, as the view server's analysis would give it (HV8's review). */
const flagged = (head: string) =>
  ({
    findings: [
      {
        rule: 'breaking-change',
        symbol: 'src/a.ts#a',
        severity: 'warning',
        message: `a changed at ${head.slice(0, 7)}`,
      },
    ],
    nodes: [],
    files: [],
  }) as unknown as Graph;

describe.each(['github', 'gitlab'] as const)(
  'Hive lands through a %s request: the rounds before the push (HV8)',
  (kind) => {
    const forges: FakeForge[] = [];
    afterEach(async () => {
      for (const forge of forges.splice(0)) await forge.close_();
    });

    /** A repository whose Hive lands by request on a fake forge over a bare `origin`. */
    async function requesting(checks: string[]) {
      const repo = repository(checks);
      const remote = origin(repo);
      const forge = await fakeForge(kind, remote);
      forges.push(forge);
      const git = await openRepo(repo.root);
      const requests = hiveRequests(git, {
        env: {},
        graphOf: ({ head }) => Promise.resolve(flagged(head)),
        make: () => clientOf(forge, true),
      });
      const s = await setup(repo, { land: true, requests: { ...requests, by: () => 'request' } });
      await s.turn(true);
      return { repo, remote, forge, s };
    }

    it("cannot merge, the writer's merge of main fails the check: the open request keeps the commit Hive approved", async () => {
      const { repo, remote, forge, s } = await requesting(['test ! -f broken.txt']);
      const worktree = await s.start('feature/three');
      const runner = s.runner();
      await s.fake.endTurn(worktree, { files: { 'src/a.ts': 'export const a = "three";\n' } });
      await settle(
        runner,
        s,
        async () => (await readHive(s.where, 'feature/three'))?.request?.review !== undefined,
        'the request opened and reviewed',
      );
      const approved = gitIn(worktree, 'rev-parse', 'HEAD');
      expect(repo.git('--git-dir', remote, 'rev-parse', 'feature/three')).toBe(approved);
      // main moves on the forge, on the same line: the request conflicts.
      repo.write({ 'src/a.ts': 'export const a = "main";\n' });
      repo.commit('M: a is main');
      repo.git('push', '--quiet', 'origin', 'main');
      repo.git('reset', '--quiet', '--hard', 'HEAD~1');
      forge.conflict(12);
      await settle(
        runner,
        s,
        async () => (await readHive(s.where, 'feature/three'))?.merges === 1,
        'the conflict sent',
      );

      // The writer merges main in, and its merge breaks the check.
      try {
        gitIn(worktree, 'merge', 'main');
      } catch {
        // the conflict
      }
      writeFileSync(join(worktree, 'src', 'a.ts'), 'export const a = "main" + "three";\n');
      writeFileSync(join(worktree, 'broken.txt'), 'broken\n');
      gitIn(worktree, 'add', '-A');
      gitIn(worktree, 'commit', '-qm', 'Merge main into feature/three');
      await s.fake.endTurn(worktree);
      const unchecked = gitIn(worktree, 'rev-parse', 'HEAD');
      await settle(
        runner,
        s,
        async () =>
          (await readHive(s.where, 'feature/three'))?.checks.some(
            (c) => c.at === unchecked && !c.ok,
          ) ?? false,
        'the check failed on the merge',
      );
      // The request on the forge is what the person merges: still the commit Hive approved, not
      // the one its check failed.
      const record = await readHive(s.where, 'feature/three');
      expect(record?.request).toMatchObject({ number: 12, state: 'open', at: approved });
      expect(repo.git('--git-dir', remote, 'rev-parse', 'feature/three')).toBe(approved);
    });
  },
);
