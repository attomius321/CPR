import { SymbioteError } from '../errors.js';
import { git } from './exec.js';
import type { GitRepo } from './repo.js';

/** One hunk of a zero-context diff (`git diff -U0`): old lines replaced by new ones. */
export interface LineHunk {
  /** First old line; with `oldLines` 0, the line the new ones follow (0: the file's start). */
  oldStart: number;
  oldLines: number;
  /** First new line; with `newLines` 0, the line the removed ones followed. */
  newStart: number;
  newLines: number;
}

/**
 * Where a line of a commit's file is in the working copy: `exact` when the line itself is there
 * (moved by what was added or removed above it), `nearest` when it was changed or removed (the
 * first line of what replaced it, or the line after the removal), `missing` when the working
 * copy has no file at that path.
 */
export type WorkingLine = { how: 'exact' | 'nearest'; line: number } | { how: 'missing' };

/** Maps a 1-based old line through a diff's hunks, in ascending order. */
export function mapLine(
  hunks: readonly LineHunk[],
  line: number,
): { how: 'exact' | 'nearest'; line: number } {
  let offset = 0;
  for (const hunk of hunks) {
    if (hunk.oldLines === 0) {
      if (line <= hunk.oldStart) break;
      offset += hunk.newLines;
      continue;
    }
    if (line < hunk.oldStart) break;
    if (line < hunk.oldStart + hunk.oldLines) {
      return { how: 'nearest', line: hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart };
    }
    offset += hunk.newLines - hunk.oldLines;
  }
  return { how: 'exact', line: line + offset };
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Where a line of `path` at commit `sha` is in the working copy, uncommitted edits included
 * (`git diff <sha> -- <path>`). A file deleted or renamed since is `missing`.
 */
export async function workingLine(
  repo: GitRepo,
  sha: string,
  path: string,
  line: number,
): Promise<WorkingLine> {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new SymbioteError(`not a commit SHA: ${sha}`);
  // Literal pathspecs: `src/routes/[id]/index.tsx` is a glob that matches other files.
  const patch = await git(repo.root, [
    '--literal-pathspecs',
    'diff',
    '-U0',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    sha,
    '--',
    path,
  ]);
  const hunks: LineHunk[] = [];
  let header = true;
  for (const text of patch.split('\n')) {
    // `+++ /dev/null` is a header only before the first hunk; later it is an added line.
    if (header && text === '+++ /dev/null') return { how: 'missing' };
    const hunk = HUNK.exec(text);
    if (!hunk) continue;
    header = false;
    hunks.push({
      oldStart: Number(hunk[1]),
      oldLines: hunk[2] === undefined ? 1 : Number(hunk[2]),
      newStart: Number(hunk[3]),
      newLines: hunk[4] === undefined ? 1 : Number(hunk[4]),
    });
  }
  return mapLine(hunks, line);
}
