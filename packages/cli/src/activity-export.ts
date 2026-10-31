// An activity taken out of Symbiote (V84, decisions 668–672): a workspace's (its record, thread,
// tools, commits and verdict, as its Activity tab merges them) or Nucleus's (NU2's file), as one
// Markdown file a person or an agent reads whole — front matter with the facts, the brief, then
// the timeline by day: messages, reports and asks as headings, one list item a call, a failed
// call's input and output under it — or as JSON Lines, every line as read with the record it came
// from. Pure: the services read the sources; every string is redacted here, before anything is
// written (decision 670).
import type {
  ActivityEntry,
  AgentKind,
  NucleusActivityLine,
  NucleusCall,
  NucleusEntry,
  ThreadEntry,
  TurnTokens,
  WorkspaceCommit,
  WorkspaceThread,
} from '@symbiote/core';
import { redactDeep } from './nucleus-record.js';
import type { WorkspaceFile } from './workspace-record.js';

export const EXPORT_FORMATS = ['markdown', 'jsonl'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The version of the export's shape, in its front matter and its JSON Lines' header. */
export const EXPORT_VERSION = 1;

/** A workspace's activity as its service read it. */
export interface WorkspaceSources {
  of: 'workspace';
  /** The repository's folder name. */
  repository: string;
  record: WorkspaceFile;
  /** Its thread, whole, oldest first. */
  entries: readonly ThreadEntry[];
  /** Its tools' starts and ends, whole, oldest first. */
  tools: readonly ActivityEntry[];
  commits: readonly WorkspaceCommit[];
  verdict?: WorkspaceThread['verdict'];
  /** What could not be read, each in a sentence. */
  missing?: readonly string[];
}

/** Nucleus's activity: its file's lines, whole, oldest first. */
export interface NucleusSources {
  of: 'nucleus';
  repository: string;
  lines: readonly NucleusActivityLine[];
  missing?: readonly string[];
}

export type ActivitySources = WorkspaceSources | NucleusSources;

export interface ExportSettings {
  now: Date;
  /** The values to hide, by variable (`secretsOf`). */
  secrets: readonly [string, string][];
  /** The time zone the Markdown's times are in: the machine's when absent. */
  timeZone?: string;
  /**
   * Markdown only: at most this many bytes, the oldest messages and what followed them left out
   * first, and said (the MCP's answer, decision 672).
   */
  maxBytes?: number;
}

/** An export: its text, the file name to save it as, and its media type. */
export interface ActivityExport {
  text: string;
  name: string;
  type: string;
}

const AGENTS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  hermes: 'Hermes',
};
const agentName = (kind: AgentKind | undefined) => (kind ? AGENTS[kind] : 'its agent');

/** One activity in the given format. */
export function exportActivity(
  sources: ActivitySources,
  format: ExportFormat,
  settings: ExportSettings,
): ActivityExport {
  const clean = redactDeep(sources, settings.secrets) as ActivitySources;
  const zone = settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = dateOf(settings.now, zone);
  const who = clean.of === 'workspace' ? safe(clean.record.branch) : 'nucleus';
  const name = `activity-${safe(clean.repository)}-${who}-${day}`;
  if (format === 'jsonl') {
    return {
      text: jsonLines(clean, settings.now, zone),
      name: `${name}.jsonl`,
      type: 'application/x-ndjson; charset=utf-8',
    };
  }
  return {
    text: markdown(clean, settings.now, zone, settings.maxBytes),
    name: `${name}.md`,
    type: 'text/markdown; charset=utf-8',
  };
}

const safe = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

// --- Times ---------------------------------------------------------------------------------------

const timeOf = (at: string | undefined) => {
  const t = at === undefined ? NaN : Date.parse(at);
  return Number.isNaN(t) ? null : t;
};

function parts(ms: number, zone: string, options: Intl.DateTimeFormatOptions) {
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', { ...options, timeZone: zone }).formatToParts(
    ms,
  )) {
    out[part.type] = part.value;
  }
  return out;
}

/** `10:06:01` in `zone`. */
function clock(ms: number, zone: string): string {
  const p = parts(ms, zone, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** `Sat 31 Oct 2026` in `zone`. */
function dayText(ms: number, zone: string): string {
  const p = parts(ms, zone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** `2026-10-31` in `zone`. */
function dateOf(date: Date, zone: string): string {
  const p = parts(date.getTime(), zone, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** A duration in words: `180 ms`, `4.2 s`, `42 s`, `3 min 12 s`, `1 h 4 min`. */
export function duration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 10) return `${String(Math.round(s * 10) / 10)} s`;
  if (s < 60) return `${String(Math.round(s))} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) {
    const rest = Math.round(s - minutes * 60);
    return rest > 0 ? `${String(minutes)} min ${String(rest)} s` : `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes - hours * 60;
  return rest > 0 ? `${String(hours)} h ${String(rest)} min` : `${String(hours)} h`;
}

const number = (n: number) => n.toLocaleString('en-US');

// --- Markdown's pieces ---------------------------------------------------------------------------

/** Inline code holding `text` whole: a run of backticks longer than any in it. */
function code(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ');
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${flat}${pad}${ticks}`;
}

/** A fenced block holding `text` whole: its fence one backtick longer than any run in it. */
function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`{3,}/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}\n${text.replace(/\n+$/, '')}\n${ticks}`;
}

/** `text` quoted, every line: its headings and fences stay inside the quote. */
const quote = (text: string) =>
  text
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');

/** `text` indented under a list item. */
const indent = (text: string) =>
  text
    .split('\n')
    .map((line) => (line === '' ? '' : `  ${line}`))
    .join('\n');

const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
const yaml = (value: string | number | boolean) =>
  typeof value === 'string' ? JSON.stringify(value) : String(value);

/**
 * A piece of the timeline: a list item (its sub-items in `text`; `body`, paragraphs under it), or
 * a heading with what it says under it. `at` places it; `day` and `conversation` head it.
 */
interface Piece {
  at: number | null;
  kind: 'item' | 'heading';
  text: string;
  body?: string[];
  /** A message: where the timeline is cut to fit (`maxBytes`). */
  message?: true;
  /** Nucleus: the conversation it belongs to, when its line names one. */
  conversation?: { id: string; agent?: AgentKind };
}

const when = (at: number | null, zone: string) => (at === null ? '--:--:--' : clock(at, zone));

function item(at: number | null, zone: string, text: string, body?: string[]): Piece {
  return { at, kind: 'item', text: `- ${when(at, zone)} · ${text}`, ...(body ? { body } : {}) };
}

function heading(at: number | null, zone: string, text: string, body?: string[]): Piece {
  return {
    at,
    kind: 'heading',
    text: `### ${when(at, zone)} · ${text}`,
    ...(body ? { body } : {}),
  };
}

// --- Calls ---------------------------------------------------------------------------------------

/** A call's start and end lines, paired by ID, in the order the first came (a repeat ignored). */
function callsOf<T extends ActivityEntry>(lines: readonly T[]): { start?: T; end?: T }[] {
  const calls = new Map<string, { start?: T; end?: T }>();
  for (const line of lines) {
    const call = calls.get(line.id) ?? {};
    if (line.phase === 'start' && !call.start) call.start = line;
    if (line.phase === 'end' && !call.end) call.end = line;
    calls.set(line.id, call);
  }
  return [...calls.values()];
}

const failedCall = (end: ActivityEntry | undefined) =>
  !!end && (end.failed === true || (end.exit !== undefined && end.exit !== 0));

/**
 * A call as a list item, and under it, when it failed, its input and output. `declined`: how the
 * person's Confirm for it ended when it was not a yes (Nucleus's calls of Symbiote, NU2): neither
 * a failure nor its output then.
 */
function callPiece(
  call: { start?: NucleusCall; end?: NucleusCall },
  zone: string,
  declined?: string,
): Piece {
  const { start, end } = call;
  const line = (start ?? end) as NucleusCall;
  const symbiote = line.source === 'symbiote';
  const subject = start?.subject ?? end?.subject;
  const said: string[] = symbiote
    ? ['Symbiote', code(line.tool)]
    : [line.tool, ...(subject ? [code(subject)] : [])];
  const gate = start?.gate;
  const refusedByGate = gate?.decision === 'deny';
  const failed = !declined && failedCall(end);
  if (refusedByGate) {
    said.push(`**refused by its gate**${gate.reason ? `: ${gate.reason}` : ''}`);
  } else {
    if (end?.refused) said.push(`**refused**: ${end.refused}`);
    if (declined) said.push(declined);
    if (failed) said.push('**failed**');
    if (end?.exit !== undefined) said.push(`exit ${String(end.exit)}`);
    if (end?.added !== undefined || end?.removed !== undefined) {
      said.push(`+${String(end.added ?? 0)} −${String(end.removed ?? 0)}`);
    }
    const startAt = timeOf(start?.at);
    const endAt = timeOf(end?.at);
    const ms =
      end?.ms ??
      (startAt !== null && endAt !== null && !start?.untimed && !end?.untimed
        ? endAt - startAt
        : undefined);
    if (ms !== undefined) said.push(duration(ms));
    if (end?.interrupted) said.push('interrupted');
    if (end?.background) said.push('sent to the background');
    if (!end) said.push('no end recorded');
  }
  const task = start?.task ?? end?.task;
  if (task?.subject) said.push(`task: ${task.subject}`);
  else if (task?.status) said.push(`task ${task.id ?? ''}: ${task.status}`.replace(' :', ':'));
  const about = start?.about ? ` — ${start.about}` : '';
  const sub = [
    ...(end?.pages ?? []).map(
      (page) =>
        `  - ${[
          page.code !== undefined ? String(page.code) : '',
          page.bytes !== undefined ? `${number(page.bytes)} bytes` : '',
          page.title ?? '',
          page.url,
        ]
          .filter(Boolean)
          .join(' · ')}`,
    ),
    ...(end?.links ?? []).map(
      (link) => `  - Result: ${link.title ? `${link.title} — ${link.url}` : link.url}`,
    ),
  ];
  const at = timeOf(start?.at ?? end?.at);
  const untimed = (start ?? end)?.untimed === true;
  const piece = item(untimed ? null : at, zone, `${said.join(' · ')}${about}`);
  piece.at = at;
  if (sub.length > 0) piece.text += `\n${sub.join('\n')}`;
  if (failed) {
    const body: string[] = [];
    if (start?.input && start.input !== subject) body.push('Input:', fence(start.input));
    if (end?.output) body.push(end.clipped ? 'Output (its end):' : 'Output:', fence(end.output));
    if (body.length > 0) piece.body = body;
  }
  return piece;
}

// --- A workspace ---------------------------------------------------------------------------------

const VERDICTS = {
  approve: 'approved',
  'request-changes': 'changes requested',
  comment: 'commented',
} as const;

/** How a session started, in words. */
function started(source: string, agent: string, first: boolean): string {
  if (first || source === 'startup') return `${agent} started (${source})`;
  if (source === 'resume') return 'Continued (resume)';
  if (source === 'compact') return 'Continued after compacting';
  if (source === 'clear') return 'Started again: context cleared';
  return `Started again (${source})`;
}

function asked(entry: Extract<ThreadEntry, { kind: 'asks' }>, at: number | null, zone: string) {
  const questions = entry.questions ?? [];
  if (questions.length === 0) {
    return heading(
      at,
      zone,
      `Asked for permission: ${entry.tool}`,
      entry.input ? [fence(entry.input)] : undefined,
    );
  }
  const body =
    questions.length === 1
      ? questions[0]?.options.length
        ? [`Options: ${(questions[0]?.options ?? []).join(' · ')}`]
        : undefined
      : questions.map((q) => `${q.question}: ${q.options.join(' · ')}`);
  return heading(at, zone, `Asked: ${questions.map((q) => q.question).join('; ')}`, body);
}

function workspacePieces(sources: WorkspaceSources, zone: string): Piece[] {
  const { record } = sources;
  const agent = agentName(record.agent?.kind);
  const pieces: Piece[] = [];
  const short = record.base.slice(0, 7);
  pieces.push(
    item(
      timeOf(record.created),
      zone,
      record.from
        ? `Workspace made from ${code(record.from)} at ${code(short)}`
        : `Workspace made at ${code(short)}`,
    ),
  );
  let firstStart = true;
  let firstPrompt = true;
  for (const entry of sources.entries) {
    const at = timeOf(entry.at);
    switch (entry.kind) {
      case 'start':
        pieces.push(
          item(
            at,
            zone,
            `${started(entry.source, agent, firstStart)} · session ${code(entry.session.slice(0, 8))}`,
          ),
        );
        firstStart = false;
        break;
      case 'end':
        pieces.push(item(at, zone, `Session ended${entry.reason ? `: ${entry.reason}` : ''}`));
        break;
      case 'prompt': {
        if (!firstPrompt && entry.text.trimStart().startsWith('<task-notification>')) {
          const summary = /<summary>([^<]+)<\/summary>/.exec(entry.text)?.[1]?.trim();
          pieces.push(item(at, zone, `A background task ended${summary ? `: ${summary}` : ''}`));
          break;
        }
        const piece = heading(
          at,
          zone,
          firstPrompt ? "Symbiote's prompt" : "The person's message",
          [quote(entry.text)],
        );
        piece.message = true;
        pieces.push(piece);
        firstPrompt = false;
        break;
      }
      case 'report':
        pieces.push(heading(at, zone, 'Report', [quote(entry.text)]));
        break;
      case 'asks':
        pieces.push(asked(entry, at, zone));
        break;
      case 'notice':
        pieces.push(
          item(at, zone, `Notice (${entry.type})${entry.message ? `: ${entry.message}` : ''}`),
        );
        break;
    }
  }
  for (const call of callsOf(sources.tools)) pieces.push(callPiece(call, zone));
  for (const commit of sources.commits) {
    pieces.push(
      item(timeOf(commit.date), zone, `Commit ${code(commit.sha.slice(0, 7))} · ${commit.subject}`),
    );
  }
  const { verdict } = sources;
  if (verdict) {
    pieces.push(
      heading(
        timeOf(verdict.at),
        zone,
        `Review: ${VERDICTS[verdict.event]} at ${code(verdict.head.slice(0, 7))}`,
        verdict.text ? [quote(verdict.text)] : undefined,
      ),
    );
  }
  return pieces;
}

// --- Nucleus -------------------------------------------------------------------------------------

const CONFIRM_ENDS = {
  confirmed: 'Confirmed',
  declined: 'Confirm declined',
  expired: 'Confirm not answered in time',
  gone: 'Confirm ended: its call ended first',
} as const;

/** A turn's tokens in words: `155,000 tokens in (80 % cached) · 603 out`. */
function tokensText(tokens: TurnTokens): string {
  const cached = tokens.cached ?? 0;
  const total = tokens.input + cached + (tokens.cacheWrite ?? 0);
  const share =
    total > 0 && cached > 0 ? ` (${String(Math.round((cached / total) * 100))} % cached)` : '';
  return `${number(total)} tokens in${share} · ${number(tokens.output)} out`;
}

function nucleusEntryPiece(entry: NucleusEntry, zone: string): Piece | null {
  const at = timeOf(entry.at);
  const agent = agentName(entry.agent);
  switch (entry.kind) {
    case 'prompt': {
      const piece = heading(at, zone, "The person's message", [quote(entry.text)]);
      piece.message = true;
      return piece;
    }
    case 'report': {
      const said = [
        "Nucleus's answer",
        ...(entry.tokens ? [tokensText(entry.tokens)] : []),
        ...(entry.ms !== undefined ? [duration(entry.ms)] : []),
      ];
      return heading(at, zone, said.join(' · '), [quote(entry.text)]);
    }
    case 'start':
      return item(
        at,
        zone,
        `${started(entry.source, agent, false)}${entry.model ? ` · ${entry.model}` : ''}`,
      );
    case 'end':
      return item(at, zone, `Session ended${entry.reason ? `: ${entry.reason}` : ''}`);
    case 'compact':
      return entry.stage === 'before'
        ? item(at, zone, `Context compacting${entry.trigger ? ` (${entry.trigger})` : ''}`)
        : item(at, zone, 'Context compacted', entry.summary ? [quote(entry.summary)] : undefined);
    case 'error':
      return item(
        at,
        zone,
        `**Error**: ${firstLine(entry.error)}`,
        entry.details || entry.error.includes('\n')
          ? [fence([entry.error, entry.details ?? ''].filter(Boolean).join('\n\n'))]
          : undefined,
      );
    case 'notice':
      return item(at, zone, `Notice (${entry.type})${entry.message ? `: ${entry.message}` : ''}`);
    case 'interrupted':
      return item(at, zone, 'Interrupted by the person');
    case 'opened': {
      const on = [entry.model, entry.effort ? `${entry.effort} effort` : ''].filter(Boolean);
      return item(
        at,
        zone,
        `Symbiote opened a conversation on ${agent}${on.length > 0 ? ` (${on.join(', ')})` : ''}`,
      );
    }
    case 'renewed':
      return item(at, zone, 'New conversation: this one ended');
    case 'confirm':
      return entry.stage === 'asked'
        ? item(at, zone, `Confirm asked: ${entry.words} (${code(entry.tool)})`)
        : item(at, zone, `${CONFIRM_ENDS[entry.answer]} after ${duration(entry.ms)}`);
    default:
      return null;
  }
}

const isCall = (line: NucleusActivityLine): line is NucleusCall =>
  'phase' in line && (line.phase === 'start' || line.phase === 'end');

const NOT_YES = {
  declined: 'declined by the person',
  expired: 'not answered in time',
  gone: 'its call ended before an answer',
} as const;

/** Symbiote's calls whose Confirm ended without a yes, by the call's ID, in words. */
function notConfirmed(lines: readonly NucleusActivityLine[]): Map<string, string> {
  const ends = new Map<string, string>();
  for (const line of lines) {
    if (isCall(line) || line.kind !== 'confirm' || line.stage !== 'ended' || !line.call) continue;
    if (line.answer !== 'confirmed') ends.set(line.call, NOT_YES[line.answer]);
  }
  return ends;
}

function nucleusPieces(sources: NucleusSources, zone: string): Piece[] {
  const pieces: Piece[] = [];
  const of = (line: NucleusActivityLine) =>
    line.conversation
      ? { id: line.conversation, ...(line.agent ? { agent: line.agent } : {}) }
      : null;
  for (const line of sources.lines) {
    if (isCall(line)) continue;
    const piece = nucleusEntryPiece(line, zone);
    const conversation = of(line);
    if (piece && conversation) piece.conversation = conversation;
    if (piece) pieces.push(piece);
  }
  const declined = notConfirmed(sources.lines);
  for (const call of callsOf(sources.lines.filter(isCall))) {
    const line = (call.start ?? call.end) as NucleusCall;
    const piece = callPiece(call, zone, declined.get(line.id));
    const conversation = of(line);
    if (conversation) piece.conversation = conversation;
    pieces.push(piece);
  }
  return pieces;
}

// --- The file ------------------------------------------------------------------------------------

/** Pieces by their times, those at one time (or untimed) in the order they were made. */
function inOrder(pieces: Piece[]): Piece[] {
  let last = 0;
  // An untimed piece keeps the place of the piece before it.
  const times = pieces.map((piece) => (last = piece.at ?? last));
  return pieces
    .map((piece, index) => ({ piece, index, time: times[index] ?? 0 }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ piece }) => piece);
}

/** The timeline's text: a day's heading where the day changes, a conversation's where it does. */
function timeline(pieces: readonly Piece[], zone: string): string {
  let out = '';
  let day: string | null = null;
  let conversation: string | null = null;
  /** Whether the text so far ends with a list item with nothing under it: the next item is
   * written on the next line, anything else after a blank one. */
  let tight: boolean | null = null;
  const add = (text: string, kind: 'item' | 'other', ends: 'item' | 'other' = kind) => {
    if (tight !== null) out += tight && kind === 'item' ? '\n' : '\n\n';
    out += text;
    tight = ends === 'item';
  };
  for (const piece of pieces) {
    if (piece.at !== null) {
      const today = dayText(piece.at, zone);
      if (today !== day) {
        day = today;
        add(`## ${today}`, 'other');
      }
    }
    if (piece.conversation && piece.conversation.id !== conversation) {
      conversation = piece.conversation.id;
      add(
        `### Conversation ${code(conversation.slice(0, 8))} · ${agentName(piece.conversation.agent)}`,
        'other',
      );
    }
    if (piece.kind === 'heading') {
      add([piece.text, ...(piece.body ?? [])].join('\n\n'), 'other');
    } else if (piece.body) {
      add([piece.text, ...piece.body.map(indent)].join('\n\n'), 'item', 'other');
    } else {
      add(piece.text, 'item');
    }
  }
  return out;
}

/** A front matter's key and value. */
type Fact = [string, string | number | boolean];
/** A fact when it has a value; none otherwise. */
const fact = (key: string, value: string | undefined): Fact[] => (value ? [[key, value]] : []);

/** The front matter's facts, in order, and the title with the line under it. */
interface Head {
  facts: Fact[];
  intro: string;
}

function workspaceHead(sources: WorkspaceSources, zone: string): Head {
  const { record } = sources;
  const agent = record.agent;
  const facts: Fact[] = [
    ['of', 'workspace'],
    ['repository', sources.repository],
    ['branch', record.branch],
    ...fact('title', record.title),
    ...fact('kind', record.kind),
    ['agent', agent ? agentName(agent.kind) : 'none'],
    ...fact('model', agent?.model),
    ...fact('effort', agent?.effort),
    ['created', record.created],
    ...fact('finished', record.finished),
    ...fact('from', record.from),
    ['base', record.base],
    ['worktree', record.worktree],
  ];
  const on = agent
    ? `${agentName(agent.kind)}${
        agent.model || agent.effort
          ? ` (${[agent.model, agent.effort ? `${agent.effort} effort` : ''].filter(Boolean).join(', ')})`
          : ''
      }`
    : 'no agent';
  const made = record.from
    ? `made from ${code(record.from)} at ${code(record.base.slice(0, 7))}`
    : `made at ${code(record.base.slice(0, 7))}`;
  const finished = timeOf(record.finished);
  const ended =
    finished === null
      ? ''
      : `, cleaned up on ${dayText(finished, zone)} at ${clock(finished, zone).slice(0, 5)}`;
  const line = `The workspace ${code(record.branch)}${record.kind ? ` (${record.kind})` : ''}: ${on}, ${made}${ended}. ${zoneText(zone)}`;
  return {
    facts,
    intro: `# Activity: ${record.title ?? record.branch}\n\n${line}`,
  };
}

const zoneText = (zone: string) => (zone === 'UTC' ? 'Times are UTC.' : `Times are in ${zone}.`);

/** The front matter's counts, from the pieces of the whole activity. */
function counts(sources: ActivitySources): [string, number][] {
  if (sources.of === 'workspace') {
    const calls = callsOf(sources.tools);
    return [
      ['messages', sources.entries.filter((e) => e.kind === 'prompt').length],
      ['calls', calls.length],
      ['failed', calls.filter((c) => failedCall(c.end)).length],
      ['commits', sources.commits.length],
    ];
  }
  const calls = callsOf(sources.lines.filter(isCall));
  const declined = notConfirmed(sources.lines);
  const entries = sources.lines.filter((line): line is NucleusEntry => !isCall(line));
  return [
    ['messages', entries.filter((e) => e.kind === 'prompt').length],
    ['calls', calls.length],
    [
      'failed',
      calls.filter((c) => {
        const id = (c.start ?? c.end)?.id ?? '';
        return c.start?.gate?.decision !== 'deny' && !declined.has(id) && failedCall(c.end);
      }).length,
    ],
    [
      'refused',
      calls.filter((c) => c.start?.gate?.decision === 'deny' || c.end?.refused !== undefined)
        .length,
    ],
    ['confirms', new Set(entries.flatMap((e) => (e.kind === 'confirm' ? [e.ask] : []))).size],
  ];
}

function markdown(
  sources: ActivitySources,
  now: Date,
  zone: string,
  maxBytes: number | undefined,
): string {
  const pieces = inOrder(
    sources.of === 'workspace' ? workspacePieces(sources, zone) : nucleusPieces(sources, zone),
  );
  const times = pieces.flatMap((p) => (p.at === null ? [] : [p.at]));
  const head =
    sources.of === 'workspace'
      ? workspaceHead(sources, zone)
      : {
          facts: [
            ['of', 'nucleus'],
            ['repository', sources.repository],
            [
              'conversations',
              new Set(sources.lines.flatMap((l) => (l.conversation ? [l.conversation] : []))).size,
            ],
          ] as Fact[],
          intro: `# Activity: Nucleus\n\nNucleus, the person's assistant in ${code(sources.repository)}, across its conversations. ${zoneText(zone)}`,
        };
  const facts: Fact[] = [
    ...head.facts,
    ...(times.length > 0
      ? ([
          ['first', new Date(Math.min(...times)).toISOString()],
          ['last', new Date(Math.max(...times)).toISOString()],
        ] as [string, string][])
      : []),
    ['timezone', zone],
    ['exported', now.toISOString()],
    ...counts(sources),
  ];
  const brief = sources.of === 'workspace' ? `## Brief\n\n${quote(sources.record.brief)}` : '';
  const command =
    sources.of === 'workspace'
      ? `symbiote activity ${sources.record.branch}`
      : 'symbiote activity --nucleus';

  const render = (shown: readonly Piece[], missing: readonly string[]) => {
    const matter = [
      '---',
      `symbiote-activity: ${String(EXPORT_VERSION)}`,
      ...facts.map(([key, value]) => `${key}: ${key === 'of' ? String(value) : yaml(value)}`),
      `complete: ${String(missing.length === 0)}`,
      ...(missing.length > 0 ? ['missing:', ...missing.map((m) => `  - ${yaml(m)}`)] : []),
      '---',
    ].join('\n');
    const note =
      missing.length > 0 ? `**Not in this export**: ${sentence(missing.join('; '))}` : '';
    return `${[matter, head.intro, note, brief, timeline(shown, zone)].filter(Boolean).join('\n\n')}\n`;
  };

  const missing = sources.missing ?? [];
  const whole = render(pieces, missing);
  if (maxBytes === undefined || Buffer.byteLength(whole) <= maxBytes) return whole;

  // The oldest messages, and what came before and after them, left out until it fits.
  const starts = pieces.flatMap((piece, index) => (piece.message ? [index] : []));
  for (let left = 1; left < starts.length; left++) {
    const from = starts[left] as number;
    const said =
      left === 1
        ? 'The oldest message and what followed it'
        : `The ${String(left)} oldest messages and what followed them`;
    const text = render(pieces.slice(from), [
      ...missing,
      `${said}, left out to fit ${String(Math.floor(maxBytes / 1024))} KB: \`${command}\` gives all of it`,
    ]);
    if (Buffer.byteLength(text) <= maxBytes) return text;
  }
  // Not even the newest message fits: its end, from a line's start.
  const last = starts.at(-1) ?? 0;
  const head2 = render(
    [],
    [
      ...missing,
      `Only the end of the newest message's activity, to fit: \`${command}\` gives all of it`,
    ],
  );
  const rest = timeline(pieces.slice(last), zone);
  const room = Math.max(0, maxBytes - Buffer.byteLength(head2) - 1);
  const tail = Buffer.from(rest)
    .subarray(Math.max(0, Buffer.byteLength(rest) - room))
    .toString();
  const cut = tail.indexOf('\n');
  return `${head2}${cut >= 0 ? tail.slice(cut + 1) : tail}\n`;
}

// --- JSON Lines ----------------------------------------------------------------------------------

function jsonLines(sources: ActivitySources, now: Date, zone: string): string {
  const missing = sources.missing ?? [];
  const header = {
    record: 'export',
    'symbiote-activity': EXPORT_VERSION,
    of: sources.of,
    repository: sources.repository,
    ...(sources.of === 'workspace' ? { branch: sources.record.branch } : {}),
    timezone: zone,
    exported: now.toISOString(),
    complete: missing.length === 0,
    ...(missing.length > 0 ? { missing } : {}),
  };
  const lines: { at: number | null; value: object }[] =
    sources.of === 'workspace'
      ? [
          { at: timeOf(sources.record.created), value: { record: 'workspace', ...sources.record } },
          ...sources.entries.map((e) => ({ at: timeOf(e.at), value: { record: 'thread', ...e } })),
          ...sources.tools.map((t) => ({ at: timeOf(t.at), value: { record: 'tool', ...t } })),
          ...sources.commits.map((c) => ({
            at: timeOf(c.date),
            value: { record: 'commit', ...c },
          })),
          ...(sources.verdict
            ? [{ at: timeOf(sources.verdict.at), value: { record: 'verdict', ...sources.verdict } }]
            : []),
        ]
      : sources.lines.map((l) => ({ at: timeOf(l.at), value: { record: 'nucleus', ...l } }));
  let last = 0;
  const sorted = lines
    .map((line, index) => ({ ...line, index, time: (last = line.at ?? last) }))
    .sort((a, b) => a.time - b.time || a.index - b.index);
  return `${[header, ...sorted.map((l) => l.value)].map((v) => JSON.stringify(v)).join('\n')}\n`;
}
