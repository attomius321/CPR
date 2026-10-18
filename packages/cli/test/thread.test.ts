import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ThreadEntry } from '@cpr/core';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import {
  hookMain,
  lastAction,
  readThread,
  recordEvent,
  threadEntry,
  threadPath,
  turnEnded,
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
  /** A `cpr/` folder with the record of `feature/x`, whose worktree is `<tmp>/app.worktrees/feature-x`. */
  function cpr() {
    const root = tempDir();
    folders.push(root);
    const folder = join(root, 'cpr');
    const worktree = join(root, 'app.worktrees', 'feature-x');
    mkdirSync(join(worktree, 'src'), { recursive: true });
    const record = join(folder, 'features', 'feature', 'x.json');
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(record, JSON.stringify({ branch: 'feature/x', base: 'a'.repeat(40), worktree }));
    return { folder, worktree, root };
  }
  const at = (n: number) => `2026-10-15T09:00:0${n}.000Z`;

  it("appends each event to its feature's thread, found by the worktree holding its folder", async () => {
    const { folder, worktree } = cpr();
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

  it('matches real paths: a worktree reached through a symbolic link', async () => {
    const { folder, worktree, root } = cpr();
    const link = join(root, 'link');
    symlinkSync(join(root, 'app.worktrees'), link);
    expect(
      await recordEvent(folder, { ...input('Stop'), cwd: join(link, 'feature-x') }, at(1)),
    ).toBe(threadPath(folder, 'feature/x'));
    expect(worktree).toContain('feature-x');
  });

  it('reads the last entries, skips broken lines, and keeps one entry for a question asked twice', async () => {
    const { folder, worktree } = cpr();
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

  it("the agent's last action: its newest report or question, not the person's or Claude Code's entries (V22)", () => {
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
      const folder = join(root, 'cpr');
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
