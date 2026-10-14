import { useMemo, useState } from 'react';
import type { FinishResult, Graph } from '@cpr/core';
import {
  canFinish,
  canSubmit,
  describeDraft,
  finishReview,
  postReview,
  pushAgain,
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
  /** A branch review (V16): its branch, and where Approve pushes. */
  local?: { branch: string; push?: { remote: string; branch: string; commits: number } };
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
  const push = review.local?.push;
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
            The verdict and its comments stay in this repository, for the agent to read; only
            Approve pushes.
          </p>
        )}
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
            : !local
              ? `Submit review to ${site}`
              : event !== 'approve'
                ? 'Finish review'
                : push && push.commits > 0
                  ? `Approve and push ${plural(push.commits, 'commit')} to ${push.remote}/${push.branch}`
                  : 'Approve'}
        </button>
        {submission.status === 'finished' && (
          <Finished
            branch={review.local?.branch ?? ''}
            result={submission.result}
            onResult={(result) => setSubmission({ status: 'finished', result })}
          />
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
 * What finishing a branch review did (V16): the push on Approve (or git's refusal, with "Push
 * again"); otherwise where the agent finds the comments, and "Copy for the agent".
 */
function Finished({
  branch,
  result,
  onResult,
}: {
  branch: string;
  result: FinishResult;
  onResult: (result: FinishResult) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [pushing, setPushing] = useState<string | null>(null);
  const { verdict, unpushed } = result;
  if (verdict.event === 'approve') {
    const push = verdict.push;
    return (
      <div className="posted finished">
        {push && 'sha' in push ? (
          <p>
            Approved and pushed {push.sha.slice(0, 7)} to {push.remote}/{push.branch}.
            {unpushed > 0 && ` ${plural(unpushed, 'newer commit')} not pushed: not reviewed.`}
          </p>
        ) : push && 'error' in push ? (
          <>
            <p>Approved; git refused the push:</p>
            <pre className="error">{push.error}</pre>
            <button
              type="button"
              className="button"
              disabled={pushing === 'pushing'}
              onClick={() => {
                setPushing('pushing');
                pushAgain()
                  .then((next) => {
                    setPushing(null);
                    onResult(next);
                  })
                  .catch((error: unknown) => setPushing((error as Error).message));
              }}
            >
              {pushing === 'pushing' ? 'Pushing…' : 'Push again'}
            </button>
            {pushing && pushing !== 'pushing' && <p className="error">{pushing}</p>}
          </>
        ) : (
          <p>Approved; {push && 'none' in push ? push.none : 'nothing pushed'}.</p>
        )}
      </div>
    );
  }
  return (
    <div className="posted finished">
      <p>
        {verdict.event === 'request-changes' ? 'Changes requested' : 'Comments recorded'}: the agent
        finds them in {`cpr/reviews/${branch}/`} (the last of <code>verdicts</code>).
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
