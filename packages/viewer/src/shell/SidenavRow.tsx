// Normal mode's sidenav rows (V93, decisions 876, 877; `nkit.js`, the kits' `.ws`): a workspace's
// row of two lines — its state's icon and its title; its state's word, facts and time — a merge's
// row the same, and Done today's one line with when. The words are `row-words.ts`'s (pure).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MergeEntry } from '@symbiote/core';
import {
  AlertIcon,
  BellIcon,
  DoneIcon,
  IdleIcon,
  MergeIcon,
  QuestionIcon,
  ReviewIcon,
  SpinIcon,
  TrashIcon,
} from '../ui/icons.js';
import { tip } from '../ui/tip.js';
import { useSecondsWhile } from '../workspaces/clock.js';
import { cleanUp, removeMerge } from '../workspaces/cleanup.js';
import { mergeState, removableOnCard } from '../workspaces/merges.js';
import { mergeKey, useRemoving, workspaceKey } from '../workspaces/removing.js';
import {
  mergeRowWords,
  rowWords,
  type RowFindings,
  type RowIcon,
  type RowWords,
} from '../workspaces/row-words.js';
import { useMergeCheck } from '../workspaces/WorkspaceFacts.js';
import { mergedForCard, workspaceName, type WorkspaceRow } from '../workspaces/workspaces.js';
import { hrefOf } from './pages.js';
import { useShell, type Notice } from './shell-context.js';

const ICONS: Record<RowIcon, () => ReactNode> = {
  merge: MergeIcon,
  bell: BellIcon,
  question: QuestionIcon,
  eye: ReviewIcon,
  spin: SpinIcon,
  alert: AlertIcon,
  idle: IdleIcon,
  check: DoneIcon,
};

/** "12:44". */
export const hourMinute = (iso: string): string => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/**
 * The second line (the kits' `.m`): the state's word, what its tool works on right after it, then
 * its facts and its time, each after " · ".
 */
function RowLine({ words }: { words: RowWords }) {
  const rest = [...words.detail, ...(words.time ? [words.time] : [])];
  const after = [words.object, ...rest.map((part) => `· ${part}`)].filter(Boolean).join(' ');
  return (
    <span className="ws-row-state">
      <b>{words.word}</b>
      {after && <span>{after}</span>}
    </span>
  );
}

/**
 * What the row's two lines leave out, said whole for screen readers (its tip says it for the
 * pointer): the state in full, the kind and branch, the model, the facts.
 */
function Said({ text }: { text: string }) {
  const [, ...rest] = text.split('\n');
  return <span className="ws-row-said">{rest.join('. ')}</span>;
}

/** Its row in view when it is the one shown; flashed once when just started. */
function useShown(picked: boolean, flashed: boolean) {
  const item = useRef<HTMLLIElement>(null);
  const [flash, setFlash] = useState(false);
  useLayoutEffect(() => {
    if (picked) item.current?.scrollIntoView({ block: 'nearest' });
  }, [picked]);
  useLayoutEffect(() => {
    if (!flashed) return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(timer);
  }, [flashed]);
  return { item, flash };
}

/**
 * A workspace's row. A click or Enter opens it; one that waits opens with its terminal focused
 * (V48's Respond, `onRespond`). On the rail its icon alone, its tip the rest.
 */
export function WorkspaceRowItem({
  row,
  folded,
  picked,
  flashed,
  findings,
  onPick,
  onRespond,
}: {
  row: WorkspaceRow;
  folded: boolean;
  picked: boolean;
  flashed: boolean;
  findings?: RowFindings | undefined;
  onPick: () => void;
  onRespond: () => void;
}) {
  const { workspace, next } = row;
  const { item, flash } = useShown(picked, flashed);
  const merge = useMergeCheck(workspace);
  // A working agent's turn ticks each second.
  const ticking = next.group === 'working' && !!workspace.activity?.since;
  const clock = useSecondsWhile(ticking);
  const now = ticking ? clock : Date.now();
  const found = rowWords(row, now, { merge, ...(findings ? { findings } : {}) });
  const name = workspaceName(workspace);
  // Being cleaned up (V57): disabled, saying so, until the list drops it; Clean up anyway from
  // its page reaches a row of any group.
  const cleaning = useRemoving(workspaceKey(workspace.branch));
  const goes = mergedForCard(workspace)
    ? 'its worktree and its branch'
    : 'its worktree; the branch stays';
  const words: RowWords = cleaning
    ? {
        icon: 'spin',
        tone: 'idle',
        word: 'Cleaning up',
        detail: [goes],
        tip: `${name}\nCleaning up · ${goes}`,
      }
    : found;
  const Icon = ICONS[words.icon];
  const open = next.group === 'waiting' ? onRespond : onPick;
  return (
    <li
      ref={item}
      className={`workspace-row ws-row${picked ? ' picked' : ''}${flash ? ' flash' : ''}${cleaning ? ' removing' : ''}`}
      data-branch={workspace.branch}
      data-group={next.group}
      data-tone={words.tone}
      {...(cleaning ? { 'aria-busy': true, 'aria-disabled': true } : {})}
      {...tip(folded ? `${words.tip}` : words.tip.split('\n').slice(1).join('\n'), {
        side: 'right',
      })}
      onClick={cleaning ? undefined : open}
    >
      <span className={`ws-row-icon${words.icon === 'spin' ? ' spinning' : ''}`} aria-hidden="true">
        <Icon />
      </span>
      <button
        type="button"
        className="workspace-about ws-row-title"
        aria-current={picked ? 'true' : undefined}
        disabled={cleaning}
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
      >
        {name}
      </button>
      {!folded && <RowLine words={words} />}
      <Said text={words.tip} />
    </li>
  );
}

/** A merge in Symbiote's queue (V26): its workspace's title, its state and its check's clock. */
export function MergeRowItem({
  entry,
  title,
  folded,
  picked,
  onPick,
}: {
  entry: MergeEntry;
  title: string | undefined;
  folded: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const { item } = useShown(picked, false);
  const ticking = entry.state === 'checking' && !!entry.check?.started;
  const clock = useSecondsWhile(ticking);
  const words = mergeRowWords(entry, title, ticking ? clock : Date.now());
  // Being removed (V57): disabled, saying so, until the list drops it.
  const removing = useRemoving(mergeKey(entry.id));
  const removable = removableOnCard(entry) && !removing;
  const Icon = ICONS[words.icon];
  return (
    <li
      ref={item}
      className={`workspace-row ws-row merge-card${picked ? ' picked' : ''}${removable ? ' removable' : ''}${removing ? ' removing' : ''}`}
      data-merge={entry.branch}
      data-tone={words.tone}
      {...(removing ? { 'aria-busy': true, 'aria-disabled': true } : {})}
      {...tip(folded ? words.tip : words.tip.split('\n').slice(1).join('\n'), { side: 'right' })}
      onClick={removing ? undefined : onPick}
    >
      <span className="ws-row-icon" aria-hidden="true">
        <Icon />
      </span>
      {/* A link, as a merge's address is one (V26). */}
      <a
        className="workspace-about ws-row-title"
        {...(removing
          ? { 'aria-disabled': true }
          : { href: hrefOf({ page: 'merge', branch: entry.branch }) })}
        aria-current={picked ? 'true' : undefined}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          if (!removing) onPick();
        }}
      >
        {words.title}
      </a>
      {!folded &&
        (removing ? (
          <span className="ws-row-state">
            <b>Removing</b>
            <span>it from the queue</span>
          </span>
        ) : (
          <RowLine words={words} />
        ))}
      <Said text={`${words.tip}\n${mergeState(entry).text}`} />
      {removable && (
        <RowRemove
          label={`Remove the merge of ${entry.branch}`}
          title={`Remove it from the queue\nWith its log: ${entry.into} keeps the merge`}
          shown={picked}
          run={() => removeMerge(entry)}
        />
      )}
    </li>
  );
}

/** Done today's row (`nkit.js`'s `.ws.small`): the check, its title, when it merged; a bin. */
export function DoneRowItem({
  row,
  at,
  folded,
  picked,
  onPick,
}: {
  row: WorkspaceRow;
  /** When it merged: today's rows show it. */
  at?: string | undefined;
  folded: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const { workspace } = row;
  const { item } = useShown(picked, false);
  const name = workspaceName(workspace);
  const cleaning = useRemoving(workspaceKey(workspace.branch));
  const goes = mergedForCard(workspace)
    ? 'its worktree and its branch'
    : 'its worktree; the branch stays';
  return (
    <li
      ref={item}
      className={`workspace-row ws-row small${picked ? ' picked' : ''}${cleaning ? ' removing' : ' removable'}`}
      data-branch={workspace.branch}
      data-group="done"
      data-tone="ok"
      {...(cleaning ? { 'aria-busy': true, 'aria-disabled': true } : {})}
      {...tip(
        cleaning
          ? `${name}\nCleaning up · ${goes}`
          : `${name}\nMerged into ${workspace.from ?? 'its branch'} · ${workspace.branch}`,
        { side: 'right' },
      )}
      onClick={cleaning ? undefined : onPick}
    >
      <span className="ws-row-icon" aria-hidden="true">
        {cleaning ? <SpinIcon /> : <DoneIcon />}
      </span>
      <button
        type="button"
        className="workspace-about ws-row-title"
        aria-current={picked ? 'true' : undefined}
        disabled={cleaning}
        onClick={(event) => {
          event.stopPropagation();
          onPick();
        }}
      >
        {name}
      </button>
      <Said
        text={`${name}\n${cleaning ? `Cleaning up · ${goes}` : `Merged into ${workspace.from ?? 'its branch'}`}`}
      />
      {at && !folded && (
        <time className="ws-row-when" dateTime={at}>
          {hourMinute(at)}
        </time>
      )}
      {!cleaning && (
        <RowRemove
          label={`Clean up ${name}`}
          title={'Clean up\nRemove its sessions, its worktree and its merged branch'}
          shown={picked}
          run={() => cleanUp(workspace.branch)}
        />
      )}
    </li>
  );
}

/**
 * A done workspace's or a landed merge's way out of the sidenav (V55): a bin over the row's end,
 * on its hover or focus. It runs at once; the row is disabled until the list drops it (V57). The
 * one shown gives way to the Overview (V91).
 */
function RowRemove({
  label,
  title,
  shown,
  run,
}: {
  label: string;
  title: string;
  shown: boolean;
  run: () => Promise<Notice>;
}) {
  const shell = useShell();
  return (
    <button
      type="button"
      className="icon-button card-remove"
      aria-label={label}
      {...tip(title)}
      onClick={(event) => {
        event.stopPropagation();
        run().then(
          (notice) => {
            shell?.notify(notice);
            if (shown) shell?.navigate({ page: 'overview' });
          },
          (e: unknown) => shell?.notify({ text: (e as Error).message, error: true }),
        );
      }}
    >
      <TrashIcon />
    </button>
  );
}
