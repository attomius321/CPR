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
import {
  SymbioteMark,
  GitIcon,
  HistoryIcon,
  MenuIcon,
  MonitorIcon,
  PlusIcon,
  NucleusIcon,
  SettingsIcon,
  SidenavIcon,
  SkillsIcon,
  SpinIcon,
  OverviewIcon,
  ChevronIcon,
} from '../ui/icons.js';
import { Help } from '../ui/Help.js';
import {
  GIT_PAGE,
  MONITOR_PAGE,
  NUCLEUS_PAGE,
  SETTINGS_PAGE,
  SKILLS_PAGE,
  START_PAGE,
  WORKSPACE_HISTORY_PAGE,
  OVERVIEW_PAGE,
} from './pages.js';
import { Resizer } from '../ui/Resizer.js';
import { nextNucleusMark, type NucleusMark } from '../nucleus/page-agent.js';
import { nucleusWaiting, scribeWaiting } from './waiting.js';
import { useAsks } from './useAsks.js';
import { nucleusName as named, useNucleusName } from './names.js';
import { useNucleusPhase } from './alpha-ceph.js';
import { BecomingName } from './BecomingName.js';
import { useShell } from './shell-context.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { respondTo } from '../workspaces/respond.js';
import { useHive } from './hive.js';
import { HiveSidenavGroups } from './HiveSidenav.js';
import { useStarts, type StartUnderWay } from '../workspaces/starting.js';
import { useCardMoves } from '../workspaces/useCardMoves.js';
import { doneGroups } from '../workspaces/row-words.js';
import { findingsOf } from '../overview/normal-overview.js';
import { useFindings } from '../workspaces/useFindings.js';
import { workspaceGroups, type WorkspaceRow } from '../workspaces/workspaces.js';
import { mergingAlone } from '../workspaces/merges.js';
import { DoneRowItem, MergeRowItem, WorkspaceRowItem } from './SidenavRow.js';
import { loadWidths, saveWidth } from '../ui/widths.js';
import { tip } from '../ui/tip.js';

/**
 * Normal mode's groups after the merges (V93, `nkit.js`): what waits for the person first, then
 * what is theirs to review, what does not run, what works; Done today and Earlier fold after them.
 */
const GROUPS = [
  ['waiting', 'Waiting for you'],
  ['review', 'To review'],
  ['stopped', 'Not running'],
  ['working', 'Working'],
] as const;

/** The cards' buttons (a merge's, links), in order. */
const CARD = '.workspace-about';

/**
 * What `w` focuses and the arrows move between: the cards' buttons but those of cards being
 * cleaned up or removed (V57), which take no focus.
 */
export const CARD_NAMES = `${CARD}:not(:disabled, [aria-disabled='true'])`;

/**
 * A page agent's mark after its link's name (V35): a spinner while it works, a dot when it
 * answered. Waiting on the person (V59), "Waits": the link is an amber band then, and its dot
 * shows only on the folded rail, where words do not.
 */
function AgentMark({ waits, mark }: { waits: boolean; mark: NucleusMark }) {
  if (waits) {
    return (
      <>
        <span className="sidenav-waits">Waits</span>
        <span className="state-dot tone-waiting" aria-hidden="true" />
      </>
    );
  }
  if (!mark) return null;
  return (
    <span
      className={`state-dot ${mark === 'working' ? 'tone-working' : 'tone-done'}`}
      aria-hidden="true"
    />
  );
}

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
  const { list, reviews, merges, nucleus, scribe, failing, readAt } = useWorkspaces();
  // Workspaces being made (V48), until the list has them.
  const starts = useStarts().filter(
    (start) => !list?.workspaces.some((workspace) => workspace.branch === start.branch),
  );
  // Hive mode (HV4, decision 774): only Hive and Done; nothing waits for the person.
  const hiveMode = useHive();
  const groups = useMemo(
    () => workspaceGroups(list?.workspaces ?? [], reviews, { hiveMode }),
    [list, reviews, hiveMode],
  );
  // The findings of the changes analyzed in this run (V93, decision 892), by each tip.
  const graphs = useFindings();
  // Done today and Earlier (decision 877): a landed merge says when.
  const done = useMemo(
    () => doneGroups(groups.done, merges?.merges ?? [], Date.now()),
    [groups.done, merges],
  );
  // Nucleus by its name: Alpha Ceph while Hive mode is on (decision 682).
  const nucleusName = useNucleusName();
  // Nucleus becoming Alpha Ceph as this window turned Hive on (V86): only here does it play.
  const becoming = useNucleusPhase() === 'becoming';
  const route = shell?.route;
  const queued = merges?.merges ?? [];
  // The branches merging now: their workspaces' rows are the merges' (V93), until one fails.
  const merging = useMemo(() => mergingAlone(queued), [queued]);
  const empty =
    list !== null && list.workspaces.length === 0 && queued.length === 0 && starts.length === 0;
  // Nucleus's mark (V35): working while it answers; answered when it did while you were elsewhere.
  const pageAgentState = nucleus?.conversation?.state;
  const onNucleus = route?.page === 'nucleus';
  const [nucleusMark, setNucleusMark] = useState<NucleusMark>(null);
  useEffect(() => {
    setNucleusMark((shown) => nextNucleusMark(shown, pageAgentState, onNucleus));
  }, [pageAgentState, onNucleus]);
  // It waits for the person (MC1): an ask of its own on the page, or a dialog in its terminal.
  const nucleusWaits = nucleusWaiting(nucleus, useAsks());
  // Scribe's, on Skills (V41): as Nucleus's.
  const scribeState = scribe?.conversation?.state;
  const onSkills = route?.page === 'skills';
  const [scribeMark, setScribeMark] = useState<NucleusMark>(null);
  useEffect(() => {
    setScribeMark((shown) => nextNucleusMark(shown, scribeState, onSkills));
  }, [scribeState, onSkills]);
  // A dialog in its terminal (V59): it waits as Nucleus does.
  const scribeWaits = scribeWaiting(scribe);

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

  // What every group's rows share: the workspace shown.
  const cards = {
    picked: route?.page === 'workspace' ? route.branch : null,
    onPick: (branch: string) => shell?.navigate({ page: 'workspace', branch }),
    onRespond: (branch: string) => respondTo(branch, (route) => shell?.navigate(route)),
  };

  /** The arrows move between the cards; Enter opens one (it is a button). */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>(CARD_NAMES)];
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
          href={GIT_PAGE}
          // Named in the rail too, where its words are hidden (a `title` named it before V54).
          aria-label={repo ? `Symbiote · ${repo}` : 'Symbiote'}
          {...tip(repo ? `Symbiote · ${repo}` : 'Symbiote', { side: 'right' })}
        >
          <SymbioteMark />
          {/* The project's name alone beside the S (V88, the redesign's kits); Symbiote's only
              where there is no project. */}
          <span className="sidenav-label">{repo ?? 'Symbiote'}</span>
          {/* Hive's pill (V92, decision 869): lit by the arrival's last step. */}
          {hiveMode && (
            <span className="hive-pill sidenav-label">
              <svg viewBox="0 0 12 13" aria-hidden="true">
                <polygon points="6,0.5 11.5,3.5 11.5,9.5 6,12.5 0.5,9.5 0.5,3.5" />
              </svg>
              Hive
            </span>
          )}
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
        {/* The Overview (V91, decision 848): first, the page `/` opens. */}
        <a
          href={OVERVIEW_PAGE}
          aria-label="Overview"
          {...tip(
            hiveMode
              ? "Overview\nHive's work: in flight, stopped, landed today, its limits"
              : 'Overview\nWhat waits for you, the agents at work, the merges and the day',
            { keys: 't', side: 'right' },
          )}
          aria-current={route?.page === 'overview' ? 'page' : undefined}
        >
          <OverviewIcon />
          <span className="sidenav-label">Overview</span>
          <kbd aria-hidden="true">t</kbd>
        </a>
        <a
          href={NUCLEUS_PAGE}
          aria-label={nucleusWaits ? `${nucleusName}, waits for you` : nucleusName}
          {...tip(
            nucleusWaits
              ? `${nucleusName}\nWaits for you`
              : nucleusMark === 'working'
                ? `${nucleusName}\nWorking`
                : nucleusMark === 'answered'
                  ? `${nucleusName}\nAnswered while you were away`
                  : `${nucleusName}\nYour orchestrator: ask, research the web, carry a workspace`,
            {
              keys: 'a',
              side: 'right',
              tone: nucleusWaits
                ? 'warn'
                : nucleusMark === 'working'
                  ? 'info'
                  : nucleusMark === 'answered'
                    ? 'ok'
                    : undefined,
            },
          )}
          aria-current={route?.page === 'nucleus' ? 'page' : undefined}
          data-state={nucleusWaits ? 'waiting' : (nucleusMark ?? undefined)}
        >
          <NucleusIcon becoming={becoming} />
          <span className="sidenav-label">
            {becoming ? <BecomingName from={named(false)} to={nucleusName} /> : nucleusName}
          </span>
          <AgentMark waits={nucleusWaits} mark={nucleusMark} />
          <kbd aria-hidden="true">a</kbd>
        </a>
        <a
          href={GIT_PAGE}
          aria-label="Git"
          {...tip("Git\nEvery branch's commits, your changes and the remotes", {
            keys: 'g',
            side: 'right',
          })}
          aria-current={route?.page === 'git' ? 'page' : undefined}
        >
          <GitIcon />
          <span className="sidenav-label">Git</span>
          <kbd aria-hidden="true">g</kbd>
        </a>
        <a
          href={SKILLS_PAGE}
          aria-label={scribeWaits ? 'Skills, Scribe waits for you' : 'Skills'}
          {...tip(
            scribeWaits
              ? 'Skills\nScribe waits for you'
              : scribeMark === 'working'
                ? 'Skills\nScribe is writing'
                : scribeMark === 'answered'
                  ? 'Skills\nScribe answered while you were away'
                  : 'Skills\nWhat agents load to work in this repository',
            {
              keys: 'i',
              side: 'right',
              tone: scribeWaits
                ? 'warn'
                : scribeMark === 'working'
                  ? 'info'
                  : scribeMark === 'answered'
                    ? 'ok'
                    : undefined,
            },
          )}
          aria-current={route?.page === 'skills' ? 'page' : undefined}
          data-state={scribeWaits ? 'waiting' : (scribeMark ?? undefined)}
        >
          <SkillsIcon />
          <span className="sidenav-label">Skills</span>
          <AgentMark waits={scribeWaits} mark={scribeMark} />
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
          href={WORKSPACE_HISTORY_PAGE}
          aria-label="History"
          {...tip('History\nThe workspaces you cleaned up: what their agents did', {
            keys: 'h',
            side: 'right',
          })}
          aria-current={route?.page === 'workspace-history' ? 'page' : undefined}
        >
          <HistoryIcon />
          <span className="sidenav-label">History</span>
          <kbd aria-hidden="true">h</kbd>
        </a>
      </nav>
      <section className="sidenav-workspaces" aria-label="Workspaces">
        <h2 className="sidenav-heading">
          <span className="sidenav-label">Workspaces</span>
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
        {/* In Hive mode, In flight says it (V92): "Nothing yet: start a goal". */}
        {empty && !hiveMode && (
          <p className="hint workspaces-empty">
            No workspaces yet.
            <Help label="About workspaces">
              Start one (<kbd>n</kbd>): describe the work, and Symbiote makes its branch and
              worktree and starts an agent there. Or start one from a commit in Git.
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
          {queued.length > 0 && !hiveMode && (
            <WorkspaceGroupSection
              group="merging"
              title="Merging"
              count={queued.length}
              folded={folded}
            >
              {() =>
                queued.map((entry) => (
                  <MergeRowItem
                    key={entry.id}
                    entry={entry}
                    title={list?.workspaces.find((w) => w.branch === entry.branch)?.title}
                    folded={folded}
                    picked={route?.page === 'merge' && route.branch === entry.branch}
                    onPick={() => shell?.navigate({ page: 'merge', branch: entry.branch })}
                  />
                ))
              }
            </WorkspaceGroupSection>
          )}
          {hiveMode && (
            <HiveSidenavGroups
              workspaces={list?.workspaces ?? []}
              reviews={reviews}
              folded={folded}
              picked={cards.picked}
              onPick={cards.onPick}
              starting={starts.map((start) => (
                <StartingCard key={start.branch} start={start} />
              ))}
            />
          )}
          {!hiveMode &&
            GROUPS.map(([key, title]) => {
              // A workspace being made is at work.
              const making = key === 'working' ? starts : [];
              // A workspace with a merge in the queue shows in Merging alone (V93, the proofs);
              // failed, its card is back for its agent's fix (fix/failed-merge-hides-workspace).
              const rows = groups[key].filter((row) => !merging.has(row.workspace.branch));
              return rows.length + making.length === 0 ? null : (
                <WorkspaceGroupSection
                  key={key}
                  group={key}
                  title={title}
                  count={rows.length + making.length}
                  folded={folded}
                >
                  {() => (
                    <>
                      {rows.map((r) => (
                        <WorkspaceRowItem
                          key={r.workspace.branch}
                          row={r}
                          folded={folded}
                          picked={cards.picked === r.workspace.branch}
                          flashed={r.workspace.branch === flashed}
                          findings={findingsOf(r.workspace.tip, graphs)}
                          onPick={() => cards.onPick(r.workspace.branch)}
                          onRespond={() => cards.onRespond(r.workspace.branch)}
                        />
                      ))}
                      {making.map((start) => (
                        <StartingCard key={start.branch} start={start} />
                      ))}
                    </>
                  )}
                </WorkspaceGroupSection>
              );
            })}
          {!hiveMode &&
            (
              [
                ['today', 'Done today', done.today],
                ['earlier', 'Earlier', done.earlier],
              ] as const satisfies readonly (readonly [
                keyof typeof FOLD_KEYS,
                string,
                readonly (WorkspaceRow & { at?: string })[],
              ])[]
            ).map(([key, title, rows]) =>
              rows.length === 0 ? null : (
                <WorkspaceGroupSection
                  key={key}
                  group={key === 'today' ? 'done' : 'earlier'}
                  title={title}
                  count={rows.length}
                  fold={FOLD_KEYS[key]}
                  folded={folded}
                >
                  {(open) =>
                    (open ? rows : rows.filter((r) => r.workspace.branch === cards.picked)).map(
                      (r) => (
                        <DoneRowItem
                          key={r.workspace.branch}
                          row={r}
                          at={'at' in r ? (r.at as string) : undefined}
                          folded={folded}
                          picked={cards.picked === r.workspace.branch}
                          onPick={() => cards.onPick(r.workspace.branch)}
                        />
                      ),
                    )
                  }
                </WorkspaceGroupSection>
              ),
            )}
        </div>
      </section>
      {/* Settings at the bottom, under the workspaces: not a page one works in. No landmark of its
          own: the Settings page has the navigation named "Settings". */}
      <footer className="sidenav-foot">
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
      </footer>
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

/**
 * Where a folding group keeps whether the person opened it: normal mode's Done today (V91's Done,
 * decision 859) and Earlier (V93).
 */
const FOLD_KEYS = { today: 'symbiote.viewer.done', earlier: 'symbiote.viewer.done-earlier' };

/** Whether the person folded a group: folded until opened. */
function loadFolded(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'open';
  } catch {
    return true;
  }
}

function saveFolded(key: string, folded: boolean): void {
  try {
    window.localStorage.setItem(key, folded ? 'folded' : 'open');
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/**
 * A group of workspaces (V93, decision 877; `nkit.js`'s `.nav-group`): its name and how many, no
 * icon; its rows. A folding one's heading is a button, its chevron first.
 */
function WorkspaceGroupSection({
  group,
  title,
  count,
  fold,
  folded,
  children,
}: {
  group: string;
  title: string;
  count: number;
  /** Its key in this browser when its rows fold under its heading. */
  fold?: string | undefined;
  /** The sidenav folded to its rail: a row is its icon, its tip says the rest. */
  folded: boolean;
  /** Its rows: all of them, or, folded, the one shown in the main area (`open` false). */
  children: (open: boolean) => ReactNode;
}) {
  const [shut, setShut] = useState(() => (fold ? loadFolded(fold) : false));
  // On the rail every row is an icon: nothing folds there.
  const open = !(fold && shut && !folded);
  const toggle = () =>
    setShut((now) => {
      if (fold) saveFolded(fold, !now);
      return !now;
    });
  return (
    <section className={`workspace-group group-${group}`} aria-label={title}>
      {fold && !folded ? (
        <h3>
          <button
            type="button"
            className="group-fold"
            aria-expanded={open}
            {...tip(open ? `Fold ${title}` : `Show ${title}`, { side: 'right' })}
            onClick={toggle}
          >
            <ChevronIcon open={open} />
            <span className="sidenav-label">{title}</span>{' '}
            <span className="branches-count">{count}</span>
          </button>
        </h3>
      ) : (
        <h3 {...tip(title, { side: 'right' })}>
          <span className="sidenav-label">{title}</span>{' '}
          <span className="branches-count">{count}</span>
        </h3>
      )}
      <ul className="workspace-list">{children(open)}</ul>
    </section>
  );
}

/**
 * A workspace being made (V48): its row while Symbiote makes its branch and worktree and starts
 * its agent (~1 s); its own row takes its place once listed.
 */
function StartingCard({ start }: { start: StartUnderWay }) {
  return (
    <li
      className="workspace-row ws-row starting"
      data-branch={start.branch}
      data-tone="run"
      aria-busy="true"
      {...tip(`${start.name}\n${start.kind ? `${start.kind} · ` : ''}${start.branch}`, {
        side: 'right',
      })}
    >
      <span className="ws-row-icon" aria-hidden="true">
        <SpinIcon />
      </span>
      {/* Not a row's button (`.workspace-about`): the arrows and the focus skip it. */}
      <span className="starting-name ws-row-title">{start.name}</span>
      <span className="ws-row-state">
        <b>Starting</b> · its worktree, then {start.agent ?? 'the branch'}
      </span>
    </li>
  );
}
