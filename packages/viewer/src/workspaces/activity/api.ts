// The Activity tab's own read (V73): the agent's recorded tools, read while the tab is shown, with
// the list's reads; the thread and the commits are read as the panel reads them.
import { useEffect, useState } from 'react';
import type { WorkspaceTools } from '@symbiote/core';
import { useTouched } from '../../shell/events.js';

/**
 * A workspace's recorded tools (`/api/workspaces/activity`), read again with `version`; null until
 * the first read answers. A failed read keeps what was read before.
 */
export function useTools(branch: string, version: unknown): WorkspaceTools | null {
  const [tools, setTools] = useState<WorkspaceTools | null>(null);
  // Its file written (V94c): a tool's end the list's JSON may not show.
  const touched = useTouched(`activity/${branch}.jsonl`);
  useEffect(() => {
    let live = true;
    fetch(`/api/workspaces/activity?branch=${encodeURIComponent(branch)}`)
      .then((response) => (response.ok ? (response.json() as Promise<WorkspaceTools>) : null))
      .then((read) => {
        if (live && read) setTools(read);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [branch, version, touched]);
  return tools;
}
