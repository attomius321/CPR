import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThreadEntry } from '@cpr/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { codex, codexArgs, codexState, parseCodexAccount, type DetachedRun } from '../src/codex.js';
import { runCodex } from '../src/codex-run.js';
import type { FeatureFile } from '../src/features.js';
import type { Run } from '../src/features.js';

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

const thread = () => join(dir, 'cpr', 'threads', 'feature', 'csv.jsonl');
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

const run = (source: 'startup' | 'resume', prompt = 'Build it') =>
  runCodex(
    {
      thread: thread(),
      source,
      run: 'r1',
      command: process.execPath,
      args: [join(dir, 'codex.js'), 'exec', '--json', '--', prompt],
    },
    { now: () => AT },
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
});

describe('codex (V20a)', () => {
  it('starts and resumes through the runner, detached in the worktree; the process ID', async () => {
    const detached = vi.fn<DetachedRun>(() => Promise.resolve(4242));
    const agent = codex('/usr/bin/codex', {
      runner: '/opt/cpr/dist/codex-run.js',
      node: '/usr/bin/node',
      detach: detached,
    });
    expect(
      await agent.start({
        cwd: '/w/x',
        thread: '/r/cpr/threads/x.jsonl',
        run: 'r1',
        writable: ['/g'],
        prompt: 'P',
      }),
    ).toEqual({ ok: true, pid: 4242 });
    expect(detached).toHaveBeenLastCalledWith(
      '/usr/bin/node',
      [
        '/opt/cpr/dist/codex-run.js',
        '/r/cpr/threads/x.jsonl',
        'startup',
        'r1',
        '/usr/bin/codex',
        ...codexArgs({ cwd: '/w/x', writable: ['/g'], prompt: 'P' }),
      ],
      '/w/x',
    );
    await agent.resume({
      cwd: '/w/x',
      thread: '/r/cpr/threads/x.jsonl',
      run: 'r2',
      writable: ['/g'],
      sessionId: T,
      text: 'Go',
    });
    expect(detached.mock.lastCall?.[1].slice(1, 4)).toEqual([
      '/r/cpr/threads/x.jsonl',
      'resume',
      'r2',
    ]);
    expect(detached.mock.lastCall?.[1].slice(5)).toEqual(
      codexArgs({ writable: ['/g'], sessionId: T, prompt: 'Go' }),
    );
    const failing = codex('/usr/bin/codex', {
      runner: '/r.js',
      detach: () => Promise.reject(new Error('spawn EACCES')),
    });
    expect(
      await failing.start({ cwd: '/w/x', thread: '/t', run: 'r1', writable: [], prompt: 'P' }),
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
  const feature = (over: Partial<FeatureFile> = {}): FeatureFile => ({
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
    expect(codexState(feature(), [], true, 0)).toEqual({ state: 'working', kind: 'codex' });
    expect(codexState(feature(), started, true, 0)).toEqual({
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
    expect(codexState(feature(), done, false, 0)).toEqual({
      state: 'plan-ready',
      kind: 'codex',
      id: T,
    });
    expect(codexState(feature(), done, false, 2).state).toBe('ready');
    expect(codexState(feature({ planFirst: false }), done, false, 0).state).toBe('done');
    // A run that ended normally ended, whatever its old process ID now is.
    expect(codexState(feature(), done, true, 0).state).toBe('plan-ready');
  });

  it('reads a stop, a failure with its reason, and an end without a word', () => {
    const ended = (reason: string) => [...started, e(1, { kind: 'end', reason })];
    expect(codexState(feature(), ended('stopped'), false, 0)).toEqual({
      state: 'stopped',
      kind: 'codex',
      id: T,
    });
    expect(codexState(feature(), ended('unexpected status 401'), false, 0)).toEqual({
      state: 'failed',
      kind: 'codex',
      id: T,
      error: 'unexpected status 401',
    });
    expect(
      codexState(feature(), [...started, e(1, { kind: 'report', text: 'Plan' })], false, 0).state,
    ).toBe('plan-ready');
    expect(codexState(feature(), started, false, 0)).toEqual({
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
    const again = feature({ agent: { kind: 'codex', started: at(1), run: 'r2', pid: 4343 } });
    expect(codexState(again, before, true, 0)).toEqual({ state: 'working', kind: 'codex', id: T });
    const resumed = [
      ...before,
      e(1, { kind: 'start', source: 'resume' }, 'r2'),
      e(2, { kind: 'end', reason: 'stopped' }, 'r2'),
    ];
    expect(codexState(again, resumed, false, 0).state).toBe('stopped');
  });

  it('says when it did not start', () => {
    const failed = feature({ agent: { kind: 'codex', error: 'Codex is not logged in' } });
    expect(codexState(failed, [], false, 0)).toEqual({
      state: 'not-started',
      kind: 'codex',
      error: 'Codex is not logged in',
    });
  });
});
