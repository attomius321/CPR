import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NucleusActivityLine } from '@symbiote/core';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import {
  ACTIVITY_ROTATE,
  appendActivity,
  gateLine,
  hookLines,
  nucleusHook,
  NUCLEUS_ACTIVITY,
  NUCLEUS_ACTIVITY_OLDER,
  readNucleusActivity,
  redact,
  rotateActivity,
  turnTokens,
} from '../src/nucleus-activity.js';
import { gateDecision, gateOptions, hookOutput } from '../src/nucleus-gate.js';

const AT = '2026-10-30T10:00:00.000Z';
const CHECKOUT = '/home/p/repo';
const head = { session_id: 's1', cwd: CHECKOUT, transcript_path: '/nowhere.jsonl' };
const lines = (file: string) =>
  readFileSync(file, 'utf8')
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l) as NucleusActivityLine);

describe('redact (NU2, decision 608)', () => {
  const env = {
    GITHUB_TOKEN: 'abcdefghij0123456789',
    MY_API_KEY: 'k3y-value-long',
    SHORT_TOKEN: 'abc',
    HOME: '/home/p',
    PATH: '/usr/bin',
  };

  it('replaces the values of secret-named variables with their names', () => {
    expect(redact('curl -H "x: abcdefghij0123456789" and k3y-value-long', env)).toBe(
      'curl -H "x: [redacted: GITHUB_TOKEN]" and [redacted: MY_API_KEY]',
    );
  });

  it('keeps short values and variables whose names say nothing secret', () => {
    expect(redact('abc in /home/p with /usr/bin', env)).toBe('abc in /home/p with /usr/bin');
  });

  it.each([
    ['ghp_0123456789abcdefghijABCDEFGHIJ012345', '[redacted]'],
    ['github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', '[redacted]'],
    ['glpat-abcdefghij0123456789', '[redacted]'],
    ['sk-ant-api03-abcdefghijklmnop0123456789', '[redacted]'],
    ['sk-proj-abcdefghijklmnop0123456789', '[redacted]'],
    ['xoxb-1234567890-abcdefghij', '[redacted]'],
    ['AKIAIOSFODNN7EXAMPLE', '[redacted]'],
  ])('tokens by their shape: %s', (token, shown) => {
    expect(redact(`the token ${token} here`, {})).toBe(`the token ${shown} here`);
  });

  it('a bearer, a password in a URL, secret query parameters', () => {
    expect(redact('Authorization: Bearer abc.def-123456', {})).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(redact('https://me:hunter22@example.com/x', {})).toBe(
      'https://me:[redacted]@example.com/x',
    );
    expect(redact('https://api.example.com/v1?q=vite&access_token=abc123&key=zz9', {})).toBe(
      'https://api.example.com/v1?q=vite&access_token=[redacted]&key=[redacted]',
    );
  });

  it('leaves ordinary text alone', () => {
    const text = 'git log --oneline -5 -- packages/cli/src/sk-ant.ts # task-key';
    expect(redact(text, env)).toBe(text);
  });
});

describe('gateLine (decision 605)', () => {
  const call = (tool: string, input: unknown) => ({
    ...head,
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: input,
    tool_use_id: 't1',
  });

  it("a git read: the call's start, its command whole, the gate's allow", () => {
    const input = call('Bash', { command: 'git log --oneline -5', description: 'Recent commits' });
    expect(gateLine(input, gateDecision(input), AT, CHECKOUT)).toEqual({
      at: AT,
      session: 's1',
      conversation: 's1',
      agent: 'claude',
      id: 't1',
      tool: 'Bash',
      subject: 'git log --oneline -5',
      phase: 'start',
      input: 'git log --oneline -5',
      about: 'Recent commits',
      gate: { decision: 'allow' },
    });
  });

  it('a refused command keeps the refusal', () => {
    const input = call('Bash', { command: 'curl https://example.com' });
    const line = gateLine(input, gateDecision(input), AT, CHECKOUT);
    expect(line?.gate?.decision).toBe('deny');
    expect(line?.gate?.reason).toContain('curl: only git runs');
  });

  it("a read in the checkout is its agent's to decide; a page keeps its input", () => {
    const read = call('Read', { file_path: `${CHECKOUT}/README.md` });
    expect(gateLine(read, gateDecision(read), AT, CHECKOUT)).toMatchObject({
      subject: 'README.md',
      input: JSON.stringify({ file_path: `${CHECKOUT}/README.md` }),
      gate: { decision: 'agent' },
    });
    const page = call('WebFetch', { url: 'https://vite.dev', prompt: 'the latest version' });
    expect(gateLine(page, gateDecision(page, { web: true }), AT, CHECKOUT)).toMatchObject({
      subject: 'https://vite.dev',
      input: JSON.stringify({ url: 'https://vite.dev', prompt: 'the latest version' }),
      gate: { decision: 'allow', reason: 'the web, as its agent reads it (NU1)' },
    });
  });

  it('nothing without a call ID', () => {
    const input = { ...call('Bash', { command: 'git log' }), tool_use_id: undefined };
    expect(gateLine(input, gateDecision(input), AT, CHECKOUT)).toBeNull();
  });
});

describe('hookLines', () => {
  const at = (input: object) => hookLines({ ...head, ...input }, AT, CHECKOUT);
  const of = { at: AT, conversation: 's1', agent: 'claude' };

  it("the person's message, a session's start and end, a notice", async () => {
    expect(await at({ hook_event_name: 'UserPromptSubmit', prompt: 'What changed?' })).toEqual([
      { ...of, kind: 'prompt', text: 'What changed?' },
    ]);
    expect(
      await at({ hook_event_name: 'SessionStart', source: 'resume', model: 'claude-opus-5-5' }),
    ).toEqual([{ ...of, kind: 'start', source: 'resume', model: 'claude-opus-5-5' }]);
    expect(await at({ hook_event_name: 'SessionEnd', reason: 'other' })).toEqual([
      { ...of, kind: 'end', reason: 'other' },
    ]);
    expect(
      await at({ hook_event_name: 'Notification', notification_type: 'idle', message: 'Waiting' }),
    ).toEqual([{ ...of, kind: 'notice', type: 'idle', message: 'Waiting' }]);
  });

  it('compaction before and after, an error', async () => {
    expect(await at({ hook_event_name: 'PreCompact', trigger: 'auto' })).toEqual([
      { ...of, kind: 'compact', stage: 'before', trigger: 'auto' },
    ]);
    expect(
      await at({ hook_event_name: 'PostCompact', trigger: 'manual', compact_summary: 'So far…' }),
    ).toEqual([{ ...of, kind: 'compact', stage: 'after', trigger: 'manual', summary: 'So far…' }]);
    expect(
      await at({
        hook_event_name: 'StopFailure',
        error: 'rate_limit',
        error_details: '429 from the API',
      }),
    ).toEqual([{ ...of, kind: 'error', error: 'rate_limit', details: '429 from the API' }]);
  });

  it("an answer, with its turn's tokens and time from the transcript", async () => {
    const transcript = join(tempDir(), 't.jsonl');
    const usage = (input: number, read: number, write: number, output: number) => ({
      input_tokens: input,
      cache_read_input_tokens: read,
      cache_creation_input_tokens: write,
      output_tokens: output,
    });
    writeFileSync(
      transcript,
      [
        { type: 'user', timestamp: '2026-10-30T09:00:00.000Z', message: { content: 'old' } },
        { type: 'assistant', message: { id: 'm0', usage: usage(9, 9, 9, 9) } },
        { type: 'user', timestamp: '2026-10-30T09:59:50.000Z', message: { content: 'Now?' } },
        { type: 'assistant', message: { id: 'm1', usage: usage(3, 100, 20, 7) } },
        // One message's blocks, each its own line, with the same usage: counted once.
        { type: 'assistant', message: { id: 'm1', usage: usage(3, 100, 20, 7) } },
        {
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
        },
        { type: 'assistant', message: { id: 'm2', usage: usage(1, 120, 0, 40) } },
        'not json',
      ]
        .map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
        .join('\n'),
    );
    expect(await turnTokens(transcript, AT)).toEqual({
      tokens: { input: 4, cached: 220, cacheWrite: 20, output: 47 },
      ms: 10_000,
    });
    expect(
      await hookLines(
        {
          ...head,
          transcript_path: transcript,
          hook_event_name: 'Stop',
          last_assistant_message: 'Two commits.',
        },
        AT,
        CHECKOUT,
      ),
    ).toEqual([
      {
        ...of,
        kind: 'report',
        text: 'Two commits.',
        tokens: { input: 4, cached: 220, cacheWrite: 20, output: 47 },
        ms: 10_000,
      },
    ]);
  });

  it('an answer without a transcript has no tokens', async () => {
    expect(await at({ hook_event_name: 'Stop', last_assistant_message: 'Done.' })).toEqual([
      { ...of, kind: 'report', text: 'Done.' },
    ]);
  });

  const end = (tool: string, tool_input: unknown, tool_response: unknown, more = {}) =>
    at({
      hook_event_name: 'PostToolUse',
      tool_name: tool,
      tool_input,
      tool_response,
      tool_use_id: 't1',
      duration_ms: 812,
      ...more,
    });

  it("a page's address, status and size, and the start of what was read", async () => {
    const [line] = await end(
      'WebFetch',
      { url: 'http://vite.dev', prompt: 'version' },
      {
        url: 'https://vite.dev/',
        code: 200,
        codeText: 'OK',
        bytes: 3926,
        durationMs: 800,
        result: 'Vite 8.3.5 is the latest.',
      },
    );
    expect(line).toMatchObject({
      phase: 'end',
      tool: 'WebFetch',
      ms: 812,
      pages: [{ url: 'https://vite.dev/', code: 200, bytes: 3926 }],
      output: 'Vite 8.3.5 is the latest.',
    });
  });

  it("a search's results", async () => {
    const [line] = await end(
      'WebSearch',
      { query: 'vite latest' },
      {
        query: 'vite latest',
        results: [
          {
            tool_use_id: 'x',
            content: [
              { title: 'Vite 8', url: 'https://vite.dev/blog' },
              { title: 'Releases', url: 'https://github.com/vitejs/vite/releases' },
            ],
          },
          'Vite 8.3.5 was released…',
        ],
        durationSeconds: 6.8,
      },
    );
    expect(line).toMatchObject({
      subject: 'vite latest',
      links: [
        { title: 'Vite 8', url: 'https://vite.dev/blog' },
        { title: 'Releases', url: 'https://github.com/vitejs/vite/releases' },
      ],
    });
  });

  it("a Symbiote tool's answer and a grep's files, from their start", async () => {
    const [mcp] = await end('mcp__symbiote__list_workspaces', {}, [
      { type: 'text', text: '{"workspaces":[]}' },
    ]);
    expect(mcp).toMatchObject({ output: '{"workspaces":[]}' });
    const [grep] = await end(
      'Grep',
      { pattern: 'gate' },
      { mode: 'files_with_matches', filenames: ['a.ts', 'b.ts'], numFiles: 2 },
    );
    expect(grep).toMatchObject({ output: 'a.ts\nb.ts' });
  });

  it('a long answer keeps its first 2 KB, said clipped', async () => {
    const [mcp] = await end('mcp__symbiote__review', {}, 'x'.repeat(3000) + '\nend');
    expect((mcp as { output?: string }).output).toHaveLength(2048);
    expect(mcp).toMatchObject({ clipped: true });
  });

  it("a failed command's exit code, a call its agent refused", async () => {
    const [failed] = await at({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'git log --bad' },
      tool_use_id: 't1',
      error: 'Exit code 128\nfatal: unrecognized argument',
      duration_ms: 30,
    });
    expect(failed).toMatchObject({ phase: 'end', failed: true, exit: 128, ms: 30 });
    const [refused] = await at({
      hook_event_name: 'PermissionDenied',
      tool_name: 'Read',
      tool_input: { file_path: '/etc/passwd' },
      tool_use_id: 't2',
      reason: 'outside the working directory',
    });
    expect(refused).toMatchObject({
      phase: 'end',
      id: 't2',
      failed: true,
      refused: 'outside the working directory',
    });
  });

  it("PreToolUse is the gate's, and an unknown event is nothing", async () => {
    expect(
      await at({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't' }),
    ).toEqual([]);
    expect(await at({ hook_event_name: 'SubagentStop' })).toEqual([]);
    expect(await hookLines(null, AT, CHECKOUT)).toEqual([]);
  });
});

describe('the file (decision 604)', () => {
  it('appends lines, redacted', () => {
    const folder = tempDir();
    const file = join(folder, NUCLEUS_ACTIVITY);
    appendActivity(
      file,
      [{ at: AT, kind: 'prompt', text: 'my token is ghp_0123456789abcdefghijABCDEFGHIJ012345' }],
      {},
    );
    appendActivity(file, [{ at: AT, kind: 'renewed' }], {});
    expect(lines(file)).toEqual([
      { at: AT, kind: 'prompt', text: 'my token is [redacted]' },
      { at: AT, kind: 'renewed' },
    ]);
  });

  it('moves a file over the limit to the older one, replacing it', async () => {
    const folder = tempDir();
    const file = join(folder, NUCLEUS_ACTIVITY);
    writeFileSync(join(folder, NUCLEUS_ACTIVITY_OLDER), 'oldest\n');
    writeFileSync(file, 'x'.repeat(100) + '\n');
    expect(await rotateActivity(folder, 1000)).toBe(false);
    writeFileSync(file, 'x'.repeat(2000) + '\n');
    expect(await rotateActivity(folder, 1000)).toBe(true);
    expect(statSync(join(folder, NUCLEUS_ACTIVITY_OLDER)).size).toBe(2001);
    expect(() => statSync(file)).toThrow();
    expect(ACTIVITY_ROTATE).toBe(4 * 1024 * 1024);
  });

  it('reads the newest bytes across the older file and the current one', async () => {
    const folder = tempDir();
    const line = (n: number) => `${JSON.stringify({ at: AT, kind: 'prompt', text: `p${n}` })}\n`;
    writeFileSync(join(folder, NUCLEUS_ACTIVITY_OLDER), [1, 2, 3].map(line).join(''));
    writeFileSync(join(folder, NUCLEUS_ACTIVITY), [4, 5].map(line).join('') + 'broken\n');
    const all = await readNucleusActivity(folder, 10_000);
    expect(all.cut).toBe(false);
    expect(all.lines.map((l) => ('text' in l ? l.text : ''))).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
    ]);
    const some = await readNucleusActivity(folder, line(1).length * 3 + 7);
    expect(some.cut).toBe(true);
    expect(some.lines.map((l) => ('text' in l ? l.text : ''))).toEqual(['p3', 'p4', 'p5']);
    expect(await readNucleusActivity(tempDir(), 1000)).toEqual({ lines: [], cut: false });
  });
});

describe('nucleusHook: the gate and the recorder in one process', () => {
  const args = (file: string) => [
    CHECKOUT,
    '/home/p/repo/symbiote/workspaces',
    `--activity=${file}`,
  ];

  it("answers PreToolUse as the gate does, and records the call's start", async () => {
    const file = join(tempDir(), NUCLEUS_ACTIVITY);
    const input = {
      ...head,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
      tool_use_id: 't9',
    };
    const out = await nucleusHook(JSON.stringify(input), args(file), {}, AT);
    expect(out).toBe(hookOutput(gateDecision(input, gateOptions(args(file)))));
    expect(lines(file)).toMatchObject([{ id: 't9', phase: 'start', gate: { decision: 'deny' } }]);
  });

  it('records any other event and answers nothing', async () => {
    const file = join(tempDir(), NUCLEUS_ACTIVITY);
    const input = { ...head, hook_event_name: 'UserPromptSubmit', prompt: 'hi' };
    expect(await nucleusHook(JSON.stringify(input), args(file), {}, AT)).toBe('');
    expect(lines(file)).toMatchObject([{ kind: 'prompt', text: 'hi' }]);
  });

  it('without --activity, the gate as before; broken input, no answer', async () => {
    const input = {
      ...head,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: {},
      tool_use_id: 't',
    };
    expect(await nucleusHook(JSON.stringify(input), [CHECKOUT], {}, AT)).toBe(
      hookOutput(gateDecision(input)),
    );
    expect(await nucleusHook('{', args(join(tempDir(), 'x.jsonl')), {}, AT)).toBe('');
  });
});
