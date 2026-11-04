// The findings of the graphs `symbiote view` analyzed (V93, decision 892), read with the list:
// a workspace's row and the Overview count them by its tip. Nothing is analyzed for them.
import { useEffect, useState } from 'react';
import type { WorkspaceFindings } from '@symbiote/core';
import { useWorkspaces } from './useWorkspaces.js';

/** Read again when the list changes (V94a): a tip moved, a workspace came or went. */
export function useFindings(): WorkspaceFindings['graphs'] {
  const { list } = useWorkspaces();
  const [graphs, setGraphs] = useState<WorkspaceFindings['graphs']>([]);
  useEffect(() => {
    let live = true;
    fetch('/api/workspaces/findings')
      .then((response) => (response.ok ? (response.json() as Promise<WorkspaceFindings>) : null))
      .then((read) => live && read && setGraphs(read.graphs))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [list]);
  return graphs;
}
