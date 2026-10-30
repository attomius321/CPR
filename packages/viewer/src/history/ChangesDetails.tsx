// The checkout's uncommitted changes in Git's pane (V66c): the commit box, the staged files and
// the rest, each staged or unstaged whole; a file clicked shows in the rows' place (V70). An
// operation in progress continued or aborted (decision 636), the changes stashed (639), a file's
// changes discarded (641).
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { LineCount, WorkingChanges, WorkingFile } from '@symbiote/core';
import {
  commit,
  discard,
  endOperation,
  fetchChangesLines,
  stage,
  stash,
  unstage,
} from './git-api.js';
import { operationWords, stoppedNotice } from './actions.js';
import type { After, Ask } from './AskDialog.js';
import type { Notice } from '../shell/shell-context.js';
import { ResetIcon } from '../ui/icons.js';
import {
  changesSummary,
  commitProblem,
  withLines,
  type ShownFile,
  type WithLines,
} from './details.js';
import { FileRow } from '../workspaces/ChangesPanel.js';
import { fileFacts } from '../workspaces/changes.js';
import { tip } from '../ui/tip.js';

/** The uncommitted files with their lines, each side apart (V70: the pane's and the file shown). */
export interface ChangesRead {
  staged: WithLines<WorkingFile>[];
  unstaged: WithLines<WorkingFile>[];
}

/** The lines of `changes` (none when null), read again whenever the changes are. */
export function useChangesRead(changes: WorkingChanges | null): ChangesRead | null {
  const [lines, setLines] = useState<{ staged: LineCount[]; unstaged: LineCount[] } | null>(null);
  useEffect(() => {
    if (!changes) return;
    let live = true;
    fetchChangesLines()
      .then((read) => live && setLines(read))
      .catch(() => live && setLines(null));
    return () => {
      live = false;
    };
  }, [changes]);
  return useMemo(
    () =>
      changes && {
        staged: withLines(changes.staged, lines?.staged ?? []),
        unstaged: withLines(changes.unstaged, lines?.unstaged ?? []),
      },
    [changes, lines],
  );
}

export function ChangesDetails({
  changes,
  read: { staged, unstaged },
  open,
  onOpen,
  onChanges,
  onCommitted,
  onAsk,
  onDone,
}: {
  changes: WorkingChanges;
  read: ChangesRead;
  /** The file shown in the rows' place (V70), on its side. */
  open: ShownFile | null;
  /** Shows a file, or none (the one shown clicked again). */
  onOpen: (file: ShownFile | null) => void;
  /** The changes after a stage or an unstage. */
  onChanges: (next: WorkingChanges) => void;
  /** A commit was made: the page lists again. */
  onCommitted: (sha: string, amend: boolean) => void;
  /** A write asked first: Abort, Stash, Discard. */
  onAsk: (ask: Ask) => void;
  /** A write done here (Continue): the status bar's words, and how the page lists. */
  onDone: (notice: Notice, after: After) => void;
}) {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (write: () => Promise<WorkingChanges>) => {
    setBusy(true);
    setError(null);
    write()
      .then(onChanges)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const problem = commitProblem(message, changes.staged.length, amend);
  const operation = changes.operation ? operationWords(changes.operation) : null;
  const goOn = () => {
    setBusy(true);
    setError(null);
    endOperation('continue')
      .then((result) =>
        onDone(stoppedNotice(result, `Continued the ${changes.operation}`), 'afresh'),
      )
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const askAbort = () =>
    onAsk({
      title: `Abort the ${changes.operation}?`,
      note: 'The branch goes back to where it was before it started; the conflicts resolved so far are lost.',
      verb: 'Abort',
      danger: true,
      run: async () => {
        await endOperation('abort');
        return { text: `Aborted the ${changes.operation}` };
      },
      after: 'afresh',
    });
  const askStash = () =>
    onAsk({
      title: 'Stash the changes?',
      note: 'Every change, staged or not, new files too, is put aside and the checkout is as HEAD; the stash is listed under the branches, to apply or pop later.',
      verb: 'Stash',
      field: { label: 'Message (optional)', placeholder: 'What these changes are' },
      run: async ({ text }) => {
        await stash(text);
        return { text: text.trim() ? `Stashed: ${text.trim()}` : 'Stashed the changes' };
      },
      after: 'changes',
    });
  const askDiscard = (file: WorkingFile) =>
    onAsk(
      file.status === 'untracked'
        ? {
            title: `Delete ${file.path}?`,
            note: 'It was never committed: once deleted, git has no copy of it.',
            verb: 'Delete',
            danger: true,
            run: async () => {
              onChanges(await discard(file.path));
              return { text: `Deleted ${file.path}` };
            },
            after: 'changes',
          }
        : {
            title: `Discard the changes to ${file.path}?`,
            note: 'The file goes back as it is staged (or as HEAD has it): the changes not staged are lost.',
            verb: 'Discard',
            danger: true,
            run: async () => {
              onChanges(await discard(file.path));
              return { text: `Discarded the changes to ${file.path}` };
            },
            after: 'changes',
          },
    );
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
              onOpen={() => onOpen(current ? null : { path: file.path, staged: isStaged })}
            />
            {!isStaged && file.status !== 'conflicted' && (
              <button
                type="button"
                className="icon-button git-file-action"
                disabled={busy}
                aria-label={`${file.status === 'untracked' ? 'Delete' : 'Discard the changes to'} ${file.path}`}
                {...tip(
                  file.status === 'untracked'
                    ? 'Delete the new file: asks first'
                    : 'Discard its changes not staged: asks first',
                )}
                onClick={() => askDiscard(file)}
              >
                <ResetIcon />
              </button>
            )}
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
        {changes.staged.length + changes.unstaged.length > 0 && !changes.operation && (
          <button
            type="button"
            className="button ghost git-stash"
            disabled={busy}
            {...tip('Put every change aside, new files too: asks first')}
            onClick={askStash}
          >
            Stash…
          </button>
        )}
      </header>
      <div className="git-details-body">
        {operation && (
          <div className="git-operation" role="status">
            <p className="git-operation-title">{operation.title}</p>
            <p className="git-operation-note">
              Resolve the conflicted files and stage them
              {operation.continues ? `, then Continue: ${operation.continues.toLowerCase()}.` : '.'}
            </p>
            <div className="git-operation-buttons">
              {operation.continues && (
                <button type="button" className="button" disabled={busy} onClick={goOn}>
                  Continue
                </button>
              )}
              <button type="button" className="button ghost" disabled={busy} onClick={askAbort}>
                {changes.operation === 'bisect' ? 'Stop bisecting…' : 'Abort…'}
              </button>
            </div>
          </div>
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
      </div>
    </>
  );
}
