import { useState } from 'react';
import type { MergeEntry, MergeList } from '@symbiote/core';
import { postJson } from './http.js';
import { mergeActions, mergeState, toReview, type MergeAction } from './merges.js';
import { reloadWorkspaces, useWorkspaces } from './useWorkspaces.js';

const ACTION_NAMES: Record<MergeAction, string> = {
  land: 'Land',
  approve: 'Approve',
  change: 'Request changes',
  retry: 'Retry',
  remove: 'Remove',
};

/** The queue's entry for a branch: the one still in progress, else its last. */
export function mergeOf(merges: MergeList | null, branch: string): MergeEntry | undefined {
  const entries = merges?.merges.filter((e) => e.branch === branch) ?? [];
  return entries.find((e) => e.state !== 'landed') ?? entries.at(-1);
}

/**
 * A merge in Symbiote's queue (V26a), in the shell's main area (V29a; a row of the Workspaces
 * page's Merging section before): its branch, target and state, the merger agent's resolution to
 * review region by region, the end of a failed check's output, and Land, Approve, Retry or Remove.
 */
export function MergeView({ branch }: { branch: string }) {
  const { merges } = useWorkspaces();
  if (!merges) return <p className="hint main-hint">Reading the merges…</p>;
  const entry = mergeOf(merges, branch);
  if (!entry) {
    return (
      <div className="main-empty">
        <p>No merge of {branch} in Symbiote&apos;s queue.</p>
      </div>
    );
  }
  return (
    <div className="merge-view">
      {merges.elsewhere && (
        <p className="hint">
          Another Symbiote in this repository merges these: it shows them as it goes.
        </p>
      )}
      <MergeEntryView key={entry.id} entry={entry} />
    </div>
  );
}

function MergeEntryView({ entry }: { entry: MergeEntry }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState(false);
  const [changing, setChanging] = useState(false);
  const [comments, setComments] = useState('');
  const { text, tone } = mergeState(entry);
  const post = (path: string, body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    postJson(path, { id: entry.id, ...body })
      .then(() => {
        setChanging(false);
        setComments('');
        return reloadWorkspaces();
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const act = (action: MergeAction) => {
    if (action === 'change') setChanging((open) => !open);
    else post(`/api/merges/${action}`, {});
  };
  const regions = toReview(entry) ? (entry.resolution?.regions ?? []) : [];
  const shown = entry.check?.output && entry.check.ok === false;
  return (
    <section className={`merge-row merge-tone-${tone}`} aria-label={`Merge of ${entry.branch}`}>
      <div className="merge-row-head">
        <span className="ref ref-branch">{entry.branch}</span>
        <span className="merge-arrow" aria-hidden="true">
          →
        </span>
        <span className="ref ref-branch">{entry.into}</span>
        <span className="merge-row-state">{text}</span>
        <span className="merge-row-actions">
          {mergeActions(entry).map((action) => (
            <button
              key={action}
              type="button"
              className={action === 'approve' || action === 'land' ? 'button primary' : 'button'}
              disabled={busy}
              onClick={() => act(action)}
            >
              {ACTION_NAMES[action]}
            </button>
          ))}
        </span>
      </div>
      <p className="merge-title hint">{entry.title}</p>
      {regions.length > 0 && (
        <ol className="merge-regions" aria-label="Its resolution">
          {regions.map((region, i) => (
            <li key={i} className="merge-region">
              <p className="merge-region-where small">
                <span className="merge-file">
                  {region.path}:{region.line}
                </span>
                {region.note && <span className="muted"> · {region.note}</span>}
              </p>
              <div className="merge-region-sides">
                <MergeSide label={entry.into} lines={region.ours} />
                {region.base && <MergeSide label="ancestor" lines={region.base} />}
                <MergeSide label={entry.branch} lines={region.theirs} />
              </div>
              <MergeSide label="Written in its place" lines={region.text.split('\n')} written />
            </li>
          ))}
        </ol>
      )}
      {changing && (
        <form
          className="merge-change"
          onSubmit={(event) => {
            event.preventDefault();
            post('/api/merges/request-changes', { comments });
          }}
        >
          <textarea
            aria-label="What to change in the resolution"
            placeholder="What to change: the merger agent answers again with your words"
            rows={2}
            value={comments}
            onChange={(event) => setComments(event.target.value)}
          />
          <button type="submit" className="button" disabled={busy || comments.trim() === ''}>
            Ask again
          </button>
        </form>
      )}
      {regions.length === 0 && entry.conflicts && (
        <ul className="merge-files small">
          {entry.conflicts.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      )}
      {entry.state === 'needs-you' && entry.message && !entry.resolution?.needsYou && (
        <p className="hint small">{entry.message}</p>
      )}
      {shown && (
        <button type="button" className="link small" onClick={() => setOutput((o) => !o)}>
          {output ? 'Hide its output' : 'Its output'}
        </button>
      )}
      {shown && output && <pre className="merge-output">{entry.check?.output}</pre>}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** One side of a conflict region, or the text written in its place. */
function MergeSide({
  label,
  lines,
  written,
}: {
  label: string;
  lines: string[];
  written?: boolean;
}) {
  return (
    <figure className={`merge-side${written ? ' merge-written' : ''}`}>
      <figcaption className="small muted">{label}</figcaption>
      <pre>
        {lines.length === 0 || (lines.length === 1 && lines[0] === '') ? ' ' : lines.join('\n')}
      </pre>
    </figure>
  );
}
