// A workspace's reply box (V18c): one message that continues the agent's session; sending to an
// agent that works, or waits on a prompt, ends its turn, so that is asked first (decision 82). Under
// a plan that waits (V89, decisions 833, 834), Send reply and Approve plan, which sends the plan's
// OK; with its terminal, both are typed there and sent.
import type { WorkspaceThread } from '@symbiote/core';
import type { replyMode } from './workspaces.js';
import { AttachIcon, CheckIcon, SendIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';

/** The box under the Thread tab, with Send the verdict and Send (or Stop and send). */
export function ReplyForm({
  hidden,
  text,
  mode,
  verdict,
  confirming,
  busy,
  waitingFor,
  plan = false,
  inTerminal = false,
  onText,
  onSend,
  onApprove,
  onCancel,
  onAttach,
}: {
  hidden: boolean;
  text: string;
  mode: ReturnType<typeof replyMode>;
  /** The review's verdict, in words for the agent; null when there is none to send. */
  verdict: WorkspaceThread['verdict'] | null;
  /** Sending stops the agent's turn: asked before it is sent. */
  confirming: boolean;
  busy: boolean;
  /** What the agent waits on, said when sending stops it. */
  waitingFor: string | undefined;
  /** A plan waits for the person's OK: Send reply and Approve plan. */
  plan?: boolean;
  /** What is sent is typed into the agent's terminal (decision 834). */
  inTerminal?: boolean;
  onText: (text: string) => void;
  /** Sends the text; `stop`: its turn stopped first, as asked. */
  onSend: (stop: boolean) => void;
  /** Sends the plan's OK. */
  onApprove?: () => void;
  onCancel: () => void;
  /** Attach images (V78) from the composer, as proof 02 draws it; none without a terminal. */
  onAttach?: (() => void) | undefined;
}) {
  const approve = plan && onApprove;
  return (
    <form
      hidden={hidden}
      className="reply"
      onSubmit={(event) => {
        event.preventDefault();
        onSend(false);
      }}
    >
      <textarea
        aria-label="Reply to the agent"
        placeholder={
          approve ? 'Reply to the agent, or approve the plan as it is…' : 'Reply to the agent…'
        }
        value={text}
        rows={3}
        disabled={mode === 'none'}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            // Nothing typed under a plan: Ctrl+Enter approves it, as its button says.
            if (approve && text.trim() === '') onApprove();
            else onSend(false);
          }
        }}
      />
      <div className="reply-actions">
        {/* The composer's Attach (V93, proof 02): files go to its terminal, where the agent reads
            them; its tip says where. */}
        {onAttach && (
          <button
            type="button"
            className="button ghost reply-attach"
            {...tip('Attach images\nPasted into its terminal')}
            onClick={onAttach}
          >
            <AttachIcon />
            Attach
          </button>
        )}
        {verdict && (
          <button
            type="button"
            className="link"
            {...tip(
              `Your ${verdict.event === 'approve' ? 'approval' : 'review'} at ${verdict.head.slice(0, 7)}\nIn words for the agent`,
            )}
            onClick={() => onText(verdict.text)}
          >
            Send the verdict
          </button>
        )}
        {approve && inTerminal && (
          <span className="hint reply-where">It answers in its terminal</span>
        )}
        {mode === 'none' && (
          <span className="hint">No session to continue: start the agent again.</span>
        )}
        {confirming ? (
          <span className="workspace-confirm">
            Sending stops the agent's turn
            {waitingFor ? ` and what it waits on (${waitingFor})` : ''}.{' '}
            <button type="button" className="button" disabled={busy} onClick={() => onSend(true)}>
              Stop it and send
            </button>{' '}
            <button type="button" className="button ghost" onClick={onCancel}>
              Cancel
            </button>
          </span>
        ) : (
          <>
            <button
              type="submit"
              className={approve ? 'button secondary' : 'button'}
              disabled={busy || mode === 'none' || text.trim() === ''}
              {...tip(
                approve ? 'Send reply' : mode === 'stop-and-send' ? 'Stop and send' : 'Send',
                approve ? {} : { keys: 'Ctrl+Enter' },
              )}
            >
              <SendIcon />
              {approve ? 'Send reply' : mode === 'stop-and-send' ? 'Stop and send' : 'Send'}
            </button>
            {approve && (
              <button
                type="button"
                className="button primary"
                disabled={busy}
                {...tip(
                  `Sends: Your plan is approved.\nBuild it as planned, and commit in small steps.`,
                  {
                    keys: 'Ctrl+Enter',
                  },
                )}
                onClick={onApprove}
              >
                <CheckIcon />
                Approve plan
                <kbd className="reply-keys" aria-hidden="true">
                  Ctrl ↵
                </kbd>
              </button>
            )}
          </>
        )}
      </div>
    </form>
  );
}
