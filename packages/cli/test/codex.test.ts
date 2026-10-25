import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThreadEntry } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import type { CodexThread } from '../src/app-server.js';
import {
  asksTrust,
  codex,
  codexArgs,
  codexState,
  parseCodexAccount,
  parseDaemon,
  serverEntries,
  serverState,
  type DetachedRun,
} from '../src/codex.js';
import { runCodex } from '../src/codex-run.js';
import type { WorkspaceFile } from '../src/workspace-record.js';
import type { Run } from '../src/programs.js';
import { daemonStartOutput, fakeAppServer } from './fake-app-server.js';

const RUNNER = fileURLToPath(new URL('../src/codex-run.ts', import.meta.url));

const folders: string[] = [];
let dir: string;
beforeEach(() => {
  dir = tempDir();
  folders.push(dir);
});
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/**
 * A fake Codex: prints the events of `script.json` as JSONL (each after `delay` ms), writes its
 * `stderr`, then exits with `exit`; with `hang`, it waits to be stopped after its events.
 */
function fakeCodex(script: {
  events: unknown[];
  stderr?: string;
  exit?: number;
  hang?: boolean;
  delay?: number;
}): string {
  const file = join(dir, 'script.json');
  writeFileSync(file, JSON.stringify(script));
  const fake = join(dir, 'codex.js');
  writeFileSync(
    fake,
    `const s = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(file)}, 'utf8'));
process.stderr.write('Reading additional input from stdin...\\n');
let i = 0;
const next = () => {
  if (i < s.events.length) {
    const e = s.events[i++];
    process.stdout.write((typeof e === 'string' ? e : JSON.stringify(e)) + '\\n');
    return setTimeout(next, s.delay || 0);
  }
  if (s.stderr) process.stderr.write(s.stderr);
  if (s.hang) return setInterval(() => {}, 1000);
  process.exit(s.exit || 0);
};
next();
`,
  );
  return fake;
}

const thread = () => join(dir, 'symbiote', 'threads', 'feature', 'csv.jsonl');
const entries = (): ThreadEntry[] =>
  existsSync(thread())
    ? readFileSync(thread(), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as ThreadEntry)
    : [];
const AT = '2026-10-19T12:00:00.000Z';
const T = '01a1552c-bfcb-76b1-8112-774913d628c1';

/** Codex 0.163's stream for a finished turn, as recorded in the V20a spike. */
const TURN = [
  { type: 'thread.started', thread_id: T },
  { type: 'turn.started' },
  {
    type: 'item.completed',
    item: { id: 'item_0', type: 'agent_message', text: 'I’ll read the brief first.' },
  },
  {
    type: 'item.started',
    item: { id: 'item_1', type: 'command_execution', command: 'cat a', status: 'in_progress' },
  },
  {
    type: 'item.completed',
    item: { id: 'item_1', type: 'command_execution', command: 'cat a', exit_code: 0 },
  },
  { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: '1. Plan.' } },
  { type: 'turn.completed', usage: { input_tokens: 30853, output_tokens: 181 } },
];

const activity = () => join(dir, 'symbiote', 'activity', 'feature', 'csv.jsonl');
const run = (source: 'startup' | 'resume', prompt = 'Build it') =>
  runCodex(
    {
      thread: thread(),
      activity: activity(),
      source,
      run: 'r1',
      command: process.execPath,
      args: [join(dir, 'codex.js'), 'exec', '--json', '--', prompt],
    },
    { now: () => AT, worktree: '/w/feature-csv' },
  );

describe('runCodex (V20a)', () => {
  it('records a turn: its start, what it was given, its last message as the report, its end', async () => {
    fakeCodex({ events: TURN });
    expect(await run('startup').done).toBe(0);
    expect(entries()).toEqual([
      { at: AT, session: T, run: 'r1', kind: 'start', source: 'startup' },
      { at: AT, session: T, run: 'r1', kind: 'prompt', text: 'Build it' },
      { at: AT, session: T, run: 'r1', kind: 'report', text: '1. Plan.' },
      { at: AT, session: T, run: 'r1', kind: 'end', reason: 'completed' },
    ]);
  });

  it("writes what Codex runs and changes to the workspace's activity, not its thread (V48f)", async () => {
    fakeCodex({
      events: [
        { type: 'thread.started', thread_id: T },
        { type: 'turn.started' },
        {
          type: 'item.started',
          item: {
            id: 'c1',
            type: 'command_execution',
            command: 'cargo test\n--all',
            status: 'in_progress',
          },
        },
        {
          type: 'item.completed',
          item: { id: 'c1', type: 'command_execution', command: 'cargo test', exit_code: 101 },
        },
        {
          type: 'item.completed',
          item: {
            id: 'f1',
            type: 'file_change',
            changes: [{ path: '/w/feature-csv/src/lib.rs', kind: 'update' }],
            status: 'completed',
          },
        },
        { type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'Thinking' } },
        { type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'Done.' } },
        { type: 'turn.completed' },
      ],
    });
    expect(await run('startup').done).toBe(0);
    const lines = readFileSync(activity(), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as unknown);
    const head = { at: AT, session: T, run: 'r1' };
    const command = { ...head, id: 'c1', tool: 'command', subject: 'cargo test' };
    const change = { ...head, id: 'f1', tool: 'fileChange', subject: 'src/lib.rs' };
    expect(lines).toEqual([
      { ...command, phase: 'start' },
      { ...command, phase: 'end', failed: true },
      { ...change, phase: 'start' },
      { ...change, phase: 'end' },
    ]);
    expect(entries().map((e) => e.kind)).toEqual(['start', 'prompt', 'report', 'end']);
  });

  it('appends a resumed turn to the thread, as resumed', async () => {
    fakeCodex({ events: TURN });
    await run('startup').done;
    await run('resume', 'Go ahead').done;
    expect(
      entries().map((e) => [e.kind, 'source' in e ? e.source : 'text' in e ? e.text : '']),
    ).toEqual([
      ['start', 'startup'],
      ['prompt', 'Build it'],
      ['report', '1. Plan.'],
      ['end', ''],
      ['start', 'resume'],
      ['prompt', 'Go ahead'],
      ['report', '1. Plan.'],
      ['end', ''],
    ]);
  });

  it("ends a failed turn with Codex's words: the turn's failure, else its last error, else its output", async () => {
    fakeCodex({
      events: [
        { type: 'thread.started', thread_id: T },
        { type: 'turn.started' },
        { type: 'error', message: 'Reconnecting... 2/5 (unexpected status 401 Unauthorized)' },
        { type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } },
      ],
      exit: 1,
    });
    expect(await run('startup').done).toBe(1);
    expect(entries().at(-1)).toEqual({
      at: AT,
      session: T,
      run: 'r1',
      kind: 'end',
      reason: 'unexpected status 401 Unauthorized',
    });

    rmSync(thread());
    fakeCodex({
      events: [
        { type: 'thread.started', thread_id: T },
        { type: 'error', message: 'stream lost' },
      ],
      exit: 1,
    });
    await run('startup').done;
    expect(entries().at(-1)).toMatchObject({ kind: 'end', reason: 'stream lost' });

    rmSync(thread());
    fakeCodex({ events: [], stderr: 'Error: unknown thread\nUsage: codex exec resume\n', exit: 2 });
    await run('resume').done;
    // No session started: the end has none; Codex's notice about stdin is not its words.
    expect(entries()).toEqual([
      {
        at: AT,
        session: '',
        run: 'r1',
        kind: 'end',
        reason: 'Error: unknown thread\nUsage: codex exec resume',
      },
    ]);

    rmSync(thread());
    fakeCodex({ events: [], exit: 3 });
    await run('startup').done;
    expect(entries()).toEqual([
      { at: AT, session: '', run: 'r1', kind: 'end', reason: 'Codex exited with code 3' },
    ]);
  });

  it('skips lines that are not events, and a turn with no message reports nothing', async () => {
    fakeCodex({
      events: [
        'not json',
        { type: 'thread.started', thread_id: T },
        { type: 'turn.started' },
        { type: 'turn.completed' },
      ],
    });
    await run('startup').done;
    expect(entries().map((e) => e.kind)).toEqual(['start', 'prompt', 'end']);
  });

  it('ends as stopped when asked to stop, and Codex with it', async () => {
    fakeCodex({
      events: [{ type: 'thread.started', thread_id: T }, { type: 'turn.started' }],
      hang: true,
    });
    const running = run('startup');
    await vi.waitFor(() => expect(entries().map((e) => e.kind)).toEqual(['start', 'prompt']));
    running.stop();
    expect(await running.done).not.toBe(0);
    expect(entries().at(-1)).toEqual({
      at: AT,
      session: T,
      run: 'r1',
      kind: 'end',
      reason: 'stopped',
    });
  });

  it('says when Codex cannot be run', async () => {
    const running = runCodex(
      {
        thread: thread(),
        source: 'startup',
        run: 'r1',
        command: join(dir, 'missing'),
        args: ['exec', 'hi'],
      },
      { now: () => AT },
    );
    expect(await running.done).toBe(1);
    expect(entries()).toEqual([
      expect.objectContaining({
        session: '',
        kind: 'end',
        reason: expect.stringMatching(/^could not run .*missing/) as string,
      }),
    ]);
  });

  it('runs as its own program, detached, and stops with its process group', async () => {
    fakeCodex({
      events: [{ type: 'thread.started', thread_id: T }, { type: 'turn.started' }],
      hang: true,
    });
    const child = spawn(
      process.execPath,
      [
        RUNNER,
        thread(),
        activity(),
        'startup',
        'r1',
        process.execPath,
        join(dir, 'codex.js'),
        'exec',
        'Build it',
      ],
      { cwd: dir, detached: true, stdio: 'ignore' },
    );
    child.unref();
    const pid = child.pid as number;
    const agent = codex('codex', { runner: RUNNER });
    await vi.waitFor(() => expect(entries().map((e) => e.kind)).toEqual(['start', 'prompt']), {
      timeout: 5_000,
    });
    expect(agent.alive(pid)).toBe(true);
    await agent.stop(pid);
    expect(agent.alive(pid)).toBe(false);
    expect(entries().at(-1)).toMatchObject({ kind: 'end', reason: 'stopped' });
  });
});

describe('codexArgs (V20a)', () => {
  const roots = ['/r/.git/worktrees/feature-csv', '/r/.git/objects', '/r/.git/refs/heads/feature'];
  it('starts in the worktree, sandboxed to it, its git folders writable; the prompt after --', () => {
    expect(codexArgs({ cwd: '/w/feature-csv', writable: roots, prompt: '-p' })).toEqual([
      'exec',
      '--json',
      '-C',
      '/w/feature-csv',
      '-s',
      'workspace-write',
      '-c',
      'sandbox_workspace_write.writable_roots=["/r/.git/worktrees/feature-csv","/r/.git/objects","/r/.git/refs/heads/feature"]',
      '--',
      '-p',
    ]);
  });

  it('resumes a thread with the same sandbox: a resume keeps none of the first options', () => {
    expect(codexArgs({ writable: ['C:\\r\\"x"'], sessionId: T, prompt: 'Go ahead' })).toEqual([
      'exec',
      'resume',
      '--json',
      '-c',
      'sandbox_mode="workspace-write"',
      '-c',
      'sandbox_workspace_write.writable_roots=["C:\\\\r\\\\\\"x\\""]',
      '--',
      T,
      'Go ahead',
    ]);
  });

  it('gives an effort level on the start and on every resume, which keeps none (V30b)', () => {
    const start = codexArgs({ cwd: '/w', writable: ['/g'], prompt: 'P', effort: 'low' });
    expect(start.slice(start.indexOf('-c', 6), -2)).toEqual([
      '-c',
      'sandbox_workspace_write.writable_roots=["/g"]',
      '-c',
      'model_reasoning_effort="low"',
    ]);
    const resume = codexArgs({ writable: ['/g'], sessionId: T, prompt: 'Go', effort: 'xhigh' });
    expect(resume.slice(-5)).toEqual(['-c', 'model_reasoning_effort="xhigh"', '--', T, 'Go']);
    // None given: Codex's own, as before.
    expect(codexArgs({ cwd: '/w', writable: ['/g'], prompt: 'P' }).join(' ')).not.toContain(
      'model_reasoning_effort',
    );
  });

  it('gives a model on the start and on every resume, before what it is given (V47)', () => {
    const start = codexArgs({ cwd: '/w', writable: ['/g'], prompt: 'P', model: 'gpt-5.6-luna' });
    expect(start.slice(-4)).toEqual(['-m', 'gpt-5.6-luna', '--', 'P']);
    const resume = codexArgs({
      writable: ['/g'],
      sessionId: T,
      prompt: 'Go',
      effort: 'low',
      model: 'gpt-5.6-luna',
    });
    expect(resume.slice(-7)).toEqual([
      '-c',
      'model_reasoning_effort="low"',
      '-m',
      'gpt-5.6-luna',
      '--',
      T,
      'Go',
    ]);
    // None given: Codex's configured one, as before.
    expect(codexArgs({ cwd: '/w', writable: ['/g'], prompt: 'P' })).not.toContain('-m');
  });
});

describe('codex (V20a)', () => {
  it('starts and resumes through the runner, detached in the worktree; the process ID', async () => {
    const detached = vi.fn<DetachedRun>(() => Promise.resolve(4242));
    const agent = codex('/usr/bin/codex', {
      runner: '/opt/symbiote/dist/codex-run.js',
      node: '/usr/bin/node',
      detach: detached,
    });
    expect(
      await agent.start({
        cwd: '/w/x',
        thread: '/r/symbiote/threads/x.jsonl',
        activity: '/r/symbiote/activity/x.jsonl',
        run: 'r1',
        writable: ['/g'],
        prompt: 'P',
      }),
    ).toEqual({ ok: true, pid: 4242 });
    expect(detached).toHaveBeenLastCalledWith(
      '/usr/bin/node',
      [
        '/opt/symbiote/dist/codex-run.js',
        '/r/symbiote/threads/x.jsonl',
        '/r/symbiote/activity/x.jsonl',
        'startup',
        'r1',
        '/usr/bin/codex',
        ...codexArgs({ cwd: '/w/x', writable: ['/g'], prompt: 'P' }),
      ],
      '/w/x',
    );
    await agent.resume({
      cwd: '/w/x',
      thread: '/r/symbiote/threads/x.jsonl',
      activity: '/r/symbiote/activity/x.jsonl',
      run: 'r2',
      writable: ['/g'],
      sessionId: T,
      text: 'Go',
    });
    expect(detached.mock.lastCall?.[1].slice(1, 5)).toEqual([
      '/r/symbiote/threads/x.jsonl',
      '/r/symbiote/activity/x.jsonl',
      'resume',
      'r2',
    ]);
    expect(detached.mock.lastCall?.[1].slice(6)).toEqual(
      codexArgs({ writable: ['/g'], sessionId: T, prompt: 'Go' }),
    );
    const failing = codex('/usr/bin/codex', {
      runner: '/r.js',
      detach: () => Promise.reject(new Error('spawn EACCES')),
    });
    expect(
      await failing.start({
        cwd: '/w/x',
        thread: '/t',
        activity: '/a',
        run: 'r1',
        writable: [],
        prompt: 'P',
      }),
    ).toEqual({
      ok: false,
      error: 'spawn EACCES',
    });
  });

  it("says whose account, and archives a thread with Codex's command", async () => {
    const calls: string[][] = [];
    let answer = { code: 0 as number | null, stdout: '', stderr: 'Logged in using ChatGPT\n' };
    const run: Run = (_command, args) => {
      calls.push(args);
      return Promise.resolve(answer);
    };
    const agent = codex('/usr/bin/codex', { runner: '/r.js', run, cwd: '/repo' });
    expect(await agent.account()).toBe('your ChatGPT account');
    answer = { code: 0, stdout: '', stderr: `Archived session ${T}.\n` };
    await agent.archive(T);
    expect(calls).toEqual([
      ['login', 'status'],
      ['archive', T],
    ]);
  });
});

describe('parseCodexAccount (V20a)', () => {
  it('reads `codex login status`', () => {
    expect(parseCodexAccount({ code: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' })).toBe(
      'your ChatGPT account',
    );
    expect(
      parseCodexAccount({ code: 0, stdout: '', stderr: 'Logged in using an API key - sk-***\n' }),
    ).toBe('an API key');
    expect(parseCodexAccount({ code: 1, stdout: '', stderr: 'Not logged in\n' })).toBe(
      'not logged in',
    );
    expect(parseCodexAccount({ code: 0, stdout: '', stderr: 'Something else\n' })).toBeUndefined();
    expect(parseCodexAccount({ code: null, stdout: '', stderr: 'spawn ENOENT' })).toBeUndefined();
  });
});

describe('codexState (V20a)', () => {
  const STARTED = '2026-10-19T12:00:00.000Z';
  const workspace = (over: Partial<WorkspaceFile> = {}): WorkspaceFile => ({
    agent: { kind: 'codex', started: STARTED, run: 'r1', pid: 4242 },
    base: 'a'.repeat(40),
    branch: 'feature/csv',
    brief: 'Export a review as CSV',
    created: STARTED,
    planFirst: true,
    worktree: '/w/feature-csv',
    ...over,
  });
  const at = (minutes: number) => new Date(Date.parse(STARTED) + minutes * 60_000).toISOString();
  const e = (minutes: number, entry: Record<string, unknown>, run = 'r1') =>
    ({ at: at(minutes), session: T, run, ...entry }) as ThreadEntry;
  const started = [e(0, { kind: 'start', source: 'startup' }), e(0, { kind: 'prompt', text: 'P' })];

  it('reads a run that lives as working, before its first event too', () => {
    expect(codexState(workspace(), [], true, 0)).toEqual({ state: 'working', kind: 'codex' });
    expect(codexState(workspace(), started, true, 0)).toEqual({
      state: 'working',
      kind: 'codex',
      id: T,
    });
  });

  it("reads a finished turn by the branch's commits, as Claude Code's", () => {
    const done = [
      ...started,
      e(1, { kind: 'report', text: 'Plan' }),
      e(1, { kind: 'end', reason: 'completed' }),
    ];
    expect(codexState(workspace(), done, false, 0)).toEqual({
      state: 'plan-ready',
      kind: 'codex',
      id: T,
    });
    expect(codexState(workspace(), done, false, 2).state).toBe('ready');
    expect(codexState(workspace({ planFirst: false }), done, false, 0).state).toBe('done');
    // A run that ended normally ended, whatever its old process ID now is.
    expect(codexState(workspace(), done, true, 0).state).toBe('plan-ready');
  });

  it('reads a stop, a failure with its reason, and an end without a word', () => {
    const ended = (reason: string) => [...started, e(1, { kind: 'end', reason })];
    expect(codexState(workspace(), ended('stopped'), false, 0)).toEqual({
      state: 'stopped',
      kind: 'codex',
      id: T,
    });
    expect(codexState(workspace(), ended('unexpected status 401'), false, 0)).toEqual({
      state: 'failed',
      kind: 'codex',
      id: T,
      error: 'unexpected status 401',
    });
    expect(
      codexState(workspace(), [...started, e(1, { kind: 'report', text: 'Plan' })], false, 0).state,
    ).toBe('plan-ready');
    expect(codexState(workspace(), started, false, 0)).toEqual({
      state: 'failed',
      kind: 'codex',
      id: T,
      error: 'Codex ended without a word',
    });
  });

  it('reads only the last run: an earlier end does not end a new one', () => {
    const before = [
      ...started,
      e(1, { kind: 'report', text: 'Plan' }),
      e(1, { kind: 'end', reason: 'completed' }),
    ];
    // The same millisecond as the earlier end: runs are told apart by their IDs, not their times.
    const again = workspace({ agent: { kind: 'codex', started: at(1), run: 'r2', pid: 4343 } });
    expect(codexState(again, before, true, 0)).toEqual({ state: 'working', kind: 'codex', id: T });
    const resumed = [
      ...before,
      e(1, { kind: 'start', source: 'resume' }, 'r2'),
      e(2, { kind: 'end', reason: 'stopped' }, 'r2'),
    ];
    expect(codexState(again, resumed, false, 0).state).toBe('stopped');
  });

  it('says when it did not start', () => {
    const failed = workspace({ agent: { kind: 'codex', error: 'Codex is not logged in' } });
    expect(codexState(failed, [], false, 0)).toEqual({
      state: 'not-started',
      kind: 'codex',
      error: 'Codex is not logged in',
    });
  });
});

describe('parseDaemon (V27a)', () => {
  it("reads the daemon's socket from `codex app-server daemon start`, after its log lines", () => {
    const socket = '/home/someone/.codex/app-server-control/app-server-control.sock';
    for (const status of ['started', 'alreadyRunning', 'running']) {
      expect(parseDaemon({ code: 0, stdout: daemonStartOutput(socket, status), stderr: '' })).toBe(
        socket,
      );
    }
    // Codex's warnings go to stderr; its JSON is the last line of stdout.
    expect(
      parseDaemon({ code: 0, stdout: daemonStartOutput(socket), stderr: 'WARNING: proceeding\n' }),
    ).toBe(socket);
  });

  it('none when it failed, said something else, or is too old to have a daemon', () => {
    const socket = '/s.sock';
    expect(parseDaemon({ code: 1, stdout: daemonStartOutput(socket), stderr: '' })).toBeNull();
    expect(
      parseDaemon({ code: 0, stdout: daemonStartOutput(socket, 'stopped'), stderr: '' }),
    ).toBeNull();
    expect(parseDaemon({ code: 0, stdout: 'started\n', stderr: '' })).toBeNull();
    expect(
      parseDaemon({ code: 2, stdout: '', stderr: "error: unrecognized subcommand 'daemon'" }),
    ).toBeNull();
    expect(parseDaemon({ code: null, stdout: '', stderr: 'timed out' })).toBeNull();
  });
});

describe('codex server (V27a)', () => {
  /** A fake `run` answering `daemon start` with `socket`, or failing. */
  type Ran = Awaited<ReturnType<Run>>;
  const daemon = (answer: () => Ran | Promise<Ran>) => {
    const calls: string[][] = [];
    const run: Run = (_command, args) => {
      calls.push(args);
      return Promise.resolve(answer());
    };
    return { calls, run };
  };

  it("finds the person's daemon once, with `daemon start` (it runs, or starts)", async () => {
    const path = join(dir, 's.sock');
    const server = await fakeAppServer(path);
    try {
      const { calls, run } = daemon(() => ({
        code: 0,
        stdout: daemonStartOutput(path),
        stderr: '',
      }));
      const agent = codex('/usr/bin/codex', { runner: '/r.js', run, cwd: '/repo' });
      const found = await agent.server();
      expect(found?.address).toBe(`unix://${path}`);
      expect(await agent.server()).toBe(found);
      expect(calls).toEqual([['app-server', 'daemon', 'start']]);
      const thread = await found?.start({ cwd: '/w', writable: [], name: 'b', prompt: 'P' });
      expect(server.thread(thread ?? '').cwd).toBe('/w');
    } finally {
      await server.close();
    }
  });

  it('none when Codex starts no daemon, asked again a minute later', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { calls, run } = daemon(() => ({
      code: 2,
      stdout: '',
      stderr: 'unrecognized subcommand',
    }));
    const agent = codex('/usr/bin/codex', { runner: '/r.js', run, cwd: '/repo' });
    expect(await agent.server()).toBeNull();
    now = 30_000;
    expect(await agent.server()).toBeNull();
    expect(calls).toHaveLength(1);
    now = 61_000;
    expect(await agent.server()).toBeNull();
    expect(calls).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it('starts the daemon again when its socket stops answering, and asks once more', async () => {
    const path = join(dir, 's.sock');
    let server = await fakeAppServer(path);
    const { calls, run } = daemon(async () => {
      // The second `daemon start` answers once a new server listens on the same socket.
      if (calls.length === 2) server = await fakeAppServer(path);
      return {
        code: 0,
        stdout: daemonStartOutput(path, calls.length === 2 ? 'started' : 'alreadyRunning'),
        stderr: '',
      };
    });
    const agent = codex('/usr/bin/codex', { runner: '/r.js', run, cwd: '/repo' });
    const found = await agent.server();
    await server.close();
    // The daemon is gone: started again, then the thread is unknown to the new one (an answer).
    const read = found?.read('thread-1', { turns: 1, items: 'summary' });
    await expect(read).rejects.toThrow('thread not found: thread-1');
    expect(calls).toHaveLength(2);
    await server.close();
  });
});

describe('serverEntries (V27a)', () => {
  const t0 = Date.parse('2026-10-20T10:00:00.000Z') / 1000;
  const iso = (s: number) => new Date((t0 + s) * 1000).toISOString();
  const read = (over: Partial<CodexThread> = {}): CodexThread => ({
    id: T,
    createdAt: t0,
    updatedAt: t0 + 100,
    status: 'idle',
    turns: [],
    ...over,
  });

  it("makes V18c's entries of a thread's turns: a start, each message, each answer, the ends", () => {
    const entries = serverEntries(
      read({
        turns: [
          {
            id: 'a',
            status: 'completed',
            startedAt: t0,
            completedAt: t0 + 5,
            prompts: ['P'],
            report: '1. Plan',
            final: true,
          },
          {
            id: 'b',
            status: 'completed',
            startedAt: t0 + 60,
            completedAt: t0 + 70,
            prompts: ['Go', 'And test it'],
            report: 'Done',
            final: true,
          },
          {
            id: 'c',
            status: 'interrupted',
            startedAt: t0 + 80,
            completedAt: t0 + 81,
            prompts: ['More'],
          },
          {
            id: 'd',
            status: 'failed',
            startedAt: t0 + 90,
            completedAt: t0 + 91,
            prompts: ['Again'],
            error: '401',
          },
        ],
      }),
    );
    const head = { session: T };
    expect(entries).toEqual([
      { ...head, at: iso(0), kind: 'start', source: 'startup' },
      { ...head, at: iso(0), kind: 'prompt', text: 'P' },
      { ...head, at: iso(5), kind: 'report', text: '1. Plan' },
      { ...head, at: iso(60), kind: 'prompt', text: 'Go' },
      { ...head, at: iso(60), kind: 'prompt', text: 'And test it' },
      { ...head, at: iso(70), kind: 'report', text: 'Done' },
      { ...head, at: iso(80), kind: 'prompt', text: 'More' },
      { ...head, at: iso(81), kind: 'end', reason: 'stopped' },
      { ...head, at: iso(90), kind: 'prompt', text: 'Again' },
      { ...head, at: iso(91), kind: 'end', reason: '401' },
    ]);
  });

  it("shows what a waiting turn last said, when it waits; a working turn's words are not a report", () => {
    const turn = {
      id: 'a',
      status: 'inProgress',
      startedAt: t0,
      prompts: ['P'],
      report: 'May I run pnpm install?',
    };
    expect(
      serverEntries(read({ status: 'active', waiting: 'approval', turns: [turn] })).at(-1),
    ).toEqual({
      session: T,
      at: iso(100),
      kind: 'report',
      text: 'May I run pnpm install?',
    });
    expect(serverEntries(read({ status: 'active', turns: [turn] })).map((e) => e.kind)).toEqual([
      'start',
      'prompt',
    ]);
  });

  it('starts with the thread only when its first turn is there', () => {
    const later = {
      id: 'z',
      status: 'completed',
      startedAt: t0 + 900,
      completedAt: t0 + 901,
      prompts: ['Late'],
      report: 'OK',
      final: true as const,
    };
    expect(serverEntries(read({ turns: [later] }), { first: false }).map((e) => e.kind)).toEqual([
      'prompt',
      'report',
    ]);
  });
});

describe('serverState (V27a)', () => {
  const STARTED = '2026-10-20T10:00:00.000Z';
  const ADDRESS = 'unix:///home/someone/.codex/app-server-control/app-server-control.sock';
  const workspace = (over: Partial<WorkspaceFile> = {}): WorkspaceFile => ({
    agent: { kind: 'codex', started: STARTED, thread: T },
    base: 'a'.repeat(40),
    branch: 'feature/csv',
    brief: 'Export a review as CSV',
    created: STARTED,
    planFirst: true,
    worktree: '/w/feature-csv',
    ...over,
  });
  const turn = (status: string, over: Record<string, unknown> = {}) => ({
    id: 't',
    status,
    startedAt: 1,
    prompts: ['P'],
    ...over,
  });
  const read = (
    status: string,
    turns: ReturnType<typeof turn>[],
    waiting?: 'approval' | 'input',
  ): CodexThread => ({
    id: T,
    createdAt: 1,
    updatedAt: 2,
    status,
    ...(waiting ? { waiting } : {}),
    turns,
  });
  const head = { kind: 'codex', id: T, remote: ADDRESS };

  it('reads an active thread as working, or as needing the person when it waits', () => {
    expect(serverState(workspace(), read('active', [turn('inProgress')]), 0, ADDRESS)).toEqual({
      state: 'working',
      ...head,
    });
    expect(
      serverState(workspace(), read('active', [turn('inProgress')], 'approval'), 0, ADDRESS),
    ).toEqual({
      state: 'needs-you',
      ...head,
      waitingFor: 'approval prompt',
    });
    expect(
      serverState(workspace(), read('active', [turn('inProgress')], 'input'), 0, ADDRESS)
        .waitingFor,
    ).toBe('question');
  });

  it("reads its last turn once idle: finished by the branch's commits, stopped, or failed in Codex's words", () => {
    const idle = (t: ReturnType<typeof turn>) => read('idle', [turn('completed'), t]);
    expect(serverState(workspace(), idle(turn('completed')), 0, ADDRESS).state).toBe('plan-ready');
    expect(serverState(workspace(), idle(turn('completed')), 2, ADDRESS).state).toBe('ready');
    expect(
      serverState(workspace({ planFirst: false }), idle(turn('completed')), 0, ADDRESS).state,
    ).toBe('done');
    expect(serverState(workspace(), idle(turn('interrupted')), 0, ADDRESS)).toEqual({
      state: 'stopped',
      ...head,
    });
    expect(
      serverState(
        workspace(),
        idle(turn('failed', { error: 'unexpected status 401' })),
        0,
        ADDRESS,
      ),
    ).toEqual({
      state: 'failed',
      ...head,
      error: 'unexpected status 401',
    });
    // The server restarted: its threads are not loaded, their last turns say what happened.
    expect(
      serverState(workspace(), read('notLoaded', [turn('interrupted')]), 0, ADDRESS).state,
    ).toBe('stopped');
    expect(serverState(workspace(), read('notLoaded', [turn('completed')]), 0, ADDRESS).state).toBe(
      'plan-ready',
    );
  });

  it('says when its thread has no turn, broke, or cannot be read', () => {
    expect(serverState(workspace(), read('idle', []), 0, ADDRESS)).toEqual({
      state: 'failed',
      ...head,
      error: 'Codex ended without a word',
    });
    expect(serverState(workspace(), read('systemError', [turn('inProgress')]), 0, ADDRESS)).toEqual(
      {
        state: 'failed',
        ...head,
        error: "Codex's app server reported an error on its thread",
      },
    );
    expect(serverState(workspace(), new Error('thread not found: x'), 0, ADDRESS)).toEqual({
      state: 'unknown',
      ...head,
      error: "Codex's app server: thread not found: x",
    });
    expect(serverState(workspace(), new Error('ECONNREFUSED'), 0, null)).toEqual({
      state: 'unknown',
      kind: 'codex',
      id: T,
      error: "Codex's app server: ECONNREFUSED",
    });
    const failed = workspace({ agent: { kind: 'codex', error: 'Codex is not logged in' } });
    expect(serverState(failed, read('idle', []), 0, ADDRESS)).toEqual({
      state: 'not-started',
      kind: 'codex',
      error: 'Codex is not logged in',
    });
  });
});

describe('asksTrust (V27b)', () => {
  const W = '/home/someone/app.worktrees/feature-csv';
  it('asks when Codex has no entry for the worktree or a folder above it', () => {
    expect(asksTrust({}, [W])).toBe(true);
    // The repository is trusted by any writable start, but it sits beside its worktrees.
    expect(asksTrust({ '/home/someone/app': 'trusted' }, [W])).toBe(true);
    // A folder whose name starts the same is not above it.
    expect(asksTrust({ '/home/someone/app.work': 'trusted' }, [W])).toBe(true);
  });

  it('does not when the worktree or a folder above it has an entry, under any of its names', () => {
    expect(asksTrust({ [W]: 'trusted' }, [W])).toBe(false);
    expect(asksTrust({ '/home/someone': 'trusted' }, [W])).toBe(false);
    // Decided already, either way: Codex does not ask again.
    expect(asksTrust({ [W]: 'untrusted' }, [W])).toBe(false);
    // Its real path (a symlinked home) is the one Codex saved.
    expect(
      asksTrust({ '/data/someone/app.worktrees/feature-csv': 'trusted' }, [
        W,
        '/data/someone/app.worktrees/feature-csv',
      ]),
    ).toBe(false);
    expect(asksTrust({ [`${W}/`]: 'trusted' }, [W])).toBe(false);
  });
});
