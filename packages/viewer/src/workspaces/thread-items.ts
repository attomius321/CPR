// A workspace's thread as its panel shows it (V18c): its entries as items, who sent a prompt, what
// the agent asks, how the box answers it, and the review's verdict to send.
import type { WorkspaceAgentState, WorkspaceThread, PromptFrom, ThreadEntry } from '@symbiote/core';

/** One line of a workspace's thread as its panel shows it (V18c). */
export interface ThreadItem {
  /** Symbiote's prompt, the agent's report, the person's message, what it waits on, or a note. */
  who: 'symbiote' | 'agent' | 'you' | 'waits' | 'line';
  at: string;
  text: string;
  /**
   * Its heading when not the plain one (AR2): who of Symbiote's sent it ("Hive's message"), or
   * "Your verdict" for the person's verdict in Symbiote's words.
   */
  label?: string;
}

/** The heading of a message one of Symbiote's senders typed (AR2, decision 741). */
const SENT_LABELS: Readonly<Partial<Record<PromptFrom, string>>> = {
  hive: "Hive's message",
  nucleus: "Nucleus's message",
  merger: "Symbiote's message",
};

/**
 * Who sent a prompt: as the thread's reader labelled it (AR2), else, for a thread read before,
 * the first prompt Symbiote's, a background job's end by its tag, and the rest the person's.
 */
export function promptFrom(
  entry: Extract<ThreadEntry, { kind: 'prompt' }>,
  first: boolean,
): PromptFrom {
  if (entry.from) return entry.from;
  if (first) return 'start';
  return entry.text.trimStart().startsWith('<task-notification>') ? 'task' : 'person';
}

/** Tools whose permission is to change a file (`file_path` in their input). */
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * What an ask is for, in words (V48): a question and its options, or the permission to run a
 * command, to edit a file (inside the worktree, by its path there) or to use a tool.
 */
export function askedFor(entry: Extract<ThreadEntry, { kind: 'asks' }>, worktree?: string): string {
  if (entry.questions) {
    const asked = entry.questions.map((q) =>
      q.options.length > 0 ? `${q.question} — ${q.options.join(' · ')}` : q.question,
    );
    return `Asks: ${asked.join('; ')}`;
  }
  let input: { command?: unknown; file_path?: unknown } = {};
  try {
    input = (JSON.parse(entry.input ?? '') as typeof input | null) ?? {};
  } catch {
    // Cut at 4 KB, or not JSON: only the tool is shown.
  }
  if (entry.tool === 'Bash' && typeof input.command === 'string') {
    return `Permission to run ${input.command}`;
  }
  if (EDITS.has(entry.tool) && typeof input.file_path === 'string') {
    const path = input.file_path;
    const inside = worktree && [`${worktree}/`, `${worktree}\\`].find((p) => path.startsWith(p));
    return `Permission to edit ${inside ? path.slice(inside.length) : path}`;
  }
  return `Permission to use ${entry.tool}`;
}

/** What an agent waits on, in the thread's words: a question and its options, or a permission. */
function waitsFor(entry: Extract<ThreadEntry, { kind: 'asks' }>, worktree?: string): string {
  const asked = askedFor(entry, worktree);
  return entry.questions ? asked : `Waiting: p${asked.slice(1)}`;
}

/**
 * A thread's entries as the panel shows them: the first prompt is Symbiote's, later ones the
 * person's messages; reports are the agent's; what it waited on in words; a session started after
 * the first as a line. Ends and Claude Code's notices are left out (the state says as much).
 */
export function threadItems(entries: readonly ThreadEntry[], worktree?: string): ThreadItem[] {
  const items: ThreadItem[] = [];
  let started = false;
  let prompted = false;
  for (const entry of entries) {
    const { at } = entry;
    switch (entry.kind) {
      case 'start':
        if (started) {
          const text =
            entry.source === 'resume'
              ? 'Continued'
              : entry.source === 'fork'
                ? 'A copy of the session started'
                : 'Started again';
          items.push({ who: 'line', at, text });
        }
        started = true;
        break;
      case 'prompt': {
        const from = promptFrom(entry, !prompted);
        prompted = true;
        if (from === 'task') {
          const said = /<summary>([^<]+)<\/summary>/.exec(entry.text)?.[1]?.trim();
          items.push({
            who: 'line',
            at,
            text: `A background task ended${said ? `: ${said}` : ''}`,
          });
        } else if (from === 'subagent') {
          items.push({ who: 'line', at, text: 'A subagent handed back its report' });
        } else if (from === 'person') {
          items.push({ who: 'you', at, text: entry.text });
        } else if (from === 'verdict') {
          // The person's decision, in Symbiote's words: theirs, shown whole, named for what it is.
          items.push({ who: 'you', at, text: entry.text, label: 'Your verdict' });
        } else {
          const label = SENT_LABELS[from];
          items.push({ who: 'symbiote', at, text: entry.text, ...(label ? { label } : {}) });
        }
        break;
      }
      case 'report':
        items.push({ who: 'agent', at, text: entry.text });
        break;
      case 'asks':
        items.push({ who: 'waits', at, text: waitsFor(entry, worktree) });
        break;
      default:
        break;
    }
  }
  return items;
}

/**
 * How a message reaches the agent: sent (its turn ended, or it stopped; Codex on its app server
 * while it works, the message joining its turn, V27a), sent once its turn is stopped (it works,
 * or waits on a prompt), or not at all (no session to continue).
 */
export function replyMode(agent: WorkspaceAgentState): 'send' | 'stop-and-send' | 'none' {
  switch (agent.state) {
    case 'working':
      return agent.remote ? 'send' : 'stop-and-send';
    case 'needs-you':
      return agent.waitingFor ? 'stop-and-send' : 'send';
    case 'plan-ready':
    case 'ready':
    case 'done':
    case 'stopped':
    case 'failed':
      return 'send';
    default:
      return 'none';
  }
}

/** The review's last verdict, when it is newer than the last message the agent got. */
export function verdictToSend(thread: WorkspaceThread | null): WorkspaceThread['verdict'] | null {
  const verdict = thread?.verdict;
  if (!verdict) return null;
  const last = thread.entries.findLast((e) => e.kind === 'prompt');
  return !last || verdict.at > last.at ? verdict : null;
}
