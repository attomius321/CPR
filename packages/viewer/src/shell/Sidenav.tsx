import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { MergeEntry } from '@symbiote/core';
import { reviewMarks, type ReviewMark } from '../history/branchReviews.js';
import {
  DoneIcon,
  KoiMark,
  HistoryIcon,
  MenuIcon,
  MergingIcon,
  MonitorIcon,
  PlusIcon,
  ReviewIcon,
  ScoutIcon,
  SettingsIcon,
  SidenavIcon,
  SkillsIcon,
  StoppedIcon,
  TrashIcon,
  WaitingIcon,
  WorkingIcon,
} from '../ui/icons.js';
import { cleanUp, removeMerge } from '../workspaces/cleanup.js';
import { mergeState, removableOnCard } from '../workspaces/merges.js';
import { Help } from '../ui/Help.js';
import {
  HISTORY_PAGE,
  hrefOf,
  MONITOR_PAGE,
  SCOUT_PAGE,
  SETTINGS_PAGE,
  SKILLS_PAGE,
  START_PAGE,
} from './pages.js';
import { Resizer } from '../ui/Resizer.js';
import { nextScoutMark, type ScoutMark } from '../scout/scout.js';
import { asksBy } from './asks.js';
import { useAsks } from './useAsks.js';
import { useShell, type Notice } from './shell-context.js';
import { reloadWorkspaces, useWorkspaces } from '../workspaces/useWorkspaces.js';
import {
  KindTag,
  StateAge,
  StateDot,
  WorkspaceBranch,
  WorkspaceState,
} from '../workspaces/WorkspaceFacts.js';
import { respondTo } from '../workspaces/respond.js';
import { useStarts, type StartUnderWay } from '../workspaces/starting.js';
import { useCardMoves } from '../workspaces/useCardMoves.js';
import {
  cleanableOnCard,
  workspaceGroups,
  workspaceName,
  type WorkspaceGroup,
  type WorkspaceRow,
} from '../workspaces/workspaces.js';
import { loadWidths, saveWidth } from '../ui/widths.js';
import { tip } from '../ui/tip.js';

/**
 * The workspaces' groups after the merges, each with its icon (V44): only the group has one, a
 * card its dot. The merges come first, then Waiting for you (V48; fix/merging-status).
 */
const GROUPS = [
  ['review', 'To review', ReviewIcon],
  ['stopped', 'Not running', StoppedIcon],
  ['working', 'Working', WorkingIcon],
  ['done', 'Done', DoneIcon],
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
  const { list, reviews, merges, scout, scribe, failing, readAt } = useWorkspaces();
  // Workspaces being made (V48), until the list has them.
  const starts = useStarts().filter(
    (start) => !list?.workspaces.some((workspace) => workspace.branch === start.branch),
  );
  const groups = useMemo(() => workspaceGroups(list?.workspaces ?? [], reviews), [list, reviews]);
  const marks = useMemo(() => reviewMarks(reviews).marks, [reviews]);
  const route = shell?.route;
  const queued = merges?.merges ?? [];
  const needs = groups.waiting.length;
  const empty =
    list !== null && list.workspaces.length === 0 && queued.length === 0 && starts.length === 0;
  // Scout's mark (V35): working while it answers; answered when it did while you were elsewhere.
  const scoutState = scout?.conversation?.state;
  const onScout = route?.page === 'scout';
  const [scoutMark, setScoutMark] = useState<ScoutMark>(null);
  useEffect(() => {
    setScoutMark((shown) => nextScoutMark(shown, scoutState, onScout));
  }, [scoutState, onScout]);
  // It waits for the person (MC1): an ask of its own on the page, or a dialog in its terminal.
  const scoutWaits = asksBy(useAsks(), 'scout') || scoutState === 'needs-you';
  // Scribe's, on Skills (V41): as Scout's.
  const scribeState = scribe?.conversation?.state;
  const onSkills = route?.page === 'skills';
  const [scribeMark, setScribeMark] = useState<ScoutMark>(null);
  useEffect(() => {
    setScribeMark((shown) => nextScoutMark(shown, scribeState, onSkills));
  }, [scribeState, onSkills]);

  // A card whose workspace moves to another group (its agent moved on) is drawn anew there, and
  // the focus would fall to the page: it follows the card. Only the card the focus was on, and
  // only when nothing else took the focus (a blur, the person's own move, forgets it).
  const cardList = useRef<HTMLDivElement>(null);
  useCardMoves(cardList);
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

  // What every group's cards share: the review marks, the workspace shown, the one just started.
  const cards = {
    folded,
    marks,
    picked: route?.page === 'workspace' ? route.branch : null,
    flashed,
    onPick: (branch: string) => shell?.navigate({ page: 'workspace', branch }),
    onRespond: (branch: string) => respondTo(branch, (route) => shell?.navigate(route)),
  };

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
          // Named in the rail too, where its words are hidden (a `title` named it before V54).
          aria-label={repo ? `Symbiote · ${repo}` : 'Symbiote'}
          {...tip(repo ? `Symbiote · ${repo}` : 'Symbiote', { side: 'right' })}
        >
          <KoiMark />
          <span className="sidenav-label">
            Symbiote{repo && <span className="sidenav-repo"> · {repo}</span>}
          </span>
        </a>
        <button
          type="button"
          className="icon-button sidenav-fold"
          aria-label={folded ? 'Open the sidenav' : 'Fold the sidenav'}
          {...tip(folded ? 'Open the sidenav' : 'Fold the sidenav', { keys: '[', side: 'right' })}
          aria-expanded={!folded}
          onClick={onFold}
        >
          <SidenavIcon />
        </button>
      </div>
      <nav className="sidenav-pages" aria-label="Pages">
        <a
          href={HISTORY_PAGE}
          aria-label="History"
          {...tip("History\nEvery branch's commits", { keys: 'h', side: 'right' })}
          aria-current={route?.page === 'history' ? 'page' : undefined}
        >
          <HistoryIcon />
          <span className="sidenav-label">History</span>
          <kbd aria-hidden="true">h</kbd>
        </a>
        <a
          href={SCOUT_PAGE}
          aria-label="Scout"
          {...tip(
            scoutWaits
              ? 'Scout\nWaits for you'
              : scoutMark === 'working'
                ? 'Scout\nWorking'
                : scoutMark === 'answered'
                  ? 'Scout\nAnswered while you were away'
                  : 'Scout\nAsk about the repository, or have it carry a workspace',
            {
              keys: 'a',
              side: 'right',
              tone: scoutWaits
                ? 'warn'
                : scoutMark === 'working'
                  ? 'info'
                  : scoutMark === 'answered'
                    ? 'ok'
                    : undefined,
            },
          )}
          aria-current={route?.page === 'scout' ? 'page' : undefined}
          data-state={scoutWaits ? 'waiting' : (scoutMark ?? undefined)}
        >
          <ScoutIcon />
          <span className="sidenav-label">Scout</span>
          {(scoutWaits || scoutMark) && (
            <span
              className={`state-dot ${
                scoutWaits ? 'tone-waiting' : scoutMark === 'working' ? 'tone-working' : 'tone-done'
              }`}
              aria-hidden="true"
            />
          )}
          <kbd aria-hidden="true">a</kbd>
        </a>
        <a
          href={SKILLS_PAGE}
          aria-label="Skills"
          {...tip(
            scribeMark === 'working'
              ? 'Skills\nScribe is writing'
              : scribeMark === 'answered'
                ? 'Skills\nScribe answered while you were away'
                : 'Skills\nWhat agents load to work in this repository',
            {
              keys: 'i',
              side: 'right',
              tone:
                scribeMark === 'working' ? 'info' : scribeMark === 'answered' ? 'ok' : undefined,
            },
          )}
          aria-current={route?.page === 'skills' ? 'page' : undefined}
          data-state={scribeMark ?? undefined}
        >
          <SkillsIcon />
          <span className="sidenav-label">Skills</span>
          {scribeMark && (
            <span
              className={`state-dot ${scribeMark === 'working' ? 'tone-working' : 'tone-done'}`}
              aria-hidden="true"
            />
          )}
          <kbd aria-hidden="true">i</kbd>
        </a>
        <a
          href={MONITOR_PAGE}
          aria-label="Monitor"
          {...tip("Monitor\nWhere this checkout's code is", { keys: 'm', side: 'right' })}
          aria-current={route?.page === 'monitor' ? 'page' : undefined}
        >
          <MonitorIcon />
          <span className="sidenav-label">Monitor</span>
          <kbd aria-hidden="true">m</kbd>
        </a>
        <a
          href={SETTINGS_PAGE}
          aria-label="Settings"
          {...tip("Settings\nEvery agent's prompts", { keys: 's', side: 'right' })}
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
            <span
              className="page-count"
              {...tip(`${needs} need${needs === 1 ? 's' : ''} you`, { tone: 'warn' })}
            >
              {needs}
            </span>
          )}
          {/* A page since V30a: on a diff, its own document, the link loads it. */}
          <a
            className="icon-button"
            href={START_PAGE}
            aria-label="Start a workspace"
            {...tip('Start a workspace\nA branch, its worktree and an agent', { keys: 'n' })}
            aria-current={route?.page === 'start' ? 'page' : undefined}
          >
            <PlusIcon />
          </a>
        </h2>
        {/* Why they are kept where they are (Symbiote's cache), or a folder left from before (V25). */}
        {list?.note && <p className="hint workspaces-note">{list.note}</p>}
        {/* Before the first read: cards' outlines, shown after 150 ms so a fast read draws none. */}
        {!list && (
          <div className="workspace-skeleton" aria-busy="true" aria-label="Listing workspaces">
            {[0, 1, 2].map((n) => (
              <div key={n} className="skeleton-card">
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        )}
        {/* What was read stays; that it is not new is said (V48). */}
        {failing && (
          <p className="hint workspaces-stale" role="status">
            {readAt
              ? `Not updated since ${new Date(readAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
              : 'Not read'}
            : Symbiote does not answer. Trying again.
          </p>
        )}
        {empty && (
          <p className="hint workspaces-empty">
            No workspaces yet.
            <Help label="About workspaces">
              Start one (<kbd>n</kbd>): describe the work, and Symbiote makes its branch and
              worktree and starts an agent there. Or start one from a commit in History.
            </Help>
          </p>
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
              <h3 {...tip('Merging', { side: 'right' })}>
                <MergingIcon />
                <span className="sidenav-label">Merging</span>{' '}
                <span className="branches-count">{queued.length}</span>
              </h3>
              <ul className="workspace-list">
                {queued.map((entry) => (
                  <MergeCard
                    key={entry.id}
                    entry={entry}
                    folded={folded}
                    picked={route?.page === 'merge' && route.branch === entry.branch}
                    onPick={() => shell?.navigate({ page: 'merge', branch: entry.branch })}
                  />
                ))}
              </ul>
            </section>
          )}
          {groups.waiting.length > 0 && (
            <WorkspaceGroupSection
              group="waiting"
              title="Waiting for you"
              Icon={WaitingIcon}
              rows={groups.waiting}
              {...cards}
            />
          )}
          {GROUPS.map(([key, title, Icon]) => {
            const making = key === 'working' ? starts : [];
            return groups[key].length + making.length === 0 ? null : (
              <WorkspaceGroupSection
                key={key}
                group={key}
                title={title}
                Icon={Icon}
                rows={groups[key]}
                starts={making}
                {...cards}
              />
            );
          })}
        </div>
      </section>
    </aside>
  );
}

/** The sidenav's handle lies over its right border in the shell's grid, not between the two. */
const findSidenav = (handle: HTMLElement) => ({
  panel: handle.parentElement?.querySelector(':scope > .sidenav') ?? null,
  rest: handle.parentElement?.querySelector(':scope > .shell-main') ?? null,
});

/**
 * The sidenav's width as the person drags it (V34): 180–480 px, the main area keeping 480. Gives
 * the shell's style (`--sidenav-open`, which the folded rail ignores), whether a drag is on, and
 * the handle, drawn only while the sidenav is open; under 900 px the stylesheet hides it.
 */
export function useSidenavWidth(folded: boolean): {
  style: CSSProperties | undefined;
  resizing: boolean;
  handle: ReactNode;
} {
  const [width, setWidth] = useState(() => loadWidths().sidenav);
  const [resizing, setResizing] = useState(false);
  const onResize = useCallback((next: number | null) => {
    setWidth(next ?? undefined);
    saveWidth('sidenav', next);
  }, []);
  return {
    style: width ? ({ '--sidenav-open': `${width}px` } as CSSProperties) : undefined,
    resizing,
    handle: folded ? null : (
      <Resizer
        label="Resize sidebar"
        side="before"
        variable="--sidenav-open"
        min={180}
        max={480}
        room={480}
        find={findSidenav}
        onResize={onResize}
        onDrag={setResizing}
      />
    ),
  };
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

/** A group of workspaces (V44): its icon in its state's colour, its name, how many, its cards. */
function WorkspaceGroupSection({
  group,
  title,
  Icon,
  rows,
  starts = [],
  folded,
  marks,
  picked,
  flashed,
  onPick,
  onRespond,
}: {
  group: WorkspaceGroup;
  title: string;
  Icon: () => ReactNode;
  rows: WorkspaceRow[];
  /** Workspaces being made (V48): their cards after the group's. */
  starts?: readonly StartUnderWay[];
  /** The sidenav folded to its rail: a card is its dot, its tip says the rest. */
  folded: boolean;
  marks: Map<string, ReviewMark>;
  /** The workspace shown in the main area. */
  picked: string | null;
  flashed: string | null;
  onPick: (branch: string) => void;
  onRespond: (branch: string) => void;
}) {
  return (
    <section className={`workspace-group group-${group}`} aria-label={title}>
      {/* Its tip names it in the rail, where only the icon shows. */}
      <h3 {...tip(title, { side: 'right' })}>
        <Icon />
        <span className="sidenav-label">{title}</span>{' '}
        <span className="branches-count">{rows.length + starts.length}</span>
      </h3>
      <ul className="workspace-list">
        {rows.map((row) => (
          <WorkspaceCard
            key={row.workspace.branch}
            row={row}
            mark={marks.get(row.workspace.branch)}
            folded={folded}
            picked={picked === row.workspace.branch}
            flashed={row.workspace.branch === flashed}
            onPick={() => onPick(row.workspace.branch)}
            onRespond={() => onRespond(row.workspace.branch)}
          />
        ))}
        {starts.map((start) => (
          <StartingCard key={start.branch} start={start} />
        ))}
      </ul>
    </section>
  );
}

/**
 * A workspace being made (V48): its card while Symbiote makes its branch and worktree and starts
 * its agent (~1 s); its own card takes its place once listed.
 */
function StartingCard({ start }: { start: StartUnderWay }) {
  return (
    <li className="workspace-row starting" data-branch={start.branch} aria-busy="true">
      <div className="workspace-head">
        <span className="state-dot tone-starting" aria-hidden="true" />
        {/* Not a card's button (`.workspace-about`): the arrows and the focus skip it. */}
        <span className="starting-name">{start.name}</span>
      </div>
      <div className="workspace-line">
        <p className="workspace-state">
          <strong>Starting</strong> · its worktree, then {start.agent ?? 'the branch'}
        </p>
      </div>
      <div className="workspace-branch">
        <span className="ref ref-branch">{start.branch}</span>
      </div>
    </li>
  );
}

/** A workspace in the sidenav: what it is and what it needs; a click opens it. */
function WorkspaceCard({
  row,
  mark,
  folded,
  picked,
  flashed,
  onPick,
  onRespond,
}: {
  row: WorkspaceRow;
  mark: ReviewMark | undefined;
  folded: boolean;
  picked: boolean;
  flashed: boolean;
  onPick: () => void;
  /** A waiting agent's answer (V48): its workspace opened, its terminal focused. */
  onRespond: () => void;
}) {
  const item = useRef<HTMLLIElement>(null);
  const [flash, setFlash] = useState(false);
  const { workspace } = row;
  const name = workspaceName(workspace);
  const cleanable = cleanableOnCard(row);

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
      className={`workspace-row${picked ? ' picked' : ''}${flash ? ' flash' : ''}${cleanable ? ' removable' : ''}`}
      data-branch={workspace.branch}
      {...(folded
        ? tip(
            `${name}\n${row.next.doing ?? row.next.text}${row.next.blocked ? `: ${row.next.blocked}` : ''}`,
            { side: 'right' },
          )
        : {})}
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
        <KindTag workspace={workspace} />
      </div>
      {/* After the name in the Tab order, before the branch's link: where it is drawn. */}
      {cleanable && (
        <CardRemove
          label={`Clean up ${name}`}
          title={'Clean up\nRemove its sessions, its worktree and its merged branch'}
          shown={picked}
          run={() => cleanUp(workspace.branch)}
        />
      )}
      {row.next.group === 'waiting' ? (
        // What it asks, and the way to answer it (V48): the card's own action, and how long.
        <>
          <p className="workspace-blocked" {...tip(row.next.blocked ?? row.next.text)}>
            {row.next.blocked ?? row.next.text}
          </p>
          <div className="workspace-respond">
            <button
              type="button"
              className="button secondary respond"
              {...tip(`Answer ${name}\nIts terminal, focused`)}
              onClick={(event) => {
                event.stopPropagation();
                onRespond();
              }}
            >
              Respond
            </button>
            <StateAge workspace={workspace} />
          </div>
        </>
      ) : (
        <div className="workspace-line">
          <WorkspaceState row={row} />
          <StateAge workspace={workspace} />
        </div>
      )}
      <div className="workspace-branch">
        <WorkspaceBranch row={row} mark={mark} />
      </div>
    </li>
  );
}

/** A merge in Symbiote's queue: the branch, where it goes, its state; a click opens it. */
function MergeCard({
  entry,
  folded,
  picked,
  onPick,
}: {
  entry: MergeEntry;
  folded: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const { text, tone } = mergeState(entry);
  const removable = removableOnCard(entry);
  return (
    <li
      className={`workspace-row merge-card merge-tone-${tone}${picked ? ' picked' : ''}${removable ? ' removable' : ''}`}
      data-merge={entry.branch}
      {...(folded ? tip(`${entry.branch} → ${entry.into}\n${text}`, { side: 'right' }) : {})}
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
      {removable && (
        <CardRemove
          label={`Remove the merge of ${entry.branch}`}
          title={`Remove it from the queue\nWith its log: ${entry.into} keeps the merge`}
          shown={picked}
          run={() => removeMerge(entry)}
        />
      )}
      <p className="workspace-state">{text}</p>
    </li>
  );
}

/**
 * A done workspace's or a landed merge's way out of the sidenav (V55): a bin at the card's end, on
 * its hover or focus. It runs at once, as the action does on its page; the card goes with the
 * list's next read, the status bar saying so, or why not. The one shown gives way to History.
 */
function CardRemove({
  label,
  title,
  shown,
  run,
}: {
  label: string;
  title: string;
  /** Its card is the one in the main area. */
  shown: boolean;
  run: () => Promise<Notice>;
}) {
  const shell = useShell();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="icon-button card-remove"
      aria-label={label}
      {...tip(title)}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        run()
          .then(
            (notice) => {
              shell?.notify(notice);
              if (shown) shell?.navigate({ page: 'history' });
            },
            (e: unknown) => shell?.notify({ text: (e as Error).message, error: true }),
          )
          .finally(() => {
            setBusy(false);
            void reloadWorkspaces();
          });
      }}
    >
      <TrashIcon />
    </button>
  );
}
