// A merge's log on its page (V46a): its steps, each with its mark and time, and the text its
// read-only terminal is given. Pure.
import type { MergeAgentEvent, MergeEntry, MergeLogLine, MergeStep } from '@symbiote/core';
import { duration } from './merges.js';

/** How a step went: it runs, passed or failed; waits its turn; did not run; or never ended. */
export type StepMark = 'running' | 'passed' | 'failed' | 'waiting' | 'not-run' | 'stopped';

export interface LogStep {
  step: MergeStep;
  title: string;
  mark: StepMark;
  /** When it started (ms), for a running step's time. */
  at?: number;
  /** How long it took. */
  ms?: number;
  /** Which of the log's steps it is (0 the first): the terminal's heading. None for one to come. */
  index?: number;
}

/** A run of a merge: the first, then one per line saying why it ran again. */
export interface LogRun {
  why?: string;
  steps: LogStep[];
}

/** A step's name in the list: `Merge`, `Merger agent`, the command, `Land`. */
export function stepName(step: Pick<LogStep, 'step' | 'title'>): string {
  switch (step.step) {
    case 'merge':
      return 'Merge';
    case 'resolve':
      return 'Merger agent';
    case 'check':
      return step.title;
    case 'land':
      return 'Land';
  }
}

const RUNNING = new Set<MergeEntry['state']>(['merging', 'resolving', 'checking']);

/**
 * The log's runs and their steps. A step without its end runs while the entry does, else it
 * stopped. In the last run, the check's commands not started yet wait while it checks, and those
 * after a failed one did not run (as `failedCheck` says).
 */
export function logRuns(lines: readonly MergeLogLine[], entry: MergeEntry): LogRun[] {
  const runs: LogRun[] = [];
  let current: LogRun | null = null;
  let open: LogStep | null = null;
  let index = 0;
  for (const line of lines) {
    if ('run' in line) {
      current = { why: line.run, steps: [] };
      runs.push(current);
      open = null;
    } else if ('step' in line) {
      if (!current) runs.push((current = { steps: [] }));
      open = { step: line.step, title: line.title, mark: 'stopped', at: line.at, index: index++ };
      current.steps.push(open);
    } else if ('end' in line && open) {
      open.mark = line.end.ok ? 'passed' : 'failed';
      open.ms = line.end.ms;
      open = null;
    }
  }
  const last = runs.at(-1);
  if (!last) return runs;
  if (open && RUNNING.has(entry.state) && last.steps.at(-1) === open) open.mark = 'running';
  const commands = entry.check?.commands;
  const checks = last.steps.filter((s) => s.step === 'check');
  if (commands && checks.length > 0 && checks.length < commands.length) {
    const rest = commands.slice(checks.length);
    const lastCheck = checks.at(-1);
    const mark: StepMark | null =
      entry.state === 'checking' ? 'waiting' : lastCheck?.mark === 'failed' ? 'not-run' : null;
    if (mark && lastCheck) {
      const after = last.steps.indexOf(lastCheck) + 1;
      last.steps.splice(
        after,
        0,
        ...rest.map((title) => ({ step: 'check' as const, title, mark })),
      );
    }
  }
  return runs;
}

/** What the terminal has been given so far: whether its last line is open, steps and runs. */
export interface TextState {
  /** The last output ended without its newline. */
  open: boolean;
  /** Anything was written. */
  any: boolean;
  /** Step headings written. */
  steps: number;
  /** Runs, the first counted. */
  runs: number;
  /** What the merger agent was streaming last (V46b): its thinking or its text. */
  streaming?: 'think' | 'say';
  /** The characters of its JSON answer so far, while it streams one. */
  answer?: number;
}

export const NO_TEXT: TextState = { open: false, any: false, steps: 0, runs: 1 };

/** The state with no stream of the agent's open. */
const settle = ({ open, any, steps, runs }: TextState): TextState => ({ open, any, steps, runs });

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const THOUGHT = '\x1b[2;3m';
const RESET = '\x1b[0m';

/**
 * A log line as its terminal is given it (newlines as `\n`: the terminal turns them into line
 * ends), and the state after it. A step is headed `── <title>`, a blank line before all but the
 * first; its end says how it went and how long it took; a run after the first is numbered.
 * `heading`: the text ends with a step's heading line, for the terminal to mark.
 */
export function logText(
  line: MergeLogLine,
  state: TextState,
): { text: string; state: TextState; heading?: true } {
  const close = state.open ? '\n' : '';
  const settled = settle(state);
  if ('out' in line) {
    return {
      // An open line of the agent's ends first; a command's own output goes on as it came.
      text: `${state.streaming ? close : ''}${line.out}`,
      state: { ...settled, open: !line.out.endsWith('\n'), any: true },
    };
  }
  if ('agent' in line) return agentText(line.agent, state, close);
  if ('step' in line) {
    return {
      text: `${close}${state.any ? '\n' : ''}${BOLD}── ${line.title}${RESET}\n`,
      state: { ...settled, open: false, any: true, steps: state.steps + 1 },
      heading: true,
    };
  }
  if ('end' in line) {
    const how = line.end.ok
      ? `${GREEN}✓ passed${RESET} ${DIM}in ${duration(line.end.ms)}${RESET}`
      : `${RED}✗ failed${RESET} ${DIM}after ${duration(line.end.ms)}${RESET}`;
    return { text: `${close}${how}\n`, state: { ...settled, open: false, any: true } };
  }
  if ('run' in line) {
    const runs = state.runs + 1;
    return {
      text: `${close}\n${BOLD}▸ Run ${runs} · ${line.run}${RESET}\n`,
      state: { ...settled, open: false, any: true, runs },
    };
  }
  return { text: '', state };
}

/**
 * The merger agent's event as its terminal is given it (V46b): its start and Symbiote's notes dim,
 * its thinking dim and italic after `∴`, a tool `● Read src/a.ts` and its result `⎿ 42 lines`
 * under it, its text as written. Pieces of one stream go on the same line. Its JSON answer is
 * counted on one line rewritten in place: its regions are on Files, and its 20K tokens of escaped
 * text would bury the rest.
 */
function agentText(
  event: MergeAgentEvent,
  state: TextState,
  close: string,
): { text: string; state: TextState } {
  const settled = settle(state);
  const line = (text: string) => ({
    text: `${close}${text}\n`,
    state: { ...settled, open: false, any: true },
  });
  if ('say' in event) {
    const piece = event.say;
    const going = state.streaming === 'say';
    // Its answer is JSON for Symbiote, shown on Files region by region: counted on one line.
    const answer = going ? state.answer : /^\s*[{`]/.test(piece) ? 0 : undefined;
    if (answer !== undefined) {
      const n = answer + piece.length;
      return {
        text: `${going ? '' : close}\r\x1b[2K${DIM}Writing its answer: ${n.toLocaleString('en-US')} characters${RESET}`,
        state: { ...settled, open: true, any: true, streaming: 'say', answer: n },
      };
    }
    return {
      text: `${going ? '' : close}${piece}`,
      state: { ...settled, open: !piece.endsWith('\n'), any: true, streaming: 'say' },
    };
  }
  if ('think' in event) {
    const piece = event.think;
    const going = state.streaming === 'think';
    return {
      text: `${going ? '' : close}${THOUGHT}${going ? '' : '∴ '}${piece}${RESET}`,
      state: { ...settled, open: !piece.endsWith('\n'), any: true, streaming: 'think' },
    };
  }
  if ('tool' in event) return line(`${CYAN}●${RESET} ${event.tool} ${DIM}${event.input}${RESET}`);
  if ('result' in event) return line(`${DIM}  ⎿ ${event.result}${RESET}`);
  return line(`${DIM}${'start' in event ? event.start : event.note}${RESET}`);
}
