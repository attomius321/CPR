import { useEffect, useState } from 'react';
import type { MergeEntry, MergeStrategy, MergeTargets } from '@symbiote/core';
import { getJson, postJson } from '../ui/http.js';
import { fastForwardBlocked, mergeState, mergeTip } from './merges.js';
import { reloadWorkspaces, useWorkspaces } from './useWorkspaces.js';
import { tip } from '../ui/tip.js';

/**
 * Merge into ▾ (V26a, decision 149): offered when the branch's last verdict approves and its tip
 * is the approved commit; the target preselected (the branch it is reviewed against, V65; its
 * `from`, the verdict's `into`, the default branch) and any other branch to pick; how it lands,
 * with a merge commit or by fast-forward (V67, `merge.strategy` preselected), a fast-forward the
 * target cannot take said and not offered. Once queued, the entry's state instead.
 */
export function MergeControl({ branch }: { branch: string }) {
  const { merges } = useWorkspaces();
  const [targets, setTargets] = useState<MergeTargets | null>(null);
  const [into, setInto] = useState<string | null>(null);
  const [how, setHow] = useState<MergeStrategy | null>(null);
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
  const strategy = how ?? targets.strategy;
  const cannot = strategy === 'fast-forward' ? fastForwardBlocked(targets, branch, target) : null;
  const merge = () => {
    setBusy(true);
    setError(null);
    postJson<MergeEntry>('/api/merges', { branch, into: target, strategy })
      .then(() => reloadWorkspaces())
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="merge-control">
      <button
        type="button"
        className="button"
        disabled={busy || cannot !== null}
        {...tip(mergeTip(targets, target, strategy))}
        onClick={merge}
      >
        Merge into
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
      </select>{' '}
      <select
        aria-label="How it lands"
        value={strategy}
        disabled={busy}
        onChange={(event) => setHow(event.target.value as MergeStrategy)}
      >
        <option value="merge">with a merge commit</option>
        <option value="fast-forward">by fast-forward</option>
      </select>
      {cannot && (
        <span className="merge-control-why hint" role="status">
          {cannot}
        </span>
      )}
      {error && (
        <span className="error" role="alert">
          {' '}
          {error}
        </span>
      )}
    </div>
  );
}
