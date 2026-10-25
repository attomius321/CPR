// What a workspace's heading says, in its panel and on its card in the sidenav: its state as a dot,
// its kind, its branch and review mark, and a line of what is next and its facts.
import { useEffect, useState } from 'react';
import type { BranchMerge, WorkspaceSummary } from '@symbiote/core';
import type { ReviewMark } from '../history/branchReviews.js';
import { HISTORY_PAGE } from '../shell/pages.js';
import type { WorkspaceRow } from './workspaces.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Whether a workspace with commits merges into the default branch (V17's check), read once. */
function useMergeCheck(workspace: WorkspaceSummary): BranchMerge | null {
  const [merge, setMerge] = useState<BranchMerge | null>(null);
  const wanted = workspace.ahead > 0 && !workspace.merged && workspace.tip !== null;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    fetch(`/api/workspaces/merge?branch=${encodeURIComponent(workspace.branch)}`)
      .then((response) => (response.ok ? (response.json() as Promise<BranchMerge>) : null))
      .then((check) => live && setMerge(check))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [wanted, workspace.branch, workspace.tip]);
  return wanted ? merge : null;
}

function mergeText(merge: BranchMerge | null): string | null {
  if (!merge) return null;
  if ('clean' in merge) return `Merges cleanly into ${merge.into}`;
  if ('conflicts' in merge) {
    return `Conflicts with ${merge.into} in ${plural(merge.conflicts.length, 'file')}`;
  }
  return null;
}

/** What is next for a workspace, then its facts: commits, files not committed, the merge check. */
export function WorkspaceState({ row: { workspace, next } }: { row: WorkspaceRow }) {
  const merge = useMergeCheck(workspace);
  const facts = [
    workspace.ahead > 0 ? plural(workspace.ahead, 'commit') : 'no commits yet',
    workspace.worktree.changed
      ? `${plural(workspace.worktree.changed, 'file')} not committed yet`
      : null,
    workspace.worktree.exists ? null : 'its worktree is gone',
    mergeText(merge),
  ].filter((fact): fact is string => fact !== null);
  const text = [next.text, ...facts].join(' · ');
  return (
    <p className="workspace-state" title={text}>
      <strong>{next.text}</strong>
      {facts.map((fact) => (
        <span key={fact}> · {fact}</span>
      ))}
    </p>
  );
}

/** A workspace's kind before its name (V24c): none for a Feature, the common case. */
export function KindTag({ workspace }: { workspace: WorkspaceSummary }) {
  if (!workspace.kind || workspace.kind === 'feature') return null;
  return <span className="kind-tag">{workspace.kind}</span>;
}

/** A workspace's state as a dot (V29b): the colour of its mark on its branch's badges. */
export function StateDot({ row: { next } }: { row: WorkspaceRow }) {
  return <span className={`state-dot tone-${next.chip.tone}`} aria-hidden="true" />;
}

/** A workspace's branch (a link to its commits) and its review's mark. */
export function WorkspaceBranch({
  row: { workspace },
  mark,
}: {
  row: WorkspaceRow;
  mark?: ReviewMark | undefined;
}) {
  const { branch } = workspace;
  return (
    <>
      {workspace.tip === null ? (
        <span className="ref ref-branch">{branch}</span>
      ) : (
        <a
          className="ref ref-branch"
          href={`${HISTORY_PAGE}?branch=${encodeURIComponent(branch)}`}
          title={`${branch}: its commits`}
          onClick={(event) => event.stopPropagation()}
        >
          {branch}
        </a>
      )}
      {mark && (
        <span className={`ref-review ref-review-${mark.tone}`} title={mark.title}>
          {mark.mark}
        </span>
      )}
    </>
  );
}
