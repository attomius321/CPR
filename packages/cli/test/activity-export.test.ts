import { describe, expect, it } from 'vitest';
import type { ActivityEntry, NucleusActivityLine, ThreadEntry } from '@symbiote/core';
import {
  exportActivity,
  type NucleusSources,
  type WorkspaceSources,
} from '../src/activity-export.js';
import { secretsOf } from '../src/nucleus-record.js';

const NOW = new Date('2026-11-01T09:00:00.000Z');
const settings = { now: NOW, secrets: [] as [string, string][], timeZone: 'UTC' };
const S1 = '8ebed03b-25fc-4601-ac50-6c0dd7667003';

const entries: ThreadEntry[] = [
  { at: '2026-10-31T10:06:02.000Z', session: S1, kind: 'start', source: 'startup' },
  {
    at: '2026-10-31T10:06:03.000Z',
    session: S1,
    kind: 'prompt',
    text: 'You are starting a new feature.\n\n# Feature: export',
  },
  {
    at: '2026-10-31T10:20:00.000Z',
    session: S1,
    kind: 'asks',
    tool: 'AskUserQuestion',
    questions: [{ question: 'Which format?', options: ['Markdown', 'JSON'] }],
  },
  {
    at: '2026-10-31T10:40:00.000Z',
    session: S1,
    kind: 'report',
    text: '## Done\n\nThe export is built.',
  },
  {
    at: '2026-11-01T08:00:00.000Z',
    session: S1,
    kind: 'prompt',
    text: 'Check my review',
  },
  { at: '2026-11-01T08:30:00.000Z', session: S1, kind: 'end', reason: 'stopped' },
];

const tools: ActivityEntry[] = [
  {
    at: '2026-10-31T10:06:10.000Z',
    session: S1,
    id: 't1',
    tool: 'Bash',
    phase: 'start',
    subject: 'git log -5',
    input: 'git log -5',
    about: 'Show recent history',
  },
  {
    at: '2026-10-31T10:06:10.200Z',
    session: S1,
    id: 't1',
    tool: 'Bash',
    phase: 'end',
    ms: 180,
    exit: 0,
    output: 'abc1234 Plan',
  },
  {
    at: '2026-10-31T10:07:00.000Z',
    session: S1,
    id: 't2',
    tool: 'Bash',
    phase: 'start',
    subject: 'pnpm test',
    input: 'pnpm test \\\n  -- --run',
    about: 'Run the tests',
  },
  {
    at: '2026-10-31T10:07:42.000Z',
    session: S1,
    id: 't2',
    tool: 'Bash',
    phase: 'end',
    failed: true,
    exit: 1,
    ms: 42_000,
    output: 'FAIL test/a.test.ts\nexpected 1, got 2',
  },
  {
    at: '2026-10-31T10:08:00.000Z',
    session: S1,
    id: 't3',
    tool: 'Edit',
    phase: 'start',
    subject: 'src/a.ts',
  },
  {
    at: '2026-10-31T10:08:00.100Z',
    session: S1,
    id: 't3',
    tool: 'Edit',
    phase: 'end',
    added: 12,
    removed: 3,
  },
  {
    at: '2026-11-01T08:10:00.000Z',
    session: S1,
    id: 't4',
    tool: 'Bash',
    phase: 'start',
    subject: 'pnpm build',
  },
];

const workspace: WorkspaceSources = {
  of: 'workspace',
  repository: 'Symbiote',
  record: {
    agent: { kind: 'claude', model: 'opus', effort: 'xhigh' },
    base: '21e510eb656828272059689f6a3cc601dd24fcf5',
    branch: 'feature/export-activity',
    brief: '# Feature: export activity\n\n## Goal\nExport it.',
    created: '2026-10-31T10:06:01.000Z',
    from: 'main',
    kind: 'feature',
    planFirst: true,
    title: 'export activity',
    worktree: '/home/p/Symbiote.worktrees/feature-export-activity',
  },
  entries,
  tools,
  commits: [
    {
      sha: 'abc1234def5678',
      subject: 'Plan V84: export activity',
      author: 'a',
      date: '2026-10-31T12:30:00+02:00',
    },
  ],
  verdict: {
    at: '2026-11-01T07:00:00.000Z',
    event: 'request-changes',
    head: 'abc1234def5678',
    text: 'Fix the name.',
  },
};

const markdown = (sources: WorkspaceSources | NucleusSources, more = {}) =>
  exportActivity(sources, 'markdown', { ...settings, ...more }).text;

describe('a workspace as Markdown (V84, decision 668)', () => {
  it('reads as front matter, the brief and a timeline by day', () => {
    expect(markdown(workspace)).toBe(`---
symbiote-activity: 1
of: workspace
repository: "Symbiote"
branch: "feature/export-activity"
title: "export activity"
kind: "feature"
agent: "Claude Code"
model: "opus"
effort: "xhigh"
created: "2026-10-31T10:06:01.000Z"
from: "main"
base: "21e510eb656828272059689f6a3cc601dd24fcf5"
worktree: "/home/p/Symbiote.worktrees/feature-export-activity"
first: "2026-10-31T10:06:01.000Z"
last: "2026-11-01T08:30:00.000Z"
timezone: "UTC"
exported: "2026-11-01T09:00:00.000Z"
messages: 2
calls: 4
failed: 1
commits: 1
complete: true
---

# Activity: export activity

The workspace \`feature/export-activity\` (feature): Claude Code (opus, xhigh effort), made from \`main\` at \`21e510e\`. Times are UTC.

## Brief

> # Feature: export activity
>
> ## Goal
> Export it.

## Sat 31 Oct 2026

- 10:06:01 · Workspace made from \`main\` at \`21e510e\`
- 10:06:02 · Claude Code started (startup) · session \`8ebed03b\`

### 10:06:03 · Symbiote's prompt

> You are starting a new feature.
>
> # Feature: export

- 10:06:10 · Bash · \`git log -5\` · exit 0 · 180 ms — Show recent history
- 10:07:00 · Bash · \`pnpm test\` · **failed** · exit 1 · 42 s — Run the tests

  Input:

  \`\`\`
  pnpm test \\
    -- --run
  \`\`\`

  Output:

  \`\`\`
  FAIL test/a.test.ts
  expected 1, got 2
  \`\`\`

- 10:08:00 · Edit · \`src/a.ts\` · +12 −3 · 100 ms

### 10:20:00 · Asked: Which format?

Options: Markdown · JSON

- 10:30:00 · Commit \`abc1234\` · Plan V84: export activity

### 10:40:00 · Report

> ## Done
>
> The export is built.

## Sun 1 Nov 2026

### 07:00:00 · Review: changes requested at \`abc1234\`

> Fix the name.

### 08:00:00 · The person's message

> Check my review

- 08:10:00 · Bash · \`pnpm build\` · no end recorded
- 08:30:00 · Session ended: stopped
`);
  });
});

const C1 = '58851fe7-f8d8-4abf-ab02-8ecaec22d657';
const C2 = '1824b343-c00d-498d-9543-8c095018cfc1';
const of1 = { conversation: C1, agent: 'claude' as const };
const nucleusLines: NucleusActivityLine[] = [
  { at: '2026-10-30T17:10:30.000Z', kind: 'opened', ...of1, model: 'opus', effort: 'xhigh' },
  { at: '2026-10-30T17:10:31.000Z', kind: 'start', source: 'startup', ...of1 },
  { at: '2026-10-30T17:10:32.000Z', kind: 'prompt', text: 'What waits for me?', ...of1 },
  {
    at: '2026-10-30T17:10:40.000Z',
    session: C1,
    id: 'g1',
    tool: 'Bash',
    phase: 'start',
    subject: 'curl https://example.com',
    gate: { decision: 'deny', reason: 'Nucleus reads; it runs no other command' },
    ...of1,
  },
  {
    at: '2026-10-30T17:10:41.000Z',
    session: C1,
    id: 'w1',
    tool: 'WebFetch',
    phase: 'start',
    subject: 'https://code.claude.com/docs',
    gate: { decision: 'allow', reason: 'the web, as its agent reads it (NU1)' },
    ...of1,
  },
  {
    at: '2026-10-30T17:10:41.500Z',
    session: C1,
    id: 'w1',
    tool: 'WebFetch',
    phase: 'end',
    ms: 534,
    pages: [{ url: 'https://code.claude.com/docs', code: 200, bytes: 42_596 }],
    ...of1,
  },
  {
    at: '2026-10-30T17:10:42.000Z',
    session: C1,
    id: 's1',
    tool: 'WebSearch',
    phase: 'start',
    subject: 'agent teams',
    ...of1,
  },
  {
    at: '2026-10-30T17:10:47.000Z',
    session: C1,
    id: 's1',
    tool: 'WebSearch',
    phase: 'end',
    ms: 5_000,
    links: [{ title: 'Agent teams', url: 'https://example.com/teams' }],
    ...of1,
  },
  {
    at: '2026-10-30T17:10:48.000Z',
    session: 'symbiote',
    id: 'm1',
    tool: 'start_workspace',
    source: 'symbiote',
    phase: 'start',
    input: '{"branch":"fix/a"}',
  },
  {
    at: '2026-10-30T17:10:48.100Z',
    kind: 'confirm',
    ask: 'a1',
    tool: 'start_workspace',
    words: 'Start fix/a with Claude Code',
    call: 'm1',
    stage: 'asked',
    until: '2026-10-30T17:20:48.100Z',
  },
  {
    at: '2026-10-30T17:10:52.000Z',
    kind: 'confirm',
    ask: 'a1',
    tool: 'start_workspace',
    words: 'Start fix/a with Claude Code',
    call: 'm1',
    stage: 'ended',
    answer: 'declined',
    ms: 3_900,
  },
  {
    at: '2026-10-30T17:10:52.100Z',
    session: 'symbiote',
    id: 'm1',
    tool: 'start_workspace',
    source: 'symbiote',
    phase: 'end',
    ms: 4_100,
    failed: true,
    output: 'The person declined',
  },
  {
    at: '2026-10-30T17:11:00.000Z',
    kind: 'report',
    text: 'Nothing waits.',
    tokens: { input: 31_000, cached: 124_000, output: 603 },
    ms: 28_000,
    ...of1,
  },
  { at: '2026-10-30T17:12:00.000Z', kind: 'renewed', ...of1 },
  {
    at: '2026-10-30T17:12:01.000Z',
    kind: 'start',
    source: 'startup',
    conversation: C2,
    agent: 'codex',
  },
  {
    at: '2026-10-30T17:12:02.000Z',
    kind: 'compact',
    stage: 'after',
    summary: 'We looked at the queue.',
    conversation: C2,
    agent: 'codex',
  },
];

const nucleus: NucleusSources = { of: 'nucleus', repository: 'Symbiote', lines: nucleusLines };

describe('Nucleus as Markdown (V84)', () => {
  const text = markdown(nucleus);

  it('says what it is in its front matter', () => {
    expect(
      text.startsWith(`---
symbiote-activity: 1
of: nucleus
repository: "Symbiote"
conversations: 2
first: "2026-10-30T17:10:30.000Z"
last: "2026-10-30T17:12:02.000Z"
timezone: "UTC"
exported: "2026-11-01T09:00:00.000Z"
messages: 1
calls: 4
failed: 0
refused: 1
confirms: 1
complete: true
---

# Activity: Nucleus

Nucleus, the person's assistant in \`Symbiote\`, across its conversations. Times are UTC.
`),
    ).toBe(true);
  });

  it('heads each conversation, and says the gate, the pages, the results, Symbiote and the Confirm', () => {
    expect(text).toContain(`## Fri 30 Oct 2026

### Conversation \`58851fe7\` · Claude Code

- 17:10:30 · Symbiote opened a conversation on Claude Code (opus, xhigh effort)
- 17:10:31 · Claude Code started (startup)

### 17:10:32 · The person's message

> What waits for me?

- 17:10:40 · Bash · \`curl https://example.com\` · **refused by its gate**: Nucleus reads; it runs no other command
- 17:10:41 · WebFetch · \`https://code.claude.com/docs\` · 534 ms
  - 200 · 42,596 bytes · https://code.claude.com/docs
- 17:10:42 · WebSearch · \`agent teams\` · 5 s
  - Result: Agent teams — https://example.com/teams
- 17:10:48 · Symbiote · \`start_workspace\` · declined by the person · 4.1 s
- 17:10:48 · Confirm asked: Start fix/a with Claude Code (\`start_workspace\`)
- 17:10:52 · Confirm declined after 3.9 s

### 17:11:00 · Nucleus's answer · 155,000 tokens in (80 % cached) · 603 out · 28 s

> Nothing waits.

- 17:12:00 · New conversation: this one ended

### Conversation \`1824b343\` · Codex

- 17:12:01 · Codex started (startup)
- 17:12:02 · Context compacted

  > We looked at the queue.
`);
  });
});

describe('what the export keeps intact (V84)', () => {
  it('fences an output in one backtick more than its longest run, and quotes text whole', () => {
    const fenced: WorkspaceSources = {
      ...workspace,
      entries: [
        { at: '2026-10-31T10:40:00.000Z', session: S1, kind: 'report', text: '---\n```ts\nx\n```' },
      ],
      tools: [
        {
          at: '2026-10-31T10:07:00.000Z',
          session: S1,
          id: 'x',
          tool: 'Bash',
          phase: 'start',
          subject: 'cat `ls`',
        },
        {
          at: '2026-10-31T10:07:01.000Z',
          session: S1,
          id: 'x',
          tool: 'Bash',
          phase: 'end',
          exit: 2,
          output: 'a\n```\nb',
          clipped: true,
        },
      ],
      commits: [],
    };
    delete fenced.verdict;
    const text = markdown(fenced);
    expect(text).toContain('Bash · `` cat `ls` `` · **failed** · exit 2');
    expect(text).toContain('  Output (its end):\n\n  ````\n  a\n  ```\n  b\n  ````\n');
    expect(text).toContain('> ---\n> ```ts\n> x\n> ```\n');
  });

  it('redacts secrets in every string, by the environment and by their shape (decision 670)', () => {
    const secrets = secretsOf({ GITHUB_TOKEN: 'abcdefghij0123456789' });
    const leaking: WorkspaceSources = {
      ...workspace,
      tools: [
        {
          at: '2026-10-31T10:07:00.000Z',
          session: S1,
          id: 'x',
          tool: 'Bash',
          phase: 'start',
          subject: 'curl -H "auth: abcdefghij0123456789"',
          input: 'curl -H "auth: abcdefghij0123456789"',
        },
        {
          at: '2026-10-31T10:07:01.000Z',
          session: S1,
          id: 'x',
          tool: 'Bash',
          phase: 'end',
          exit: 1,
          output: 'token ghp_0123456789abcdefghijABCDEFGHIJ012345 refused',
        },
      ],
    };
    for (const format of ['markdown', 'jsonl'] as const) {
      const text = exportActivity(leaking, format, { ...settings, secrets }).text;
      expect(text).not.toContain('abcdefghij0123456789');
      expect(text).not.toContain('ghp_0123456789');
      expect(text).toContain('[redacted: GITHUB_TOKEN]');
      expect(text).toContain('token [redacted] refused');
    }
  });

  it('says what could not be read: not complete, and why', () => {
    const text = markdown({
      ...workspace,
      missing: ['Its calls: its agent started before Symbiote recorded them'],
    });
    expect(text).toContain(
      'complete: false\nmissing:\n  - "Its calls: its agent started before Symbiote recorded them"\n---',
    );
    expect(text).toContain(
      '\n**Not in this export**: Its calls: its agent started before Symbiote recorded them.\n',
    );
  });

  it('names the file by the repository, the branch and the day, with its type', () => {
    expect(exportActivity(workspace, 'markdown', settings)).toMatchObject({
      name: 'activity-Symbiote-feature-export-activity-2026-11-01.md',
      type: 'text/markdown; charset=utf-8',
    });
    expect(exportActivity(nucleus, 'jsonl', settings)).toMatchObject({
      name: 'activity-Symbiote-nucleus-2026-11-01.jsonl',
      type: 'application/x-ndjson; charset=utf-8',
    });
  });
});

describe('JSON Lines: every line as read, by its record (decision 668)', () => {
  const lines = exportActivity(workspace, 'jsonl', settings)
    .text.trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  it('starts with a header, then the record, each thread entry, tool line, commit and the verdict', () => {
    expect(lines[0]).toEqual({
      record: 'export',
      'symbiote-activity': 1,
      of: 'workspace',
      repository: 'Symbiote',
      branch: 'feature/export-activity',
      timezone: 'UTC',
      exported: '2026-11-01T09:00:00.000Z',
      complete: true,
    });
    const count = (record: string) => lines.filter((l) => l.record === record).length;
    expect(count('workspace')).toBe(1);
    expect(count('thread')).toBe(entries.length);
    expect(count('tool')).toBe(tools.length);
    expect(count('commit')).toBe(1);
    expect(count('verdict')).toBe(1);
    expect(lines.find((l) => l.record === 'tool' && l.id === 't2' && l.phase === 'end')).toEqual({
      record: 'tool',
      ...tools[3],
    });
  });

  it('keeps them in time order', () => {
    const times = lines.slice(1).map((l) => Date.parse((l.at ?? l.date ?? l.created) as string));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("Nucleus's lines as recorded", () => {
    const read = exportActivity(nucleus, 'jsonl', settings).text.trimEnd().split('\n');
    expect(read).toHaveLength(nucleusLines.length + 1);
    expect(JSON.parse(read[1] as string)).toEqual({ record: 'nucleus', ...nucleusLines[0] });
  });
});

describe('within a size (the MCP, decision 672)', () => {
  it('leaves out the oldest messages and what followed them first, and says so', () => {
    const whole = markdown(workspace);
    const text = markdown(workspace, { maxBytes: Buffer.byteLength(whole) - 200 });
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(Buffer.byteLength(whole) - 200);
    expect(text).not.toContain("Symbiote's prompt");
    expect(text).toContain("### 08:00:00 · The person's message");
    expect(text).toContain('complete: false');
    expect(text).toContain('The oldest message and what followed it, left out to fit');
    expect(text).toContain('## Brief');
  });

  it('gives all of it when it fits', () => {
    expect(markdown(workspace, { maxBytes: 1_000_000 })).toBe(markdown(workspace));
  });
});
