// What a workspace's heading says, in its panel and on its card in the sidenav: its state as a dot,
// its kind, its branch and review mark, a line of what is next and its facts, and how long its
// state has lasted (V48).
import { useEffect, useState } from 'react';
import type { BranchMerge, WorkspaceSummary } from '@symbiote/core';
import { reviewTip, type ReviewMark } from '../history/branchReviews.js';
import { relativeDate } from '../history/commits.js';
import { HISTORY_PAGE } from '../shell/pages.js';
import { ClaudeMark, CodexMark, HermesMark } from '../ui/icons.js';
import { longAge, useNow } from './clock.js';
import { AGENT_NAMES, shortAge, type WorkspaceRow } from './workspaces.js';
import { tip } from '../ui/tip.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Whether a workspace with commits merges into the branch it is reviewed against (V17's check,
 * V65), read once per tip and pick.
 */
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
  }, [wanted, workspace.branch, workspace.tip, workspace.against]);
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

/**
 * What is next for a workspace — what its agent runs while it works (V48f), after the agent's mark
 * (V53) — then its facts: commits, files not committed, the merge check.
 */
export function WorkspaceState({ row: { workspace, next } }: { row: WorkspaceRow }) {
  const merge = useMergeCheck(workspace);
  const said = next.doing ?? next.text;
  // Only while it works is the line the agent's action; the rest is Symbiote's to say.
  const agent = next.group === 'working' ? (workspace.agent.kind ?? 'claude') : null;
  const facts = [
    workspace.ahead > 0 ? plural(workspace.ahead, 'commit') : 'no commits yet',
    workspace.worktree.changed
      ? `${plural(workspace.worktree.changed, 'file')} not committed yet`
      : null,
    workspace.worktree.exists ? null : 'its worktree is gone',
    mergeText(merge),
  ].filter((fact): fact is string => fact !== null);
  const text = [said, ...facts].join(' · ');
  return (
    <p className="workspace-state" {...tip(agent ? `${AGENT_NAMES[agent]}\n${text}` : text)}>
      {agent === 'codex' ? (
        <CodexMark />
      ) : agent === 'hermes' ? (
        <HermesMark />
      ) : (
        agent && <ClaudeMark />
      )}
      <strong>{said}</strong>
      {facts.map((fact) => (
        <span key={fact}> · {fact}</span>
      ))}
    </p>
  );
}

/** A workspace's kind (V24c), in a chip for every kind (V53); none recorded before V24. */
export function KindTag({ workspace }: { workspace: WorkspaceSummary }) {
  if (!workspace.kind) return null;
  return <span className="kind-tag">{workspace.kind}</span>;
}

/**
 * A workspace's state as a dot (V29b): the colour of its mark on its branch's badges, and its shape
 * (V48): a working agent's halo pulses, a waiting one's holds, a stopped one's dot is a ring.
 */
export function StateDot({ row: { next } }: { row: WorkspaceRow }) {
  return <span className={`state-dot tone-${next.chip.tone}`} aria-hidden="true" />;
}

/**
 * How long a workspace's state has lasted (V48), on its card: "now", "12m", "2h"; else when it
 * was made, as before. Its own component: the page's clock renders it alone.
 */
export function StateAge({ workspace }: { workspace: WorkspaceSummary }) {
  const now = useNow();
  const since = workspace.activity?.since;
  if (!since) {
    return (
      <time className="commit-date" dateTime={workspace.created}>
        {relativeDate(workspace.created, now)}
      </time>
    );
  }
  return (
    <time className="commit-date state-age" dateTime={since} {...tip(`For ${longAge(since, now)}`)}>
      {shortAge(since, now)}
    </time>
  );
}

/** How long its state has lasted, in its panel's heading (V48): " · 12 min"; nothing unknown. */
export function StateFor({ workspace }: { workspace: WorkspaceSummary }) {
  const now = useNow();
  const since = workspace.activity?.since;
  if (!since) return null;
  return (
    <time className="state-for" dateTime={since}>
      {/* Kept by the flex line, which drops a leading space. */}
      {'\u00a0· '}
      {longAge(since, now)}
    </time>
  );
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
          {...tip(`${branch}\nIts commits in History`)}
          onClick={(event) => event.stopPropagation()}
        >
          {branch}
        </a>
      )}
      {mark && (
        <span className={`ref-review ref-review-${mark.tone}`} {...reviewTip(mark)}>
          {mark.mark}
        </span>
      )}
    </>
  );
}
