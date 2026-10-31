// HV2: Hive's runner, driving workspaces started while Hive is on, with a fake Claude Code whose
// sessions and hooks act as the real one's (a prompt recorded as a turn starts, a report as it
// ends) and the project's real check, run as a shell would.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  openRepo,
  type GitRepo,
  type HiveLogLine,
  type MergeEntry,
  type Verdict,
} from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { repositoryHive, type HiveRecord } from '../src/hive.js';
import { hiveRunner, type HiveRunner } from '../src/hive-runner.js';
import { hiveLogPath } from '../src/hive-live.js';
import {
  hiveEventsPath,
  hiveSummary,
  hiveTestsDir,
  readHive,
  writeHive,
} from '../src/hive-record.js';
import type { Confine } from '../src/hive-review.js';
import { hiveWorkspace } from '../src/hive-workspace.js';
import type { Merger } from '../src/merges.js';
import { reviewPlace, type BranchReviews, type ReviewPlace } from '../src/reviews.js';
import { recordEvent } from '../src/thread.js';
import {
  readRecord,
  serializeWorkspace,
  symbioteFolder,
  type WorkspaceFile,
  type WorkspaceRefused,
} from '../src/workspace-record.js';
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

/** Whether a process (a check's group leader) is still there. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Waits until `ready` holds, for up to 10 s. */
async function until(ready: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await ready()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * A fake Claude Code: a start or a resume is a working session whose prompt the hooks record, as
 * `UserPromptSubmit` does; `endTurn` commits (or leaves files) in the worktree and records the
 * report, as `Stop` does; a stop is a stopped session.
 */
function fakeClaude(symbiote: string, now: () => Date) {
  const listed: AgentSession[] = [];
  const hook = (session: AgentSession, input: Record<string, unknown>) =>
    recordEvent(
      symbiote,
      { session_id: session.sessionId, cwd: session.cwd, ...input },
      now().toISOString(),
    );
  const start = vi.fn<ClaudeCode['start']>(async ({ cwd, prompt }) => {
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
    await hook(session, { hook_event_name: 'UserPromptSubmit', prompt });
    return { ok: true };
  });
  const resume = vi.fn<ClaudeCode['resume']>(async ({ sessionId, text }) => {
    const session = listed.find((s) => s.sessionId === sessionId);
    if (!session) return { ok: false, error: 'no such session' };
    Object.assign(session, { state: 'working', status: 'busy' });
    await hook(session, { hook_event_name: 'UserPromptSubmit', prompt: text });
    return { ok: true };
  });
  const stop = vi.fn<ClaudeCode['stop']>((id) => {
    for (const session of listed) {
      if (session.id !== id) continue;
      session.state = 'stopped';
      delete session.status;
    }
    return Promise.resolve({ ok: true });
  });
  const sessions = vi.fn<ClaudeCode['sessions']>(() => Promise.resolve(listed));
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
  return { claude, listed, start, resume, stop, sessions, sessionIn, endTurn };
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
  runner: (options?: { pid?: number }) => HiveRunner;
  /** Turns Hive on or off as Settings does: the record, then this process's runner told. */
  turn: (on: boolean, runner?: HiveRunner) => Promise<void>;
  start: (branch: string, more?: { planFirst?: boolean; kind?: 'spike' }) => Promise<string>;
}

async function setup(
  repo: TestRepo,
  { confine = unconfined }: { confine?: Confine | null } = {},
): Promise<Setup> {
  const git = await openRepo(repo.root);
  const now = clock();
  const where = await reviewPlace(git, cache);
  const hive = repositoryHive(git, cache, { now });
  const fake = fakeClaude(symbioteFolder(where), now);
  const reviewer = fakeReviewer(join(cache, 'fake-reviewer'));
  const service = workspaces(git, cache, {
    claude: () => Promise.resolve(fake.claude),
    now,
    env: { PATH: '/usr/bin' },
    hook: HOOK,
    node: '/usr/bin/node',
    hive: () => hive.on(),
  });
  const runner = ({ pid }: { pid?: number } = {}) => {
    const made = hiveRunner(git, cache, {
      hive,
      workspaces: service,
      now,
      interval: 0,
      ...(pid ? { pid } : {}),
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

const events = (where: ReviewPlace, branch: string) =>
  existsSync(hiveEventsPath(where, branch))
    ? readFileSync(hiveEventsPath(where, branch), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { kind: string }).kind)
    : [];

describe('Hive, on', () => {
  it('drives a workspace from its first turn to landing asked, then landed once merged', async () => {
    const repo = repository(['test -f one.txt']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/one');
    // The record says Hive drives it; Hive's record starts at the writer's turn.
    expect((await readRecord(s.where, 'feature/one')).hive).toBe(true);
    expect(await readHive(s.where, 'feature/one')).toMatchObject({
      branch: 'feature/one',
      step: 'writing',
      round: 1,
      rounds: 3,
    });
    // Its writer is told Hive drives it, and which check Symbiote runs.
    const prompt = s.fake.start.mock.calls[0]?.[0].prompt ?? '';
    expect(prompt).toContain(
      "Hive drives this workspace. When you end a turn with commits, Symbiote runs the check on the branch's tip (`test -f one.txt`)",
    );
    expect(await s.service.prompt('feature/one')).toBe(prompt);
    const runner = s.runner();
    await runner.tick();
    // The writer works: nothing to do.
    expect((await readHive(s.where, 'feature/one'))?.step).toBe('writing');

    await s.fake.endTurn(worktree, { files: { 'one.txt': 'one\n' } });
    await runner.tick();
    await runner.idle();
    const tip = gitIn(worktree, 'rev-parse', 'HEAD');
    const landing = await readHive(s.where, 'feature/one');
    expect(landing).toMatchObject({ step: 'landing', round: 1, checked: tip });
    expect(landing?.checks).toMatchObject([{ round: 1, at: tip, ok: true }]);
    // The running reviewer (HV3) found nothing on the commit the check passed on.
    expect(landing?.reviews).toMatchObject([{ round: 1, at: tip, verdict: 'approved' }]);
    // The card reads it: landing asked, Hive on.
    const listed = (await s.service.list()).workspaces[0];
    expect(listed?.hive).toMatchObject({ step: 'landing', round: 1, rounds: 3 });
    expect(listed?.hive?.check).toMatchObject({ ok: true });
    expect(listed?.hive?.paused).toBeUndefined();
    // Nothing was sent to the writer: its one turn passed.
    expect(s.fake.resume).not.toHaveBeenCalled();

    // The person lands it (Approve, Merge into): merged into main.
    repo.git('merge', '-q', '--no-ff', 'feature/one', '-m', 'Merge one');
    await runner.tick();
    expect((await readHive(s.where, 'feature/one'))?.step).toBe('landed');
    expect(events(s.where, 'feature/one')).toEqual([
      'started',
      'turn-ended',
      'check-started',
      'check',
      'reviewing',
      'review-started',
      'review',
      'landing',
      'landed',
    ]);
    // Each event's time is its own: a field named `at` in what it says never replaces it.
    const lines = readFileSync(hiveEventsPath(s.where, 'feature/one'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { at: string; kind: string; commit?: string });
    for (const line of lines) expect(line.at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(lines.find((line) => line.kind === 'check-started')?.commit).toBe(tip);
  });

  it('sends a failed check to the writer round by round, and stops for the person at the cap', async () => {
    const repo = repository(['test -f fixed.txt']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/cap');
    const runner = s.runner();
    for (const round of [1, 2, 3]) {
      await s.fake.endTurn(worktree, { files: { [`r${round}.txt`]: `${round}\n` } });
      await runner.tick();
      await runner.idle();
      // Hive's message reaches the session before its turn is read again.
      await runner.tick();
      const record = await readHive(s.where, 'feature/cap');
      expect(record?.checks.at(-1)).toMatchObject({
        round,
        ok: false,
        failed: 'test -f fixed.txt',
      });
      if (round < 3) {
        expect(record).toMatchObject({ step: 'writing', round: round + 1 });
        const text = s.fake.resume.mock.calls.at(-1)?.[0].text ?? '';
        expect(text).toContain('`test -f fixed.txt` failed');
        expect(text).toContain(`round ${round} of 3`);
      }
    }
    const stuck = await readHive(s.where, 'feature/cap');
    expect(stuck).toMatchObject({ step: 'stuck', round: 3 });
    expect(stuck?.note).toMatch(/failed 3 times/);
    expect(s.fake.resume).toHaveBeenCalledTimes(2);

    // The person's message starts the rounds again.
    await s.service.reply({ branch: 'feature/cap', text: 'Add fixed.txt.' });
    await runner.tick();
    expect(await readHive(s.where, 'feature/cap')).toMatchObject({ step: 'writing', round: 1 });
    await s.fake.endTurn(worktree, { files: { 'fixed.txt': 'yes\n' } });
    await runner.tick();
    await runner.idle();
    expect((await readHive(s.where, 'feature/cap'))?.step).toBe('landing');
  });

  it('asks the writer to commit what it left, and checks only a clean tree', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/dirty');
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'left.txt': 'x\n' }, commit: false });
    await runner.tick();
    await runner.idle();
    expect(await readHive(s.where, 'feature/dirty')).toMatchObject({ step: 'writing', round: 2 });
    expect(s.fake.resume.mock.calls.at(-1)?.[0].text).toContain('left.txt');
    // No check ran on files the writer had not committed.
    expect((await readHive(s.where, 'feature/dirty'))?.checks).toEqual([]);
  });

  it('a spike that ends without commits is asked of the person, with no check', async () => {
    const repo = repository(['false']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('spike/why', { kind: 'spike' });
    const runner = s.runner();
    await s.fake.endTurn(worktree);
    await runner.tick();
    await runner.idle();
    const record = await readHive(s.where, 'spike/why');
    expect(record).toMatchObject({ step: 'landing', checks: [] });
    expect(s.fake.resume).not.toHaveBeenCalled();
  });

  it('a plan first waits for the person, then the loop goes on', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/planned', { planFirst: true });
    const runner = s.runner();
    await s.fake.endTurn(worktree);
    await runner.tick();
    // A plan waits for the person's OK: no message from Hive.
    expect(await readHive(s.where, 'feature/planned')).toMatchObject({ step: 'writing', round: 1 });
    expect(s.fake.resume).not.toHaveBeenCalled();
    await s.service.reply({ branch: 'feature/planned', text: 'OK' });
    await s.fake.endTurn(worktree, { files: { 'p.txt': 'p\n' } });
    await runner.tick();
    await runner.idle();
    expect((await readHive(s.where, 'feature/planned'))?.step).toBe('landing');
  });

  it('refuses Codex and Hermes while Hive is on: Hive drives Claude Code only', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    for (const agent of ['codex', 'hermes'] as const) {
      const refused = await s.service
        .start({ brief: 'x', branch: `feature/${agent}`, planFirst: false, agent })
        .then(
          () => null,
          (error: unknown) => error as WorkspaceRefused,
        );
      expect(refused?.status).toBe(409);
      expect(refused?.message).toMatch(/Hive drives Claude Code only/);
    }
  });

  it('a message Hive wrote but never sent is sent once by the next runner', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/lost');
    await s.fake.endTurn(worktree, { files: { 'a.txt': 'a\n' } });
    const record = await readHive(s.where, 'feature/lost');
    if (!record) throw new Error('no record');
    // Written as it is about to be sent, then the runner died.
    const since = s.now().toISOString();
    await writeHive(s.where, {
      ...record,
      round: 2,
      since,
      message: { key: 'hive.commit', text: 'Commit it.', at: since },
    });
    const runner = s.runner();
    await runner.tick();
    await runner.tick();
    expect(s.fake.resume).toHaveBeenCalledTimes(1);
    expect(s.fake.resume.mock.calls[0]?.[0].text).toBe('Commit it.');
    expect((await readHive(s.where, 'feature/lost'))?.message?.sent).toBe(true);
  });
});

describe('Hive off, on again, a killed runner', () => {
  it('Hive off stops a working writer and keeps its step; on again, it is told to continue', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    await s.start('feature/off');
    const runner = s.runner();
    await runner.tick();
    await s.turn(false, runner);
    await runner.tick();
    expect(s.fake.stop).toHaveBeenCalledWith('s1');
    expect(await readHive(s.where, 'feature/off')).toMatchObject({
      step: 'writing',
      interrupted: true,
    });
    expect((await s.service.list()).workspaces[0]?.hive?.paused).toBe(true);
    // While off, nothing more: no second stop, no message.
    await runner.tick();
    expect(s.fake.stop).toHaveBeenCalledTimes(1);
    expect(s.fake.resume).not.toHaveBeenCalled();

    await s.turn(true, runner);
    await runner.tick();
    expect(s.fake.resume).toHaveBeenCalledTimes(1);
    expect(s.fake.resume.mock.calls[0]?.[0].text).toMatch(/Hive was turned off/);
    const record = await readHive(s.where, 'feature/off');
    expect(record).toMatchObject({ step: 'writing', round: 1 });
    expect(record?.interrupted).toBeUndefined();
  });

  it('a turn the person finished while Hive was off goes on to the check, with no message', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/meanwhile');
    const runner = s.runner();
    await runner.tick();
    await s.turn(false, runner);
    await runner.tick();
    // The person continues it while Hive is off: Hive does not stop it again.
    await s.service.reply({ branch: 'feature/meanwhile', text: 'Go on.' });
    await runner.tick();
    expect(s.fake.stop).toHaveBeenCalledTimes(1);
    await s.fake.endTurn(worktree, { files: { 'm.txt': 'm\n' } });
    await s.turn(true, runner);
    await runner.tick();
    await runner.idle();
    expect((await readHive(s.where, 'feature/meanwhile'))?.step).toBe('landing');
    expect(s.fake.resume).toHaveBeenCalledTimes(1); // the person's own message only
  });

  it('Hive off mid-check kills the check and keeps the step; on again, the check runs again', async () => {
    const repo = repository(['sleep 30']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/check');
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'c.txt': 'c\n' } });
    await runner.tick();
    await until(
      async () => (await readHive(s.where, 'feature/check'))?.check !== undefined,
      'the check',
    );
    const pid = (await readHive(s.where, 'feature/check'))?.check?.pid ?? 0;
    expect(alive(pid)).toBe(true);

    await s.turn(false, runner);
    await runner.tick();
    await until(() => !alive(pid), 'the check to be killed');
    await runner.idle();
    const off = await readHive(s.where, 'feature/check');
    // A killed check is no result: the step stays, with no check recorded.
    expect(off).toMatchObject({ step: 'checking', checks: [] });

    setChecks(repo, ['true']);
    await s.turn(true, runner);
    await runner.tick();
    await runner.idle();
    expect(await readHive(s.where, 'feature/check')).toMatchObject({
      step: 'landing',
      checks: [{ round: 1, ok: true }],
    }); // Its events say Hive went off, the check stopped, Hive came on and ran it again.
    expect(events(s.where, 'feature/check').slice(2)).toEqual([
      'check-started',
      'off',
      'check-stopped',
      'on',
      'check-started',
      'check',
      'reviewing',
      'review-started',
      'review',
      'landing',
    ]);
  });

  it('a killed runner: the next kills its orphaned check and runs it again, and leaves a working writer be', async () => {
    const repo = repository(['sleep 30']);
    const s = await setup(repo);
    await s.turn(true);
    const checked = await s.start('feature/orphan');
    await s.start('feature/busy');
    const first = s.runner();
    await s.fake.endTurn(checked, { files: { 'o.txt': 'o\n' } });
    await first.tick();
    await until(
      async () => (await readHive(s.where, 'feature/orphan'))?.check !== undefined,
      'the check',
    );
    const pid = (await readHive(s.where, 'feature/orphan'))?.check?.pid ?? 0;
    // SIGKILL: no clean-up, its check left running, its lock left behind.
    first.abandon();
    expect(alive(pid)).toBe(true);

    setChecks(repo, ['true']);
    const next = s.runner();
    await next.tick();
    await until(() => !alive(pid), 'the orphan to be killed');
    await next.idle();
    expect(await readHive(s.where, 'feature/orphan')).toMatchObject({
      step: 'landing',
      checks: [{ round: 1, ok: true }],
    });
    // The other writer still works: no stop, no message.
    expect(await readHive(s.where, 'feature/busy')).toMatchObject({ step: 'writing', round: 1 });
    expect(s.fake.stop).not.toHaveBeenCalled();
    expect(s.fake.resume).not.toHaveBeenCalled();
  });

  it('one runner drives a repository: another one, of another process, only reads', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/locked');
    const holder = s.runner();
    await holder.tick();
    // Another process: its own pid, the lock held by this live one.
    const other = s.runner({ pid: process.pid + 100_000 });
    await s.fake.endTurn(worktree, { files: { 'l.txt': 'l\n' } });
    await other.tick();
    await other.idle();
    expect((await readHive(s.where, 'feature/locked'))?.step).toBe('writing');
    await holder.tick();
    await holder.idle();
    expect((await readHive(s.where, 'feature/locked'))?.step).toBe('landing');
  });
});

/** A test the fake reviewer writes: it fails, naming itself, while one.txt does not say one. */
const ONE_TEST =
  'grep -qx one one.txt && echo "PASS one says one" || { echo "FAIL one says one"; exit 1; }\n';
const ONE_FINDING = {
  defect: 'one.txt says uno, not one',
  test: 'one says one',
  command: 'sh test/one.test.sh',
  files: ['test/one.test.sh'],
};

/** The reviews' copies left in Symbiote's cache: none once a review ended. */
const copiesLeft = (copies: string) =>
  existsSync(copies) ? readdirSync(copies, { recursive: true }) : [];

describe("Hive's running reviewer (HV3)", () => {
  it('a defect proven by a failing test reaches the writer; its fix passes the next review; landing asked', async () => {
    const repo = repository(['test -f one.txt']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/one');
    s.reviewer.answers([
      {
        write: { 'test/one.test.sh': ONE_TEST },
        answer: { summary: 'one.txt says uno.', ran: 'test/one.test.sh', findings: [ONE_FINDING] },
        cost: 0.75,
      },
      { answer: { summary: 'Fixed.', ran: 'test/one.test.sh passes.', findings: [] } },
    ]);
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'one.txt': 'uno\n' } });
    await runner.tick();
    await runner.idle();
    const first = gitIn(worktree, 'rev-parse', 'HEAD');

    // It ran in a clone of the commit the check passed on, with Symbiote's settings only.
    const [call] = s.reviewer.calls();
    if (!call) throw new Error('no review');
    expect(call.cwd).not.toBe(worktree);
    expect(call.cwd.startsWith(s.copies)).toBe(true);
    expect(call.args.slice(0, 1)).toEqual(['-p']);
    const arg = (name: string) => call.args[call.args.indexOf(name) + 1];
    expect(arg('--model')).toBe('opus');
    expect(arg('--effort')).toBe('high');
    expect(arg('--setting-sources')).toBe('');
    expect(arg('--permission-mode')).toBe('dontAsk');
    expect(call.args).toEqual(
      expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence']),
    );
    expect(call.input).toContain('Write feature/one.');
    expect(call.input).toContain('+uno');
    expect(call.input).toContain("Symbiote's check passed on");

    await runner.tick();
    const record = await readHive(s.where, 'feature/one');
    expect(record).toMatchObject({ step: 'writing', round: 2 });
    expect(record?.reviews).toMatchObject([
      {
        round: 1,
        at: first,
        verdict: 'changes',
        cost: 0.75,
        model: 'opus',
        effort: 'high',
        findings: [{ ...ONE_FINDING, kept: true, code: 1 }],
      },
    ]);
    expect(record?.reviews[0]?.findings[0]?.output).toContain('FAIL one says one');
    // The writer got the failing test, kept beside Hive's record.
    const text = s.fake.resume.mock.calls.at(-1)?.[0].text ?? '';
    expect(text).toContain('proved 1 defect with failing tests');
    expect(text).toContain('one.txt says uno, not one');
    expect(text).toContain('`sh test/one.test.sh`');
    expect(text).toContain('grep -qx one one.txt');
    expect(text).toContain('FAIL one says one');
    const kept = join(hiveTestsDir(s.where, 'feature/one', 1), 'test', 'one.test.sh');
    expect(readFileSync(kept, 'utf8')).toBe(ONE_TEST);
    expect(copiesLeft(s.copies)).toEqual([]);
    expect((await s.service.list()).workspaces[0]?.hive?.review).toEqual({
      round: 1,
      at: first,
      verdict: 'changes',
      kept: 1,
    });

    // The writer adds the test and makes it pass: the check, then a review that approves.
    await s.fake.endTurn(worktree, { files: { 'one.txt': 'one\n', 'test/one.test.sh': ONE_TEST } });
    await runner.tick();
    await runner.idle();
    const second = s.reviewer.calls()[1];
    expect(second?.input).toContain('In round 1, a reviewer proved these defects');
    expect(second?.input).toContain('one.txt says uno, not one');
    expect(second?.input).toContain("The writer's report of its turn since");
    const tip = gitIn(worktree, 'rev-parse', 'HEAD');
    const landing = await readHive(s.where, 'feature/one');
    expect(landing).toMatchObject({ step: 'landing', round: 2, checked: tip });
    expect(landing?.reviews.map((r) => [r.round, r.verdict])).toEqual([
      [1, 'changes'],
      [2, 'approved'],
    ]);
    expect(copiesLeft(s.copies)).toEqual([]);
    expect(events(s.where, 'feature/one')).toEqual([
      'started',
      'turn-ended',
      'check-started',
      'check',
      'reviewing',
      'review-started',
      'review',
      'message',
      'sent',
      'turn-ended',
      'check-started',
      'check',
      'reviewing',
      'review-started',
      'review',
      'landing',
    ]);
  });

  it("drops a finding whose test passes on Symbiote's rerun, or does not name it, or has no file in the copy", async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/drop');
    s.reviewer.answers([
      {
        write: {
          'test/pass.sh': 'echo "PASS it is fine"\n',
          'test/other.sh': 'echo "something else"; exit 1\n',
          'test/gone.sh': 'exit 127\n',
        },
        answer: {
          summary: 'Three suspicions.',
          ran: 'Three tests.',
          findings: [
            {
              defect: 'a',
              test: 'it is fine',
              command: 'sh test/pass.sh',
              files: ['test/pass.sh'],
            },
            { defect: 'b', test: 'named', command: 'sh test/other.sh', files: ['test/other.sh'] },
            { defect: 'c', test: 'gone', command: 'sh test/gone.sh', files: ['test/gone.sh'] },
            { defect: 'd', test: 'x', command: 'sh test/missing.sh', files: ['test/missing.sh'] },
            { defect: 'e', test: 'y', command: 'sh ../out.sh', files: ['../out.sh'] },
          ],
        },
      },
    ]);
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'a.txt': 'a\n' } });
    await runner.tick();
    await runner.idle();
    const record = await readHive(s.where, 'feature/drop');
    // Nothing proven: landing asked, nothing sent to the writer.
    expect(record).toMatchObject({ step: 'landing', round: 1 });
    expect(s.fake.resume).not.toHaveBeenCalled();
    const review = record?.reviews[0];
    expect(review?.verdict).toBe('approved');
    expect(review?.findings.map((f) => [f.defect, f.kept, f.why])).toEqual([
      ['a', false, "its test passed on Symbiote's rerun"],
      ['b', false, 'its command failed, but its output does not name "named"'],
      ['c', false, 'its command could not run (exit 127)'],
      ['d', false, 'test/missing.sh is not in the copy'],
      ['e', false, '../out.sh holds ".."'],
    ]);
    expect(existsSync(hiveTestsDir(s.where, 'feature/drop', 1))).toBe(false);
    expect(copiesLeft(s.copies)).toEqual([]);
  });

  it('a failing check goes back without a review; defects proven in the last round stop for the person', async () => {
    const repo = repository(['test -f one.txt']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/cap');
    s.reviewer.answers([
      {
        write: { 'test/one.test.sh': ONE_TEST },
        answer: { summary: 'Still uno.', ran: 'test/one.test.sh', findings: [ONE_FINDING] },
      },
    ]);
    const runner = s.runner();
    // Round 1: the check fails, and no review runs.
    await s.fake.endTurn(worktree, { files: { 'two.txt': '2\n' } });
    await runner.tick();
    await runner.idle();
    await runner.tick();
    expect(await readHive(s.where, 'feature/cap')).toMatchObject({ step: 'writing', round: 2 });
    expect(s.reviewer.calls()).toEqual([]);
    // Rounds 2 and 3: the check passes, the reviewer proves the defect each time.
    for (const round of [2, 3]) {
      await s.fake.endTurn(worktree, { files: { 'one.txt': `uno ${round}\n` } });
      await runner.tick();
      await runner.idle();
      await runner.tick();
    }
    const stuck = await readHive(s.where, 'feature/cap');
    expect(stuck).toMatchObject({ step: 'stuck', round: 3 });
    expect(stuck?.note).toBe('the reviewer proved defects in 3 rounds');
    expect(stuck?.reviews.map((r) => [r.round, r.verdict])).toEqual([
      [2, 'changes'],
      [3, 'changes'],
    ]);
    expect(s.reviewer.calls()).toHaveLength(2);
    expect(copiesLeft(s.copies)).toEqual([]);
  });

  it('Hive off mid-review stops the reviewer and keeps the step; on again, a new review runs', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/off');
    s.reviewer.answers([{ sleep: 30_000 }, {}]);
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'o.txt': 'o\n' } });
    await runner.tick();
    await until(() => s.reviewer.calls().length === 1, 'the reviewer');
    await until(
      async () => (await readHive(s.where, 'feature/off'))?.review !== undefined,
      'the review in the record',
    );
    const pid = s.reviewer.calls()[0]?.pid ?? 0;
    expect((await readHive(s.where, 'feature/off'))?.review?.pid).toBe(pid);
    expect(alive(pid)).toBe(true);
    expect((await s.service.list()).workspaces[0]?.hive?.step).toBe('reviewing');

    await s.turn(false, runner);
    await runner.tick();
    await until(() => !alive(pid), 'the reviewer to be stopped');
    await runner.idle();
    const off = await readHive(s.where, 'feature/off');
    expect(off).toMatchObject({ step: 'reviewing', interrupted: true, reviews: [] });
    expect(off?.review).toBeUndefined();
    expect(copiesLeft(s.copies)).toEqual([]);
    expect((await s.service.list()).workspaces[0]?.hive?.paused).toBe(true);

    await s.turn(true, runner);
    await runner.tick();
    await runner.idle();
    expect(await readHive(s.where, 'feature/off')).toMatchObject({
      step: 'landing',
      reviews: [{ round: 1, verdict: 'approved' }],
    });
    expect(s.reviewer.calls()).toHaveLength(2);
    expect(events(s.where, 'feature/off').slice(-7)).toEqual([
      'review-started',
      'off',
      'review-stopped',
      'on',
      'review-started',
      'review',
      'landing',
    ]);
    expect(copiesLeft(s.copies)).toEqual([]);
  });

  it('a killed runner: the next ends its orphaned reviewer, removes its copy and reviews again', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/orphan');
    s.reviewer.answers([{ sleep: 30_000 }, {}]);
    const first = s.runner();
    await s.fake.endTurn(worktree, { files: { 'o.txt': 'o\n' } });
    await first.tick();
    await until(
      async () => (await readHive(s.where, 'feature/orphan'))?.review !== undefined,
      'the review in the record',
    );
    await until(() => s.reviewer.calls().length === 1, 'the reviewer');
    const pid = s.reviewer.calls()[0]?.pid ?? 0;
    expect((await readHive(s.where, 'feature/orphan'))?.review?.pid).toBe(pid);
    first.abandon();
    expect(alive(pid)).toBe(true);

    const next = s.runner();
    await next.tick();
    await until(() => !alive(pid), 'the orphan to be ended');
    await next.idle();
    expect(await readHive(s.where, 'feature/orphan')).toMatchObject({
      step: 'landing',
      reviews: [{ round: 1, verdict: 'approved' }],
    });
    expect(events(s.where, 'feature/orphan')).toContain('orphan-killed');
    await until(() => copiesLeft(s.copies).length === 0, 'the copies to be removed');
  });

  it("the person's message mid-review stops it, and the rounds start again", async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/mine');
    s.reviewer.answers([{ sleep: 30_000 }]);
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'm.txt': 'm\n' } });
    await runner.tick();
    await until(() => s.reviewer.calls().length === 1, 'the reviewer');
    const pid = s.reviewer.calls()[0]?.pid ?? 0;
    await s.service.reply({ branch: 'feature/mine', text: 'I take it from here.' });
    await runner.tick();
    await until(() => !alive(pid), 'the reviewer to be stopped');
    await runner.idle();
    expect(await readHive(s.where, 'feature/mine')).toMatchObject({
      step: 'writing',
      round: 1,
      reviews: [],
    });
    expect(copiesLeft(s.copies)).toEqual([]);
  });

  it('a reviewer that fails twice on a commit: landing asked, with a note', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/fails');
    s.reviewer.answers([{ exit: 1, stderr: 'API Error: overloaded' }]);
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'f.txt': 'f\n' } });
    await runner.tick();
    await runner.idle();
    // The first failure: the review runs again at the next look.
    expect((await readHive(s.where, 'feature/fails'))?.step).toBe('reviewing');
    await runner.tick();
    await runner.idle();
    const record = await readHive(s.where, 'feature/fails');
    expect(record?.step).toBe('landing');
    expect(record?.reviews.map((r) => r.verdict)).toEqual(['failed', 'failed']);
    expect(record?.reviews[1]?.error).toMatch(/API Error: overloaded/);
    expect(record?.note).toMatch(/^the running review failed twice: .*review it yourself$/);
    expect(s.fake.resume).not.toHaveBeenCalled();
  });

  it("without Claude Code's sandbox nothing is reviewed: landing asked, with a note", async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/nosandbox');
    s.reviewer.answers([
      {
        exit: 1,
        stderr:
          'Error: sandbox required but unavailable: sandbox is enabled but dependencies are missing: socat not installed · install missing tools (e.g. apt install bubblewrap socat)',
      },
    ]);
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'n.txt': 'n\n' } });
    await runner.tick();
    await runner.idle();
    const record = await readHive(s.where, 'feature/nosandbox');
    expect(record?.step).toBe('landing');
    expect(record?.reviews.map((r) => r.verdict)).toEqual(['unavailable']);
    expect(record?.note).toMatch(
      /^not reviewed: Claude Code's sandbox is not available: .*socat not installed/,
    );
    expect(s.reviewer.calls()).toHaveLength(1);
  });

  it('without a way to confine the rerun, no reviewer is started', async () => {
    const repo = repository(['true']);
    const s = await setup(repo, { confine: null });
    await s.turn(true);
    const worktree = await s.start('feature/noconfine');
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'c.txt': 'c\n' } });
    await runner.tick();
    await runner.idle();
    const record = await readHive(s.where, 'feature/noconfine');
    expect(record?.step).toBe('landing');
    expect(record?.note).toMatch(/^not reviewed: .*bubblewrap/);
    expect(s.reviewer.calls()).toEqual([]);
  });

  it('the Review tab: the rounds, a kept test, and Land, which approves the reviewed commit and queues it', async () => {
    const repo = repository(['test -f one.txt']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/tab');
    s.reviewer.answers([
      {
        write: { 'test/one.test.sh': ONE_TEST },
        answer: { summary: 'uno', ran: 'test/one.test.sh', findings: [ONE_FINDING] },
      },
      {},
    ]);
    const runner = s.runner();
    const finish = vi.fn<BranchReviews['finish']>(() =>
      Promise.resolve({ verdict: {} as Verdict, text: '' }),
    );
    const enqueue = vi.fn<Merger['enqueue']>(({ branch, into }) =>
      Promise.resolve({ id: 'm1', branch, into, state: 'queued' } as MergeEntry),
    );
    const tab = hiveWorkspace(s.git, cache, {
      hive: s.hive,
      reviews: {
        resolve: (branch) =>
          Promise.resolve({
            info: {
              branch,
              ref: branch,
              base: 'base',
              head: gitIn(worktree, 'rev-parse', 'HEAD'),
              reviewed: null,
              since: null,
              into: 'main',
            },
            pair: {} as Awaited<ReturnType<BranchReviews['resolve']>>['pair'],
          }),
        finish,
      },
      merges: {
        targets: () => Promise.resolve({ branches: ['main'], into: 'main', strategy: 'merge' }),
        enqueue,
      },
    });
    await s.fake.endTurn(worktree, { files: { 'one.txt': 'uno\n' } });
    await runner.tick();
    await runner.idle();
    await runner.tick();
    // Not asked yet: Land is refused.
    await expect(tab.land('feature/tab')).rejects.toThrow(
      /Hive has not asked to land feature\/tab: it is writing/,
    );
    expect(await tab.test('feature/tab', 1, 'test/one.test.sh')).toBe(ONE_TEST);
    // Only a kept finding's file is read.
    expect(await tab.test('feature/tab', 1, '../../../config.json')).toBeNull();
    await s.fake.endTurn(worktree, { files: { 'one.txt': 'one\n', 'test/one.test.sh': ONE_TEST } });
    await runner.tick();
    await runner.idle();
    const tip = gitIn(worktree, 'rev-parse', 'HEAD');
    const detail = await tab.detail('feature/tab');
    expect(detail).toMatchObject({
      branch: 'feature/tab',
      step: 'landing',
      round: 2,
      on: true,
      checked: tip,
      checks: [{ round: 1 }, { round: 2 }],
      reviews: [
        { round: 1, verdict: 'changes' },
        { round: 2, verdict: 'approved' },
      ],
    });
    expect(await tab.detail('feature/none')).toBeNull();

    const entry = await tab.land('feature/tab');
    expect(entry).toMatchObject({ branch: 'feature/tab', into: 'main' });
    expect(finish).toHaveBeenCalledTimes(1);
    const [info, review] = finish.mock.calls[0] ?? [];
    expect(info?.head).toBe(tip);
    expect(review).toMatchObject({ event: 'approve', comments: [] });
    expect(review?.body).toContain(`checked and reviewed by Hive at ${tip.slice(0, 7)} (round 2)`);
    // Nothing reached the writer: Hive keeps waiting for the merge.
    const sent = s.fake.resume.mock.calls.length;
    await runner.tick();
    expect(s.fake.resume.mock.calls.length).toBe(sent);
    expect((await readHive(s.where, 'feature/tab'))?.step).toBe('landing');

    // Hive off: the person lands it as any workspace.
    await s.turn(false, runner);
    await expect(tab.land('feature/tab')).rejects.toThrow(/Hive is off/);
  });

  it("asks the reviewer on the project's model and level", async () => {
    const repo = repository(['true']);
    writeFileSync(
      join(repo.root, 'symbiote', 'config.json'),
      `${JSON.stringify({ merge: { checks: ['true'] }, hive: { reviewer: { model: 'sonnet', effort: 'medium' } } })}\n`,
    );
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/sonnet');
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 's.txt': 's\n' } });
    await runner.tick();
    await runner.idle();
    const call = s.reviewer.calls()[0];
    expect(call?.args[call.args.indexOf('--model') + 1]).toBe('sonnet');
    expect(call?.args[call.args.indexOf('--effort') + 1]).toBe('medium');
    expect((await readHive(s.where, 'feature/sonnet'))?.reviews[0]).toMatchObject({
      model: 'sonnet',
      effort: 'medium',
    });
  });
});

describe("Hive's live progress", () => {
  /** A command that says it waits, waits for `name`'s file in `gates`, then says it went on. */
  const waitFor = (gates: string, name: string) =>
    `echo waiting-${name}; while [ ! -f ${gates}/${name} ]; do sleep 0.05; done; echo after-${name}`;
  const gatesDir = () => {
    const dir = join(cache, 'gates');
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const open = (gates: string, name: string) => writeFileSync(join(gates, name), '');
  const logLines = (file: string) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HiveLogLine);
  /** The Review tab's service, with nothing to land. */
  const tabOf = (s: Setup) =>
    hiveWorkspace(s.git, cache, {
      hive: s.hive,
      reviews: {
        resolve: () => Promise.reject(new Error('not landed here')),
        finish: () => Promise.reject(new Error('not landed here')),
      },
      merges: {
        targets: () => Promise.reject(new Error('not landed here')),
        enqueue: () => Promise.reject(new Error('not landed here')),
      },
    });
  const card = async (s: Setup, branch: string) =>
    (await s.service.list()).workspaces.find((w) => w.branch === branch)?.hive;

  it("records the check's commands, the one running and since when, and streams its output to its log", async () => {
    const gates = gatesDir();
    const commands = ['echo one', waitFor(gates, 'two'), 'echo three'];
    const repo = repository(commands);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/live');
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'l.txt': 'l\n' } });
    await runner.tick();
    await until(
      async () => (await readHive(s.where, 'feature/live'))?.check?.step === 1,
      'the second command',
    );
    const check = (await readHive(s.where, 'feature/live'))?.check;
    expect(check).toMatchObject({ commands, step: 1, done: [{ ok: true }] });
    expect(check?.done?.[0]?.ms).toBeGreaterThanOrEqual(0);
    // The check's own start, not its command's.
    expect(Date.parse(check?.since ?? '')).toBeGreaterThan(Date.parse(check?.started ?? ''));
    expect(check?.log).toMatch(/^[\w-]+$/);
    // Its log, as it comes: the first command and its end, the second and what it said so far.
    const file = hiveLogPath(s.where, 'feature/live', check?.log ?? '');
    await until(() => readFileSync(file, 'utf8').includes('waiting-two'), 'the output');
    const running = logLines(file);
    expect(running.flatMap((l) => ('step' in l ? [[l.step, l.title]] : []))).toEqual([
      ['check', 'echo one'],
      ['check', commands[1]],
    ]);
    expect(running.filter((l) => 'end' in l)).toHaveLength(1);
    expect(running.some((l) => 'out' in l && l.out.includes('one'))).toBe(true);
    // The card and the Review tab read it: no expected time on a first check.
    const live = {
      kind: 'check',
      started: check?.started,
      commands,
      step: 1,
      since: check?.since,
      log: check?.log,
    };
    const listed = await card(s, 'feature/live');
    expect(listed?.live).toMatchObject(live);
    expect(listed?.live).not.toHaveProperty('expected');
    expect((await tabOf(s).detail('feature/live'))?.live).toMatchObject(live);

    open(gates, 'two');
    await runner.idle();
    const after = await readHive(s.where, 'feature/live');
    expect(after?.check).toBeUndefined();
    expect(after?.checks[0]).toMatchObject({
      ok: true,
      started: check?.started,
      commands,
      steps: commands.map((command) => ({ command, ok: true })),
      log: check?.log,
    });
    const ended = logLines(file);
    expect(ended.filter((l) => 'end' in l)).toHaveLength(3);
    expect(readFileSync(file, 'utf8')).toContain('after-two');
    expect(readFileSync(file, 'utf8')).toContain('three');
    // Nothing runs once landing is asked.
    expect((await card(s, 'feature/live'))?.live).toBeUndefined();
    // The tab reads the logs its record names, and no other file.
    const tab = tabOf(s);
    expect((await tab.log('feature/live', check?.log ?? '', 0))?.lines).toEqual(ended);
    expect(await tab.log('feature/live', 'not-a-log', 0)).toBeNull();
    expect(await tab.log('feature/live', '../../workspaces/feature/live', 0)).toBeNull();
    expect(await tab.log('feature/other', check?.log ?? '', 0)).toBeNull();
  });

  it('a failed command ends the check: its steps up to it, the rest not run', async () => {
    const repo = repository(['echo fine', 'echo broken; exit 3', 'echo never']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/broken');
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'b.txt': 'b\n' } });
    await runner.tick();
    await runner.idle();
    const check = (await readHive(s.where, 'feature/broken'))?.checks[0];
    expect(check).toMatchObject({
      ok: false,
      failed: 'echo broken; exit 3',
      steps: [
        { command: 'echo fine', ok: true },
        { command: 'echo broken; exit 3', ok: false },
      ],
    });
    const lines = logLines(hiveLogPath(s.where, 'feature/broken', check?.log ?? ''));
    expect(lines.flatMap((l) => ('end' in l ? [l.end.ok] : []))).toEqual([true, false]);
  });

  it('the expected time: the last passing check of the same commands in the repository, never a guess', async () => {
    const gates = gatesDir();
    const commands = [waitFor(gates, 'a')];
    const repo = repository(commands);
    const s = await setup(repo);
    await s.turn(true);
    const runner = s.runner();
    const checking = async (branch: string) => {
      const worktree = await s.start(branch);
      await s.fake.endTurn(worktree, { files: { [`${branch.split('/')[1]}.txt`]: 'x\n' } });
      await runner.tick();
      await until(
        async () => (await readHive(s.where, branch))?.check?.step === 0,
        `${branch}'s check`,
      );
    };

    // A first check of one command: its one step, elapsed only.
    await checking('feature/first');
    const first = await card(s, 'feature/first');
    expect(first?.live).toMatchObject({ kind: 'check', commands, step: 0, done: [] });
    expect(first?.live).not.toHaveProperty('expected');
    open(gates, 'a');
    await runner.idle();
    const passed = (await readHive(s.where, 'feature/first'))?.checks[0];
    expect(passed).toMatchObject({ ok: true, steps: [{ command: commands[0], ok: true }] });

    // The next check of the same commands, in another workspace: that check's times.
    rmSync(join(gates, 'a'));
    await checking('feature/second');
    expect((await card(s, 'feature/second'))?.live).toMatchObject({
      expected: { ms: passed?.ms, steps: [passed?.steps?.[0]?.ms] },
    });
    open(gates, 'a');
    await runner.idle();

    // Other commands: none of the checks before ran them. A record from before (no commands)
    // never counts.
    setChecks(repo, [waitFor(gates, 'b'), 'true']);
    await writeHive(s.where, {
      branch: 'feature/old',
      step: 'landing',
      round: 1,
      rounds: 3,
      since: '2026-10-30T10:00:00.000Z',
      started: '2026-10-30T10:00:00.000Z',
      checks: [{ round: 1, at: 'abc', ok: true, ms: 420_000 }],
      reviews: [],
    });
    await checking('feature/third');
    expect((await card(s, 'feature/third'))?.live).not.toHaveProperty('expected');
    open(gates, 'b');
    await runner.idle();
  }, 20_000);

  it('no check set or found: Hive reviews without one, and the card says so while it does', async () => {
    const repo = repository([]);
    writeFileSync(join(repo.root, 'symbiote', 'config.json'), '{}\n');
    const s = await setup(repo);
    await s.turn(true);
    const gate = join(cache, 'review-gate');
    s.reviewer.answers([{ gate }]);
    const worktree = await s.start('feature/nocheck');
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'n.txt': 'n\n' } });
    await runner.tick();
    await until(
      async () => (await card(s, 'feature/nocheck'))?.live?.kind === 'review',
      'the review',
    );
    const listed = await card(s, 'feature/nocheck');
    expect(listed).toMatchObject({ step: 'reviewing' });
    expect(listed?.note).toMatch(/no check/);
    expect(listed?.check).toBeUndefined();
    writeFileSync(gate, '');
    await runner.idle();
  });

  it("the running review: its log as it comes, what it runs now from the reviewer's stream", async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const gate = join(cache, 'review-gate');
    s.reviewer.answers([
      {
        gate,
        stream: [
          { type: 'system', subtype: 'init', model: 'claude-fake', claude_code_version: '9.9' },
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', name: 'Bash', input: { command: 'pnpm vitest run x.test.ts' } },
              ],
            },
          },
        ],
      },
    ]);
    const worktree = await s.start('feature/reviewing');
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'r.txt': 'r\n' } });
    await runner.tick();
    await until(async () => {
      const live = (await card(s, 'feature/reviewing'))?.live;
      return live?.kind === 'review' && live.doing !== undefined;
    }, "the reviewer's call");
    const record = await readHive(s.where, 'feature/reviewing');
    const live = (await card(s, 'feature/reviewing'))?.live;
    expect(live).toMatchObject({
      kind: 'review',
      started: record?.review?.started,
      log: record?.review?.log,
      phase: 'review',
      doing: 'Bash: pnpm vitest run x.test.ts',
    });
    expect((await tabOf(s).detail('feature/reviewing'))?.live).toMatchObject({
      kind: 'review',
      doing: 'Bash: pnpm vitest run x.test.ts',
    });
    const file = hiveLogPath(s.where, 'feature/reviewing', record?.review?.log ?? '');
    expect(logLines(file)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'review', title: 'The reviewer' }),
        expect.objectContaining({ agent: { start: 'Claude Code 9.9 · claude-fake' } }),
        expect.objectContaining({ agent: { tool: 'Bash', input: 'pnpm vitest run x.test.ts' } }),
      ]),
    );

    writeFileSync(gate, '');
    await runner.idle();
    const after = await readHive(s.where, 'feature/reviewing');
    expect(after?.reviews[0]).toMatchObject({ verdict: 'approved', log: record?.review?.log });
    expect(logLines(file).flatMap((l) => ('end' in l ? [l.end.ok] : []))).toEqual([true]);
    expect((await card(s, 'feature/reviewing'))?.live).toBeUndefined();
  });

  it("the check's write at each command keeps what was written meanwhile (decision 694)", async () => {
    const gates = gatesDir();
    const repo = repository([waitFor(gates, 'one'), waitFor(gates, 'two')]);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/meanwhile');
    const runner = s.runner();
    await s.fake.endTurn(worktree, { files: { 'm.txt': 'm\n' } });
    await runner.tick();
    await until(
      async () => (await readHive(s.where, 'feature/meanwhile'))?.check?.step === 0,
      'the first command',
    );
    // Another write while the first command runs (the tick's, say).
    const read = await readHive(s.where, 'feature/meanwhile');
    if (!read) throw new Error('no record');
    await writeHive(s.where, { ...read, note: 'written meanwhile' });
    open(gates, 'one');
    await until(
      async () => (await readHive(s.where, 'feature/meanwhile'))?.check?.step === 1,
      'the second command',
    );
    expect((await readHive(s.where, 'feature/meanwhile'))?.note).toBe('written meanwhile');
    open(gates, 'two');
    await runner.idle();
  });

  it('Hive off: the card shows nothing running', () => {
    const at = '2026-10-31T10:00:00.000Z';
    const record = {
      branch: 'feature/x',
      step: 'checking' as const,
      round: 1,
      rounds: 3,
      since: at,
      started: at,
      check: { pid: 1, started: at, at: 'abc', commands: ['true'], step: 0, since: at, done: [] },
      checks: [],
      reviews: [],
    };
    const live = {
      kind: 'check' as const,
      started: at,
      commands: ['true'],
      step: 0,
      since: at,
      done: [],
    };
    expect(hiveSummary(record, true, live).live).toEqual(live);
    expect(hiveSummary(record, false, live)).not.toHaveProperty('live');
  });
});

describe('Hive off = main', () => {
  it('a start is as without Hive: its record and prompt, nothing under symbiote/hive, no agent call', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    // The same start by a service that knows nothing of Hive, as on main.
    const plain = workspaces(s.git, cache, {
      claude: () => Promise.resolve(s.fake.claude),
      now: () => new Date('2026-10-31T09:00:00.000Z'),
      env: { PATH: '/usr/bin' },
      hook: HOOK,
      node: '/usr/bin/node',
    });
    const main = await plain.start({ brief: 'Same.', branch: 'feature/main', planFirst: false });
    const off = await s.service.start({ brief: 'Same.', branch: 'feature/off', planFirst: false });
    expect(off.prompt).toBe(
      main.prompt
        .replaceAll('feature/main', 'feature/off')
        .replaceAll('feature-main', 'feature-off'),
    );
    expect(off.prompt).not.toMatch(/Hive/);
    /** A record without what differs between two starts: its branch, worktree and times. */
    const record = (branch: string): Partial<WorkspaceFile> => {
      const read = JSON.parse(
        serializeWorkspace(readRecordSync(s.where, branch)),
      ) as Partial<WorkspaceFile>;
      delete read.created;
      delete read.branch;
      delete read.worktree;
      return { ...read, agent: read.agent ? { ...read.agent, started: 'x' } : null };
    };
    expect(record('feature/off')).toEqual(record('feature/main'));

    const on = vi.spyOn(s.hive, 'on');
    const runner = s.runner();
    const before = s.fake.sessions.mock.calls.length;
    await runner.tick();
    await runner.tick();
    await runner.tick();
    await runner.idle();
    expect(s.fake.sessions.mock.calls.length).toBe(before);
    expect(existsSync(join(symbioteFolder(s.where), 'hive'))).toBe(false);
    // No running reviewer, no copy (HV3).
    expect(s.reviewer.calls()).toEqual([]);
    expect(existsSync(s.copies)).toBe(false);
    // Off, the switch is read once; after that only its file's time is, until it is written.
    expect(on).toHaveBeenCalledTimes(1);
    await s.hive.set(true);
    await runner.tick();
    expect(on).toHaveBeenCalledTimes(2);
  });
});

/** A workspace's record, read at once (the record's own reader is async). */
function readRecordSync(where: ReviewPlace, branch: string): WorkspaceFile {
  const file = join(symbioteFolder(where), 'workspaces', ...`${branch}.json`.split('/'));
  return JSON.parse(readFileSync(file, 'utf8')) as WorkspaceFile;
}
