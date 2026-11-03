// The sidenav's workspaces in Hive mode (V92, decisions 868, 869; proof 01-overview, the kit's
// `.ws`): In flight, Stopped, Landed today and Earlier, folded; each row two lines — its title,
// then its state's word in its tone and the round and time — and a landed row one line with when.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { BranchReviewList, WorkspaceSummary } from '@symbiote/core';
import {
  AlertIcon,
  AnsweredIcon,
  ChevronIcon,
  DoneIcon,
  IdleIcon,
  SpinIcon,
  StoppedIcon,
  WaitingIcon,
} from '../ui/icons.js';
import { tip } from '../ui/tip.js';
import { useSecondsWhile } from '../workspaces/clock.js';
import {
  hiveGroups,
  hiveRowWords,
  workspaceName,
  type HiveRowWords,
  type WorkspaceRow,
} from '../workspaces/workspaces.js';

const ICONS: Record<HiveRowWords['tone'], () => ReactNode> = {
  run: SpinIcon,
  ok: DoneIcon,
  fail: AlertIcon,
  info: StoppedIcon,
  idle: IdleIcon,
  you: WaitingIcon,
};

const EARLIER_KEY = 'symbiote.viewer.hive-earlier';

/** Whether the person opened Earlier (as 859's Done): folded until opened, kept in the browser. */
function loadEarlierFolded(): boolean {
  try {
    return window.localStorage.getItem(EARLIER_KEY) !== 'open';
  } catch {
    return true;
  }
}

function saveEarlierFolded(folded: boolean): void {
  try {
    window.localStorage.setItem(EARLIER_KEY, folded ? 'folded' : 'open');
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

const two = (n: number) => String(n).padStart(2, '0');
/** "12:44". */
const hm = (iso: string) => {
  const date = new Date(iso);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
};

/** A row: its state's icon, its title; under it its state's word and the rest, or when it landed. */
function HiveRow({
  workspace,
  at,
  folded,
  picked,
  onPick,
}: {
  workspace: WorkspaceSummary;
  /** Landed today: when, on its one line. */
  at?: string;
  folded: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const item = useRef<HTMLLIElement>(null);
  // What Hive runs now ticks each second; a landed row is still.
  const ticking = workspace.hive?.live !== undefined;
  const clock = useSecondsWhile(ticking);
  // Still, the time of this draw: a pause's "goes on at" is said against today.
  const now = ticking ? clock : Date.now();
  const words = hiveRowWords(workspace, now);
  const name = workspaceName(workspace);
  const answered = workspace.hive?.step === 'answered';
  const Icon = answered ? AnsweredIcon : ICONS[words.tone];
  useLayoutEffect(() => {
    if (picked) item.current?.scrollIntoView({ block: 'nearest' });
  }, [picked]);
  return (
    <li
      ref={item}
      className={`workspace-row ws-row hive-row${at ? ' landed small' : ''}${picked ? ' picked' : ''}`}
      data-branch={workspace.branch}
      data-tone={answered ? 'idle' : words.tone}
      {...(folded ? tip(`${name}\n${words.word} · ${words.detail}`, { side: 'right' }) : {})}
      onClick={onPick}
    >
      <span
        className={`ws-row-icon hive-row-icon${words.tone === 'run' && !answered ? ' spinning' : ''}`}
        aria-hidden="true"
      >
        <Icon />
      </span>
      <button
        type="button"
        className="workspace-about ws-row-title hive-row-title"
        aria-current={picked ? 'true' : undefined}
        onClick={(event) => {
          event.stopPropagation();
          onPick();
        }}
      >
        {name}
      </button>
      {at ? (
        <span className="ws-row-when hive-row-time">{hm(at)}</span>
      ) : (
        !folded && (
          <span className="ws-row-state hive-row-state">
            <b>{words.word}</b>
            {words.detail && <span> · {words.detail}</span>}
          </span>
        )
      )}
    </li>
  );
}

/** A group: its name and count (the kit's `.nav-group`), its rows; Earlier folds. */
function HiveGroup({
  title,
  count,
  foldable = false,
  folded,
  children,
}: {
  title: string;
  count: number;
  foldable?: boolean;
  folded: boolean;
  children: (open: boolean) => ReactNode;
}) {
  const [shut, setShut] = useState(() => foldable && loadEarlierFolded());
  const open = !(foldable && shut && !folded);
  return (
    <section className="workspace-group hive-group" aria-label={title}>
      {foldable && !folded ? (
        <h3>
          <button
            type="button"
            className="group-fold"
            aria-expanded={open}
            {...tip(open ? `Fold ${title}` : `Show ${title}`, { side: 'right' })}
            onClick={() =>
              setShut((now) => {
                saveEarlierFolded(!now);
                return !now;
              })
            }
          >
            <span className="sidenav-label">{title}</span>{' '}
            <span className="branches-count">{count}</span>
            <ChevronIcon open={open} />
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

/** Hive's groups of workspaces (decision 868), with the workspaces being made in flight. */
export function HiveSidenavGroups({
  workspaces,
  reviews,
  folded,
  picked,
  onPick,
  starting,
}: {
  workspaces: readonly WorkspaceSummary[];
  reviews: BranchReviewList | null;
  folded: boolean;
  picked: string | null;
  onPick: (branch: string) => void;
  /** The workspaces being made: their cards in flight. */
  starting: ReactNode[];
}) {
  // Today moves at midnight: the list's own reads draw it again often enough.
  const groups = hiveGroups(workspaces, reviews, Date.now());
  const row = (r: WorkspaceRow, at?: string) => (
    <HiveRow
      key={r.workspace.branch}
      workspace={r.workspace}
      {...(at ? { at } : {})}
      folded={folded}
      picked={picked === r.workspace.branch}
      onPick={() => onPick(r.workspace.branch)}
    />
  );
  return (
    <>
      <HiveGroup title="In flight" count={groups.flight.length + starting.length} folded={folded}>
        {() =>
          groups.flight.length + starting.length === 0 ? (
            <li className="hive-none">Nothing yet: start a goal</li>
          ) : (
            <>
              {groups.flight.map((r) => row(r))}
              {starting}
            </>
          )
        }
      </HiveGroup>
      {groups.stopped.length > 0 && (
        <HiveGroup title="Stopped" count={groups.stopped.length} folded={folded}>
          {() => groups.stopped.map((r) => row(r))}
        </HiveGroup>
      )}
      {groups.today.length > 0 && (
        <HiveGroup title="Landed today" count={groups.today.length} folded={folded}>
          {() => groups.today.map((r) => row(r, r.at))}
        </HiveGroup>
      )}
      {groups.earlier.length > 0 && (
        <HiveGroup title="Earlier" count={groups.earlier.length} foldable folded={folded}>
          {(open) =>
            (open
              ? groups.earlier
              : groups.earlier.filter((r) => r.workspace.branch === picked)
            ).map((r) => row(r))
          }
        </HiveGroup>
      )}
    </>
  );
}
