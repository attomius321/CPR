import type { MergeEntry } from '@symbiote/core';
import type { Notice } from '../shell/shell-context.js';
import { postJson } from '../ui/http.js';

/**
 * Cleans up a workspace (V18; from its card too since V55): its agent's sessions, its worktree
 * and, once merged, its branch; an unmerged one only when asked. What the status bar then says.
 */
export async function cleanUp(branch: string, unmerged = false): Promise<Notice> {
  await postJson('/api/workspaces/clean', { branch, ...(unmerged ? { unmerged: true } : {}) });
  return { text: `Cleaned up ${branch}: its worktree is removed.` };
}

/** Removes a merge from Symbiote's queue, with its log (V26a; a landed one from its card, V55). */
export async function removeMerge(entry: MergeEntry): Promise<Notice> {
  await postJson('/api/merges/remove', { id: entry.id });
  return { text: `Removed the merge of ${entry.branch} from the queue.` };
}
