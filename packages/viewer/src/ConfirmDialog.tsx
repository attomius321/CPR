/**
 * A question before something is lost, in CPR's own dialog (N1c): the browser's `confirm` is
 * headed by the page's address ("127.0.0.1:<port> says"). Staying is the default; Escape stays.
 */
export function ConfirmDialog({
  question,
  detail,
  leave,
  onLeave,
  onStay,
}: {
  question: string;
  detail: string;
  /** What the button that goes on says. */
  leave: string;
  onLeave: () => void;
  onStay: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-question"
        aria-describedby="confirm-detail"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          onStay();
        }}
      >
        <h2 id="confirm-question">{question}</h2>
        <p id="confirm-detail">{detail}</p>
        <div className="dialog-buttons">
          <button type="button" className="link" onClick={onLeave}>
            {leave}
          </button>
          <button type="button" className="button" autoFocus onClick={onStay}>
            Stay
          </button>
        </div>
      </div>
    </div>
  );
}
