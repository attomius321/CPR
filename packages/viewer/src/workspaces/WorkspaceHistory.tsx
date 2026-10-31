// History (V77): the finished workspaces — cleaned up, their records kept — in a card, by the day
// they finished, and the one picked beside them, read only: its Activity, Thread, Brief and
// Changes (decisions 561–563). Under Monitor in the sidenav (`h`), at `/workspace-history`; the
// picked one in `?branch=`, its tab after it (`&brief`).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  FinishedWorkspace,
  WorkKind,
  WorkspaceHistory as History,
  WorkspaceSummary,
} from '@symbiote/core';
import { BranchIcon, HistoryIcon, SearchIcon } from '../ui/icons.js';
import { PageHead } from '../ui/PageHead.js';
import { getJson } from '../ui/http.js';
import { tip } from '../ui/tip.js';
import { startDiff } from '../history/api.js';
import { useShell } from '../shell/shell-context.js';
import { ActivityTab } from './ActivityTab.js';
import { BriefTab } from './BriefTab.js';
import { ChangesPanel, useChanges } from './ChangesPanel.js';
import { KIND_ICONS } from './StartKinds.js';
import { ThreadTab, useThread } from './ThreadTab.js';
import { useNow } from './clock.js';
import {
  byDay,
  HISTORY_VIEWS,
  historyView,
  kindsOf,
  matching,
  outcomeText,
  outcomeWord,
  ranFor,
  withHistoryView,
  type HistoryView,
} from './history.js';
import { useWorkspaces } from './useWorkspaces.js';
import { AGENT_NAMES, briefTip, startedWith, workspaceName } from './workspaces.js';
import { useNucleusName } from '../shell/names.js';

const TAB_NAMES: Record<HistoryView, string> = {
  activity: 'Activity',
  thread: 'Thread',
  brief: 'Brief',
  changes: 'Changes',
};

/** The rows' buttons, which the arrows move between. */
const ROWS = '.history-row';

const when = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * The finished workspaces, read when the page opens and again when a workspace leaves the list
 * (cleaned up: it comes here); what was read stays while the next is read.
 */
function useHistory(): { read: History | null; error: string | null } {
  const { list } = useWorkspaces();
  const live = list ? list.workspaces.map((w) => w.branch).join('\n') : null;
  const [state, setState] = useState<{ read: History | null; error: string | null }>({
    read: null,
    error: null,
  });
  useEffect(() => {
    let gone = false;
    getJson<History>('/api/workspaces/history').then(
      (read) => !gone && setState({ read, error: null }),
      (e: unknown) => !gone && setState((before) => ({ ...before, error: (e as Error).message })),
    );
    return () => {
      gone = true;
    };
  }, [live]);
  return state;
}

/** A finished workspace as its tabs read it (V77); null until read, the server's words if not. */
function useFinished(branch: string): WorkspaceSummary | string | null {
  const [read, setRead] = useState<WorkspaceSummary | string | null>(null);
  useEffect(() => {
    let gone = false;
    setRead(null);
    getJson<WorkspaceSummary>(`/api/workspaces/history?branch=${encodeURIComponent(branch)}`).then(
      (summary) => !gone && setRead(summary),
      (e: unknown) => !gone && setRead((e as Error).message),
    );
    return () => {
      gone = true;
    };
  }, [branch]);
  return read;
}

/** History's page: its head, the list, the picked workspace. */
export function WorkspaceHistory({ branch }: { branch: string | undefined }) {
  const shell = useShell();
  const { read, error } = useHistory();
  const now = useNow();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<WorkKind | null>(null);
  const [view, setView] = useState<HistoryView>(() => historyView(window.location.search));
  const all = useMemo(() => read?.workspaces ?? [], [read]);
  const rows = useMemo(() => matching(all, query, kind), [all, query, kind]);
  const days = useMemo(() => byDay(rows, new Date(now)), [rows, now]);
  const kinds = useMemo(() => kindsOf(all), [all]);
  // The one the address names; none named, the newest, the address left as it is.
  const shown = branch ? all.find((w) => w.branch === branch) : all[0];

  // The tab follows the pick in the address (a reload, a link, Back to here keep it).
  useEffect(() => {
    if (!branch) return;
    const here = `${window.location.pathname}${window.location.search}`;
    const next = withHistoryView(here, view);
    if (next !== here) window.history.replaceState(null, '', next);
  }, [branch, view]);

  const pick = (next: string) =>
    shell?.navigate({ page: 'workspace-history', branch: next }, { replace: true });
  // A tab picked on the newest, shown with none named: the address names it, so it is kept.
  const onView = (next: HistoryView) => {
    setView(next);
    if (!branch && shown) pick(shown.branch);
  };

  /** The arrows move the pick from row to row, as Git's cursor moves; the focus goes with it. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(ROWS)];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const next =
      buttons[Math.max(0, Math.min(buttons.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    next?.focus();
    if (next?.dataset.branch) pick(next.dataset.branch);
  };

  // The picked row in sight in its card (an address, Back, or the list under a narrow head).
  const listRef = useRef<HTMLElement>(null);
  const shownBranch = shown?.branch;
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`${ROWS}[aria-current='true']`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [shownBranch, read]);

  const count = read ? all.length : null;
  return (
    <div className="history">
      <PageHead
        className="history-head"
        icon={<HistoryIcon />}
        title="History"
        line={
          count === null
            ? 'The workspaces you cleaned up: what their agents did, and what they were asked.'
            : `${count.toLocaleString('en-US')} finished workspace${count === 1 ? '' : 's'}: what their agents did, and what they were asked.`
        }
      />
      {error && (
        <p className="history-note error" role="alert">
          {error}
        </p>
      )}
      {!read ? (
        !error && <p className="hint history-note">Reading the finished workspaces…</p>
      ) : all.length === 0 ? (
        <div className="history-body empty">
          <div className="history-card history-none">
            <p>No finished workspace yet.</p>
            <p className="hint">
              A workspace comes here when you clean it up, with its brief, its thread and what its
              agent did.
            </p>
          </div>
        </div>
      ) : (
        <div className="history-body">
          <nav
            ref={listRef}
            className="history-list"
            aria-label="Finished workspaces"
            onKeyDown={onKeyDown}
          >
            <div className="history-filters">
              <label className="history-search">
                <SearchIcon />
                <input
                  type="search"
                  aria-label="Search finished workspaces"
                  placeholder="Search workspaces…"
                  value={query}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape' || query === '') return;
                    event.preventDefault();
                    setQuery('');
                  }}
                />
              </label>
              {kinds.length > 1 && (
                <select
                  className="history-kind"
                  aria-label="Kind of work"
                  value={kind ?? ''}
                  onChange={(event) => setKind((event.target.value || null) as WorkKind | null)}
                >
                  <option value="">All kinds</option>
                  {kinds.map((each) => (
                    <option key={each} value={each}>
                      {each[0]?.toUpperCase()}
                      {each.slice(1)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {rows.length === 0 && (
              <p className="hint history-none-found">
                No finished workspace matches{query.trim() ? ` “${query.trim()}”` : ''}.
              </p>
            )}
            {days.map((day) => (
              <section key={day.key} aria-label={day.label}>
                <h2>{day.label}</h2>
                <ul>
                  {day.rows.map((row) => (
                    <li key={row.branch}>
                      <HistoryRow
                        row={row}
                        current={row.branch === shown?.branch}
                        onPick={() => pick(row.branch)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
          {shown ? (
            <FinishedCard key={shown.branch} entry={shown} view={view} onView={onView} />
          ) : (
            <div className="history-card history-none">
              <p>No finished workspace {branch}.</p>
              <p className="hint">It is not cleaned up yet, or was started elsewhere.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A row of the list: its kind's icon, its name, its outcome; its branch, agent and how long. */
function HistoryRow({
  row,
  current,
  onPick,
}: {
  row: FinishedWorkspace;
  current: boolean;
  onPick: () => void;
}) {
  const ran = ranFor(row.created, row.finished);
  return (
    <button
      type="button"
      className="history-row"
      data-branch={row.branch}
      aria-current={current ? 'true' : undefined}
      {...tip(briefTip(row.brief), { side: 'right' })}
      onClick={onPick}
    >
      <span className="history-row-icon">
        {(row.kind && KIND_ICONS[row.kind]) ?? <BranchIcon />}
      </span>
      <span className="history-row-text">
        <span className="history-row-line">
          <span className="history-row-name">{workspaceName(row)}</span>
          <span className={`history-outcome outcome-${row.outcome}`}>{outcomeWord(row)}</span>
        </span>
        <span className="history-row-facts">
          <span className="history-row-branch">{row.branch}</span>
          {row.agent && <span>{AGENT_NAMES[row.agent.kind]}</span>}
          {ran && <span>{ran}</span>}
        </span>
      </span>
    </button>
  );
}

/** What is said in its Thread tab when Symbiote kept none of its messages. */
function unrecorded(summary: WorkspaceSummary): string {
  const kind = summary.agent.kind;
  if (!kind || kind === 'claude') {
    return "Symbiote keeps an agent's messages from V18c on: this one's were not kept.";
  }
  return `${AGENT_NAMES[kind]} keeps this one's messages, not Symbiote.`;
}

/**
 * The picked workspace, read only (decision 562): its name, branch, when it finished, how long it
 * ran and what became of its branch; Open the change; then its tabs.
 */
function FinishedCard({
  entry,
  view,
  onView,
}: {
  entry: FinishedWorkspace;
  view: HistoryView;
  onView: (view: HistoryView) => void;
}) {
  const summary = useFinished(entry.branch);
  const nucleusName = useNucleusName();
  const workspace = summary && typeof summary !== 'string' ? summary : null;
  const [thread] = useThread(entry.branch, entry);
  const changes = useChanges(entry.branch, entry);
  const [said, setSaid] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const ran = ranFor(entry.created, entry.finished);
  const range =
    changes && typeof changes !== 'string' && changes.tip && changes.commits.count > 0
      ? { base: changes.base, head: changes.tip }
      : null;
  const openChange = () => {
    if (!range) return;
    setOpening(true);
    startDiff(range).then(
      (url) => window.location.assign(url),
      (e: unknown) => {
        setOpening(false);
        setSaid((e as Error).message);
      },
    );
  };
  return (
    <section className="history-card history-workspace" aria-label={`Workspace ${entry.branch}`}>
      <div className="history-workspace-head">
        <span className="history-tile" aria-hidden="true">
          {(entry.kind && KIND_ICONS[entry.kind]) ?? <BranchIcon />}
        </span>
        <div className="history-workspace-title">
          <h2>
            <span {...tip(briefTip(entry.brief))}>{workspaceName(entry)}</span>
            {entry.kind && <span className="kind-tag">{entry.kind}</span>}
            <span className={`history-outcome outcome-${entry.outcome}`}>{outcomeText(entry)}</span>
          </h2>
          <p className="history-facts">
            <span className="history-facts-branch">{entry.branch}</span>
            <span>Finished {when(entry.finished)}</span>
            {ran && <span>ran {ran}</span>}
          </p>
        </div>
        {said && (
          <span className="workspace-said" role="status">
            {said}
          </span>
        )}
        {range && (
          <button
            type="button"
            className="button"
            disabled={opening}
            {...tip('Its commits as a change: its files, and the graph of what changed')}
            onClick={openChange}
          >
            {opening ? 'Opening…' : 'Open the change'}
          </button>
        )}
      </div>
      <div className="workspace-views" role="tablist" aria-label="What it did">
        {HISTORY_VIEWS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={view === name}
            className={view === name ? 'selected' : ''}
            onClick={() => onView(name)}
          >
            {TAB_NAMES[name]}
          </button>
        ))}
      </div>
      <div className="workspace-body">
        {typeof summary === 'string' && <p className="history-note error">{summary}</p>}
        {!workspace && summary === null && <p className="hint history-reading">Reading it…</p>}
        {workspace && view === 'activity' && (
          <div className="workspace-activity">
            <ActivityTab workspace={workspace} thread={thread} version={entry} />
          </div>
        )}
        {workspace && view === 'thread' && (
          <div className="workspace-thread">
            <ThreadTab
              thread={thread}
              worktree={workspace.worktree.path}
              unrecorded={unrecorded(workspace)}
            />
          </div>
        )}
        {workspace && view === 'brief' && (
          <BriefTab
            text={workspace.brief}
            started={startedWith(workspace.agent, workspace.via, nucleusName)}
            documents={workspace.documents}
            removed
          />
        )}
        {view === 'changes' && (
          <div className="history-changes">
            <ChangesPanel branch={entry.branch} version={entry} finished onSaid={setSaid} />
          </div>
        )}
      </div>
    </section>
  );
}
