import { useEffect, useMemo, useState } from 'react';
import type { BranchMerge, FinishResult, Graph } from '@symbiote/core';
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
import { workspaceHref } from '../workspaces/workspaces.js';
import { label } from '../graph/flow.js';
import { openInEditor } from './open.js';
import { OpenIcon } from './OpenIcon.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { MergeControl } from '../workspaces/MergeControl.js';
import { Help } from '../ui/Help.js';

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
  canOpen = false,
}: {
  graph: Graph;
  review: ReviewProps;
  onSelect: (id: string) => void;
  /** The server opens files in VS Code (`/api/open`): a conflicting file too (V17). */
  canOpen?: boolean;
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
        {local && into && <MergeCheck branch={review.local?.branch ?? ''} canOpen={canOpen} />}
        {forge === 'gitlab' && event === 'request-changes' && (
          <p className="muted small">
            GitLab gets a note marked “Changes requested”, and your approval is withdrawn.
          </p>
        )}
        <div className="review-submit">
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
          {local && (
            <Help label="Where the verdict goes">
              The verdict and its comments stay in this repository, for the agent to read.{' '}
              {into
                ? `Approve, then Merge: Symbiote merges ${head} into ${into} (or a branch you pick), checks it and lands it.`
                : 'Approve tells it these commits may be pushed.'}
            </Help>
          )}
        </div>
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
        {/* An approval made before, or just now (V26a): Merge into ▾. */}
        {local && into && submission.status !== 'posting' && (
          <MergeControl key={submission.status} branch={review.local?.branch ?? ''} />
        )}
      </form>
    </div>
  );
}

/**
 * Whether the branch merges cleanly into the default branch (V17), checked in the background:
 * nothing while git works (seconds on a long-lived branch), then clean, or each conflicting file
 * on its line — its name, its folder, and a button that opens it in VS Code.
 */
function MergeCheck({ branch, canOpen }: { branch: string; canOpen: boolean }) {
  const [merge, setMerge] = useState<BranchMerge | { failed: string } | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
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
  const open = (file: string) =>
    void openInEditor({ side: 'head', file, line: 1, column: 1 }).then((answer) =>
      setNote(
        answer.ok
          ? { text: `Opened ${file} in VS Code`, error: false }
          : { text: answer.error, error: true },
      ),
    );
  const count = merge.conflicts.length;
  return (
    <div className="merge-check conflicts small">
      <p className="merge-check-head">
        Conflicts with {merge.into} in {count} file{count === 1 ? '' : 's'}; the agent resolves them
        on {branch} first:
      </p>
      <ul className="merge-files">
        {merge.conflicts.map((path) => {
          const slash = path.lastIndexOf('/') + 1;
          return (
            <li key={path} title={path}>
              {canOpen && (
                <button
                  type="button"
                  className="merge-open"
                  aria-label={`Open ${path} in VS Code`}
                  title={`Open ${path} in VS Code`}
                  onClick={() => open(path)}
                >
                  <OpenIcon />
                </button>
              )}
              <span className="merge-file">{path.slice(slash)}</span>
              <span className="merge-dir">{path.slice(0, slash)}</span>
            </li>
          );
        })}
      </ul>
      {canOpen && (
        <div className={`open-note${note?.error ? ' open-error' : ''}`} role="status">
          {note?.text}
        </div>
      )}
    </div>
  );
}

/**
 * What finishing a branch review recorded (V16), and what is next: Symbiote's merge (V26), or what
 * the agent does with it when asked — the push of the default branch's commits, or the comments;
 * "Copy for the agent" puts it in words for a chat; on a workspace's branch, "Send to the agent"
 * opens its panel with the words in its box (V18c).
 */
function Finished({ branch, result }: { branch: string; result: FinishResult }) {
  const [copied, setCopied] = useState<string | null>(null);
  const workspace = useWorkspaces().list?.workspaces.some((f) => f.branch === branch) ?? false;
  const { verdict } = result;
  const at = short(verdict.head);
  return (
    <div className="posted finished">
      <p>
        {verdict.event !== 'approve' ? (
          <>
            {verdict.event === 'request-changes' ? 'Changes requested' : 'Comments recorded'}: the
            agent finds them in {`symbiote/reviews/${branch}/`} (the last of <code>verdicts</code>).
          </>
        ) : verdict.into ? (
          `Approved ${at}: Merge it into ${verdict.into} or another branch below; Symbiote merges, checks and lands it.`
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
      {workspace && (
        <>
          {' '}
          <a className="button" href={`${workspaceHref(branch)}&send=verdict`}>
            Send to the agent
          </a>
        </>
      )}
      {copied && <span className="muted small"> {copied}</span>}
    </div>
  );
}
