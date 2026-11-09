// Git's rows (V10): the uncommitted row, the rows in view with their graph cells, and the words
// while the rest is listed.
import type { WorkingChanges, Commit, HistoryPage, HistoryShape } from '@symbiote/core';
import type { Picked } from './commits.js';
import { CommitRow } from './CommitRow.js';
import { useBranchReviews } from './useBranchReviews.js';
import { workspaceChips } from '../workspaces/workspace-groups.js';
import { GraphCell, ROW_HEIGHT } from './GraphCell.js';
import { layoutLanes } from './lanes.js';
import { Loading } from '../ui/Loading.js';
import { WorkingRow, WORKING } from './WorkingRow.js';
import { useGitMenus } from './GitMenus.js';
import { useShownFile } from './useShownFile.js';
import type { RefObject, Dispatch, SetStateAction } from 'react';

/** The box that scrolls the rows: only those in view are drawn, in a list as tall as all of them. */
export function CommitList({
  scroller,
  measure,
  fileShown,
  working,
  spacing,
  graphWidth,
  headRow,
  cursor,
  setCursor,
  rows,
  list,
  firstShown,
  lastShown,
  picks,
  lanes,
  details,
  comparing,
  flash,
  matched,
  pickRow,
  openMenu,
  first,
  marks,
  chips,
  parents,
  forkRow,
  jump,
  shape,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  measure: () => void;
  fileShown: ReturnType<typeof useShownFile>['fileShown'];
  working: WorkingChanges | null;
  spacing: number;
  graphWidth: number;
  headRow: number | null;
  cursor: number;
  setCursor: Dispatch<SetStateAction<number>>;
  rows: number;
  list: RefObject<HTMLOListElement | null>;
  firstShown: number;
  lastShown: number;
  picks: Picked[];
  lanes: ReturnType<typeof layoutLanes>;
  details: RefObject<Map<number, Commit>>;
  comparing: boolean;
  flash: number | null;
  matched: ReadonlySet<number>;
  pickRow: (row: number) => void;
  openMenu: ReturnType<typeof useGitMenus>['openMenu'];
  first: HistoryPage;
  marks: ReturnType<typeof useBranchReviews>;
  chips: ReturnType<typeof workspaceChips>;
  parents: number[][];
  forkRow: number | undefined;
  jump: (row: number) => void;
  shape: HistoryShape | null;
}) {
  const now = Date.now();
  const picked = new Set(picks.map((p) => p.sha));
  const shown: number[] = [];
  for (let row = firstShown; row <= lastShown; row++) shown.push(row);
  return (
    <div className="commits-scroll" ref={scroller} onScroll={measure} inert={!!fileShown}>
      {working && (
        <WorkingRow
          changes={working}
          spacing={spacing}
          width={graphWidth}
          joined={headRow === 0}
          cursor={cursor === WORKING}
          onClick={() => setCursor(WORKING)}
        />
      )}
      {rows === 0 ? (
        <p className="hint">No commits yet.</p>
      ) : (
        <ol
          className="commit-list"
          ref={list}
          aria-label="Commits"
          style={{ height: rows * ROW_HEIGHT }}
        >
          {shown.map((row) => {
            const lane = lanes[row];
            const commit = details.current.get(row);
            return (
              <CommitRow
                key={row}
                row={row}
                commit={commit}
                now={now}
                comparing={comparing}
                picked={!!commit && picked.has(commit.sha)}
                cursor={row === cursor}
                flash={row === flash}
                matched={matched.has(row)}
                onClick={() => {
                  setCursor(row);
                  if (comparing) pickRow(row);
                }}
                onMenu={(x, y) => openMenu(row, x, y)}
                branch={first.branch}
                reviewed={marks.marks}
                agents={chips}
                {...(commit && marks.added.has(commit.sha)
                  ? { added: marks.added.get(commit.sha) }
                  : {})}
                graph={
                  lane && (
                    <GraphCell
                      row={lane}
                      index={row}
                      spacing={spacing}
                      width={graphWidth}
                      merge={(parents[row]?.length ?? 0) > 1}
                      head={row === headRow}
                      picked={!!commit && picked.has(commit.sha)}
                      fork={row === forkRow}
                      onJump={jump}
                    />
                  )
                }
              />
            );
          })}
        </ol>
      )}
      {!shape && first.listed > 0 && <Loading className="hint listing">Listing the rest…</Loading>}
    </div>
  );
}
