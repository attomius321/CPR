import type { McpAsk, McpAskItem, McpVia } from '@symbiote/core';
import type { StatusTone } from '../ui/StatusLabel.js';

/** The agents' MCP clients by the names they introduce themselves with. */
const CLIENTS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex-mcp-client': 'Codex',
};

/**
 * Who asks (MC1): Nucleus by its name (`nucleus`: Alpha Ceph in Hive mode), or an agent through
 * `symbiote mcp` and the folder it runs in.
 */
export function askedBy(ask: McpAsk, nucleus = 'Nucleus'): string {
  if (ask.by.via === 'nucleus') return nucleus;
  const client = ask.by.client ? (CLIENTS[ask.by.client] ?? ask.by.client) : undefined;
  const folder = ask.by.folder?.replace(/\/+$/, '').split('/').at(-1);
  if (!client) return 'An agent';
  return folder ? `${client} in ${folder}` : client;
}

/** How long the ask waits for the person, in minutes rounded up; then nothing is done. */
export function askLeft(ask: McpAsk, now: number): string {
  const ms = Date.parse(ask.until) - now;
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min left` : 'under a minute left';
}

/** Whether an ask waits for the person (MC3): unanswered, or lapsed and kept for a late yes. */
export const waitsForPerson = (ask: McpAsk): boolean => !ask.stage || ask.stage === 'lapsed';

/** Whether one of `asks` is `via`'s and waits: the sidenav marks Nucleus while it waits on the person. */
export function asksBy(asks: readonly McpAsk[], via: McpVia): boolean {
  return asks.some((ask) => ask.by.via === via && waitsForPerson(ask));
}

/** The bar's order (MC3): one being done, the oldest that waits, results to read, lapsed ones. */
const RANK = { doing: 0, waiting: 1, done: 2, lapsed: 3 } as const;

/** The ask the bar shows; the others are "n more after it". */
export function shownAsk(asks: readonly McpAsk[]): McpAsk | undefined {
  const rank = (ask: McpAsk) => RANK[ask.stage ?? 'waiting'];
  return [...asks].sort((a, b) => rank(a) - rank(b) || a.at.localeCompare(b.at))[0];
}

/** What an item is being done or was done as, in its tool's words (MC3). */
const VERBS: Record<string, [doing: string, done: string, many: string]> = {
  start_workspace: ['Starting', 'Started', 'started'],
  clean_workspace: ['Cleaning up', 'Cleaned up', 'cleaned up'],
};
const verbs = (tool: string) => VERBS[tool] ?? ['Doing', 'Done', 'done'];

/** A batch row's state once confirmed (MC3, decision 988): its tone and word; null before. */
export function itemState(
  tool: string,
  item: McpAskItem,
): { tone: StatusTone; word: string } | null {
  const [doing, done] = verbs(tool);
  switch (item.outcome) {
    case 'running':
      return { tone: 'run', word: doing };
    case 'done':
      return { tone: 'ok', word: done };
    case 'failed':
      return { tone: 'error', word: 'Failed' };
    case 'declined':
      return { tone: 'idle', word: 'Declined' };
    case 'cant':
      return { tone: 'idle', word: 'Can’t' };
    default:
      return null;
  }
}

/**
 * A batch's tally in its head (MC3): while it is done, how many of those ticked are ("1 of 2
 * started"); once done, each outcome counted ("1 started, 1 failed"); else nothing.
 */
export function askTally(ask: McpAsk): string {
  const items = ask.items ?? [];
  const [, , many] = verbs(ask.tool);
  const count = (outcome: McpAskItem['outcome']) =>
    items.filter((item) => item.outcome === outcome).length;
  if (ask.stage === 'doing') {
    const toDo = items.filter((i) => i.outcome !== 'declined' && i.outcome !== 'cant').length;
    return `${count('done')} of ${toDo} ${many}`;
  }
  if (ask.stage !== 'done') return '';
  return [
    [count('done'), many],
    [count('failed'), 'failed'],
    [count('declined'), 'declined'],
    [count('cant'), 'can’t'],
  ]
    .filter(([n]) => n !== 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(', ');
}

/** The primary's words: Confirm, and how many are ticked in a batch with some ticked. */
export const confirmWords = (ask: McpAsk, ticked: number): string =>
  ask.items && ticked > 0 ? `Confirm ${ticked}` : 'Confirm';

/** A lapsed ask's wait in words, from its own times (MC3): "No answer in 10 minutes: …". */
export function lapsedWords(ask: McpAsk): string {
  const minutes = Math.round((Date.parse(ask.until) - Date.parse(ask.at)) / 60_000);
  const waited = minutes >= 1 ? `in ${minutes} minute${minutes === 1 ? '' : 's'}` : 'in time';
  return `No answer ${waited}: nothing done yet`;
}

/** When a lapsed ask was asked, as the page's clocks say it ("14:02"). */
export const askedAt = (
  ask: McpAsk,
  clock: (date: Date) => string = (date) =>
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
): string => clock(new Date(ask.at));
