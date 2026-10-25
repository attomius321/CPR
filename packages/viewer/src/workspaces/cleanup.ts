import type { MergeEntry } from '@symbiote/core';
import type { Notice } from '../shell/shell-context.js';
import { postJson } from '../ui/http.js';
import { beginRemoval, endRemoval, mergeKey, workspaceKey } from './removing.js';
import { reloadWorkspaces } from './useWorkspaces.js';

/**
 * Cleans up a workspace (V18; from its card too since V55): its agent's sessions, its worktree
 * and, once merged, its branch; an unmerged one only when asked. What the status bar then says.
 */
export function cleanUp(branch: string, unmerged = false): Promise<Notice> {
  return marked(workspaceKey(branch), async () => {
    await postJson('/api/workspaces/clean', { branch, ...(unmerged ? { unmerged: true } : {}) });
    return { text: `Cleaned up ${branch}: its worktree is removed.` };
  });
}

/** Removes a merge from Symbiote's queue, with its log (V26a; a landed one from its card, V55). */
export function removeMerge(entry: MergeEntry): Promise<Notice> {
  return marked(mergeKey(entry.id), async () => {
    await postJson('/api/merges/remove', { id: entry.id });
    return { text: `Removed the merge of ${entry.branch} from the queue.` };
  });
}

/**
 * Runs a removal with its card disabled (V57), then reads the list again. Done, the card stays
 * disabled until that read drops it; refused, it is itself again at once. Neither the notice nor
 * the caller waits for the read.
 */
async function marked(key: string, run: () => Promise<Notice>): Promise<Notice> {
  beginRemoval(key);
  try {
    const notice = await run();
    void reloadWorkspaces().finally(() => endRemoval(key));
    return notice;
  } catch (error) {
    endRemoval(key);
    void reloadWorkspaces();
    throw error;
  }
}
