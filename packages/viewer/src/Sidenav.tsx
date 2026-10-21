import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import type { MergeEntry } from '@symbiote/core';
import { reviewMarks, type ReviewMark } from './branchReviews.js';
import { relativeDate } from './commits.js';
import {
  SymbioteIcon,
  HistoryIcon,
  MenuIcon,
  PlusIcon,
  SettingsIcon,
  SidenavIcon,
} from './icons.js';
import { mergeState } from './merges.js';
import { HISTORY_PAGE, hrefOf, SETTINGS_PAGE, START_PAGE } from './pages.js';
import { useShell } from './shell-context.js';
import { useWorkspaces } from './useWorkspaces.js';
import { KindTag, StateDot, WorkspaceBranch, WorkspaceState } from './Workspace.js';
import { workspaceGroups, workspaceName, type WorkspaceRow } from './workspaces.js';

const GROUPS = [
  ['needsYou', 'Needs you'],
  ['working', 'Working'],
  ['done', 'Done'],
] as const;

/** The cards' buttons, in order: what `w` focuses and the arrows move between. */
const CARD = '.workspace-about';

/**
 * The shell's sidenav (V29a): Symbiote and the repository, the pages, then the workspaces by what
 * each needs from the person and the merges in Symbiote's queue. A card opens its workspace (or
 * merge) in the main area. Folded, it is a rail of icons and marks.
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

  // A card whose workspace moves to another group (its agent moved on) is drawn anew there, and
  // the focus would fall to the page: it follows the card. Only the card the focus was on, and
  // only when nothing else took the focus (a blur, the person's own move, forgets it).
  const cardList = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    focused.current = event.target.matches(CARD) ? event.target : null;
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === focused.current) focused.current = null;
  };
  useLayoutEffect(() => {
    const card = focused.current;
    if (!card || card.isConnected || document.activeElement !== document.body) return;
    const branch = card.closest<HTMLElement>('[data-branch]')?.dataset.branch;
    const again = branch
      ? cardList.current?.querySelector<HTMLElement>(
          `.workspace-row[data-branch="${CSS.escape(branch)}"] ${CARD}`,
        )
      : null;
    focused.current = again ?? null;
    again?.focus();
  });

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
        <a
          className="sidenav-brand"
          href={HISTORY_PAGE}
          title={repo ? `Symbiote · ${repo}` : 'Symbiote'}
        >
          <SymbioteIcon />
          <span className="sidenav-label">
            Symbiote{repo && <span className="sidenav-repo"> · {repo}</span>}
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
          {/* A page since V30a: on a diff, its own document, the link loads it. */}
          <a
            className="icon-button"
            href={START_PAGE}
            aria-label="Start a workspace"
            title="Start a workspace: a branch, its worktree and an agent (n)"
            aria-current={route?.page === 'start' ? 'page' : undefined}
          >
            <PlusIcon />
          </a>
        </h2>
        {/* Why they are kept where they are (Symbiote's cache), or a folder left from before (V25). */}
        {list?.note && <p className="hint workspaces-note">{list.note}</p>}
        {!list && <p className="hint sidenav-hint">Listing workspaces…</p>}
        {empty && (
          <div className="hint workspaces-empty">
            <p>No workspaces yet.</p>
            <p>
              Start one (n): describe the work, and Symbiote makes its branch and worktree and
              starts an agent there. Or start one from a commit in History.
            </p>
          </div>
        )}
        <div
          className="sidenav-list"
          ref={cardList}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        >
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
              <section key={key} className={`workspace-group group-${key}`} aria-label={title}>
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

/**
 * Under 900 px (V29a): the strip at the top whose button opens the sidenav as a drawer over the
 * page, and the scrim that closes it.
 */
export function DrawerStrip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <>
      <header className="shell-top">
        <button
          type="button"
          className="icon-button"
          aria-label={open ? 'Close the sidenav' : 'Open the sidenav'}
          aria-expanded={open}
          onClick={onToggle}
        >
          <MenuIcon />
        </button>
        <strong className="brand">Symbiote</strong>
      </header>
      {open && <div className="shell-scrim" aria-hidden="true" onClick={onToggle} />}
    </>
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
        <StateDot row={row} />
        <button
          type="button"
          className="workspace-about"
          aria-current={picked ? 'true' : undefined}
          onClick={(event) => {
            event.stopPropagation();
            onPick();
          }}
        >
          {name}
        </button>
      </div>
      <div className="workspace-line">
        <WorkspaceState row={row} />
        <time className="commit-date" dateTime={workspace.created}>
          {relativeDate(workspace.created, Date.now())}
        </time>
      </div>
      <div className="workspace-branch">
        <KindTag workspace={workspace} />
        <WorkspaceBranch row={row} mark={mark} />
      </div>
    </li>
  );
}

/** A merge in Symbiote's queue: the branch, where it goes, its state; a click opens it. */
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
        <span className={`state-dot merge-tone-${tone}`} aria-hidden="true" />
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
