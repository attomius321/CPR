// The Activity tab's words (V73): how long, what an event did in a line, a group's status and the
// parts of its summary, each in its tone; the colour of each kind of work (V74). Pure: the
// components draw what these say.
import type { ActivityEntry, TurnTokens } from '@symbiote/core';
import { callKind, COMMAND_TOOLS, shortPath, shownCommand, type WorkKind } from './classify.js';
import { symbioteTool, type ActivityEvent, type RawLine } from './events.js';

/** Nucleus's web tools (NU2): a line of its activity names its conversation. */
const NUCLEUS_WEB = new Set(['WebSearch', 'WebFetch', 'webSearch']);
import type { ActivityGroup, GroupKind } from './groups.js';

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
  // Nucleus's (NU2): its calls of Symbiote's tools; a workspace's agent's read as before.
  const symbiote =
    event.call.kind === 'symbiote' && !event.call.source ? symbioteTool(event.call) : null;
  if (symbiote) return { text: 'Used Symbiote’s', code: symbiote };
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
      // Symbiote's tools, as Nucleus calls them, and Symbiote's own record of them (NU2).
      const symbiote = event.call.source === 'symbiote' ? tool : null;
      if (symbiote) return { text: 'Symbiote answered', code: symbiote };
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
      return { text: mcp ? `Used ${mcp[1]} · ${mcp[2]}` : `Used ${tool}` };
    }
  }
}

export type Tone = 'info' | 'error' | 'added' | 'warning' | 'muted';

/** A group's status as news: null when there is none to say (a phase done). */
export function statusWords(group: ActivityGroup): { text: string; tone: Tone } | null {
  if (group.said) return group.said;
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
    if (/^[\d,]+ (failed|errors?|refused)\b/.test(text) || /^failed\b/.test(text)) {
      return { text, tone: 'error' };
    }
    if (/^[\d,]+ passed\b/.test(text) || text === 'passed') return { text, tone: 'added' };
    if (/^[\d,]+ (flaky|warnings?)\b/.test(text)) return { text, tone: 'warning' };
    return { text };
  });
}

/** A kind of work with a colour of its own (V74, decision 528): a `--phase-*` token. */
export type Phase = WorkKind | 'debug';

const PHASES: ReadonlySet<string> = new Set<Phase>([
  'explore',
  'implement',
  'docs',
  'test',
  'visual',
  'debug',
  'git',
  'web',
  'symbiote',
]);
const isPhase = (kind: string): kind is Phase => PHASES.has(kind);

/** A group's colour: its kind of work's, a commit git's; none for the milestones between. */
export function groupPhase(kind: GroupKind): Phase | null {
  if (kind === 'commit') return 'git';
  return isPhase(kind) ? kind : null;
}

/** An event's colour: its own call's kind of work (a read in an implementation explores), a commit git's. */
export function phaseOf(event: ActivityEvent): Phase | null {
  if (event.kind === 'commit') return 'git';
  if (event.kind !== 'call') return null;
  return event.call.kind !== undefined ? event.call.kind : callKind(event.call);
}

/** A raw line's colour: a tool line's by its call, a commit's git's; the thread's none. */
export function rawPhase(line: RawLine): Phase | null {
  if (line.source === 'commit') return 'git';
  if (line.source === 'symbiote') return 'symbiote';
  if (line.source !== 'tool' || typeof line.value !== 'object' || line.value === null) return null;
  const { tool, subject, input, about } = line.value as Partial<ActivityEntry>;
  if (typeof tool !== 'string') return null;
  // Nucleus's (NU2), a line of which names its conversation: its web tools and Symbiote's.
  if ((line.value as { conversation?: unknown }).conversation !== undefined) {
    if (symbioteTool({ tool, ...(subject ? { subject } : {}) })) return 'symbiote';
    if (NUCLEUS_WEB.has(tool)) return 'web';
  }
  return callKind({
    tool,
    ...(subject ? { subject } : {}),
    ...(input ? { input } : {}),
    ...(about ? { about } : {}),
  });
}

/** A count of tokens, briefly: "840", "12.4K", "1.2M". */
function tokenCount(n: number): string {
  if (n < 1000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * A turn's tokens as its agent reported them (NU2): "12.4K in, 86 % cached · 1.1K out"; the
 * cache's share only when some was read from it.
 */
export function tokensText(tokens: TurnTokens): string {
  const input = tokens.input + (tokens.cached ?? 0) + (tokens.cacheWrite ?? 0);
  const cached =
    input > 0 && (tokens.cached ?? 0) > 0
      ? `, ${Math.round(((tokens.cached ?? 0) / input) * 100)} % cached`
      : '';
  return `${tokenCount(input)} in${cached} · ${tokenCount(tokens.output)} out`;
}
