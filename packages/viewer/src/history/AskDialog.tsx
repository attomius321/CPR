// A git write asked first on Git's page (fix/git-page-feature-extend, decisions 636–645): what it
// does in a sentence, a text or a choice it takes, then the write; git's refusal shown in it.
import { useEffect, useState, type FormEvent } from 'react';
import type { Notice } from '../shell/shell-context.js';

/**
 * What the page lists after the write: afresh, the cursor on HEAD (HEAD moved); in place (remote
 * branches or the hidden ones changed, decision 634); or only the uncommitted changes.
 */
export type After = 'afresh' | 'here' | 'changes';

export interface Ask {
  title: string;
  /** What the write does, and what it keeps or loses. */
  note: string;
  /** The button's word. */
  verb: string;
  /** It loses something (a stash, a file's changes, a remote branch). */
  danger?: boolean;
  /** A text it takes: a stash's message. */
  field?: { label: string; placeholder: string };
  /** One way among several, the first chosen: a reset's soft or mixed. */
  choices?: { value: string; label: string; note: string }[];
  /** Read as the dialog opens, said under the note: how many commits a reset takes off. */
  more?: () => Promise<string>;
  run: (answer: { text: string; choice: string }) => Promise<Notice>;
  after: After;
}

/** The dialog of `ask`. Done, `onDone` has the status bar's words; Escape or Cancel closes it. */
export function AskDialog({
  ask,
  onDone,
  onCancel,
}: {
  ask: Ask;
  onDone: (notice: Notice, after: After) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState(ask.choices?.[0]?.value ?? '');
  const [more, setMore] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    ask
      .more?.()
      .then((said) => live && setMore(said))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ask]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    setError(null);
    ask.run({ text, choice }).then(
      (notice) => onDone(notice, ask.after),
      (e: unknown) => {
        setError((e as Error).message);
        setRunning(false);
      },
    );
  };
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-dialog-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || running) return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      >
        <h2 id="ask-dialog-title">{ask.title}</h2>
        <p className="dialog-note">{ask.note}</p>
        {more && <p className="dialog-note git-ask-more">{more}</p>}
        {ask.choices && (
          <fieldset className="git-ask-choices">
            <legend className="field-label">How</legend>
            {ask.choices.map((c) => (
              <label key={c.value} className="git-check git-ask-choice">
                <input
                  type="radio"
                  name="ask-choice"
                  value={c.value}
                  checked={choice === c.value}
                  onChange={() => setChoice(c.value)}
                />
                <span>
                  {c.label} <span className="muted">· {c.note}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {ask.field && (
          <label className="git-field">
            <span className="field-label">{ask.field.label}</span>
            <input
              autoFocus
              value={text}
              placeholder={ask.field.placeholder}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        )}
        {error && <pre className="error">{error}</pre>}
        <div className="dialog-buttons">
          <button type="button" className="button ghost" disabled={running} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className={ask.danger ? 'button danger' : 'button'}
            autoFocus={!ask.field}
            disabled={running}
          >
            {running ? 'Working…' : ask.verb}
          </button>
        </div>
      </form>
    </div>
  );
}
