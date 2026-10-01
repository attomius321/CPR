import { useMemo, useState } from 'react';
import type { Graph } from '@cpr/core';
import {
  canSubmit,
  describeDraft,
  postReview,
  toReview,
  type ReviewDraft,
  type ReviewEvent,
} from './comments.js';
import { label } from './flow.js';

export interface ReviewProps {
  forge: 'github' | 'gitlab';
  draft: ReviewDraft;
  onBody: (body: string) => void;
  onRemove: (id: string) => void;
  /** The review was posted: its drafts are done. */
  onPosted: () => void;
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
  | { status: 'failed'; error: string };

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

  const submit = async () => {
    setSubmission({ status: 'posting' });
    try {
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
        {forge === 'gitlab' && event === 'request-changes' && (
          <p className="muted small">
            GitLab gets a note marked “Changes requested”, and your approval is withdrawn.
          </p>
        )}
        <button
          type="submit"
          className="button"
          disabled={submission.status === 'posting' || !canSubmit(draft.drafts, event, draft.body)}
        >
          {submission.status === 'posting' ? 'Posting…' : `Submit review to ${site}`}
        </button>
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
