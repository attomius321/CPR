import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  claudeMerger,
  codexMerger,
  conflictRegions,
  MERGER_INSTRUCTIONS,
  mergerPrompt,
  parseAnswer,
  type RunWithInput,
} from '../src/merge-agent.js';

/** A file as git leaves it with `merge.conflictStyle=diff3`: two regions. */
const CONFLICTED = [
  '# Journal',
  '',
  '## V1',
  'one',
  '<<<<<<< HEAD',
  '## V2',
  'two',
  '||||||| 1a2b3c4',
  '=======',
  '## V3',
  'three',
  '>>>>>>> 5d6e7f8',
  '',
  'end',
  'a',
  'b',
  'c',
  'd',
  '<<<<<<< HEAD',
  'x = 1',
  '||||||| 1a2b3c4',
  'x = 0',
  '=======',
  'x = 2',
  '>>>>>>> 5d6e7f8',
  'tail',
  '',
].join('\n');

describe('conflictRegions (V26c)', () => {
  it("reads each region's sides and ancestor, and where it is", () => {
    const regions = conflictRegions(CONFLICTED);
    expect(regions).toEqual([
      { start: 4, end: 11, ours: ['## V2', 'two'], base: [], theirs: ['## V3', 'three'] },
      { start: 18, end: 24, ours: ['x = 1'], base: ['x = 0'], theirs: ['x = 2'] },
    ]);
  });

  it('reads a region without an ancestor (merge style) and leaves broken markers alone', () => {
    expect(conflictRegions('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n')).toEqual([
      { start: 0, end: 4, ours: ['a'], base: null, theirs: ['b'] },
    ]);
    expect(conflictRegions('<<<<<<< HEAD\na\n')).toEqual([]);
  });
});

describe('applyAnswer (V26c)', () => {
  it("writes each region's answer between its markers, nothing else changed", () => {
    const text = applyAnswer(CONFLICTED, conflictRegions(CONFLICTED), [
      '## V2\ntwo\n\n## V3\nthree',
      'x = 2\n',
    ]);
    expect(text).toBe(
      [
        '# Journal',
        '',
        '## V1',
        'one',
        '## V2',
        'two',
        '',
        '## V3',
        'three',
        '',
        'end',
        'a',
        'b',
        'c',
        'd',
        'x = 2',
        'tail',
        '',
      ].join('\n'),
    );
  });

  it('takes an empty answer as no lines', () => {
    const regions = conflictRegions(CONFLICTED);
    expect(applyAnswer(CONFLICTED, regions, ['', 'x = 2']).split('\n').slice(3, 6)).toEqual([
      'one',
      '',
      'end',
    ]);
  });
});

describe('parseAnswer (V26c)', () => {
  it('reads the regions, in a fence or not, and their notes', () => {
    expect(
      parseAnswer('{"regions": {"1": "a", "2": "b"}, "notes": {"1": "kept both"}}', 2),
    ).toEqual({ texts: ['a', 'b'], notes: ['kept both', ''] });
    expect(parseAnswer('Here:\n```json\n{"regions": {"1": "a"}}\n```\n', 1)).toEqual({
      texts: ['a'],
      notes: [''],
    });
  });

  it('reads "needs you", and refuses an answer that leaves a region out or writes markers', () => {
    expect(parseAnswer('{"needsYou": "region 2: both renamed x"}', 2)).toEqual({
      needsYou: 'region 2: both renamed x',
    });
    expect(parseAnswer('{"regions": {"1": "a"}}', 2)).toEqual({
      error: 'the answer has no text for region 2',
    });
    expect(parseAnswer('{"regions": {"1": "<<<<<<< HEAD\\na"}}', 1)).toEqual({
      error: 'the answer for region 1 has conflict markers',
    });
    expect(parseAnswer('I could not decide.', 1)).toEqual({
      error: 'the answer is not JSON: I could not decide.',
    });
  });
});

describe('mergerPrompt (V26c)', () => {
  const input = {
    branch: 'feature/csv',
    into: 'main',
    head: 'c'.repeat(40),
    base: 'b'.repeat(40),
    sides: {
      into: 'Docs: V25 merged',
      branch: 'Export a review as CSV — one row per comment',
    },
    files: [{ path: 'docs/JOURNAL.md', text: CONFLICTED }],
    symbols: [
      { path: 'src/a.ts', name: 'parse', kind: 'function', into: 'modified', branch: 'modified' },
    ],
  };

  it('holds the sides, the symbols, each region numbered with 3 lines around, and nothing else', () => {
    const prompt = mergerPrompt(input);
    expect(prompt).toBe(
      [
        'Merge feature/csv (ccccccc) into main (bbbbbbb).',
        '',
        'main (ours): Docs: V25 merged',
        'feature/csv (theirs): Export a review as CSV — one row per comment',
        '',
        'Changed on both sides in the conflicting files:',
        '- src/a.ts: parse (function): main modified, feature/csv modified',
        '',
        '## docs/JOURNAL.md',
        '',
        'Region 1 (lines 5–12):',
        '```',
        '',
        '## V1',
        'one',
        '<<<<<<< main',
        '## V2',
        'two',
        '||||||| ancestor',
        '=======',
        '## V3',
        'three',
        '>>>>>>> feature/csv',
        '',
        'end',
        'a',
        '```',
        '',
        'Region 2 (lines 19–25):',
        '```',
        'b',
        'c',
        'd',
        '<<<<<<< main',
        'x = 1',
        '||||||| ancestor',
        'x = 0',
        '=======',
        'x = 2',
        '>>>>>>> feature/csv',
        'tail',
        '```',
        '',
        'Answer for regions 1–2.',
        '',
      ].join('\n'),
    );
  });

  it("adds the project's merge rules, and the person's words on an earlier answer", () => {
    const prompt = mergerPrompt({
      ...input,
      rules: 'Keep JOURNAL entries in date order.\n',
      again: { comments: 'Keep V2 before V3.', previous: ['## V3\nthree\n## V2\ntwo', 'x = 2'] },
    });
    expect(prompt).toContain(
      "The project's merge rules (symbiote/merge.md):\n\nKeep JOURNAL entries in date order.\n",
    );
    expect(prompt).toContain(
      'Your earlier answer was reviewed: Keep V2 before V3.\nIt was:\n```json\n{"regions":{"1":"## V3\\nthree\\n## V2\\ntwo","2":"x = 2"}}\n```',
    );
  });

  it('keeps the instructions short: at most 1K tokens (4 characters each)', () => {
    expect(MERGER_INSTRUCTIONS.length / 4).toBeLessThanOrEqual(1000);
    expect(MERGER_INSTRUCTIONS).toMatch(/needsYou/);
    expect(MERGER_INSTRUCTIONS).toMatch(/never drop/i);
  });
});

describe('running the merger agent (V26c)', () => {
  function fakeRun(stdout: string, code = 0) {
    const calls: { command: string; args: string[]; cwd: string; input: string }[] = [];
    const run: RunWithInput = (command, args, { cwd, input }) => {
      calls.push({ command, args, cwd, input });
      return Promise.resolve({ code, stdout, stderr: code === 0 ? '' : 'it broke' });
    };
    return { calls, run };
  }

  it('runs claude -p once: read-only tools, no MCP, Symbiote’s system prompt, the prompt on stdin', async () => {
    const answer = {
      result: '{"regions":{"1":"a"}}',
      is_error: false,
      usage: {
        input_tokens: 5,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 300,
        output_tokens: 40,
      },
    };
    const { calls, run } = fakeRun(JSON.stringify(answer));
    const agent = claudeMerger('/bin/claude', { run });
    const result = await agent.run({ cwd: '/wt', prompt: 'P', model: 'sonnet' });
    expect(result).toMatchObject({
      ok: true,
      text: '{"regions":{"1":"a"}}',
      usage: { input: 2305, output: 40 },
    });
    expect(calls).toEqual([
      {
        command: '/bin/claude',
        args: [
          '-p',
          '--output-format',
          'json',
          '--tools',
          'Read,Grep,Glob',
          '--strict-mcp-config',
          '--no-session-persistence',
          '--model',
          'sonnet',
          '--system-prompt',
          MERGER_INSTRUCTIONS,
        ],
        cwd: '/wt',
        input: 'P',
      },
    ]);
    expect(agent.kind).toBe('claude');
    // The project's instructions (V28), as merges.ts makes them.
    await agent.run({ cwd: '/wt', prompt: 'P', instructions: 'Keep both.' });
    expect(calls[1]?.args.at(-1)).toBe('Keep both.');
  });

  it('says why when Claude Code fails', async () => {
    const failed = await claudeMerger('/bin/claude', { run: fakeRun('', 1).run }).run({
      cwd: '/wt',
      prompt: 'P',
    });
    expect(failed).toEqual({ ok: false, error: 'it broke' });
    const refused = await claudeMerger('/bin/claude', {
      run: fakeRun(JSON.stringify({ result: 'Not logged in', is_error: true })).run,
    }).run({ cwd: '/wt', prompt: 'P' });
    expect(refused).toEqual({ ok: false, error: 'Not logged in' });
  });

  it('runs codex exec once, read-only, the instructions before the prompt on stdin', async () => {
    const events = [
      { type: 'thread.started', thread_id: 't1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: '{"needsYou":"no"}' } },
      {
        type: 'turn.completed',
        usage: { input_tokens: 9000, cached_input_tokens: 4000, output_tokens: 70 },
      },
    ];
    const { calls, run } = fakeRun(events.map((e) => JSON.stringify(e)).join('\n'));
    const result = await codexMerger('/bin/codex', { run }).run({ cwd: '/wt', prompt: 'P' });
    expect(result).toMatchObject({
      ok: true,
      text: '{"needsYou":"no"}',
      usage: { input: 9000, output: 70 },
    });
    expect(calls[0]?.args).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--cd',
      '/wt',
      '-',
    ]);
    expect(calls[0]?.input).toBe(`${MERGER_INSTRUCTIONS}\n\n---\n\nP`);
    await codexMerger('/bin/codex', { run }).run({
      cwd: '/wt',
      prompt: 'P',
      instructions: 'Keep both.',
    });
    expect(calls[1]?.input).toBe('Keep both.\n\n---\n\nP');
  });
});
