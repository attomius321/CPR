// HV5: Hive paces itself (decisions 796–801). The real runner and the workspaces' start, with
// hive-runner.test.ts's harness (as the HV8 suites copy it): a fake Claude Code whose hooks record
// what the real one's do — each prompt naming its transcript, where `endTurn` writes Claude Code's
// own count (`cost-state`) — a fake running reviewer, and Claude's usage read by a function the test
// answers: never the real endpoint. A clock that moves a millisecond a read, and jumps when told.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { openRepo, type GitRepo, type MergeEntry, type UsageSubscription } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { repositoryHive, type HiveRecord } from '../src/hive.js';
import { hiveRunner, type HiveRunner } from '../src/hive-runner.js';
import { hivePacing } from '../src/hive-pacing.js';
import { hiveEventsPath, hiveSummary, readHive, type HiveFile } from '../src/hive-record.js';
import { hiveWorkspace } from '../src/hive-workspace.js';
import type { Confine } from '../src/hive-review.js';
import { reviewPlace, type ReviewPlace } from '../src/reviews.js';
import { recordEvent } from '../src/thread.js';
import { readRecord, symbioteFolder } from '../src/workspace-record.js';
import { workspaces, type Workspaces } from '../src/workspaces.js';
import type { AgentSession, ClaudeCode } from '../src/claude-code.js';
import type { ClaudeUsageRead } from '../src/usage.js';

const HOOK = '/opt/symbiote/dist/agent-hook.js';
const MIN = 60_000;
const HOUR = 60 * MIN;

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

/** A clock that moves a millisecond each time it is read, and `jump`s when the test says. */
let at = 0;
const START = Date.parse('2026-11-02T14:00:00.000Z');
function clock() {
  at = START;
  return () => new Date((at += 1));
}
const jump = (ms: number) => (at += ms);

/**
 * A fake Claude Code: a start or a resume is a working session whose prompt the hooks record with
 * its transcript, as `UserPromptSubmit` does; `endTurn` commits in the worktree, writes the
 * session's count in its transcript, then records the report, as `Stop` does; a stop is a stopped
 * session.
 */
function fakeClaude(symbiote: string, now: () => Date, transcripts: string) {
  const listed: AgentSession[] = [];
  mkdirSync(transcripts, { recursive: true });
  const transcriptOf = (session: AgentSession) =>
    join(transcripts, `${session.sessionId ?? 'none'}.jsonl`);
  const hook = (session: AgentSession, input: Record<string, unknown>) =>
    recordEvent(
      symbiote,
      {
        session_id: session.sessionId,
        cwd: session.cwd,
        transcript_path: transcriptOf(session),
        ...input,
      },
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
  const claude: ClaudeCode = {
    command: '/usr/bin/claude',
    start,
    startPageAgent: () => Promise.reject(new Error('Hive never starts a page agent')),
    sessions: () => Promise.resolve(listed),
    stop,
    resume,
    remove: () => Promise.resolve({ ok: true }),
    account: () => Promise.resolve('your Max subscription'),
    efforts: () => Promise.resolve(['low', 'medium', 'high']),
    models: () => Promise.resolve([]),
  };
  const sessionIn = (worktree: string) => listed.filter((s) => s.cwd === worktree).at(-1);
  /** Ends the writer's turn: files committed, Claude Code's count of the session, its report. */
  const endTurn = async (
    worktree: string,
    { files = {}, cost }: { files?: Record<string, string>; cost?: number } = {},
  ) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(worktree, path)), { recursive: true });
      writeFileSync(join(worktree, path), text);
    }
    if (Object.keys(files).length > 0) {
      gitIn(worktree, 'add', '-A');
      gitIn(worktree, 'commit', '-qm', `wrote ${Object.keys(files).join(', ')}`);
    }
    const session = sessionIn(worktree);
    if (!session) throw new Error(`no session in ${worktree}`);
    if (cost !== undefined) {
      appendFileSync(
        transcriptOf(session),
        `${JSON.stringify({ type: 'cost-state', sessionId: session.sessionId, totalCostUSD: cost })}\n`,
      );
    }
    Object.assign(session, { state: 'blocked', status: 'idle' });
    await hook(session, { hook_event_name: 'Stop', last_assistant_message: 'Done.' });
  };
  return { claude, start, resume, stop, sessionIn, endTurn };
}

/** One run of the fake reviewer: its answer, its cost, and a file it waits for. */
interface ReviewerAnswer {
  cost?: number;
  gate?: string;
}

/** A fake Claude Code as the running reviewer (HV3), as hive-runner.test.ts's: approves. */
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
  const answer = () => {
    const out = { summary: 'Nothing found.', ran: 'Its tests.', findings: [] };
    console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-fake' }));
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: a.cost === undefined ? 0.5 : a.cost, result: JSON.stringify(out), structured_output: out }));
  };
  const wait = () => (fs.existsSync(a.gate) ? answer() : setTimeout(wait, 50));
  if (a.gate) wait();
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
    runs: () =>
      existsSync(join(dir, 'count')) ? Number(readFileSync(join(dir, 'count'), 'utf8')) : 0,
  };
}

const unconfined: Confine = (command) => command;

const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Writer', '-c', 'user.email=writer@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

/** A repository with a commit, and `symbiote/config.json`'s `merge.checks` and `hive` as given. */
function repository(checks: string[], hive?: Record<string, unknown>) {
  const repo = createRepo();
  repo.write({ 'src/a.ts': 'export const a = 1;\n' });
  repo.commit('A');
  repo.git('config', 'user.email', 'ada@example.com');
  repo.git('config', 'user.name', 'Ada');
  repos.push(repo);
  folders.push(join(dirname(repo.root), `${basename(repo.root)}.worktrees`));
  mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
  writeFileSync(
    join(repo.root, 'symbiote', 'config.json'),
    `${JSON.stringify({ merge: { checks }, ...(hive ? { hive } : {}) })}\n`,
  );
  return repo;
}

/** Claude's numbers as read at `read`: the 5-hour window at `session` %, resetting at `resets`. */
const claudeAt = (session: number, read: number, resets: number): UsageSubscription => ({
  agent: 'claude',
  windows: [
    { minutes: 300, usedPercent: session, resetsAt: new Date(resets).toISOString() },
    { minutes: 10_080, usedPercent: 20, resetsAt: '2026-11-08T22:00:00.000Z' },
  ],
  at: new Date(read).toISOString(),
  source: 'live',
});

/** Claude's usage as the gate reads it: what the test says, and how often it was asked. */
function usage() {
  let answer: (now: number) => ClaudeUsageRead = (now) => ({
    subscription: claudeAt(10, now, START + 2 * HOUR),
  });
  let reads = 0;
  return {
    read: () => {
      reads += 1;
      return Promise.resolve(answer(at));
    },
    /** From now on each read gives `percent` of the 5-hour window, resetting at `resets`. */
    at(percent: number, resets = START + 2 * HOUR) {
      answer = (now) => ({ subscription: claudeAt(percent, now, resets) });
    },
    answer(next: (now: number) => ClaudeUsageRead) {
      answer = next;
    },
    reads: () => reads,
  };
}

interface Setup {
  git: GitRepo;
  where: ReviewPlace;
  hive: HiveRecord;
  service: Workspaces;
  fake: ReturnType<typeof fakeClaude>;
  reviewer: ReturnType<typeof fakeReviewer>;
  usage: ReturnType<typeof usage>;
  queue: MergeEntry[];
  runner: (options?: { paced?: boolean }) => HiveRunner;
  turn: (on: boolean, runner?: HiveRunner) => Promise<void>;
  start: (branch: string) => Promise<string>;
}

async function setup(repo: TestRepo, { paced = true }: { paced?: boolean } = {}): Promise<Setup> {
  const git = await openRepo(repo.root);
  const now = clock();
  const where = await reviewPlace(git, cache);
  const hive = repositoryHive(git, cache, { now });
  const fake = fakeClaude(symbioteFolder(where), now, join(cache, 'transcripts'));
  const reviewer = fakeReviewer(join(cache, 'fake-reviewer'));
  const fakeUsage = usage();
  const queue: MergeEntry[] = [];
  /** A gate as `symbiote view` makes one: a new one for each runner, as a restart would. */
  const gate = () => hivePacing({ root: repo.root, usage: fakeUsage.read, now });
  const service = workspaces(git, cache, {
    claude: () => Promise.resolve(fake.claude),
    now,
    env: { PATH: '/usr/bin' },
    hook: HOOK,
    node: '/usr/bin/node',
    hive: () => hive.on(),
    ...(paced ? { hivePacing: gate() } : {}),
  });
  return {
    git,
    where,
    hive,
    service,
    fake,
    reviewer,
    usage: fakeUsage,
    queue,
    runner: ({ paced: withGate = paced } = {}) => {
      const made = hiveRunner(git, cache, {
        hive,
        workspaces: service,
        now,
        interval: 0,
        merges: () => Promise.resolve(queue),
        reviewer: {
          claude: () => Promise.resolve(reviewer.script),
          confine: () => Promise.resolve(unconfined),
        },
        ...(withGate ? { pacing: gate() } : {}),
      });
      runners.push(made);
      return made;
    },
    async turn(on, made) {
      await hive.set(on);
      made?.switched(on);
    },
    async start(branch) {
      const { workspace } = await service.start({
        branch,
        planFirst: false,
        brief: `Write ${branch}.`,
      });
      return workspace.worktree.path;
    },
  };
}

/** Looks and waits for what the look started. */
async function look(runner: HiveRunner, times = 1) {
  for (let i = 0; i < times; i++) {
    await runner.tick();
    await runner.idle();
  }
}

const events = (where: ReviewPlace, branch: string) =>
  existsSync(hiveEventsPath(where, branch))
    ? readFileSync(hiveEventsPath(where, branch), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { kind: string } & Record<string, unknown>)
    : [];
const kinds = (where: ReviewPlace, branch: string) => events(where, branch).map((e) => e.kind);

const RESETS = START + 2 * HOUR;
const RESETS_AT = new Date(RESETS).toISOString();

describe('at or over the threshold', () => {
  it('delivers no message: the record says paused with the window and its reset, and it goes on by itself after it', async () => {
    const repo = repository(['test -f fixed.txt']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/one');
    const runner = s.runner();
    await look(runner);
    // 92 % of the 5-hour window: the check runs (no agent), its failure waits.
    s.usage.at(92, RESETS);
    await s.fake.endTurn(worktree, { files: { 'one.txt': '1\n' } });
    await look(runner, 3);
    expect(s.fake.resume).not.toHaveBeenCalled();
    const held = await readHive(s.where, 'feature/one');
    expect(held).toMatchObject({
      step: 'writing',
      round: 2,
      checks: [{ ok: false, failed: 'test -f fixed.txt' }],
      paused: { reason: 'usage', minutes: 300, percent: 92, pauseAt: 90, until: RESETS_AT },
    });
    expect(held?.message?.key).toBe('hive.check');
    expect(held?.message?.taken).toBeUndefined();
    // Once a pause, however many looks.
    expect(kinds(s.where, 'feature/one').filter((k) => k === 'paused')).toHaveLength(1);
    expect(events(s.where, 'feature/one').find((e) => e.kind === 'paused')).toMatchObject({
      minutes: 300,
      percent: 92,
      until: RESETS_AT,
    });
    // The card reads it from the record.
    expect(hiveSummary(held as HiveFile, true).pause).toMatchObject({ percent: 92 });
    // An hour on, still paused, and the window was not read again.
    const reads = s.usage.reads();
    jump(HOUR);
    await look(runner, 2);
    expect(s.fake.resume).not.toHaveBeenCalled();
    expect(s.usage.reads()).toBe(reads);
    // Past its reset: read again, the message goes, the pause is gone.
    jump(HOUR);
    s.usage.at(4, RESETS + 5 * HOUR);
    await look(runner, 2);
    expect(s.fake.resume).toHaveBeenCalledTimes(1);
    expect(s.fake.resume.mock.calls[0]?.[0].text).toContain('`test -f fixed.txt` failed');
    const after = await readHive(s.where, 'feature/one');
    expect(after?.paused).toBeUndefined();
    expect(after?.message?.sent).toBe(true);
    expect(kinds(s.where, 'feature/one')).toContain('goes-on');
  });

  it('starts no running review until the window resets; the check runs', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/two');
    const runner = s.runner();
    await look(runner);
    s.usage.at(95, RESETS);
    await s.fake.endTurn(worktree, { files: { 'two.txt': '2\n' } });
    await look(runner, 3);
    const held = await readHive(s.where, 'feature/two');
    expect(held).toMatchObject({
      step: 'reviewing',
      checks: [{ ok: true }],
      paused: { percent: 95 },
    });
    expect(s.reviewer.runs()).toBe(0);
    jump(2 * HOUR);
    s.usage.at(1, RESETS + 5 * HOUR);
    await look(runner, 3);
    expect(s.reviewer.runs()).toBe(1);
    expect(await readHive(s.where, 'feature/two')).toMatchObject({
      step: 'landing',
      reviews: [{ verdict: 'approved' }],
    });
  });

  it("holds the writer's start; the runner starts it after the reset, not as a restart", async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    s.usage.at(97, RESETS);
    await s.start('feature/held');
    expect(s.fake.start).not.toHaveBeenCalled();
    // Claude Code in auto, never started; Hive's record says why.
    const workspace = await readRecord(s.where, 'feature/held');
    expect(workspace.agent).toEqual({ kind: 'claude', permissionMode: 'auto' });
    expect(await readHive(s.where, 'feature/held')).toMatchObject({
      step: 'writing',
      unstarted: true,
      paused: { reason: 'usage', percent: 97, until: RESETS_AT },
    });
    expect(kinds(s.where, 'feature/held')).toEqual(['started', 'paused']);
    const runner = s.runner();
    await look(runner, 3);
    expect(s.fake.start).not.toHaveBeenCalled();
    jump(2 * HOUR);
    s.usage.at(2, RESETS + 5 * HOUR);
    await look(runner);
    expect(s.fake.start).toHaveBeenCalledTimes(1);
    expect(s.fake.start.mock.calls[0]?.[0]).toMatchObject({ permissionMode: 'auto' });
    expect(s.fake.start.mock.calls[0]?.[0].prompt).toContain('Hive drives this workspace.');
    const started = await readHive(s.where, 'feature/held');
    expect(started?.unstarted).toBeUndefined();
    expect(started?.paused).toBeUndefined();
    expect(started?.restarted).toBeUndefined();
    // Its turn is read from now: the first prompt is not "a turn Hive cannot see" (719).
    await look(runner, 2);
    expect((await readHive(s.where, 'feature/held'))?.step).toBe('writing');
    expect(kinds(s.where, 'feature/held')).toEqual([
      'started',
      'paused',
      'goes-on',
      'writer-started',
    ]);
  });

  it('interrupts no turn and no review already running', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/busy');
    const runner = s.runner();
    await look(runner);
    // The writer works: usage over the threshold stops nothing.
    s.usage.at(99, RESETS);
    await look(runner, 3);
    expect(s.fake.stop).not.toHaveBeenCalled();
    expect((await readHive(s.where, 'feature/busy'))?.paused).toBeUndefined();
    // A review started under the threshold runs to its end over it.
    s.usage.at(10, RESETS);
    const gate = join(cache, 'review-gate');
    s.reviewer.answers([{ gate }]);
    await s.fake.endTurn(worktree, { files: { 'busy.txt': '1\n' } });
    await runner.tick();
    for (let i = 0; i < 100 && s.reviewer.runs() === 0; i++) {
      await new Promise((done) => setTimeout(done, 50));
    }
    expect(s.reviewer.runs()).toBe(1);
    s.usage.at(99, RESETS);
    await runner.tick();
    writeFileSync(gate, '');
    await runner.idle();
    await look(runner);
    expect(await readHive(s.where, 'feature/busy')).toMatchObject({
      step: 'landing',
      reviews: [{ verdict: 'approved' }],
    });
  });
});

describe('the pause survives', () => {
  it('Hive off and on, and a new runner whose gate has not read usage', async () => {
    const repo = repository(['test -f fixed.txt']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/stays');
    const runner = s.runner();
    await look(runner);
    s.usage.at(93, RESETS);
    await s.fake.endTurn(worktree, { files: { 'a.txt': '1\n' } });
    await look(runner, 3);
    expect((await readHive(s.where, 'feature/stays'))?.paused).toMatchObject({ percent: 93 });
    // Off, then on: still paused, nothing sent.
    await s.turn(false, runner);
    await look(runner);
    await s.turn(true, runner);
    await look(runner, 2);
    expect(s.fake.resume).not.toHaveBeenCalled();
    expect((await readHive(s.where, 'feature/stays'))?.paused).toMatchObject({ percent: 93 });
    // A restart of symbiote view: a new runner, a new gate. Its record holds the pause until the
    // reset with no read, whatever a read would say.
    await runner.close();
    s.usage.at(5, RESETS);
    const reads = s.usage.reads();
    const again = s.runner();
    await look(again, 3);
    expect(s.fake.resume).not.toHaveBeenCalled();
    expect(s.usage.reads()).toBe(reads);
    expect((await readHive(s.where, 'feature/stays'))?.paused).toMatchObject({ percent: 93 });
    jump(2 * HOUR);
    await look(again, 2);
    expect(s.fake.resume).toHaveBeenCalledTimes(1);
  });

  it("not the person's message: Hive's waiting one is dropped and the rounds start again", async () => {
    const repo = repository(['test -f fixed.txt']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/person');
    const runner = s.runner();
    await look(runner);
    s.usage.at(91, RESETS);
    await s.fake.endTurn(worktree, { files: { 'a.txt': '1\n' } });
    await look(runner, 3);
    expect((await readHive(s.where, 'feature/person'))?.message?.key).toBe('hive.check');
    await s.service.reply({ branch: 'feature/person', text: 'Add fixed.txt, please.' });
    await look(runner, 2);
    const record = await readHive(s.where, 'feature/person');
    expect(record).toMatchObject({ step: 'writing', round: 1 });
    expect(record?.message).toBeUndefined();
    expect(record?.paused).toBeUndefined();
    // Only the person's message reached the writer.
    expect(s.fake.resume).toHaveBeenCalledTimes(1);
    expect(s.fake.resume.mock.calls[0]?.[0].text).toBe('Add fixed.txt, please.');
  });
});

describe('usage that cannot be read', () => {
  it('the last read stands for 15 minutes; then Hive pauses with "usage unknown" until a read succeeds', async () => {
    const repo = repository(['test -f fixed.txt']);
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/blind');
    const runner = s.runner();
    await look(runner);
    // Read at 14:00 at 10 %; every read since fails with a 429.
    const read = at;
    s.usage.answer(() => ({
      subscription: claudeAt(10, read, RESETS),
      failed: "Claude's usage asked to wait (429)",
    }));
    jump(10 * MIN);
    await s.fake.endTurn(worktree, { files: { 'a.txt': '1\n' } });
    await look(runner, 2);
    expect(s.fake.resume).toHaveBeenCalledTimes(1);
    jump(6 * MIN);
    await s.fake.endTurn(worktree, { files: { 'b.txt': '1\n' } });
    await look(runner, 3);
    expect(s.fake.resume).toHaveBeenCalledTimes(1);
    expect((await readHive(s.where, 'feature/blind'))?.paused).toEqual({
      reason: 'unknown',
      pauseAt: 90,
      why: "Claude's usage asked to wait (429)",
      since: expect.any(String) as unknown,
    });
    s.usage.at(30, RESETS);
    await look(runner, 2);
    expect(s.fake.resume).toHaveBeenCalledTimes(2);
    expect((await readHive(s.where, 'feature/blind'))?.paused).toBeUndefined();
  });

  it('never read: no writer starts until a read succeeds', async () => {
    const repo = repository(['true']);
    const s = await setup(repo);
    await s.turn(true);
    s.usage.answer(() => ({ subscription: null, failed: "Claude Code's token could not be read" }));
    await s.start('feature/never');
    expect(s.fake.start).not.toHaveBeenCalled();
    expect(await readHive(s.where, 'feature/never')).toMatchObject({
      unstarted: true,
      paused: { reason: 'unknown', why: "Claude Code's token could not be read" },
    });
    s.usage.at(20, RESETS);
    await look(s.runner());
    expect(s.fake.start).toHaveBeenCalledTimes(1);
  });
});

describe('the budget', () => {
  it('stops the workspace with why once its spend reaches it, before the next start', async () => {
    const repo = repository(['test -f fixed.txt'], { budget: 1 });
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/budget');
    const runner = s.runner();
    await look(runner);
    // $0.70 by Claude Code's count after the first turn: the check's failure goes.
    await s.fake.endTurn(worktree, { files: { 'a.txt': '1\n' }, cost: 0.7 });
    await look(runner, 2);
    expect(s.fake.resume).toHaveBeenCalledTimes(1);
    expect((await readHive(s.where, 'feature/budget'))?.spent).toMatchObject({ writer: 0.7 });
    // $1.20 after the second: no third turn.
    await s.fake.endTurn(worktree, { files: { 'b.txt': '1\n' }, cost: 1.2 });
    await look(runner, 3);
    expect(s.fake.resume).toHaveBeenCalledTimes(1);
    const stuck = await readHive(s.where, 'feature/budget');
    expect(stuck).toMatchObject({ step: 'stuck', spent: { writer: 1.2 } });
    expect(stuck?.message).toBeUndefined();
    expect(stuck?.note).toBe(
      'its spend reached its budget: $1.20 of $1.00 (the writer $1.20, no review). Raise the budget in Settings, then send it a message to go on',
    );
    expect(events(s.where, 'feature/budget').at(-1)).toMatchObject({
      kind: 'stuck',
      spent: 1.2,
      budget: 1,
    });
    // The Review tab says what it spent.
    const detail = await hiveWorkspace(s.git, cache, { hive: s.hive }).detail('feature/budget');
    expect(detail?.spend).toEqual({ writer: 1.2, reviews: 0, reviewed: 0, total: 1.2, budget: 1 });
  });

  it("counts the running reviews' cost: the next start after them is stopped", async () => {
    const repo = repository(['true'], { budget: 1 });
    const s = await setup(repo);
    await s.turn(true);
    const worktree = await s.start('feature/reviews');
    const runner = s.runner();
    await look(runner);
    s.reviewer.answers([{ cost: 0.6 }]);
    // The second commit lands after the approval: checked again, and its review is not started.
    await s.fake.endTurn(worktree, { files: { 'a.txt': '1\n' }, cost: 0.3 });
    await look(runner, 3);
    expect(await readHive(s.where, 'feature/reviews')).toMatchObject({ step: 'landing' });
    await s.fake.endTurn(worktree, { files: { 'b.txt': '1\n' }, cost: 0.45 });
    await look(runner, 3);
    expect(s.reviewer.runs()).toBe(1);
    expect(await readHive(s.where, 'feature/reviews')).toMatchObject({
      step: 'stuck',
      note: 'its spend reached its budget: $1.05 of $1.00 (the writer $0.45, 1 review $0.60). Raise the budget in Settings, then send it a message to go on',
    });
  });
});

describe('under the threshold with no budget', () => {
  /** One workspace through a failed check, a fix, a passing check and an approving review. */
  async function run(paced: boolean) {
    const repo = repository(['test -f fixed.txt']);
    const s = await setup(repo, { paced });
    // The fake reviewer's count is the test's cache's: this run's from here.
    const before = s.reviewer.runs();
    await s.turn(true);
    const worktree = await s.start('feature/same');
    const runner = s.runner();
    await look(runner);
    await s.fake.endTurn(worktree, { files: { 'a.txt': '1\n' } });
    await look(runner, 2);
    await s.fake.endTurn(worktree, { files: { 'fixed.txt': '1\n' } });
    await look(runner, 3);
    const record = await readHive(s.where, 'feature/same');
    return {
      kinds: kinds(s.where, 'feature/same'),
      step: record?.step,
      round: record?.round,
      keys: Object.keys(record ?? {}).sort(),
      starts: s.fake.start.mock.calls.length,
      // Commits differ by their time: their SHAs are left out.
      resumes: s.fake.resume.mock.calls.map((c) =>
        c[0].text.replace(/\b[0-9a-f]{7,40}\b/g, '<sha>'),
      ),
      reviews: s.reviewer.runs() - before,
    };
  }

  it('gives the same steps, events and messages as no gate at all', async () => {
    const without = await run(false);
    const withGate = await run(true);
    expect(withGate).toEqual(without);
    expect(without).toMatchObject({ step: 'landing', round: 2, starts: 1, reviews: 1 });
  });
});
