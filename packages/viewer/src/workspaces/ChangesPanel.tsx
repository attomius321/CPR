import { useEffect, useState } from 'react';
import type { WorkspaceChanges, WorkspaceFileChange } from '@symbiote/core';
import {
  commitTitle,
  fileTitle,
  linesOf,
  moreText,
  sinceText,
  splitPath,
  statusLetter,
} from './changes.js';
import { postJson, serverWords } from '../ui/http.js';
import { shortAge } from './workspaces.js';

/**
 * A workspace's changes (V29d), read when it is picked and with every read of the list (on focus,
 * every 5 s while an agent works or waits): the last answer stays drawn while the next is read.
 */
function useChanges(branch: string, version: unknown): WorkspaceChanges | string | null {
  const [changes, setChanges] = useState<WorkspaceChanges | string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/workspaces/changes?branch=${encodeURIComponent(branch)}`)
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as WorkspaceChanges)
          : `Could not read its changes: ${serverWords(await response.text())}`,
      )
      .then((read) => {
        // An error keeps what was read before.
        if (live) setChanges((before) => (typeof read === 'string' && before ? before : read));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [branch, version]);
  return changes;
}

/** Lines added and removed, in their colours; a count of none muted. */
function Lines({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="changes-lines">
      <span className={added === 0 ? 'none' : 'changes-added'}>+{added}</span>{' '}
      <span className={removed === 0 ? 'none' : 'changes-removed'}>−{removed}</span>
    </span>
  );
}

/** A file's row: its status letter, name, folder and lines; a click opens its diff in VS Code. */
function FileRow({
  file,
  onOpen,
}: {
  file: WorkspaceFileChange;
  onOpen: (file: WorkspaceFileChange) => void;
}) {
  const { name, folder } = splitPath(file.path);
  const lines = linesOf(file);
  return (
    <button
      type="button"
      className="changes-file"
      aria-label={`Open the changes to ${file.path} in VS Code`}
      title={fileTitle(file)}
      onClick={() => onOpen(file)}
    >
      <span className={`changes-status status-${file.status}`}>{statusLetter(file.status)}</span>
      <span className="changes-name">{name}</span>
      <span className="changes-folder">{folder}</span>
      {lines === 'binary' ? (
        <span className="changes-lines">binary</span>
      ) : (
        lines && <Lines added={file.added ?? 0} removed={file.removed ?? 0} />
      )}
    </button>
  );
}

function Files({
  files,
  empty,
  onOpen,
}: {
  files: { count: number; listed: WorkspaceFileChange[] };
  empty: string;
  onOpen: (file: WorkspaceFileChange) => void;
}) {
  if (files.count === 0) return <p className="changes-empty">{empty}</p>;
  const more = moreText(files.count, files.listed.length);
  return (
    <>
      <ul className="changes-list">
        {files.listed.map((file) => (
          <li key={file.path}>
            <FileRow file={file} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {more && <p className="changes-empty">{more}</p>}
    </>
  );
}

/**
 * A workspace's branch at the right of its terminal (V29d, decision 186): its commits since the
 * fork point and the files they change — what Review will show —, then the files its worktree has
 * not committed. A file opens as its diff in VS Code, what its row counts (V43): the branch's from
 * the fork point, one not committed from the worktree's HEAD.
 */
export function ChangesPanel({
  branch,
  version,
  onSaid,
}: {
  branch: string;
  /** The list as last read: the changes are read again with it. */
  version: unknown;
  /** How opening a file went, in words, for the workspace's head. */
  onSaid: (words: string) => void;
}) {
  const changes = useChanges(branch, version);
  const opener = (uncommitted: boolean) => (file: WorkspaceFileChange) =>
    void postJson('/api/workspaces/diff', {
      branch,
      file: file.path,
      ...(file.previousPath ? { previousPath: file.previousPath } : {}),
      ...(uncommitted ? { uncommitted } : {}),
    }).then(
      () => onSaid(`Opened the changes to ${file.path} in VS Code`),
      (e: unknown) => onSaid((e as Error).message),
    );
  const commitsMore =
    changes !== null && typeof changes !== 'string'
      ? moreText(changes.commits.count, changes.commits.listed.length)
      : null;
  return (
    <aside className="changes" aria-label="Changes">
      {changes === null && <p className="changes-empty">Reading its changes…</p>}
      {typeof changes === 'string' && <p className="changes-empty error">{changes}</p>}
      {changes !== null && typeof changes !== 'string' && (
        <>
          <section className="changes-section" aria-label="Commits">
            <h2>
              Commits <span className="changes-count">{changes.commits.count}</span>
              <span className="changes-since">{sinceText(changes.since)}</span>
            </h2>
            {changes.tip === null ? (
              <p className="changes-empty">Its branch is gone</p>
            ) : changes.commits.count === 0 ? (
              <p className="changes-empty">No commits yet</p>
            ) : (
              <ol className="changes-list">
                {changes.commits.listed.map((commit) => (
                  <li key={commit.sha} className="changes-commit" title={commitTitle(commit)}>
                    <span className="changes-sha">{commit.sha.slice(0, 7)}</span>
                    <span className="changes-subject">{commit.subject}</span>
                    <time className="changes-age" dateTime={commit.date}>
                      {shortAge(commit.date, Date.now())}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            {commitsMore && <p className="changes-empty">{commitsMore}</p>}
          </section>
          <section className="changes-section" aria-label="Files">
            <h2>
              Files <span className="changes-count">{changes.files.count}</span>
              {changes.files.count > 0 && (
                <Lines added={changes.files.added} removed={changes.files.removed} />
              )}
            </h2>
            <Files files={changes.files} empty="No files changed yet" onOpen={opener(false)} />
          </section>
          <section className="changes-section" aria-label="Not committed">
            <h2>
              Not committed{' '}
              {changes.uncommitted && (
                <span className="changes-count">{changes.uncommitted.count}</span>
              )}
            </h2>
            {changes.uncommitted ? (
              <Files files={changes.uncommitted} empty="Nothing" onOpen={opener(true)} />
            ) : (
              <p className="changes-empty">Its worktree is gone</p>
            )}
          </section>
        </>
      )}
    </aside>
  );
}
