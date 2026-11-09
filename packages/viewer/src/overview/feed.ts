// The Overview's events of today (V91): normal mode's from the threads, the queue and git's merges;
// Hive's from its own log (`hive/<branch>.jsonl`, decision 695's kinds). In words, the newest
// first; an event Hive writes for itself (a turn's end, a message sent) is left out. Pure.
import type { DayEvent, MergeEntry, WorkspaceDay, WorkspaceSummary } from '@symbiote/core';
import { workspaceName } from '../workspaces/workspaces.js';
import { modelName } from '../workspaces/run-choices.js';
import { isToday } from './day.js';
import type { MergedRow } from './normal-overview.js';
import { plural } from '../ui/plural.js';

export type FeedIcon =
  | 'question'
  | 'permission'
  | 'plan'
  | 'review'
  | 'answered'
  | 'start'
  | 'merge'
  | 'check'
  | 'bug'
  | 'stopped'
  | 'pause'
  | 'request'
  | 'run';

/** Violet the person's turn, amber the agent's, green done, red failed (V88). */
export type FeedTone = 'you' | 'run' | 'ok' | 'fail' | 'info' | 'idle';

export interface FeedItem {
  key: string;
  at: string;
  icon: FeedIcon;
  tone: FeedTone;
  what: string;
  /** Its workspace, and what else the record says. */
  about: string;
  branch?: string;
}

const short = (sha: unknown) => (typeof sha === 'string' ? sha.slice(0, 7) : undefined);
const joined = (...parts: (string | undefined | false)[]) =>
  parts.filter((part): part is string => !!part).join(' · ');
const newestFirst = (items: FeedItem[]) =>
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key));

/** A branch as the page names it: its workspace's name, its Hive record's title, else itself. */
function namer(list: readonly WorkspaceSummary[], day: WorkspaceDay | null) {
  return (branch: string) => {
    const listed = list.find((w) => w.branch === branch);
    if (listed) return workspaceName(listed);
    return day?.hive.find((r) => r.branch === branch)?.title ?? branch;
  };
}

/** Normal mode's events of today. */
export function normalFeed(
  day: WorkspaceDay | null,
  merges: readonly MergeEntry[],
  merged: readonly MergedRow[],
  list: readonly WorkspaceSummary[],
  now: number,
): FeedItem[] {
  const name = namer(list, day);
  const items: FeedItem[] = [];
  for (const [i, event] of (day?.events ?? []).entries()) {
    if (event.source !== 'thread' || !isToday(event.at, now)) continue;
    const base = { key: `e${i}`, at: event.at, branch: event.branch, about: name(event.branch) };
    if (event.kind === 'asks') {
      const question = event.data?.tool === 'AskUserQuestion';
      items.push({
        ...base,
        icon: question ? 'question' : 'permission',
        tone: 'you',
        what: question ? 'Asked you a question' : 'Asked for a permission',
      });
    } else if (event.kind === 'report') {
      const workspace = list.find((w) => w.branch === event.branch);
      // Plan first and nothing answered yet (V89's `planAnswered`): its report is the plan.
      const plan = workspace?.planFirst === true && event.data?.answered === false;
      items.push({
        ...base,
        tone: 'you',
        ...(plan
          ? { icon: 'plan' as const, what: 'Plan ready' }
          : (workspace?.ahead ?? 0) > 0
            ? { icon: 'review' as const, what: 'Ready for review' }
            : { icon: 'answered' as const, what: 'Answered with a report' }),
      });
    }
  }
  for (const [branch, at] of Object.entries(day?.started ?? {})) {
    if (!isToday(at, now)) continue;
    items.push({
      key: `s:${branch}`,
      at,
      branch,
      icon: 'start',
      tone: 'idle',
      what: 'Started',
      about: name(branch),
    });
  }
  for (const entry of merges) {
    if (!isToday(entry.queued, now)) continue;
    const listed = list.some((w) => w.branch === entry.branch);
    items.push({
      key: `q:${entry.id}`,
      at: entry.queued,
      branch: entry.branch,
      icon: 'merge',
      tone: 'run',
      what: `Queued to merge into ${entry.into}`,
      about: joined(
        listed ? name(entry.branch) : entry.title.replace(/^Merge [^:]+: /, ''),
        entry.by === 'hive' ? 'Hive approved' : 'you approved',
      ),
    });
  }
  for (const row of merged) {
    if (!isToday(row.at, now)) continue;
    items.push({
      key: `m:${row.sha}`,
      at: row.at,
      ...(row.branch ? { branch: row.branch } : {}),
      icon: 'merge',
      tone: 'ok',
      what: `Merged into ${row.into}${row.pushed ? ', pushed' : ''}`,
      about: joined(
        row.title,
        short(row.sha),
        row.by === 'you' ? 'you approved' : row.by === 'hive' && 'Hive approved',
      ),
    });
  }
  return newestFirst(items);
}

/** One of Hive's events in words; null for those Hive writes for itself. */
function hiveWords(
  event: DayEvent,
  name: string,
): Pick<FeedItem, 'icon' | 'tone' | 'what' | 'about'> | null {
  const data = event.data ?? {};
  const round = typeof data.round === 'number' ? `round ${data.round}` : undefined;
  const text = (key: string) => (typeof data[key] === 'string' ? data[key] : undefined);
  switch (event.kind) {
    case 'started':
      return { icon: 'start', tone: 'idle', what: 'Started from its brief', about: name };
    case 'check':
      return data.ok === true
        ? { icon: 'check', tone: 'ok', what: 'Check passed', about: joined(name, round) }
        : {
            icon: 'check',
            tone: 'fail',
            what: text('failed') ? `Check failed: ${text('failed')}` : 'Check failed',
            about: joined(name, round),
          };
    case 'review-started': {
      const model = text('model');
      return {
        icon: 'review',
        tone: 'run',
        what: 'Running review started',
        about: joined(name, model && modelName(model)),
      };
    }
    case 'review': {
      const kept = typeof data.kept === 'number' ? data.kept : 0;
      if (data.verdict === 'changes' && kept > 0) {
        return {
          icon: 'bug',
          tone: 'fail',
          what: `${plural(kept, 'defect')} proven by failing tests`,
          about: joined(name, round),
        };
      }
      if (data.verdict === 'approved') {
        return {
          icon: 'review',
          tone: 'ok',
          what: 'Review passed: no defect proven',
          about: joined(name, round),
        };
      }
      return { icon: 'review', tone: 'fail', what: 'Review failed', about: joined(name, round) };
    }
    case 'land-queued':
      return {
        icon: 'merge',
        tone: 'run',
        what: `Queued to land in ${text('into') ?? 'its branch'}`,
        about: joined(name, short(data.commit)),
      };
    case 'landed': {
      const pushed =
        data.pushed === true ||
        (typeof data.pushed === 'object' && (data.pushed as { ok?: unknown } | null)?.ok === true);
      return {
        icon: 'merge',
        tone: 'ok',
        what: `Landed${text('into') ? ` in ${text('into')}` : ''}${pushed ? ', pushed' : ''}`,
        about: joined(name, short(data.merge)),
      };
    }
    case 'land-failed':
      return {
        icon: 'merge',
        tone: 'fail',
        what: `Landing failed${text('outcome') ? `: ${text('outcome')}` : ''}`,
        about: name,
      };
    case 'stuck':
      return { icon: 'stopped', tone: 'fail', what: 'Stopped', about: joined(name, text('note')) };
    case 'answered':
      return { icon: 'answered', tone: 'ok', what: 'Answered with a report', about: name };
    case 'paused':
      return { icon: 'pause', tone: 'info', what: 'Paused for usage', about: name };
    case 'goes-on':
      return { icon: 'run', tone: 'info', what: 'Goes on', about: name };
    case 'restarted':
      return { icon: 'run', tone: 'run', what: 'Started its writer again', about: name };
    case 'request-opened':
      return { icon: 'request', tone: 'run', what: 'Opened its request', about: name };
    case 'request-merged':
      return { icon: 'request', tone: 'ok', what: 'Its request was merged', about: name };
    case 'request-closed':
      return { icon: 'request', tone: 'fail', what: 'Its request was closed', about: name };
    default:
      return null;
  }
}

/** Hive's events of today. */
export function hiveFeed(
  day: WorkspaceDay | null,
  list: readonly WorkspaceSummary[],
  now: number,
): FeedItem[] {
  const name = namer(list, day);
  const items: FeedItem[] = [];
  for (const [i, event] of (day?.events ?? []).entries()) {
    if (event.source !== 'hive' || !isToday(event.at, now)) continue;
    const words = hiveWords(event, name(event.branch));
    if (words) items.push({ key: `e${i}`, at: event.at, branch: event.branch, ...words });
  }
  return newestFirst(items);
}
