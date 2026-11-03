import { useMemo } from 'react';
import { reviewMarks } from './branchReviews.js';
import { useNucleusName } from '../shell/names.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';

/**
 * The reviewer's branch reviews (V15) as marks for History: the shell's reviews (V94a), pushed by
 * `symbiote view` as they change, or read as the workspaces are where it does not push.
 */
export function useBranchReviews(): ReturnType<typeof reviewMarks> {
  const { reviews } = useWorkspaces();
  // An approval through Nucleus by its name: Alpha Ceph's in Hive mode (decision 682).
  const nucleus = useNucleusName();
  return useMemo(() => reviewMarks(reviews, nucleus), [reviews, nucleus]);
}
