// The workspaces on Git's branches (V18b, V23): their marks on the badges, the ones that need the
// person first in the panel; an agent's commit listed as it comes.
import { useEffect, useMemo, type RefObject } from 'react';
import type { HistoryRefs } from '@symbiote/core';
import { workspaceChips, workspacesFirst } from '../workspaces/workspace-groups.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';

/** The workspaces' chips and first branches; the listing in place when a workspace's tip moved. */
export function useWorkspaceChips({
  refs,
  relistRef,
}: {
  refs: HistoryRefs | null;
  relistRef: RefObject<() => Promise<void>>;
}) {
  // Each workspace's mark on its branch's badges, a link to it (V18b); its agent's commits listed
  // as they come, in place (decision 634).
  const { list: workspaces, reviews: workspaceReviews } = useWorkspaces();
  const chips = useMemo(
    () => workspaceChips(workspaces?.workspaces ?? [], workspaceReviews, refs?.remotes ?? []),
    [workspaces, workspaceReviews, refs],
  );
  // The workspaces that need the person, first in the branches panel (V23).
  const firstBranches = useMemo(
    () => workspacesFirst(workspaces?.workspaces ?? [], workspaceReviews),
    [workspaces, workspaceReviews],
  );
  useEffect(() => {
    if (!refs || !workspaces) return;
    const moved = workspaces.workspaces.some((f) => {
      const listed = refs.branches.find((b) => b.name === f.branch);
      return f.tip !== null && listed !== undefined && listed.sha !== f.tip;
    });
    if (moved) void relistRef.current();
  }, [workspaces, refs]);

  return { workspaces, chips, firstBranches };
}
