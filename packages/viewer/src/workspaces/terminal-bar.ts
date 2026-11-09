// The bar under a workspace's terminal (V89, decisions 828, 829): what waits, in the agent's own
// words, and only keys measured to answer it; or what the agent does, or who drives. Never a
// button that answers the agent's prompt for the person. Kept pure.
import type { ThreadEntry, WorkspaceSummary } from '@symbiote/core';
import { AGENT_NAMES } from './workspaces.js';
import { mergedForCard, type WorkspaceNext } from './workspace-next.js';

/** A key, or a chord, and what it does. */
export interface BarKey {
  keys: string[];
  what: string;
}

export interface BarModel {
  /** Its colour: the person's turn, the agent's, failed, done, paused, nobody's, or Hive. */
  tone: 'you' | 'run' | 'error' | 'ok' | 'info' | 'idle' | 'hive';
  /** What waits or what happens, in bold. */
  text: string;
  /** After it, muted. */
  detail?: string;
  /** Since when: the bar counts the time since. */
  since?: string;
  /** At its end, before the keys. */
  note?: string;
  /** The keys that answer what waits: only those measured on a real session. */
  keys: BarKey[];
  /** Symbiote's own terminal keys fit here (opening a path, pasting an image). */
  terminalKeys?: true;
  /** A failure: its thread says why. */
  thread?: true;
  /** A plan waits for the person's OK. */
  plan?: true;
  /** Hive runs its check or its review now: its live words. */
  hiveLive?: true;
}

const HIVE_DETAIL =
  "it answers the writer's questions and sends it what the check and the reviewer found";
const HIVE_NOTE = 'What you type reaches the writer too, recorded as yours';

/**
 * A permission prompt's keys (decision 829), as V21's spike measured them on Claude Code: Enter
 * takes the choice picked (Yes, first), Esc denies and ends the turn. Its other choices are not
 * recorded, and "don't ask again" varies by tool: no numbers.
 */
const PERMISSION_KEYS: BarKey[] = [
  { keys: ['Enter'], what: 'allows it' },
  { keys: ['Esc'], what: 'says no and ends its turn' },
];

/** Claude Code's newest notice since the wait began: its own words (its `Notification` hook). */
function noticeSince(entries: readonly ThreadEntry[], since: string | undefined): string | null {
  const from = since ? Date.parse(since) : -Infinity;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || Date.parse(entry.at) < from) break;
    if (entry.kind === 'notice' && entry.message) return entry.message;
  }
  return null;
}

/** The bar for `workspace`, its next step as the sidenav derives it, and its thread's entries. */
export function barOf({
  workspace,
  next,
  entries,
}: {
  workspace: WorkspaceSummary;
  next: WorkspaceNext;
  entries: readonly ThreadEntry[];
}): BarModel {
  const { agent, activity, hive } = workspace;
  const since = activity?.since;
  const at = since ? { since } : {};
  if (hive && !hive.off) {
    if (hive.step === 'stuck') return { tone: 'error', text: next.text, keys: [], thread: true };
    if (hive.step === 'landed' || hive.step === 'answered' || mergedForCard(workspace)) {
      return { tone: 'ok', text: next.text, keys: [] };
    }
    // HV5: its next start held for usage; the sidenav's words, which say until when.
    if (next.paused) return { tone: 'info', text: next.text, keys: [], terminalKeys: true };
    return {
      tone: 'hive',
      text: 'Hive drives this writer',
      detail: HIVE_DETAIL,
      note: HIVE_NOTE,
      keys: [],
      terminalKeys: true,
      ...(hive.live && (hive.step === 'checking' || hive.step === 'reviewing')
        ? { hiveLive: true }
        : {}),
    };
  }
  if (workspace.tip === null) return { tone: 'error', text: next.text, keys: [] };
  if (workspace.merged) return { tone: 'ok', text: next.text, keys: [] };
  const name = agent.kind ? AGENT_NAMES[agent.kind] : 'Its agent';
  switch (agent.state) {
    case 'needs-you': {
      if (agent.interrupted) {
        return {
          tone: 'you',
          text: 'Interrupted: it waits at its prompt',
          ...at,
          keys: [],
          terminalKeys: true,
        };
      }
      const asks = activity?.asks;
      // A question: what it asks and its options, as recorded (no keys: not measured).
      if (asks?.questions?.length && next.blocked) {
        return { tone: 'you', text: next.blocked, ...at, keys: [], note: 'Answer in its terminal' };
      }
      const text =
        noticeSince(entries, since) ?? next.blocked ?? `Waiting: ${agent.waitingFor ?? 'for you'}`;
      const keys = agent.kind === 'claude' && asks ? PERMISSION_KEYS : [];
      return { tone: 'you', text, ...at, keys };
    }
    case 'plan-ready':
      return { tone: 'you', text: 'The plan waits for your OK', ...at, keys: [], plan: true };
    case 'working':
      return {
        tone: 'run',
        text: `${name} is working`,
        ...(next.doing ? { detail: next.doing } : {}),
        ...at,
        keys: [],
        terminalKeys: true,
      };
    case 'failed':
    case 'not-started':
    case 'no-agent':
    case 'unknown':
      return { tone: 'error', text: next.text, keys: [], thread: true };
    default:
      break;
  }
  const tone = next.group === 'review' ? 'you' : next.group === 'done' ? 'ok' : 'idle';
  return { tone, text: next.text, keys: [], terminalKeys: true };
}
