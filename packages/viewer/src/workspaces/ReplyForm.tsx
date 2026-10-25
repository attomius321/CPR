// A workspace's reply box (V18c): one message that continues the agent's session; sending to an
// agent that works, or waits on a prompt, ends its turn, so that is asked first (decision 82).
import type { WorkspaceThread } from '@symbiote/core';
import type { replyMode } from './workspaces.js';

/** The box under the Thread tab, with Send the verdict and Send (or Stop and send). */
export function ReplyForm({
  hidden,
  text,
  mode,
  verdict,
  confirming,
  busy,
  waitingFor,
  onText,
  onSend,
  onCancel,
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
  onText: (text: string) => void;
  /** Sends the text; `stop`: its turn stopped first, as asked. */
  onSend: (stop: boolean) => void;
  onCancel: () => void;
}) {
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
        placeholder="Reply to the agent…"
        value={text}
        rows={3}
        disabled={mode === 'none'}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onSend(false);
          }
        }}
      />
      <div className="reply-actions">
        {verdict && (
          <button
            type="button"
            className="link"
            title={`Your ${verdict.event === 'approve' ? 'approval' : 'review'} at ${verdict.head.slice(0, 7)}, in words for the agent`}
            onClick={() => onText(verdict.text)}
          >
            Send the verdict
          </button>
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
          <button
            type="submit"
            className="button"
            disabled={busy || mode === 'none' || text.trim() === ''}
            title="Ctrl+Enter"
          >
            {mode === 'stop-and-send' ? 'Stop and send' : 'Send'}
          </button>
        )}
      </div>
    </form>
  );
}
