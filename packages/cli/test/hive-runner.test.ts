// HV2: Hive's runner, driving workspaces started while Hive is on, with a fake Claude Code whose
// sessions and hooks act as the real one's (a prompt recorded as a turn starts, a report as it
// ends) and the project's real check, run as a shell would.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { openRepo, type GitRepo } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { repositoryHive, type HiveRecord } from '../src/hive.js';
import { hiveRunner, type HiveRunner } from '../src/hive-runner.js';
import { hiveEventsPath, readHive, writeHive } from '../src/hive-record.js';
import { reviewPlace, type ReviewPlace } from '../src/reviews.js';
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
  now: () => Date;
  runner: (options?: { pid?: number }) => HiveRunner;
  /** Turns Hive on or off as Settings does: the record, then this process's runner told. */
  turn: (on: boolean, runner?: HiveRunner) => Promise<void>;
  start: (branch: string, more?: { planFirst?: boolean; kind?: 'spike' }) => Promise<string>;
}

async function setup(repo: TestRepo): Promise<Setup> {
  const git = await openRepo(repo.root);
  const now = clock();
  const where = await reviewPlace(git, cache);
  const hive = repositoryHive(git, cache, { now });
  const fake = fakeClaude(symbioteFolder(where), now);
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
