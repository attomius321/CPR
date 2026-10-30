// Staging and unstaging hunks and lines on Git's page (decision 642): a patch of the lines picked
// in a modified file's diff, applied to the index. Refused when the diff changed since the page
// read it: its line numbers would pick other lines.
import { GitError, gitInput } from './exec.js';
import { gitWords } from './operations.js';
import { GitRefused } from './refused.js';
import type { GitRepo } from './repo.js';
import { workingChanges, workingFileDiff } from './working-changes.js';

/** A line picked in a diff: a removed one by its old number, an added one by its new. */
export interface LinePick {
  old?: number;
  new?: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * `diff` (one file's, git's) with only the picked changes: `reverse` false stages them (an added
 * line not picked goes, a removed one stays as context), true unstages them from a staged diff,
 * applied reversed (an added line not picked stays as context, a removed one goes). Each hunk's
 * counts and starts follow; null when no picked line is a change.
 */
export function partialPatch(
  diff: string,
  picks: readonly LinePick[],
  reverse: boolean,
): string | null {
  const olds = new Set(picks.flatMap((p) => (p.old === undefined ? [] : [p.old])));
  const news = new Set(picks.flatMap((p) => (p.new === undefined ? [] : [p.new])));
  const text = diff.endsWith('\n') ? diff.slice(0, -1) : diff;
  const lines = text.split('\n');
  const first = lines.findIndex((line) => HUNK.test(line));
  if (first < 0) return null;
  const out = lines.slice(0, first);
  // The side kept whole (old when staging, new when unstaging) keeps its starts; the other
  // side's start moves by what earlier hunks of the patch changed.
  let shift = 0;
  let changed = false;
  let i = first;
  while (i < lines.length) {
    const head = HUNK.exec(lines[i] ?? '');
    if (!head) {
      i++;
      continue;
    }
    let oldAt = Number(head[1]);
    let newAt = Number(head[3]);
    const oldStart = oldAt;
    const newStart = newAt;
    if (Number(head[2] ?? '1') === 0) oldAt++;
    if (Number(head[4] ?? '1') === 0) newAt++;
    const body: string[] = [];
    let kept = true;
    let oldCount = 0;
    let newCount = 0;
    let changes = 0;
    for (i++; i < lines.length && !HUNK.test(lines[i] ?? ''); i++) {
      const line = lines[i] ?? '';
      const mark = line[0];
      const rest = line.slice(1);
      if (mark === '\\') {
        if (kept) body.push(line);
        continue;
      }
      if (mark === ' ') {
        body.push(line);
        oldCount++;
        newCount++;
        oldAt++;
        newAt++;
        kept = true;
      } else if (mark === '-') {
        const picked = olds.has(oldAt++);
        kept = picked || !reverse;
        if (picked) {
          body.push(line);
          oldCount++;
          changes++;
        } else if (!reverse) {
          body.push(` ${rest}`);
          oldCount++;
          newCount++;
        }
      } else if (mark === '+') {
        const picked = news.has(newAt++);
        kept = picked || reverse;
        if (picked) {
          body.push(line);
          newCount++;
          changes++;
        } else if (reverse) {
          body.push(` ${rest}`);
          oldCount++;
          newCount++;
        }
      }
    }
    if (changes === 0) continue;
    changed = true;
    const delta = newCount - oldCount;
    // The other side's start: the kept side's first line, moved by earlier hunks; a side with no
    // line starts at the line before (git's "-5,0").
    const start = (from: number, fromCount: number, count: number) => {
      const line = (fromCount === 0 ? from + 1 : from) + (reverse ? -shift : shift);
      return count === 0 ? line - 1 : line;
    };
    const oldHead = reverse ? start(newStart, newCount, oldCount) : oldStart;
    const newHead = reverse ? newStart : start(oldStart, oldCount, newCount);
    out.push(`@@ -${oldHead},${oldCount} +${newHead},${newCount} @@`, ...body);
    shift += delta;
  }
  return changed ? `${out.join('\n')}\n` : null;
}

export interface LinesRequest {
  path: string;
  /** The side the lines are on: false, not staged (they are staged); true, staged (unstaged). */
  staged: boolean;
  lines: LinePick[];
  /** The diff's `index` line as the page read it: the diff must be the same still. */
  index: string;
}

/**
 * Stages the lines picked in a modified file's diff not staged, or unstages those picked in its
 * staged diff (`git apply --cached`). Refused for a file that is not modified on that side (a
 * new, deleted, renamed or conflicted one is staged whole), when its diff changed since the page
 * read it, and when no picked line is a change.
 */
export async function stageLines(
  repo: GitRepo,
  { path, staged, lines, index }: LinesRequest,
): Promise<void> {
  const changes = await workingChanges(repo);
  const file = (staged ? changes.staged : changes.unstaged).find((f) => f.path === path);
  const side = staged ? 'staged' : 'not staged';
  if (!file || file.status !== 'modified' || file.previousPath)
    throw new GitRefused(`${path} is not a file modified ${side}: stage it whole`);
  const diff = (await workingFileDiff(repo, path, staged)) ?? '';
  if ((/^index .*$/m.exec(diff)?.[0] ?? '') !== index)
    throw new GitRefused(`${path} changed since its diff was read: look at it again`);
  const patch = partialPatch(diff, lines, staged);
  if (!patch) throw new GitRefused('no line picked changes the file');
  try {
    await gitInput(
      repo.root,
      ['apply', '--cached', '--whitespace=nowarn', ...(staged ? ['--reverse'] : []), '-'],
      patch,
    );
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(gitWords(error), { cause: error });
    throw error;
  }
}
