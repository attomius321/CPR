// The checkout's uncommitted changes in Git's pane (V66c): the commit box, the staged files and
// the rest, each staged or unstaged whole, and the open file's diff.
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { LineCount, WorkingChanges, WorkingFile } from '@symbiote/core';
import { commit, fetchChangeFile, fetchChangesLines, stage, unstage } from './git-api.js';
import { changesSummary, commitProblem, withLines } from './details.js';
import { GitDiff } from './GitDiff.js';
import { FileRow } from '../workspaces/ChangesPanel.js';
import { fileFacts } from '../workspaces/changes.js';
import { tip } from '../ui/tip.js';

/** The file open in the pane, by its side: staged or not. */
interface Open {
  path: string;
  staged: boolean;
}

export function ChangesDetails({
  changes,
  onChanges,
  onCommitted,
}: {
  changes: WorkingChanges;
  /** The changes after a stage or an unstage. */
  onChanges: (next: WorkingChanges) => void;
  /** A commit was made: the page lists again. */
  onCommitted: (sha: string, amend: boolean) => void;
}) {
  const [lines, setLines] = useState<{ staged: LineCount[]; unstaged: LineCount[] } | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lines are read again whenever the changes are.
  useEffect(() => {
    let live = true;
    fetchChangesLines()
      .then((read) => live && setLines(read))
      .catch(() => live && setLines(null));
    return () => {
      live = false;
    };
  }, [changes]);
  const staged = useMemo(() => withLines(changes.staged, lines?.staged ?? []), [changes, lines]);
  const unstaged = useMemo(
    () => withLines(changes.unstaged, lines?.unstaged ?? []),
    [changes, lines],
  );
  // The open file, gone from its side: closed.
  useEffect(() => {
    if (!open) return;
    const side = open.staged ? changes.staged : changes.unstaged;
    if (!side.some((f) => f.path === open.path)) setOpen(null);
  }, [changes, open]);
  const load = useCallback(
    () => (open ? fetchChangeFile(open.path, open.staged) : Promise.resolve(null)),
    // `changes`: the diff is read again after a stage.
    [open, changes],
  );

  const run = (write: () => Promise<WorkingChanges>) => {
    setBusy(true);
    setError(null);
    write()
      .then(onChanges)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const problem = commitProblem(message, changes.staged.length, amend);
  const submit = () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    commit(message, amend)
      .then(({ sha }) => {
        setMessage('');
        setAmend(false);
        onCommitted(sha, amend);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  const list = (files: WorkingFile[], side: 'staged' | 'unstaged') => (
    <ul className="changes-list git-files">
      {files.map((file) => {
        const isStaged = side === 'staged';
        const current = open?.path === file.path && open.staged === isStaged;
        return (
          <li key={file.path} className="git-file">
            <FileRow
              file={file}
              label={`Show the diff of ${file.path}${isStaged ? ', staged' : ''}`}
              hover={`${fileFacts(file)}. Shows its diff ${isStaged ? 'against HEAD' : 'not staged'}`}
              current={current}
              onOpen={() => setOpen(current ? null : { path: file.path, staged: isStaged })}
            />
            <button
              type="button"
              className="icon-button git-file-action"
              disabled={busy}
              aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${file.path}`}
              {...tip(isStaged ? 'Unstage: its changes stay on disk' : 'Stage the whole file')}
              onClick={() => run(() => (isStaged ? unstage([file.path]) : stage([file.path])))}
            >
              {isStaged ? '−' : '+'}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <header className="git-details-head">
        <h2 className="git-details-title">Uncommitted changes</h2>
        <span className="muted git-details-summary">{changesSummary(changes)}</span>
      </header>
      <div className="git-details-body">
        {changes.operation && (
          <p className="git-details-note" role="status">
            A {changes.operation} is in progress: resolve the conflicted files, stage them, then
            commit.
          </p>
        )}
        <form
          className="git-commit"
          aria-label="Commit"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            className="git-commit-message"
            aria-label="Commit message"
            placeholder={
              amend
                ? 'Empty: the last commit keeps its message'
                : 'Message: a subject, a blank line, why'
            }
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="git-commit-row">
            <label className="git-commit-amend">
              <input
                type="checkbox"
                checked={amend}
                onChange={(event) => setAmend(event.target.checked)}
              />
              Amend the last commit
            </label>
            <button
              type="submit"
              className="button git-commit-button"
              disabled={!!problem || busy}
              {...tip(problem ?? (amend ? 'Amend the last commit' : 'Commit the staged files'), {
                keys: 'Ctrl+Enter',
              })}
            >
              {busy ? 'Working…' : amend ? 'Amend' : 'Commit'}
            </button>
          </div>
          {error && (
            <pre className="error git-details-error" role="alert">
              {error}
            </pre>
          )}
        </form>
        <h3 className="git-details-part">
          Staged <span className="muted">{changes.staged.length}</span>
          {changes.staged.length > 0 && (
            <button
              type="button"
              className="link git-part-action"
              disabled={busy}
              onClick={() => run(() => unstage(changes.staged.map((f) => f.path)))}
            >
              Unstage all
            </button>
          )}
        </h3>
        {staged.length === 0 ? (
          <p className="changes-empty">Nothing staged: + stages a file.</p>
        ) : (
          list(staged, 'staged')
        )}
        <h3 className="git-details-part">
          Changes <span className="muted">{changes.unstaged.length}</span>
          {changes.unstaged.length > 0 && (
            <button
              type="button"
              className="link git-part-action"
              disabled={busy}
              onClick={() => run(() => stage(changes.unstaged.map((f) => f.path)))}
            >
              Stage all
            </button>
          )}
        </h3>
        {unstaged.length === 0 ? (
          <p className="changes-empty">Nothing else changed.</p>
        ) : (
          list(unstaged, 'unstaged')
        )}
        {open && (
          <section className="git-details-diff" aria-label={`Changes to ${open.path}`}>
            <h3 className="git-details-part">
              {open.path} <span className="muted">{open.staged ? 'staged' : 'not staged'}</span>
            </h3>
            <GitDiff path={open.path} load={load} />
          </section>
        )}
      </div>
    </>
  );
}
