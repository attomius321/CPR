import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { ThreadEntry } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import {
  activityEntry,
  activityPath,
  hookMain,
  lastAction,
  readActivityEnd,
  recordActivity,
  readThread,
  readThreadEnd,
  recordEvent,
  threadEntry,
  threadPath,
  turnEnded,
  workspacesFolder,
} from '../src/thread.js';

/** What Claude Code 2.1.300 gave the hooks in the V18c spike, one input per event and kind. */
const inputs = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'hook-inputs.json'), 'utf8'),
) as Record<string, unknown>[];
const input = (event: string, kind = '') => {
  const found = inputs.find(
    (i) =>
      i.hook_event_name === event &&
      (kind === '' || [i.tool_name, i.source, i.notification_type].includes(kind)),
  );
  if (!found) throw new Error(`no recorded ${event} ${kind}`);
  return found;
};
const AT = '2026-10-15T09:00:00.000Z';
const SESSION = 'b2a132c3-a35e-4d33-b865-edf03a395372';

describe('threadEntry', () => {
  it("turns each hook's input into a thread entry", () => {
    expect(threadEntry(input('SessionStart', 'startup'), AT)).toEqual({
      at: AT,
      session: SESSION,
      kind: 'start',
      source: 'startup',
    });
    expect(threadEntry(input('SessionEnd'), AT)).toMatchObject({ kind: 'end', reason: 'other' });
    expect(threadEntry(input('UserPromptSubmit'), AT)).toMatchObject({
      kind: 'prompt',
      text: expect.stringContaining('add a farewell(name) function') as string,
    });
    const report = threadEntry(input('Stop'), AT);
    expect(report).toMatchObject({ kind: 'report' });
    expect(report && 'text' in report ? report.text : '').toContain('**Planned change**');
    expect(threadEntry(input('Notification', 'permission_prompt'), AT)).toMatchObject({
      kind: 'notice',
      type: 'permission_prompt',
      message: 'Claude needs your permission',
    });
  });

  it('keeps what an agent waits on: a permission with its input, a question with its options', () => {
    const edit = threadEntry(input('PermissionRequest', 'Edit'), AT);
    expect(edit).toMatchObject({ kind: 'asks', tool: 'Edit' });
    expect(JSON.parse(edit && 'input' in edit ? (edit.input ?? '') : '')).toMatchObject({
      file_path: '/work/app.worktrees/feature-x/greet.js',
    });
    const question = {
      kind: 'asks',
      tool: 'AskUserQuestion',
      questions: [
        {
          question: 'Should farewell(name) end with an exclamation mark?',
          options: ['Yes, end with !', 'No punctuation'],
        },
      ],
    };
    expect(threadEntry(input('PreToolUse', 'AskUserQuestion'), AT)).toMatchObject(question);
    // A question nothing answered comes again through PermissionRequest.
    expect(threadEntry(input('PermissionRequest', 'AskUserQuestion'), AT)).toMatchObject({
      kind: 'asks',
      tool: 'AskUserQuestion',
    });
  });

  it('cuts a long input at 4 KB and ignores anything that is not a known event', () => {
    const big = {
      ...input('PermissionRequest', 'Edit'),
      tool_input: { file_path: '/w/a.ts', content: 'x'.repeat(10_000) },
    };
    const entry = threadEntry(big, AT);
    expect(entry && 'input' in entry ? (entry.input ?? '').length : 0).toBe(4096);
    expect(threadEntry({ ...input('Stop'), last_assistant_message: '' }, AT)).toBeNull();
    expect(
      threadEntry({ hook_event_name: 'PostToolUse', session_id: 's', cwd: '/w' }, AT),
    ).toBeNull();
    expect(threadEntry({ hook_event_name: 'Stop' }, AT)).toBeNull();
    expect(threadEntry('not an object', AT)).toBeNull();
    expect(threadEntry(null, AT)).toBeNull();
  });
});

describe('recordEvent and readThread', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  /**
   * A `symbiote/` folder with the record of `feature/x`, whose worktree is
   * `<tmp>/app.worktrees/feature-x`, in `records` (`features` before V25).
   */
  function symbiote(records = 'workspaces') {
    const root = tempDir();
    folders.push(root);
    const folder = join(root, 'symbiote');
    const worktree = join(root, 'app.worktrees', 'feature-x');
    mkdirSync(join(worktree, 'src'), { recursive: true });
    const record = join(folder, records, 'feature', 'x.json');
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(record, JSON.stringify({ branch: 'feature/x', base: 'a'.repeat(40), worktree }));
    return { folder, worktree, root };
  }
  const at = (n: number) => `2026-10-15T09:00:0${n}.000Z`;

  it("appends each event to its workspace's thread, found by the worktree holding its folder", async () => {
    const { folder, worktree } = symbiote();
    const placed = (event: Record<string, unknown>, cwd: string, n: number) =>
      recordEvent(folder, { ...event, cwd }, at(n));
    expect(await placed(input('SessionStart', 'startup'), worktree, 1)).toBe(
      threadPath(folder, 'feature/x'),
    );
    expect(await placed(input('UserPromptSubmit'), join(worktree, 'src'), 2)).not.toBeNull();
    expect(await placed(input('Stop'), worktree, 3)).not.toBeNull();
    // Another folder, or nothing to record: nothing written.
    expect(await placed(input('Stop'), `${worktree}-2`, 4)).toBeNull();
    expect(await recordEvent(folder, { hook_event_name: 'PostToolUse' }, at(5))).toBeNull();
    expect(threadPath(folder, 'feature/x')).toBe(join(folder, 'threads', 'feature', 'x.jsonl'));
    const thread = await readThread(folder, 'feature/x');
    expect(thread.map((e) => e.kind)).toEqual(['start', 'prompt', 'report']);
    expect(turnEnded(thread)).toBe(true);
  });

  it('finds a workspace recorded before V25, in symbiote/features/, moved first to symbiote/workspaces/', async () => {
    const { folder, worktree } = symbiote('features');
    expect(await recordEvent(folder, { ...input('Stop'), cwd: worktree }, at(1))).toBe(
      threadPath(folder, 'feature/x'),
    );
    expect(existsSync(join(folder, 'features'))).toBe(false);
    expect(existsSync(join(folder, 'workspaces', 'feature', 'x.json'))).toBe(true);
  });

  it('matches real paths: a worktree reached through a symbolic link', async () => {
    const { folder, worktree, root } = symbiote();
    const link = join(root, 'link');
    symlinkSync(join(root, 'app.worktrees'), link);
    expect(
      await recordEvent(folder, { ...input('Stop'), cwd: join(link, 'feature-x') }, at(1)),
    ).toBe(threadPath(folder, 'feature/x'));
    expect(worktree).toContain('feature-x');
  });

  it('reads the last entries, skips broken lines, and keeps one entry for a question asked twice', async () => {
    const { folder, worktree } = symbiote();
    for (const [n, event] of [
      input('PreToolUse', 'AskUserQuestion'),
      input('Notification', 'permission_prompt'),
      // The same question again, as Claude Code asks it when the first hook gave no answer.
      {
        ...input('PermissionRequest', 'AskUserQuestion'),
        session_id: SESSION,
        tool_input: input('PreToolUse', 'AskUserQuestion').tool_input,
      },
    ].entries()) {
      await recordEvent(folder, { ...event, cwd: worktree }, at(n));
    }
    writeFileSync(threadPath(folder, 'feature/x'), 'not json\n', { flag: 'a' });
    await recordEvent(folder, { ...input('Stop'), cwd: worktree }, at(6));
    const thread = await readThread(folder, 'feature/x');
    expect(thread.map((e) => e.kind)).toEqual(['asks', 'notice', 'report']);
    expect(await readThread(folder, 'feature/none')).toEqual([]);
    expect((await readThread(folder, 'feature/x', 2)).map((e) => e.kind)).toEqual([
      'notice',
      'report',
    ]);
  });

  it("reads a thread's end only: its last entries whole, the line cut there dropped (V23)", async () => {
    const { folder, worktree } = symbiote();
    for (let n = 0; n < 40; n++) {
      await recordEvent(folder, { ...input('Stop'), cwd: worktree }, at(n));
    }
    const path = threadPath(folder, 'feature/x');
    const whole = await readThread(folder, 'feature/x');
    const size = statSync(path).size;
    const half = await readThreadEnd(folder, 'feature/x', Math.floor(size / 2));
    expect(half.length).toBeGreaterThan(10);
    expect(half.length).toBeLessThan(30);
    expect(half).toEqual(whole.slice(-half.length));
    // Cut exactly where a line starts: that line is whole, so it is kept.
    const last = readFileSync(path, 'utf8').trimEnd().split('\n').at(-1) ?? '';
    expect(await readThreadEnd(folder, 'feature/x', Buffer.byteLength(last) + 1)).toEqual(
      whole.slice(-1),
    );
    expect(await readThreadEnd(folder, 'feature/x', size * 2)).toEqual(whole);
    expect(await readThreadEnd(folder, 'feature/x', size)).toEqual(whole);
    expect(await readThreadEnd(folder, 'feature/none')).toEqual([]);
  });

  it('a turn has ended when its last report comes after the last prompt', () => {
    const e = (kind: 'prompt' | 'report' | 'start') =>
      kind === 'start'
        ? { at: AT, session: 's', kind, source: 'resume' }
        : { at: AT, session: 's', kind, text: 'x' };
    expect(turnEnded([])).toBe(false);
    expect(turnEnded([e('prompt')])).toBe(false);
    expect(turnEnded([e('prompt'), e('report')])).toBe(true);
    expect(turnEnded([e('prompt'), e('report'), e('start'), e('prompt')])).toBe(false);
  });

  it("the agent's last action: its newest report or question, not the person's or Claude Code's entries (V23)", () => {
    const at = (minute: number) => `2026-10-18T14:${String(minute).padStart(2, '0')}:00.000Z`;
    const thread: ThreadEntry[] = [
      { at: at(0), session: 's', kind: 'start', source: 'startup' },
      { at: at(1), session: 's', kind: 'prompt', text: 'the brief' },
      { at: at(5), session: 's', kind: 'asks', tool: 'Bash', input: '{"command":"ls"}' },
      { at: at(9), session: 's', kind: 'report', text: 'The plan' },
      // A minute idle, then the person: none of it is the agent handing the turn back.
      { at: at(10), session: 's', kind: 'notice', type: 'idle_prompt' },
      { at: at(20), session: 's', kind: 'end', reason: 'clear' },
      { at: at(21), session: 't', kind: 'start', source: 'clear' },
      { at: at(22), session: 't', kind: 'prompt', text: 'OK, go' },
    ];
    expect(lastAction(thread)).toBe(at(9));
    expect(lastAction(thread.slice(0, 3))).toBe(at(5));
    expect(lastAction([...thread, { at: at(30), session: 't', kind: 'asks', tool: 'Edit' }])).toBe(
      at(30),
    );
    expect(lastAction(thread.slice(0, 2))).toBeUndefined();
    expect(lastAction([])).toBeUndefined();
  });
});

describe('hookMain', () => {
  it('records an event from its input and never throws, whatever it is given', async () => {
    const root = tempDir();
    try {
      const folder = join(root, 'symbiote');
      const worktree = join(root, 'w');
      mkdirSync(join(folder, 'features'), { recursive: true });
      mkdirSync(worktree);
      writeFileSync(
        join(folder, 'features', 'x.json'),
        JSON.stringify({ branch: 'x', base: 'a'.repeat(40), worktree }),
      );
      await hookMain(JSON.stringify({ ...input('Stop'), cwd: worktree }), folder, AT);
      await hookMain('not json', folder, AT);
      await hookMain('', folder, AT);
      await hookMain(JSON.stringify(input('Stop')), undefined, AT);
      await hookMain(JSON.stringify({ ...input('Stop'), cwd: worktree }), join(root, 'none'), AT);
      expect(
        readFileSync(threadPath(folder, 'x'), 'utf8').split('\n').filter(Boolean),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('activityEntry (V48f)', () => {
  const W = '/work/app.worktrees/feature-x';
  const tool = (event: string, name: string, toolInput: unknown, rest = {}) =>
    activityEntry(
      {
        hook_event_name: event,
        session_id: 's1',
        cwd: W,
        tool_name: name,
        tool_input: toolInput,
        tool_use_id: 'toolu_1',
        ...rest,
      },
      AT,
      W,
    );
  const head = { at: AT, session: 's1', id: 'toolu_1' };

  it("a tool's start before it runs, its end after, a failure marked", () => {
    expect(tool('PreToolUse', 'Bash', { command: 'pnpm test' })).toEqual({
      ...head,
      tool: 'Bash',
      subject: 'pnpm test',
      input: 'pnpm test',
      phase: 'start',
    });
    expect(tool('PostToolUse', 'Bash', { command: 'pnpm test' }, { tool_response: {} })).toEqual({
      ...head,
      tool: 'Bash',
      subject: 'pnpm test',
      phase: 'end',
    });
    expect(
      tool('PostToolUseFailure', 'Bash', { command: 'pnpm test' }, { error: 'exit 1' }),
    ).toEqual({
      ...head,
      tool: 'Bash',
      subject: 'pnpm test',
      phase: 'end',
      failed: true,
      output: 'exit 1',
    });
  });

  it('keeps only what the tool works on: a first line, a path in the worktree, a pattern', () => {
    const subject = (name: string, toolInput: unknown) =>
      tool('PreToolUse', name, toolInput)?.subject;
    expect(subject('Bash', { command: `\n  ${'x'.repeat(200)}\nsecond` })).toBe('x'.repeat(160));
    expect(subject('Edit', { file_path: `${W}/src/auth.ts`, old_string: 'a' })).toBe('src/auth.ts');
    expect(subject('Read', { file_path: '/etc/hosts' })).toBe('/etc/hosts');
    expect(subject('Write', { file_path: `${W}/b.ts`, content: 'secret' })).toBe('b.ts');
    expect(subject('MultiEdit', { file_path: `${W}/c.ts` })).toBe('c.ts');
    expect(subject('NotebookEdit', { notebook_path: `${W}/n.ipynb` })).toBe('n.ipynb');
    expect(subject('Grep', { pattern: 'parseToken', path: W })).toBe('parseToken');
    expect(subject('Glob', { pattern: 'src/**/*.ts' })).toBe('src/**/*.ts');
    expect(subject('WebFetch', { url: 'https://docs.rs', prompt: 'p' })).toBe('https://docs.rs');
    expect(subject('WebSearch', { query: 'pino' })).toBe('pino');
    expect(subject('Task', { description: 'Find callers', prompt: 'long' })).toBe('Find callers');
    expect(subject('Agent', { description: 'Find callers' })).toBe('Find callers');
    // Anything else: the tool alone.
    expect(subject('mcp__symbiote__review', { branch: 'x' })).toBeUndefined();
    expect(subject('TodoWrite', { todos: [] })).toBeUndefined();
    expect(subject('Bash', 'not an object')).toBeUndefined();
  });

  it("a command's start keeps its whole text and the agent's words for it (V73)", () => {
    const command = `cd ${W} && pnpm check 2>&1 | tail -20`;
    expect(
      tool('PreToolUse', 'Bash', { command, description: 'Run the full check\nand more' }),
    ).toEqual({
      ...head,
      tool: 'Bash',
      subject: command,
      input: command,
      about: 'Run the full check',
      phase: 'start',
    });
    const long = `echo ${'y'.repeat(9000)}`;
    expect(tool('PreToolUse', 'Bash', { command: long })?.input).toBe(long.slice(0, 8192));
    // Anything but a command keeps its subject alone, as before.
    expect(tool('PreToolUse', 'Read', { file_path: `${W}/a.ts` })).toEqual({
      ...head,
      tool: 'Read',
      subject: 'a.ts',
      phase: 'start',
    });
  });

  it("a command's end keeps its duration and its output's last 2 KB (V73)", () => {
    const end = tool(
      'PostToolUse',
      'Bash',
      { command: 'pnpm test' },
      {
        tool_response: {
          stdout: 'ok\n Tests  3 passed (3)\n',
          stderr: 'warn\n',
          interrupted: false,
        },
        duration_ms: 1234,
      },
    );
    expect(end).toEqual({
      ...head,
      tool: 'Bash',
      subject: 'pnpm test',
      phase: 'end',
      ms: 1234,
      output: 'ok\n Tests  3 passed (3)\nwarn',
    });
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    const cut = tool('PostToolUse', 'Bash', { command: 'x' }, { tool_response: { stdout: lines } });
    // From the first whole line in its last 2,048 characters, said to be cut.
    expect(cut?.output?.length).toBeLessThanOrEqual(2048);
    expect(cut?.output?.startsWith('line ')).toBe(true);
    expect(cut?.output?.endsWith('line 399')).toBe(true);
    expect(cut?.clipped).toBe(true);
  });

  it("a failed command's exit code from its error, its error as its output (V73)", () => {
    expect(
      tool(
        'PostToolUseFailure',
        'Bash',
        { command: 'pnpm test' },
        { error: 'Exit code 1\n FAIL src/a.test.ts\n Tests  1 failed (1)', duration_ms: 900 },
      ),
    ).toEqual({
      ...head,
      tool: 'Bash',
      subject: 'pnpm test',
      phase: 'end',
      failed: true,
      ms: 900,
      exit: 1,
      output: 'Exit code 1\n FAIL src/a.test.ts\n Tests  1 failed (1)',
    });
    // Stopped by the person: interrupted, whichever way Claude Code says it.
    expect(
      tool(
        'PostToolUseFailure',
        'Bash',
        { command: 'x' },
        { error: 'Interrupted', is_interrupt: true },
      )?.interrupted,
    ).toBe(true);
    expect(
      tool('PostToolUse', 'Bash', { command: 'x' }, { tool_response: { interrupted: true } })
        ?.interrupted,
    ).toBe(true);
    // Sent to the background: its end is not the command's.
    expect(
      tool('PostToolUse', 'Bash', { command: 'x' }, { tool_response: { backgroundTaskId: 'b1' } })
        ?.background,
    ).toBe(true);
  });

  it("an edit's end counts the lines it added and removed (V73)", () => {
    const patch = [
      { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d'] },
      { oldStart: 9, oldLines: 1, newStart: 10, newLines: 1, lines: ['-e', '+f'] },
    ];
    const edit = tool(
      'PostToolUse',
      'Edit',
      { file_path: `${W}/src/a.ts` },
      { tool_response: { filePath: `${W}/src/a.ts`, structuredPatch: patch } },
    );
    expect(edit).toMatchObject({ subject: 'src/a.ts', phase: 'end', added: 3, removed: 2 });
    // A file written new: its lines, from what was written.
    const created = tool(
      'PostToolUse',
      'Write',
      { file_path: `${W}/b.ts` },
      { tool_response: { type: 'create', content: 'a\nb\nc\n', structuredPatch: [] } },
    );
    expect(created).toMatchObject({ added: 3, removed: 0 });
    expect(created?.output).toBeUndefined();
  });

  it("a task's subject, the ID it was given and its updates (V73)", () => {
    expect(
      tool('PreToolUse', 'TaskCreate', { subject: 'Write the tests', description: 'd' }),
    ).toMatchObject({ task: { subject: 'Write the tests' } });
    expect(
      tool(
        'PostToolUse',
        'TaskCreate',
        { subject: 'Write the tests' },
        { tool_response: { task: { id: '3', subject: 'Write the tests' } } },
      ),
    ).toMatchObject({ task: { id: '3', subject: 'Write the tests' } });
    expect(tool('PreToolUse', 'TaskUpdate', { taskId: '3', status: 'in_progress' })).toMatchObject({
      task: { id: '3', status: 'in_progress' },
    });
    expect(tool('PreToolUse', 'TaskUpdate', { taskId: 3 })?.task).toBeUndefined();
  });

  it('nothing for another event, or without a session, a tool or its ID', () => {
    expect(tool('Stop', 'Bash', {})).toBeNull();
    expect(tool('PermissionRequest', 'Bash', {})).toBeNull();
    expect(tool('PreToolUse', '', {})).toBeNull();
    expect(tool('PreToolUse', 'Bash', {}, { tool_use_id: undefined })).toBeNull();
    expect(tool('PreToolUse', 'Bash', {}, { session_id: 7 })).toBeNull();
    expect(activityEntry(null, AT, W)).toBeNull();
  });
});

describe('recordActivity, readActivityEnd and the hook in its activity mode (V48f)', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  function symbiote() {
    const root = tempDir();
    roots.push(root);
    const folder = join(root, 'symbiote');
    const worktree = join(root, 'app.worktrees', 'feature-x');
    mkdirSync(worktree, { recursive: true });
    const record = join(folder, 'workspaces', 'feature', 'x.json');
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(record, JSON.stringify({ branch: 'feature/x', base: 'a'.repeat(40), worktree }));
    return { folder, worktree };
  }
  const pre = (worktree: string, id: string, command: string) => ({
    hook_event_name: 'PreToolUse',
    session_id: 's1',
    cwd: worktree,
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: id,
  });

  it("appends each tool's line to its workspace's activity, never to its thread", async () => {
    const { folder, worktree } = symbiote();
    expect(await recordActivity(folder, pre(worktree, 'a', 'ls'), AT)).toBe(
      activityPath(folder, 'feature/x'),
    );
    expect(activityPath(folder, 'feature/x')).toBe(join(folder, 'activity', 'feature', 'x.jsonl'));
    await hookMain(JSON.stringify(pre(worktree, 'b', 'pnpm test')), folder, AT, 'activity');
    // The thread's mode keeps no tool, and the activity's no message.
    await hookMain(JSON.stringify(pre(worktree, 'c', 'rm')), folder, AT);
    await hookMain(
      JSON.stringify({ ...pre(worktree, 'd', ''), hook_event_name: 'Stop' }),
      folder,
      AT,
      'activity',
    );
    expect((await readActivityEnd(folder, 'feature/x')).map((e) => e.id)).toEqual(['a', 'b']);
    expect(existsSync(threadPath(folder, 'feature/x'))).toBe(false);
    // Outside any workspace: nothing.
    expect(await recordActivity(folder, pre(`${worktree}-2`, 'e', 'ls'), AT)).toBeNull();
  });

  it("reads the file's end only: a line cut there and broken lines are skipped", async () => {
    const { folder, worktree } = symbiote();
    for (let i = 0; i < 50; i++) await recordActivity(folder, pre(worktree, `t${i}`, 'ls'), AT);
    const path = activityPath(folder, 'feature/x');
    writeFileSync(path, `${readFileSync(path, 'utf8')}not json\n{"at":1}\n`);
    const all = await readActivityEnd(folder, 'feature/x');
    expect(all).toHaveLength(50);
    const end = await readActivityEnd(folder, 'feature/x', 500);
    expect(end.length).toBeGreaterThan(0);
    expect(end.length).toBeLessThan(10);
    expect(end.at(-1)?.id).toBe('t49');
    expect(await readActivityEnd(folder, 'feature/none')).toEqual([]);
  });
});

describe('workspacesFolder (V25)', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  const symbioteWith = (...records: string[]) => {
    const folder = join(tempDir(), 'symbiote');
    folders.push(dirname(folder));
    for (const path of records) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), path);
    }
    return folder;
  };

  it('moves symbiote/features/ to symbiote/workspaces/ once, when only the old one is there', async () => {
    const folder = symbioteWith('features/feature/x.json', 'features/fix/y.json');
    // Two readers at once (the list and a hook): one moves, both find the records.
    const [a, b] = await Promise.all([workspacesFolder(folder), workspacesFolder(folder)]);
    expect(a).toEqual({ dir: join(folder, 'workspaces') });
    expect(b).toEqual(a);
    expect(readFileSync(join(folder, 'workspaces', 'fix', 'y.json'), 'utf8')).toBe(
      'features/fix/y.json',
    );
    expect(existsSync(join(folder, 'features'))).toBe(false);
  });

  it('keeps symbiote/workspaces/ when there; with both, says the old one is left', async () => {
    expect(await workspacesFolder(symbioteWith('workspaces/feature/x.json'))).toEqual({
      dir: expect.stringMatching(/workspaces$/) as unknown,
    });
    const both = symbioteWith('workspaces/feature/x.json', 'features/fix/y.json');
    expect(await workspacesFolder(both)).toEqual({ dir: join(both, 'workspaces'), left: true });
    expect(readFileSync(join(both, 'features', 'fix', 'y.json'), 'utf8')).toBe(
      'features/fix/y.json',
    );
  });

  it('makes nothing when neither is there', async () => {
    const folder = symbioteWith();
    expect(await workspacesFolder(folder)).toEqual({ dir: join(folder, 'workspaces') });
    expect(existsSync(folder)).toBe(false);
  });
});
