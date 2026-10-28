// The Activity tab's words (V73): how long, what an event did in a line, a group's status and the
// parts of its summary, each in its tone. Pure: the components draw what these say.
import { COMMAND_TOOLS, shortPath, shownCommand } from './classify.js';
import type { ActivityEvent } from './events.js';
import type { ActivityGroup } from './groups.js';

const firstLine = (text: string) =>
  (text.split('\n').find((line) => line.trim() !== '') ?? '').trim();

/** A duration, briefly: "480 ms", "4.2 s", "42 s", "2m 12s", "1h 2m". */
export function durationText(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const two = (n: number) => String(n).padStart(2, '0');

/** An elapsed time as a clock: "0:42", "12:03", "1:02:03". */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}

/** An event's line: the agent's words or a verb, and a command, a pattern or a path beside them. */
export interface EventWords {
  text?: string;
  /** Literal: a command, a pattern, a SHA. */
  code?: string;
  path?: string;
}

const VERBS: Record<string, string> = {
  Read: 'Read',
  Edit: 'Edited',
  MultiEdit: 'Edited',
  Write: 'Wrote',
  NotebookEdit: 'Edited',
  fileChange: 'Changed',
  WebFetch: 'Fetched',
  LS: 'Listed',
};

const STATUS: Record<string, string> = {
  in_progress: 'started',
  completed: 'completed',
  deleted: 'deleted',
  pending: 'pending',
};

/** What an event did, in a line (V73). */
export function eventWords(event: ActivityEvent, worktree: string): EventWords {
  if (event.kind === 'commit') {
    return { text: event.commit.subject, code: event.commit.sha.slice(0, 7) };
  }
  if (event.kind !== 'call') return { text: event.kind };
  const { tool, subject, input, about, task } = event.call;
  if (COMMAND_TOOLS.has(tool)) {
    const command = input ?? subject;
    const code = command ? firstLine(shownCommand(command, worktree)) : '';
    if (about) return { text: about, ...(code ? { code } : {}) };
    return code ? { code } : { text: 'Ran a command' };
  }
  const verb = VERBS[tool];
  if (verb) return subject ? { text: verb, path: shortPath(subject, worktree) } : { text: verb };
  switch (tool) {
    case 'Grep':
      return subject ? { text: 'Searched for', code: subject } : { text: 'Searched' };
    case 'Glob':
      return subject ? { text: 'Found files', code: subject } : { text: 'Found files' };
    case 'WebSearch':
    case 'webSearch':
      return { text: subject ? `Searched the web: ${subject}` : 'Searched the web' };
    case 'Task':
    case 'Agent':
      return { text: subject ? `Subagent: ${subject}` : 'Ran a subagent' };
    case 'TaskCreate':
      return { text: task?.subject ? `Added a task: ${task.subject}` : 'Added a task' };
    case 'TaskUpdate':
      return {
        text: task?.id
          ? `Task ${task.id} ${STATUS[task.status ?? ''] ?? 'updated'}`
          : 'Updated a task',
      };
    case 'TodoWrite':
      return { text: 'Updated its to-do list' };
    case 'ToolSearch':
      return { text: 'Loaded tools' };
    case 'Skill':
      return { text: 'Used a skill' };
    case 'reasoning':
      return { text: 'Thought' };
    case 'mcp':
      return { text: subject ? `Used ${subject}` : 'Used a tool' };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
      return { text: mcp ? `Used ${mcp[1]} · ${mcp[2]}` : `Used ${tool}` };
    }
  }
}

export type Tone = 'info' | 'error' | 'added' | 'warning' | 'muted';

/** A group's status as news: null when there is none to say (a phase done). */
export function statusWords(group: ActivityGroup): { text: string; tone: Tone } | null {
  switch (group.status) {
    case 'running':
      return { text: 'Running', tone: 'info' };
    case 'failed':
      return { text: 'Failed', tone: 'error' };
    case 'cancelled':
      return { text: 'Stopped', tone: 'muted' };
    case 'waiting':
      return { text: 'Waiting for you', tone: 'warning' };
    case 'open':
      return { text: 'No end recorded', tone: 'muted' };
    case 'recovered':
      return { text: 'Passed', tone: 'added' };
    default:
      // A test run done passed; debugging done was not run again: nothing to say.
      return group.kind === 'test' ? { text: 'Passed', tone: 'added' } : null;
  }
}

/** One part of a summary: words in a tone, a command as code, or lines added and removed. */
export interface SummaryPart {
  text: string;
  tone?: Tone;
  code?: true;
  lines?: { added: string; removed: string };
}

/** A summary's parts (split at " · "): a test's command as code, counts and lines in colour. */
export function summaryParts(group: ActivityGroup): SummaryPart[] {
  if (!group.summary) return [];
  return group.summary.split(' · ').map((text, i): SummaryPart => {
    const lines = /^(\+[\d,]+) (−[\d,]+)$/.exec(text);
    if (lines) return { text: '', lines: { added: lines[1] ?? '', removed: lines[2] ?? '' } };
    if (i === 0 && group.kind === 'test') return { text, code: true };
    if (/^[\d,]+ (failed|errors?)\b/.test(text) || /^failed\b/.test(text)) {
      return { text, tone: 'error' };
    }
    if (/^[\d,]+ passed\b/.test(text) || text === 'passed') return { text, tone: 'added' };
    if (/^[\d,]+ (flaky|warnings?)\b/.test(text)) return { text, tone: 'warning' };
    return { text };
  });
}
