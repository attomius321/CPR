import { useState } from 'react';
import type { MergeEntry, MergeList, MergeRegion } from '@symbiote/core';
import { postJson } from './http.js';
import {
  failedCheck,
  mergeActions,
  mergeLabel,
  mergeState,
  regionFlags,
  reviewRegion,
  toReview,
  type LineFrom,
  type MergeAction,
  type SideKept,
} from './merges.js';
import { MoreActions, type MenuAction } from './MoreActions.js';
import { reloadWorkspaces, useWorkspaces } from './useWorkspaces.js';

const ACTION_NAMES: Record<MergeAction, string> = {
  land: 'Land',
  approve: 'Approve',
  change: 'Request changes',
  recheck: 'Check again',
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
 * review region by region, what a failed check ran and the end of its output, and Land, Approve,
 * Request changes or Check again, with Retry and Remove under "⋯".
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
  const actions = mergeActions(entry);
  // The frequent actions as buttons; Retry and Remove, rarer, in the "⋯" menu.
  const shownActions = actions.filter((a) => a !== 'retry' && a !== 'remove');
  const more: MenuAction[] = actions
    .filter((a) => a === 'retry' || a === 'remove')
    .map((a) => ({ label: ACTION_NAMES[a], disabled: busy, onSelect: () => act(a) }));
  const regions = toReview(entry) ? (entry.resolution?.regions ?? []) : [];
  const shown = entry.check?.output && entry.check.ok === false;
  const ran = entry.check ? failedCheck(entry.check) : null;
  // Approve lands a resolution whatever its check said: the button says so when it failed.
  const approveTitle =
    entry.check?.ok === false
      ? `Land the merge, though its check failed (${entry.check.failed ?? ''})`
      : undefined;
  return (
    <section className={`merge-row merge-tone-${tone}`} aria-label={`Merge of ${entry.branch}`}>
      <div className="merge-row-head">
        <span className="ref ref-branch merge-ref-theirs" title={entry.branch}>
          {entry.branch}
        </span>
        <span className="merge-arrow" aria-hidden="true">
          →
        </span>
        <span className="ref ref-branch merge-ref-ours" title={entry.into}>
          {entry.into}
        </span>
        <span className="merge-label">{mergeLabel(entry)}</span>
        <span className="merge-row-actions">
          {shownActions.map((action) => (
            <button
              key={action}
              type="button"
              className={action === 'approve' || action === 'land' ? 'button primary' : 'button'}
              title={action === 'approve' ? approveTitle : undefined}
              disabled={busy}
              onClick={() => act(action)}
            >
              {ACTION_NAMES[action]}
            </button>
          ))}
          {more.length > 0 && <MoreActions actions={more} />}
        </span>
      </div>
      <p className="merge-row-state">{text}</p>
      <p className="merge-title hint">{entry.title}</p>
      {regions.length > 0 && (
        <ol className="merge-regions" aria-label="Its resolution">
          {regions.map((region, i) => (
            <MergeRegionView key={i} region={region} into={entry.into} branch={entry.branch} />
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
      {(ran || shown) && (
        <p className="merge-run small">
          {ran}
          {shown && (
            <button type="button" className="link small" onClick={() => setOutput((o) => !o)}>
              {output ? 'Hide its output' : 'Its output'}
            </button>
          )}
        </p>
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

/** At most this many dropped lines a side shows; the rest are counted. */
const DROPPED_SHOWN = 8;

/**
 * One region of a resolution to review: what it says in words (lines dropped, kept twice, written
 * by the agent, or every line kept), the resolution with each line marked by its side, each
 * side's dropped lines, and the raw conflict folded under "Show the conflict".
 */
function MergeRegionView({
  region,
  into,
  branch,
}: {
  region: MergeRegion;
  into: string;
  branch: string;
}) {
  const [conflict, setConflict] = useState(false);
  const review = reviewRegion(region);
  const names: Record<LineFrom, string> = {
    ours: into,
    theirs: branch,
    both: 'both',
    base: 'before',
    new: 'new',
    blank: '',
  };
  const dropped = [
    { side: 'ours' as const, name: into, lines: review.dropped.ours },
    { side: 'theirs' as const, name: branch, lines: review.dropped.theirs },
  ].filter((d) => d.lines.length > 0);
  return (
    <li className="merge-region">
      <p className="merge-region-where">
        <span className="merge-file">
          {region.path}:{region.line}
        </span>
        {region.note && <span className="merge-note"> “{region.note}”</span>}
      </p>
      <div className="merge-verdict">
        {regionFlags(review, into, branch).map((flag) => (
          <span key={flag.text} className={`merge-flag merge-flag-${flag.tone}`}>
            {flag.text}
          </span>
        ))}
        <span className="merge-counts small">
          <MergeCount from="ours" name={into} count={review.kept.ours} />
          <MergeCount from="theirs" name={branch} count={review.kept.theirs} />
          <span className="merge-count from-new">
            new <b>{review.written}</b>
          </span>
        </span>
      </div>
      <div className="merge-code merge-resolved" aria-label="Written in its place">
        {review.lines.map((line, i) => (
          <MergeLine
            key={i}
            from={line.from}
            name={names[line.from]}
            text={line.text}
            twice={line.twice}
          />
        ))}
      </div>
      {dropped.map((d) => (
        <div key={d.side}>
          <p className="merge-sub">Dropped from {d.name}</p>
          <div className="merge-code merge-dropped">
            {d.lines.slice(0, DROPPED_SHOWN).map((text, i) => (
              <MergeLine key={i} from={d.side} name={d.name} text={text} />
            ))}
            {d.lines.length > DROPPED_SHOWN && (
              <p className="merge-more small">+ {d.lines.length - DROPPED_SHOWN} more lines</p>
            )}
          </div>
        </div>
      ))}
      <p className="merge-conflict small">
        <button
          type="button"
          className="link small"
          aria-expanded={conflict}
          onClick={() => setConflict((open) => !open)}
        >
          {conflict ? 'Hide the conflict' : 'Show the conflict'}
        </button>
        {region.base?.length === 0 && (
          <span className="muted"> · both sides added here, nothing before</span>
        )}
      </p>
      {conflict && (
        <div className="merge-region-sides">
          <MergeSide label={into} from="ours" lines={region.ours} />
          {region.base && region.base.length > 0 && (
            <MergeSide label="before both" from="base" lines={region.base} />
          )}
          <MergeSide label={branch} from="theirs" lines={region.theirs} />
        </div>
      )}
    </li>
  );
}

/** "main 1/1": a side's own lines the resolution kept, of all it added. */
function MergeCount({
  from,
  name,
  count,
}: {
  from: 'ours' | 'theirs';
  name: string;
  count: SideKept;
}) {
  return (
    <span className={`merge-count from-${from}`}>
      {name}{' '}
      <b>
        {count.kept}/{count.of}
      </b>
    </span>
  );
}

/** A line of a resolution, or a dropped one: its side in the gutter, coloured by it. */
function MergeLine({
  from,
  name,
  text,
  twice,
}: {
  from: LineFrom;
  name: string;
  text: string;
  twice?: true | undefined;
}) {
  return (
    <div className={`merge-line from-${from}${twice ? ' merge-twice' : ''}`}>
      <span className="merge-line-from" title={name}>
        {name}
      </span>
      <code className="merge-line-text">{text}</code>
      {twice && <span className="merge-line-tag">kept twice</span>}
    </div>
  );
}

/** One side of a conflict region, as git wrote it. */
function MergeSide({ label, from, lines }: { label: string; from: LineFrom; lines: string[] }) {
  return (
    <figure className={`merge-side from-${from}`}>
      <figcaption className="small">{label}</figcaption>
      <pre>
        {lines.length === 0 || (lines.length === 1 && lines[0] === '') ? ' ' : lines.join('\n')}
      </pre>
    </figure>
  );
}
