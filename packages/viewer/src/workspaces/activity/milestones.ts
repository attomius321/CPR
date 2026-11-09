// The milestones between the phases (V73): a prompt, the person's message, a question, a report,
// the verdict, a session's end; Nucleus's own (NU2) and its Confirms.
import type { PromptFrom, ThreadEntry } from '@symbiote/core';
import { AGENT_NAMES } from '../workspaces.js';
import { askedFor, promptFrom } from '../thread-items.js';
import type { ActivityEvent, NucleusOwn } from './events.js';
import {
  type ActivityGroup,
  type Context,
  type WorkEvent,
  firstLine,
  times,
} from './group-parts.js';

const VERDICTS = {
  approve: 'Approved',
  'request-changes': 'Changes requested',
  comment: 'Commented',
} as const;

/** How a session ended, in words; a Codex run's other reasons are its failure (V20a). */
function endGroup(entry: Extract<ThreadEntry, { kind: 'end' }>, codex: boolean) {
  const reason = entry.reason;
  if (reason === 'completed') return { title: 'Its run completed', status: 'done' as const };
  if (reason === 'stopped') return { title: 'Stopped', status: 'cancelled' as const };
  if (!reason || ['other', 'clear', 'logout', 'prompt_input_exit'].includes(reason)) {
    return { title: 'Its session ended', status: 'done' as const };
  }
  return codex
    ? { title: `Failed: ${firstLine(reason)}`, status: 'failed' as const }
    : { title: `Its session ended: ${firstLine(reason)}`, status: 'done' as const };
}

/** A Confirm's end in words and tone (NU2). */
const CONFIRM_ENDS = {
  confirmed: { text: 'Confirmed', tone: 'ok' },
  declined: { text: 'Declined', tone: 'muted' },
  expired: { text: 'No answer in time', tone: 'warning' },
  gone: { text: 'Its call ended first', tone: 'muted' },
} as const;

/** Why a start went without a Confirm (NU8), in words and tone. */
const WITHOUT_CONFIRM = {
  setting: { text: 'Your setting', tone: 'muted' },
  hive: { text: 'Hive mode', tone: 'muted' },
} as const;

type Base = Pick<ActivityGroup, 'key' | 'start' | 'end' | 'failures' | 'events'>;

/** A Confirm (NU2): asked, waiting for the person until it ends; what the yes did, its detail. */
function confirmGroup(
  event: Extract<ActivityEvent, { kind: 'confirm' }>,
  base: Base,
  context: Context,
): ActivityGroup {
  const words = (event.asked ?? event.ended)?.words ?? '';
  const did = event.did?.output;
  // None asked (NU8, decision 785): the person's setting or Hive mode started it at once.
  if (event.ended?.stage === 'skipped') {
    return {
      ...base,
      ...times([event]),
      kind: 'confirm',
      milestone: true,
      title: `Started without a Confirm: ${words}`,
      summary: event.ended.tool,
      ...(did ? { detail: did } : {}),
      status: 'done',
      said: WITHOUT_CONFIRM[event.ended.why],
    };
  }
  const answer = event.ended?.stage === 'ended' ? event.ended.answer : undefined;
  // Unanswered while Nucleus works on: it waits for the person; else its end was never recorded.
  const live = context.agent.state === 'working' || context.agent.state === 'needs-you';
  return {
    ...base,
    ...times([event, ...(event.ended ? [{ ...event, at: event.ended.at }] : [])]),
    kind: 'confirm',
    milestone: true,
    title: `Confirm: ${words}`,
    ...((event.asked ?? event.ended) ? { summary: (event.asked ?? event.ended)?.tool ?? '' } : {}),
    ...(answer === 'confirmed' && did ? { detail: did } : {}),
    status: !answer
      ? live
        ? 'waiting'
        : 'open'
      : answer === 'declined' || answer === 'gone'
        ? 'cancelled'
        : 'done',
    ...(answer ? { said: CONFIRM_ENDS[answer] } : {}),
  };
}

/** Nucleus's own events (NU2): an error, a turn interrupted, a conversation opened or ended. */
function nucleusGroup(entry: NucleusOwn, base: Base, context: Context): ActivityGroup {
  const agent = AGENT_NAMES[entry.agent ?? context.agent.kind ?? 'claude'];
  switch (entry.kind) {
    case 'error':
      return {
        ...base,
        kind: 'error',
        milestone: true,
        title: `Error: ${firstLine(entry.error)}`,
        ...(entry.details ? { detail: entry.details } : {}),
        status: 'failed',
      };
    case 'interrupted':
      return {
        ...base,
        kind: 'interrupted',
        milestone: false,
        title: 'Interrupted',
        status: 'cancelled',
      };
    case 'opened': {
      const on = [entry.model, entry.effort ? `${entry.effort} effort` : ''].filter(Boolean);
      return {
        ...base,
        kind: 'session',
        milestone: true,
        title: `A conversation opened on ${agent}`,
        ...(on.length > 0 ? { summary: on.join(' · ') } : {}),
        status: 'done',
      };
    }
    default:
      return {
        ...base,
        kind: 'end',
        milestone: true,
        title: 'New conversation: this one ended',
        status: 'done',
      };
  }
}

/** What a question asks, its questions alone: "Which store?; Which plan?". */
export const questionsOf = (entry: Extract<ThreadEntry, { kind: 'asks' }>) =>
  (entry.questions ?? []).map((q) => q.question).join('; ');

/** Who sent a message, as a milestone's title starts (AR2, decision 741). */
function senderOf(from: PromptFrom, context: Context): string {
  switch (from) {
    case 'hive':
      return 'Hive';
    case 'nucleus':
      return context.nucleusName ?? 'Nucleus';
    case 'verdict':
      return 'The verdict';
    case 'merger':
      return 'Symbiote';
    default:
      return 'You';
  }
}

/** A milestone event as its group; null for one the timeline leaves to the raw stream. */
export function milestone(
  event: Exclude<ActivityEvent, WorkEvent>,
  context: Context,
): ActivityGroup | null {
  const base = { key: event.key, ...times([event]), failures: 0, events: [event] };
  switch (event.kind) {
    case 'made': {
      const { from, base: sha } = event.workspace;
      const short = sha.slice(0, 7);
      const title = from ? `Workspace made from ${from} at ${short}` : `Workspace made at ${short}`;
      return { ...base, kind: 'made', milestone: false, title, status: 'done' };
    }
    case 'start': {
      const { entry, first } = event;
      const title = first
        ? `${AGENT_NAMES[context.agent.kind ?? 'claude']} started`
        : entry.source === 'resume'
          ? 'Continued'
          : entry.source === 'compact'
            ? 'Continued after compacting'
            : entry.source === 'clear'
              ? 'Started again: context cleared'
              : entry.source === 'fork'
                ? 'A copy of the session started'
                : 'Started again';
      return { ...base, kind: 'session', milestone: false, title, status: 'done' };
    }
    case 'prompt': {
      const { entry, first } = event;
      const from = promptFrom(entry, first);
      if (from === 'start') {
        return {
          ...base,
          kind: 'prompt',
          milestone: true,
          title: "Symbiote's prompt",
          summary: firstLine(entry.text),
          detail: entry.text,
          status: 'done',
        };
      }
      if (from === 'subagent') {
        return {
          ...base,
          kind: 'notice',
          milestone: false,
          title: 'A subagent handed back its report',
          detail: entry.text,
          status: 'done',
        };
      }
      if (from === 'task') {
        const said = /<summary>([^<]+)<\/summary>/.exec(entry.text)?.[1]?.trim();
        return {
          ...base,
          kind: 'notice',
          milestone: false,
          title: said ?? 'A background task ended',
          detail: entry.text,
          status: 'done',
        };
      }
      // Pasted text is said by its own first line, not its tag.
      const line = firstLine(entry.text.replace(/<\/?pasted_content[^>]*>/g, ''));
      return {
        ...base,
        kind: 'message',
        milestone: true,
        title: `${senderOf(from, context)}: ${line}`,
        ...(entry.text.trim() !== line ? { detail: entry.text } : {}),
        status: 'done',
      };
    }
    case 'asks': {
      const { entry } = event;
      const waiting =
        context.lastAsks === event.key &&
        context.agent.state === 'needs-you' &&
        !context.agent.interrupted;
      const asked = askedFor(entry, context.worktree);
      const options = entry.questions?.[0]?.options ?? [];
      return {
        ...base,
        kind: 'asks',
        milestone: true,
        title: entry.questions ? `Asked: ${questionsOf(entry)}` : `Asked for p${asked.slice(1)}`,
        ...(options.length > 0 ? { summary: options.join(' · ') } : {}),
        status: waiting ? 'waiting' : 'done',
      };
    }
    case 'report':
      return {
        ...base,
        kind: 'report',
        milestone: true,
        title: context.nucleus ? 'Answered' : 'Reported',
        summary: firstLine(event.entry.text).replace(/^#+\s*/, ''),
        detail: event.entry.text,
        status: 'done',
        ...(event.tokens ? { tokens: event.tokens } : {}),
        ...(event.ms !== undefined ? { took: event.ms } : {}),
      };
    case 'confirm':
      return confirmGroup(event, base, context);
    case 'compact': {
      const done = event.after !== undefined;
      const trigger = (event.before ?? event.after)?.trigger;
      return {
        ...base,
        ...times([event, ...(event.after ? [{ ...event, at: event.after.at }] : [])]),
        kind: 'compact',
        milestone: false,
        title: done ? 'Its context compacted' : 'Compacting its context',
        ...(trigger ? { summary: trigger === 'auto' ? 'automatically' : 'asked' } : {}),
        ...(event.after?.summary ? { detail: event.after.summary } : {}),
        status: 'done',
      };
    }
    case 'nucleus':
      return nucleusGroup(event.entry, base, context);
    case 'end': {
      const said = endGroup(
        event.entry,
        context.agent.kind === 'codex' || event.entry.run !== undefined,
      );
      return { ...base, kind: 'end', milestone: said.status !== 'done', ...said };
    }
    case 'verdict':
      return {
        ...base,
        kind: 'verdict',
        milestone: true,
        title: `Review: ${VERDICTS[event.verdict.event]}`,
        detail: event.verdict.text,
        status: 'done',
      };
    case 'unknown':
      return {
        ...base,
        kind: 'unknown',
        milestone: false,
        title: `Recorded: ${event.entry.kind}`,
        status: 'done',
      };
    default:
      // Claude Code's notices: the raw stream's; the question or the wait they announce has its own.
      return null;
  }
}
