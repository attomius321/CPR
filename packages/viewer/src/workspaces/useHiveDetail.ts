// Hive's record of a workspace (HV3), read for its page: the head's spend, the side card, the Run
// tab.
import { useEffect, useState } from 'react';
import type { WorkspaceHiveDetail } from '@symbiote/core';
import { getJson } from '../ui/http.js';
import { useTouched } from '../shell/events.js';
import { enc } from './run-words.js';

/**
 * What Hive did with a workspace (`/api/workspaces/hive`), read with every read of the list; the
 * last answer stays while the next is read. The page reads it once (V89) for its head's spend, the
 * side card and this tab; `on` false reads nothing (not a Hive workspace).
 */
export function useHiveDetail(
  branch: string,
  version: unknown,
  on: boolean,
): { detail: WorkspaceHiveDetail | null; error: string | null } {
  const [detail, setDetail] = useState<WorkspaceHiveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Its record and its events written (V94c): what the list's JSON may not show.
  const record = useTouched(`hive/${branch}.json`);
  const events = useTouched(`hive/${branch}.jsonl`);
  useEffect(() => {
    if (!on) return;
    let live = true;
    getJson<WorkspaceHiveDetail>(`/api/workspaces/hive?branch=${enc(branch)}`)
      .then((read) => {
        if (!live) return;
        setDetail(read);
        setError(null);
      })
      .catch((failed: unknown) => live && setError((failed as Error).message));
    return () => {
      live = false;
    };
  }, [branch, version, on, record, events]);
  return { detail, error };
}
