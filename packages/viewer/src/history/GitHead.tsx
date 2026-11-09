// The Git page's head (V66; the page frame's since V72).
import type { RefObject } from 'react';
import type { HistoryPage, SyncState } from '@symbiote/core';
import { PageHead } from '../ui/PageHead.js';
import { GitIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';
import { headLine } from './details.js';
import { FindBox } from './FindBox.js';
import { SyncBar, type SyncRun } from './SyncBar.js';

/**
 * The page's head (V66; the page frame's since V72): its icon, its name and where the
 * branch is against its upstream; the search and the remotes at its right.
 */
export function GitHead({
  first,
  sync,
  findRef,
  find,
  query,
  matches,
  cursor,
  step,
  syncing,
  runSync,
  pane,
}: {
  first: HistoryPage;
  sync: SyncState | null;
  findRef: RefObject<HTMLInputElement | null>;
  /** The search's words, kept by the page across listings. */
  find: { query: string; onQuery: (query: string) => void };
  /** The words searched, trimmed: the matches are shown only with some. */
  query: string;
  matches: number[] | null;
  cursor: number;
  step: (forward: boolean) => void;
  syncing: SyncRun | null;
  runSync: (run: SyncRun) => void;
  /** The details pane: its toggle (`d`). */
  pane: { open: boolean; onOpen: (open: boolean) => void };
}) {
  return (
    <PageHead
      className="git-bar"
      icon={<GitIcon />}
      title="Git"
      line={headLine(first.branch, sync)}
      actions={
        <>
          <FindBox
            inputRef={findRef}
            query={find.query}
            matches={query ? matches : null}
            at={matches ? matches.indexOf(cursor) : -1}
            onQuery={find.onQuery}
            onStep={step}
          />
          <SyncBar sync={sync} running={syncing} onRun={runSync} />
          <button
            type="button"
            className="compare-mode details-toggle"
            aria-pressed={pane.open}
            {...tip(pane.open ? 'Fold the details' : 'Show the details', { keys: 'd' })}
            onClick={() => pane.onOpen(!pane.open)}
          >
            Details
            <kbd aria-hidden="true">d</kbd>
          </button>
        </>
      }
    />
  );
}
