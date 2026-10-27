// The file shown in the rows' place (V70): its head — the path, what changed, its lines, Open in
// VS Code (`o`) and back to the rows (Esc) — over its diff, as tall as the rows' card.
import { useState } from 'react';
import type { WorkspaceFileChange } from '@symbiote/core';
import { GitDiff } from './GitDiff.js';
import { OpenIcon } from '../diff/OpenIcon.js';
import { Lines } from '../workspaces/ChangesPanel.js';
import { linesOf, splitPath, statusWords } from '../workspaces/changes.js';
import { CloseIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';

/** The Open in VS Code button's id: `o` clicks it, as on the Files page. */
export const OPEN_FILE_ID = 'git-open-in-editor';

export function GitFile({
  file,
  side,
  load,
  onEditor,
  onClose,
}: {
  file: WorkspaceFileChange;
  /** An uncommitted file's side. */
  side?: 'staged' | 'not staged';
  /** Its diff, as git gives it. */
  load: () => Promise<string | null>;
  /** Opens its diff in VS Code; rejected in the server's words. */
  onEditor: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const lines = linesOf(file);
  const { name, folder } = splitPath(file.path);
  const status =
    file.previousPath && file.previousPath !== file.path
      ? `${statusWords(file.status)} from ${file.previousPath}`
      : statusWords(file.status);
  const open = () => {
    setNote(null);
    onEditor().then(
      () => setNote({ text: 'Opened its diff in VS Code', error: false }),
      (e: unknown) =>
        setNote({
          text:
            e instanceof TypeError
              ? 'symbiote is not running: VS Code could not be asked to open it'
              : (e as Error).message,
          error: true,
        }),
    );
  };
  return (
    <section className="git-shown" aria-label={`Changes to ${file.path}`}>
      <header className="git-shown-head">
        {/* Its name, then its folder, cut when narrow, as the pane's rows. */}
        <h2 className="git-shown-path" {...tip(file.path, { code: true })}>
          <span className="git-shown-name">{name}</span>
          {folder && <span className="git-shown-folder">{folder}</span>}
        </h2>
        <span className="git-shown-words">{status}</span>
        {side && <span className="git-shown-side">{side}</span>}
        {lines === 'binary' ? (
          <span className="changes-lines">binary</span>
        ) : (
          lines && <Lines added={file.added ?? 0} removed={file.removed ?? 0} />
        )}
        <span className="git-shown-tail">
          <button
            id={OPEN_FILE_ID}
            type="button"
            className="open-editor"
            {...tip("Its diff in VS Code's diff editor", { keys: 'o' })}
            onClick={open}
          >
            <OpenIcon />
            Open in VS Code
            <kbd aria-hidden="true">o</kbd>
          </button>
          <button
            type="button"
            className="close"
            aria-label="Back to the commits"
            {...tip('Back to the commits', { keys: 'Esc' })}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </span>
      </header>
      {note && (
        <p className={`open-note git-shown-note${note.error ? ' open-error' : ''}`} role="status">
          {note.text}
        </p>
      )}
      <div className="git-shown-body">
        <GitDiff path={file.path} load={load} />
      </div>
    </section>
  );
}
