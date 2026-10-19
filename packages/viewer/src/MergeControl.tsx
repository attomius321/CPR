import { useEffect, useState } from 'react';
import type { MergeEntry, MergeTargets } from '@cpr/core';
import { getJson, postJson } from './http.js';
import { mergeState } from './merges.js';
import { reloadWorkspaces, useWorkspaces } from './useWorkspaces.js';

/**
 * Merge into ▾ (V26a, decision 149): offered when the branch's last verdict approves and its tip
 * is the approved commit; the target preselected (the workspace's `from`, the verdict's `into`,
 * the default branch) and any other branch to pick. Once queued, the entry's state instead.
 */
export function MergeControl({ branch }: { branch: string }) {
  const { merges } = useWorkspaces();
  const [targets, setTargets] = useState<MergeTargets | null>(null);
  const [into, setInto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queued: MergeEntry | undefined = merges?.merges.find(
    (e) => e.branch === branch && e.state !== 'landed',
  );
  // Read again when the queue changes: a landed or removed entry offers Merge again.
  const version = merges?.merges.map((e) => `${e.id}:${e.state}`).join() ?? '';
  useEffect(() => {
    let live = true;
    getJson<MergeTargets>(`/api/merges/targets?branch=${encodeURIComponent(branch)}`)
      .then((found) => live && setTargets(found))
      .catch(() => live && setTargets(null));
    return () => {
      live = false;
    };
  }, [branch, version]);

  if (queued) {
    const { text, tone } = mergeState(queued);
    return (
      <p className={`merge-control merge-tone-${tone}`} role="status">
        {text}
      </p>
    );
  }
  if (!targets || targets.blocked || !targets.head || targets.branches.length === 0) return null;
  const target = into ?? targets.into ?? targets.branches[0] ?? '';
  const merge = () => {
    setBusy(true);
    setError(null);
    postJson<MergeEntry>('/api/merges', { branch, into: target })
      .then(() => reloadWorkspaces())
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="merge-control">
      <button
        type="button"
        className="button"
        disabled={busy}
        title={`Merge the approved commit ${targets.head.slice(0, 7)} into ${target} in CPR's own worktree, check it, and land it`}
        onClick={merge}
      >
        Merge into {target}
      </button>{' '}
      <select
        aria-label="Branch to merge into"
        value={target}
        disabled={busy}
        onChange={(event) => setInto(event.target.value)}
      >
        {targets.branches.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {error && (
        <span className="error" role="alert">
          {' '}
          {error}
        </span>
      )}
    </div>
  );
}
