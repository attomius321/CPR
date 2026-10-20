import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { MergeEntry } from '@cpr/core';
import { reviewMarks, type ReviewMark } from './branchReviews.js';
import { relativeDate } from './commits.js';
import { CprIcon, HistoryIcon, PlusIcon, SettingsIcon, SidenavIcon } from './icons.js';
import { mergeState } from './merges.js';
import { HISTORY_PAGE, hrefOf, SETTINGS_PAGE } from './pages.js';
import { useShell } from './shell-context.js';
import { useWorkspaces } from './useWorkspaces.js';
import { KindTag, WorkspaceBranch, WorkspaceChip, WorkspaceState } from './Workspace.js';
import { workspaceGroups, workspaceName, type WorkspaceRow } from './workspaces.js';

const GROUPS = [
  ['needsYou', 'Needs you'],
  ['working', 'Working'],
  ['done', 'Done'],
] as const;

/** The cards' buttons, in order: what `w` focuses and the arrows move between. */
const CARD = '.workspace-about';

/**
 * The shell's sidenav (V29a): CPR and the repository, the pages, then the workspaces by what each
 * needs from the person and the merges in CPR's queue. A card opens its workspace (or merge) in
 * the main area. Folded, it is a rail of icons and marks.
 */
export function Sidenav({
  repo,
  folded,
  onFold,
  flashed,
}: {
  repo?: string | undefined;
  folded: boolean;
  onFold: () => void;
  /** A workspace just started: its card in view, flashed. */
  flashed: string | null;
}) {
  const shell = useShell();
  const { list, reviews, merges } = useWorkspaces();
  const groups = useMemo(() => workspaceGroups(list?.workspaces ?? [], reviews), [list, reviews]);
  const marks = useMemo(() => reviewMarks(reviews).marks, [reviews]);
  const route = shell?.route;
  const queued = merges?.merges ?? [];
  const needs = groups.needsYou.length;
  const empty = list !== null && list.workspaces.length === 0 && queued.length === 0;

  /** The arrows move between the cards; Enter opens one (it is a button). */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>(CARD)];
    const at = cards.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    cards[
      Math.max(0, Math.min(cards.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
    ]?.focus();
  };

  return (
    <aside className={`sidenav${folded ? ' rail' : ''}`} aria-label="Pages and workspaces">
      <div className="sidenav-top">
        <a className="sidenav-brand" href={HISTORY_PAGE} title={repo ? `CPR · ${repo}` : 'CPR'}>
          <CprIcon />
          <span className="sidenav-label">
            CPR{repo && <span className="sidenav-repo"> · {repo}</span>}
          </span>
        </a>
        <button
          type="button"
          className="icon-button sidenav-fold"
          aria-label={folded ? 'Open the sidenav' : 'Fold the sidenav'}
          title={folded ? 'Open the sidenav ([)' : 'Fold the sidenav ([)'}
          aria-expanded={!folded}
          onClick={onFold}
        >
          <SidenavIcon />
        </button>
      </div>
      <nav className="sidenav-pages" aria-label="Pages">
        <a
          href={HISTORY_PAGE}
          title="History: every branch's commits (h)"
          aria-current={route?.page === 'history' ? 'page' : undefined}
        >
          <HistoryIcon />
          <span className="sidenav-label">History</span>
          <kbd aria-hidden="true">h</kbd>
        </a>
        <a
          href={SETTINGS_PAGE}
          title="Settings: every agent's prompts (s)"
          aria-current={route?.page === 'settings' ? 'page' : undefined}
        >
          <SettingsIcon />
          <span className="sidenav-label">Settings</span>
          <kbd aria-hidden="true">s</kbd>
        </a>
      </nav>
      <section className="sidenav-workspaces" aria-label="Workspaces">
        <h2 className="sidenav-heading">
          <span className="sidenav-label">Workspaces</span>
          {needs > 0 && (
            <span className="page-count" title={`${needs} need${needs === 1 ? 's' : ''} you`}>
              {needs}
            </span>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Start a workspace"
            title="Start a workspace: a branch, its worktree and an agent (n)"
            onClick={() => shell?.startWorkspace()}
          >
            <PlusIcon />
          </button>
        </h2>
        {/* Why they are kept where they are (CPR's cache), or a folder left from before (V25). */}
        {list?.note && <p className="hint workspaces-note">{list.note}</p>}
        {!list && <p className="hint sidenav-hint">Listing workspaces…</p>}
        {empty && (
          <div className="hint workspaces-empty">
            <p>No workspaces yet.</p>
            <p>
              Start one (n): describe the work, and CPR makes its branch and worktree and starts an
              agent there. Or start one from a commit in History.
            </p>
          </div>
        )}
        <div className="sidenav-list" onKeyDown={onKeyDown}>
          {queued.length > 0 && (
            <section className="workspace-group merging" aria-label="Merging">
              <h3>
                <span className="sidenav-label">Merging</span>{' '}
                <span className="branches-count">{queued.length}</span>
              </h3>
              <ul className="workspace-list">
                {queued.map((entry) => (
                  <MergeCard
                    key={entry.id}
                    entry={entry}
                    picked={route?.page === 'merge' && route.branch === entry.branch}
                    onPick={() => shell?.navigate({ page: 'merge', branch: entry.branch })}
                  />
                ))}
              </ul>
            </section>
          )}
          {GROUPS.map(([key, title]) =>
            groups[key].length === 0 ? null : (
              <section key={key} className="workspace-group" aria-label={title}>
                <h3>
                  <span className="sidenav-label">{title}</span>{' '}
                  <span className="branches-count">{groups[key].length}</span>
                </h3>
                <ul className="workspace-list">
                  {groups[key].map((row) => (
                    <WorkspaceCard
                      key={row.workspace.branch}
                      row={row}
                      mark={marks.get(row.workspace.branch)}
                      picked={route?.page === 'workspace' && route.branch === row.workspace.branch}
                      flashed={row.workspace.branch === flashed}
                      onPick={() =>
                        shell?.navigate({ page: 'workspace', branch: row.workspace.branch })
                      }
                    />
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      </section>
    </aside>
  );
}

/** A workspace in the sidenav: what it is and what it needs; a click opens it. */
function WorkspaceCard({
  row,
  mark,
  picked,
  flashed,
  onPick,
}: {
  row: WorkspaceRow;
  mark: ReviewMark | undefined;
  picked: boolean;
  flashed: boolean;
  onPick: () => void;
}) {
  const item = useRef<HTMLLIElement>(null);
  const [flash, setFlash] = useState(false);
  const { workspace } = row;
  const name = workspaceName(workspace);

  // Picked from elsewhere (a link, a start): in view.
  useLayoutEffect(() => {
    if (picked) item.current?.scrollIntoView({ block: 'nearest' });
  }, [picked]);
  // Just started: flashed.
  useLayoutEffect(() => {
    if (!flashed) return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(timer);
  }, [flashed]);

  return (
    <li
      ref={item}
      className={`workspace-row${picked ? ' picked' : ''}${flash ? ' flash' : ''}`}
      data-branch={workspace.branch}
      title={`${name} — ${row.next.text}`}
      onClick={onPick}
    >
      <div className="workspace-head">
        <WorkspaceChip row={row} />
        <button
          type="button"
          className="workspace-about"
          aria-current={picked ? 'true' : undefined}
          onClick={(event) => {
            event.stopPropagation();
            onPick();
          }}
        >
          <KindTag workspace={workspace} />
          {name}
        </button>
        <time className="commit-date" dateTime={workspace.created}>
          {relativeDate(workspace.created, Date.now())}
        </time>
      </div>
      <WorkspaceState row={row} />
      <div className="workspace-branch">
        <WorkspaceBranch row={row} mark={mark} />
      </div>
    </li>
  );
}

/** A merge in CPR's queue: the branch, where it goes, its state; a click opens it. */
function MergeCard({
  entry,
  picked,
  onPick,
}: {
  entry: MergeEntry;
  picked: boolean;
  onPick: () => void;
}) {
  const { text, tone } = mergeState(entry);
  return (
    <li
      className={`workspace-row merge-card merge-tone-${tone}${picked ? ' picked' : ''}`}
      data-merge={entry.branch}
      title={`${entry.branch} → ${entry.into}: ${text}`}
      onClick={onPick}
    >
      <div className="workspace-head">
        <span className="workspace-mark merge-mark" aria-hidden="true">
          ⇢
        </span>
        <a
          className="workspace-about"
          href={hrefOf({ page: 'merge', branch: entry.branch })}
          aria-current={picked ? 'true' : undefined}
          onClick={(event) => event.stopPropagation()}
        >
          {entry.branch} → {entry.into}
        </a>
      </div>
      <p className="workspace-state">{text}</p>
    </li>
  );
}
