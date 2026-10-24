import type { MergeAgentEvent, MergeEntry, MergeLogLine } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  logRuns,
  logText,
  NO_TEXT,
  stepName,
  type LogStep,
  type TextState,
} from '../src/workspaces/merge-log.js';

const entry = (fields: Partial<MergeEntry> = {}): MergeEntry => ({
  id: 'm1',
  branch: 'topic',
  head: 'a'.repeat(40),
  into: 'main',
  title: 'Merge topic: T',
  state: 'landed',
  queued: '2026-10-24T12:00:00.000Z',
  updated: '2026-10-24T12:00:00.000Z',
  ...fields,
});

let at = 1000;
const step = (kind: LogStep['step'], title: string): MergeLogLine => ({
  at: (at += 10),
  step: kind,
  title,
});
const out = (text: string): MergeLogLine => ({ at: (at += 10), out: text });
const end = (ok: boolean, ms: number): MergeLogLine => ({ at: (at += 10), end: { ok, ms } });
const run = (why: string): MergeLogLine => ({ at: (at += 10), run: why });

/** Each step in short: `<name> <mark> <ms>`. */
const marks = (steps: readonly LogStep[]) =>
  steps.map((s) => `${stepName(s)} ${s.mark}${s.ms === undefined ? '' : ` ${s.ms}`}`);

describe("a merge's steps, from its log (V46a)", () => {
  it('names each step: the merge, the merger agent, a check command, the landing', () => {
    const lines = [
      step('merge', 'Merge topic into main'),
      end(true, 300),
      step('resolve', 'Merger agent'),
      end(true, 4000),
      step('check', 'pnpm check'),
      out('ok\n'),
      end(true, 47500),
      step('land', 'Land in main'),
      end(true, 12),
    ];
    const runs = logRuns(lines, entry());
    expect(runs).toHaveLength(1);
    expect(runs[0]?.why).toBeUndefined();
    expect(marks(runs[0]?.steps ?? [])).toEqual([
      'Merge passed 300',
      'Merger agent passed 4000',
      'pnpm check passed 47500',
      'Land passed 12',
    ]);
    // Each step knows which of the log's steps it is: the terminal's heading to scroll to.
    expect(runs[0]?.steps.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('marks the step that runs, from when it started, and the commands still to run as waiting', () => {
    const started = step('check', 'pnpm check');
    const lines = [
      step('merge', 'Merge topic into main'),
      end(true, 300),
      step('check', 'pnpm install'),
      end(true, 200),
      started,
      out('…\n'),
    ];
    const checking = entry({
      state: 'checking',
      check: { commands: ['pnpm install', 'pnpm check', 'pnpm build'], source: 'x' },
    });
    const [only] = logRuns(lines, checking);
    expect(marks(only?.steps ?? [])).toEqual([
      'Merge passed 300',
      'pnpm install passed 200',
      'pnpm check running',
      'pnpm build waiting',
    ]);
    expect(only?.steps[2]?.at).toBe(started.at);
    expect(only?.steps[3]?.index).toBeUndefined();
  });

  it('marks the commands after a failed one as not run, before a landing that followed', () => {
    const lines = [
      step('merge', 'Merge topic into main'),
      end(true, 300),
      step('check', 'first'),
      end(true, 10),
      step('check', 'then fail'),
      end(false, 20),
      step('land', 'Land in main'),
      end(true, 5),
    ];
    const failed = entry({
      check: {
        commands: ['first', 'then fail', 'never'],
        source: 'x',
        ok: false,
        failed: 'then fail',
      },
    });
    expect(marks(logRuns(lines, failed)[0]?.steps ?? [])).toEqual([
      'Merge passed 300',
      'first passed 10',
      'then fail failed 20',
      'never not-run',
      'Land passed 5',
    ]);
  });

  it('says a step that never ended stopped, once nothing runs', () => {
    const lines = [step('merge', 'Merge topic into main'), end(true, 300), step('check', 'slow')];
    expect(marks(logRuns(lines, entry({ state: 'queued' }))[0]?.steps ?? [])).toEqual([
      'Merge passed 300',
      'slow stopped',
    ]);
  });

  it('starts a run at each line saying why the merge runs again', () => {
    const lines = [
      step('merge', 'Merge topic into main'),
      end(true, 300),
      step('check', 'flaky'),
      end(false, 20),
      run('Check again'),
      step('check', 'flaky'),
      end(true, 20),
    ];
    const runs = logRuns(lines, entry({ state: 'needs-you' }));
    expect(runs.map((r) => r.why)).toEqual([undefined, 'Check again']);
    expect(marks(runs[1]?.steps ?? [])).toEqual(['flaky passed 20']);
    expect(runs[1]?.steps[0]?.index).toBe(2);
  });

  it('has no steps without a log', () => {
    expect(logRuns([], entry())).toEqual([]);
  });
});

/** The text of `lines` as the terminal is given it, from the start. */
function textOf(lines: readonly MergeLogLine[]): string {
  let state: TextState = NO_TEXT;
  let text = '';
  for (const line of lines) {
    const next = logText(line, state);
    text += next.text;
    state = next.state;
  }
  return text;
}

describe("a merge's log in its terminal (V46a)", () => {
  it('heads each step, writes its output as it came, and ends it with how it went', () => {
    expect(
      textOf([
        step('merge', 'Merge topic into main'),
        out('Merged a: b\n'),
        end(true, 300),
        step('check', 'pnpm check'),
        out('1 failed\n'),
        end(false, 61_000),
      ]),
    ).toBe(
      '\x1b[1m── Merge topic into main\x1b[0m\n' +
        'Merged a: b\n' +
        '\x1b[32m✓ passed\x1b[0m \x1b[2min 0.3 s\x1b[0m\n' +
        '\n\x1b[1m── pnpm check\x1b[0m\n' +
        '1 failed\n' +
        '\x1b[31m✗ failed\x1b[0m \x1b[2mafter 1 min 1 s\x1b[0m\n',
    );
  });

  it('ends output left without its newline before what follows', () => {
    expect(textOf([step('check', 'x'), out('no newline'), end(true, 1)])).toBe(
      '\x1b[1m── x\x1b[0m\nno newline\n\x1b[32m✓ passed\x1b[0m \x1b[2min 0.0 s\x1b[0m\n',
    );
  });

  it('numbers each run after the first, with why', () => {
    expect(textOf([step('check', 'x'), end(false, 1), run('Retry')])).toContain(
      '\n\x1b[1m▸ Run 2 · Retry\x1b[0m\n',
    );
  });

  it('counts the steps it headed: the terminal marks each heading', () => {
    let state: TextState = NO_TEXT;
    for (const line of [step('merge', 'm'), end(true, 1), step('check', 'c')]) {
      state = logText(line, state).state;
    }
    expect(state.steps).toBe(2);
  });
});

const agent = (event: MergeAgentEvent): MergeLogLine => ({ at: (at += 10), agent: event });

describe("the merger agent's process in the terminal (V46b)", () => {
  it('draws its start dim, its thinking dim and italic after ∴, its tools and their results, its text', () => {
    expect(
      textOf([
        step('resolve', 'Merger agent'),
        out('Asking Claude Code (sonnet): 1 region in 1 file, 900 characters\n'),
        agent({ start: 'Claude Code 2.1.310 · claude-sonnet-5-5' }),
        agent({ think: 'Both sides ' }),
        agent({ think: 'add a function.' }),
        agent({ tool: 'Read', input: 'src/math.ts' }),
        agent({ result: '42 lines' }),
        agent({ think: 'Keep both.' }),
        agent({ say: '{"regions":' }),
        agent({ say: '{"1":"x"}}' }),
        out('Answered in 4.0 s\n'),
      ]),
    ).toBe(
      '\x1b[1m── Merger agent\x1b[0m\n' +
        'Asking Claude Code (sonnet): 1 region in 1 file, 900 characters\n' +
        '\x1b[2mClaude Code 2.1.310 · claude-sonnet-5-5\x1b[0m\n' +
        '\x1b[2;3m∴ Both sides \x1b[0m\x1b[2;3madd a function.\x1b[0m\n' +
        '\x1b[36m●\x1b[0m Read \x1b[2msrc/math.ts\x1b[0m\n' +
        '\x1b[2m  ⎿ 42 lines\x1b[0m\n' +
        '\x1b[2;3m∴ Keep both.\x1b[0m\n' +
        '{"regions":{"1":"x"}}\n' +
        'Answered in 4.0 s\n',
    );
  });

  it('draws a note of Symbiote’s on the run dim, as its start', () => {
    expect(textOf([agent({ note: 'its thinking is not shown' })])).toBe(
      '\x1b[2mits thinking is not shown\x1b[0m\n',
    );
  });
});
