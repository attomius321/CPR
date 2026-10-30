// More of git on Git's page (fix/git-page-feature-extend, decisions 636–645) in words and
// groupings. Pure.
import type { BlameLine, LinePick, Operation, StashEntry, Stoppable } from '@symbiote/core';
import type { DiffRow } from '../diff/detail.js';
import type { Notice } from '../shell/shell-context.js';

const CONTINUES: Record<Operation, string | null> = {
  merge: 'Commits the merge',
  rebase: 'Commits this step and goes on with the rebase',
  am: 'Applies the next patch',
  'cherry-pick': 'Commits the cherry-picked change',
  revert: 'Commits the revert',
  // A bisect goes on in a terminal: good or bad is the person's to say.
  bisect: null,
};

/** The operation in progress in a sentence, and what Continue does (none for a bisect). */
export function operationWords(operation: Operation): { title: string; continues: string | null } {
  return { title: `A ${operation} is in progress`, continues: CONTINUES[operation] };
}

/** A row's line as a pick: a removed one by its old number, an added one by its new. */
const pickOf = (row: DiffRow): LinePick | null =>
  row.type === 'del' && row.base !== undefined
    ? { old: row.base }
    : row.type === 'add' && row.head !== undefined
      ? { new: row.head }
      : null;

/** The changed rows next to each other, rows `start` to `end` (excluded): each a hunk. */
export function changeRuns(
  rows: readonly DiffRow[],
): { start: number; end: number; picks: LinePick[] }[] {
  const runs: { start: number; end: number; picks: LinePick[] }[] = [];
  rows.forEach((row, i) => {
    const pick = pickOf(row);
    if (!pick) return;
    const last = runs.at(-1);
    if (last && last.end === i) {
      last.end = i + 1;
      last.picks.push(pick);
    } else runs.push({ start: i, end: i + 1, picks: [pick] });
  });
  return runs;
}

/** The picks of the rows at `indexes` that change a line (context left out), in order. */
export function picksIn(rows: readonly DiffRow[], indexes: ReadonlySet<number>): LinePick[] {
  return rows.flatMap((row, i) => {
    const pick = indexes.has(i) ? pickOf(row) : null;
    return pick ? [pick] : [];
  });
}

/** The lines where a run of one commit's lines starts: where the blame names the commit. */
export function blameStarts(lines: readonly BlameLine[]): Set<number> {
  const starts = new Set<number>();
  lines.forEach((line, i) => {
    if (i === 0 || lines[i - 1]?.sha !== line.sha) starts.add(i);
  });
  return starts;
}

/** A stash's words: its message, git's own ("WIP on main: <subject>") as the subject. */
export function stashWords(stash: StashEntry): string {
  return /^WIP on [^:]+: (.*)$/s.exec(stash.message)?.[1] ?? stash.message;
}

/** The status bar's words after a run that may stop on conflicts: `done` unless it stopped. */
export function stoppedNotice(result: Stoppable, done: string): Notice {
  return result.stopped
    ? {
        text: 'Stopped on conflicts: resolve them in the uncommitted changes',
        warning: result.stopped,
      }
    : { text: done };
}
