import { useEffect, useMemo, useState } from 'react';
import type { BranchMerge, FinishResult, Graph } from '@cpr/core';
import {
  canFinish,
  canSubmit,
  checkMerge,
  describeDraft,
  finishReview,
  postReview,
  toLocalReview,
  toReview,
  type ReviewDraft,
  type ReviewEvent,
} from './comments.js';
import { label } from './flow.js';

export interface ReviewProps {
  forge: 'github' | 'gitlab' | 'local';
  draft: ReviewDraft;
  onBody: (body: string) => void;
  onRemove: (id: string) => void;
  /** The review was posted: its drafts are done. */
  onPosted: () => void;
  /**
   * A branch review (V16): its branch, the tip reviewed, and the default branch an approval
   * asks the agent to merge it into (V17; absent on the default branch's own review).
   */
  local?: { branch: string; head: string; into?: string };
}

const EVENTS: { value: ReviewEvent; label: string }[] = [
  { value: 'comment', label: 'Comment' },
  { value: 'approve', label: 'Approve' },
  { value: 'request-changes', label: 'Request changes' },
];

type Submission =
  | { status: 'idle' }
  | { status: 'posting' }
  | { status: 'posted'; url: string }
  /** A branch review finished (V16). */
  | { status: 'finished'; result: FinishResult }
  | { status: 'failed'; error: string };

const short = (sha: string) => sha.slice(0, 7);

/** The pending review: comments written on symbols, a summary, the verdict, and submit. */
export function ReviewTab({
  graph,
  review,
  onSelect,
}: {
  graph: Graph;
  review: ReviewProps;
  onSelect: (id: string) => void;
}) {
  const { forge, draft } = review;
  const [event, setEvent] = useState<ReviewEvent>('comment');
  const [submission, setSubmission] = useState<Submission>({ status: 'idle' });
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const site = forge === 'gitlab' ? 'GitLab' : 'GitHub';

  const local = forge === 'local';
  const into = review.local?.into;
  const head = review.local ? short(review.local.head) : '';
  const submit = async () => {
    setSubmission({ status: 'posting' });
    try {
      if (local) {
        const result = await finishReview(toLocalReview(draft.drafts, event, draft.body));
        setSubmission({ status: 'finished', result });
        setEvent('comment');
        review.onPosted();
        return;
      }
      const { url } = await postReview(toReview(graph, draft.drafts, event, draft.body));
      setSubmission({ status: 'posted', url });
      setEvent('comment');
      review.onPosted();
    } catch (error) {
      setSubmission({ status: 'failed', error: (error as Error).message });
    }
  };

  return (
    <div className="list review-tab">
      {draft.drafts.length === 0 && (
        <p className="muted pad">
          No comments yet: select a symbol and write one in its panel (<kbd>c</kbd>).
        </p>
      )}
      {draft.drafts.map((d) => {
        const node = nodes.get(d.symbol);
        return (
          <div key={d.id} className="draft-row">
            <div className="draft-where">
              <button className="list-link" onClick={() => onSelect(d.symbol)}>
                {node ? label(node) : d.symbol}
              </button>
              <button
                className="link"
                aria-label={`Delete comment on ${node ? label(node) : d.symbol}`}
                onClick={() => review.onRemove(d.id)}
              >
                Delete
              </button>
            </div>
            <div className="muted small">{describeDraft(d)}</div>
            <p className="draft-body">{d.body}</p>
          </div>
        );
      })}

      <form
        className="submit-review"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          className="comment-input"
          aria-label="Review summary"
          placeholder="Summary"
          rows={4}
          value={draft.body}
          onChange={(e) => review.onBody(e.target.value)}
        />
        <fieldset className="events">
          {EVENTS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="event"
                value={option.value}
                checked={event === option.value}
                onChange={() => setEvent(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        {local && (
          <p className="muted small">
            The verdict and its comments stay in this repository, for the agent to read.{' '}
            {into
              ? `Approve asks it to merge ${head} into ${into}.`
              : 'Approve tells it these commits may be pushed.'}{' '}
            CPR pushes nothing.
          </p>
        )}
        {local && into && <MergeCheck branch={review.local?.branch ?? ''} />}
        {forge === 'gitlab' && event === 'request-changes' && (
          <p className="muted small">
            GitLab gets a note marked “Changes requested”, and your approval is withdrawn.
          </p>
        )}
        <button
          type="submit"
          className="button"
          disabled={
            submission.status === 'posting' ||
            !(local ? canFinish : canSubmit)(draft.drafts, event, draft.body)
          }
        >
          {submission.status === 'posting'
            ? local
              ? 'Finishing…'
              : 'Posting…'
            : local
              ? 'Finish review'
              : `Submit review to ${site}`}
        </button>
        {submission.status === 'finished' && (
          <Finished branch={review.local?.branch ?? ''} result={submission.result} />
        )}
        {submission.status === 'posted' && (
          <p className="posted">
            Review posted.{' '}
            <a href={submission.url} target="_blank" rel="noreferrer">
              Open on {site}
            </a>
          </p>
        )}
        {submission.status === 'failed' && <p className="error">{submission.error}</p>}
      </form>
    </div>
  );
}

/**
 * Whether the branch merges cleanly into the default branch (V17), checked in the background:
 * nothing while git works (seconds on a long-lived branch), then clean or the conflicting files.
 */
function MergeCheck({ branch }: { branch: string }) {
  const [merge, setMerge] = useState<BranchMerge | { failed: string } | null>(null);
  useEffect(() => {
    let live = true;
    checkMerge()
      .then((result) => live && result && setMerge(result))
      .catch((error: unknown) => live && setMerge({ failed: (error as Error).message }));
    return () => {
      live = false;
    };
  }, []);
  if (!merge) return null;
  if ('failed' in merge || 'error' in merge) {
    return (
      <p className="merge-check muted small">
        Could not check the merge: {'failed' in merge ? merge.failed : merge.error}
      </p>
    );
  }
  if ('clean' in merge) {
    return <p className="merge-check muted small">Merges cleanly into {merge.into}.</p>;
  }
  // File names: full paths wrap over many lines in the sidebar; they are in the title.
  const shown = merge.conflicts
    .slice(0, 3)
    .map((path) => path.slice(path.lastIndexOf('/') + 1))
    .join(', ');
  const more = merge.conflicts.length > 3 ? ` and ${merge.conflicts.length - 3} more` : '';
  return (
    <p className="merge-check conflicts small" title={merge.conflicts.join('\n')}>
      Conflicts with {merge.into} in {shown}
      {more}: the agent resolves them on {branch} first.
    </p>
  );
}

/**
 * What finishing a branch review recorded (V16), and what the agent does with it when asked:
 * the merge (V17), the push of the default branch's commits, or the comments; "Copy for the
 * agent" puts it in words for a chat.
 */
function Finished({ branch, result }: { branch: string; result: FinishResult }) {
  const [copied, setCopied] = useState<string | null>(null);
  const { verdict } = result;
  const at = short(verdict.head);
  return (
    <div className="posted finished">
      <p>
        {verdict.event !== 'approve' ? (
          <>
            {verdict.event === 'request-changes' ? 'Changes requested' : 'Comments recorded'}: the
            agent finds them in {`cpr/reviews/${branch}/`} (the last of <code>verdicts</code>).
          </>
        ) : verdict.into ? (
          `Approved ${at}: the agent merges it into ${verdict.into} when you ask it to act on this review.`
        ) : (
          `Approved ${at}: the agent may push these commits when you ask it to act on this review.`
        )}
      </p>
      <button
        type="button"
        className="button"
        onClick={() =>
          void navigator.clipboard
            .writeText(result.text)
            .then(() => setCopied('Copied.'))
            .catch((error: unknown) => setCopied(`Could not copy: ${(error as Error).message}`))
        }
      >
        Copy for the agent
      </button>
      {copied && <span className="muted small"> {copied}</span>}
    </div>
  );
}
