import type { WorkingState } from '@cpr/core';
import { changesNote, type CheckoutChoice } from './checkout.js';
import { RefBadge } from './RowMenu.js';

/** How the confirmation names a target's kind. */
const KINDS: Record<CheckoutChoice['ref']['kind'], string> = {
  branch: 'branch',
  remote: 'remote branch',
  tag: 'tag',
  commit: 'commit',
};

/**
 * Asks before a checkout: what it does, what happens to local changes (or why it cannot run),
 * and git's refusal if it came. Enter checks out, Escape cancels.
 */
export function CheckoutDialog({
  choice,
  state,
  running,
  error,
  onConfirm,
  onCancel,
}: {
  choice: CheckoutChoice;
  state: WorkingState;
  running: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const note = changesNote(state);
  const blocked = state.operation !== null;
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !running) onCancel();
          else if (event.key === 'Enter' && !blocked && !running) onConfirm();
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <h2 id="checkout-title">
          Check out {KINDS[choice.ref.kind]} <RefBadge target={choice.ref} className="dialog-ref" />
          ?
        </h2>
        <p>{choice.what}</p>
        {note && <p className={blocked ? 'error' : 'dialog-note'}>{note}</p>}
        {error && <pre className="error">{error}</pre>}
        <div className="dialog-buttons">
          <button type="button" className="link" disabled={running} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button"
            autoFocus
            disabled={blocked || running}
            onClick={onConfirm}
          >
            {running ? 'Checking out…' : 'Check out'}
          </button>
        </div>
      </div>
    </div>
  );
}
