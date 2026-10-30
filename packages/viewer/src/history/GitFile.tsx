// The file shown in the rows' place (V70): its head — the path, what changed, its lines, Open in
// VS Code (`o`) and back to the rows (Esc) — over its diff, as tall as the rows' card. Its diff,
// its history or its blame (decision 643); an uncommitted file's lines staged (642).
import { useState } from 'react';
import type { FileCommit, WorkspaceFileChange } from '@symbiote/core';
import { GitDiff, type Staging } from './GitDiff.js';
import { FileBlameView, FileHistory } from './FileLog.js';
import { OpenIcon } from '../diff/OpenIcon.js';
import { Lines } from '../workspaces/ChangesPanel.js';
import { linesOf, splitPath, statusWords } from '../workspaces/changes.js';
import { CloseIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';

/** The Open in VS Code button's id: `o` clicks it, as on the Files page. */
export const OPEN_FILE_ID = 'git-open-in-editor';

/** What the file shows: its diff, its commits, each line's commit. */
type FileView = 'diff' | 'history' | 'blame';
const VIEWS: { view: FileView; label: string; says: string }[] = [
  { view: 'diff', label: 'Diff', says: 'What this commit changed' },
  { view: 'history', label: 'History', says: 'The commits that changed it, renames followed' },
  { view: 'blame', label: 'Blame', says: "Each line's commit" },
];

export function GitFile({
  file,
  sha,
  side,
  staging,
  load,
  onEditor,
  onGo,
  onClose,
}: {
  file: WorkspaceFileChange;
  /** Its commit; null for an uncommitted file. */
  sha: string | null;
  /** An uncommitted file's side. */
  side?: 'staged' | 'not staged';
  /** An uncommitted modified file: its lines picked and staged (decision 642). */
  staging?: Staging;
  /** Goes to a commit's row, the file open there (its path then). */
  onGo: (commit: { sha: string; path: string }) => void;
  /** Its diff, as git gives it. */
  load: () => Promise<string | null>;
  /** Opens its diff in VS Code; rejected in the server's words. */
  onEditor: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [view, setView] = useState<FileView>('diff');
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
          <span className="scopes git-shown-views" role="group" aria-label="Show">
            {VIEWS.map((v) => (
              <button
                key={v.view}
                type="button"
                className={view === v.view ? 'scope active' : 'scope'}
                aria-pressed={view === v.view}
                {...tip(v.view === 'diff' && !sha ? 'Its changes not committed' : v.says)}
                onClick={() => setView(v.view)}
              >
                {v.label}
              </button>
            ))}
          </span>
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
        {view === 'diff' && (
          <GitDiff path={file.path} load={load} {...(staging ? { staging } : {})} />
        )}
        {view === 'history' && (
          <FileHistory
            path={file.path}
            sha={sha}
            onGo={(commit: FileCommit) => onGo({ sha: commit.sha, path: commit.path })}
          />
        )}
        {view === 'blame' && <FileBlameView path={file.path} sha={sha} onGo={onGo} />}
      </div>
    </section>
  );
}
