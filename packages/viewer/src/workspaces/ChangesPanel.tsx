import { useEffect, useState, type ReactNode } from 'react';
import type { WorkspaceAgainst, WorkspaceChanges, WorkspaceFileChange } from '@symbiote/core';
import {
  againstOptions,
  baseTitle,
  commitTitle,
  fileTitle,
  linesOf,
  moreText,
  sinceText,
  splitPath,
  statusLetter,
} from './changes.js';
import { getJson, postJson, serverWords } from '../ui/http.js';
import { reloadWorkspaces } from './useWorkspaces.js';
import { shortAge } from './workspaces.js';
import { tip } from '../ui/tip.js';

/**
 * A workspace's changes (V29d), read when it is picked and with every read of the list (on focus,
 * every 5 s while an agent works or waits): the last answer stays drawn while the next is read.
 */
export function useChanges(
  branch: string,
  version: unknown,
  /** Changed to read them again now (V65: after a pick of what it is reviewed against). */
  again = 0,
  /** False: not read (the page read them already, V89). */
  on = true,
): WorkspaceChanges | string | null {
  const [changes, setChanges] = useState<WorkspaceChanges | string | null>(null);
  useEffect(() => {
    if (!on) return;
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
  }, [branch, version, again, on]);
  return changes;
}

/**
 * The branch a workspace is reviewed against (V65): where it started, or a branch picked here;
 * its Review, these changes, the head's count and the merge check follow. Read once per branch;
 * the words alone until then, or when it cannot be read.
 */
function AgainstChoice({
  branch,
  changes,
  onPicked,
  onSaid,
}: {
  branch: string;
  changes: WorkspaceChanges;
  onPicked: () => void;
  onSaid: (words: string) => void;
}) {
  const [against, setAgainst] = useState<WorkspaceAgainst | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setAgainst(null);
    getJson<WorkspaceAgainst>(`/api/workspaces/against?branch=${encodeURIComponent(branch)}`)
      .then((read) => live && setAgainst(read))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [branch]);
  if (!against) return <p className="changes-against">{sinceText(changes.since)}</p>;
  const pick = (value: string) => {
    setBusy(true);
    postJson<WorkspaceAgainst>('/api/workspaces/against', { branch, against: value || null })
      .then((read) => {
        setAgainst(read);
        onPicked();
        return reloadWorkspaces();
      })
      .catch((e: unknown) => onSaid((e as Error).message))
      .finally(() => setBusy(false));
  };
  return (
    <label className="changes-against">
      since{' '}
      <select
        aria-label="Review against"
        value={against.against ?? ''}
        disabled={busy}
        onChange={(event) => pick(event.target.value)}
        {...tip(baseTitle(changes.base, changes.since))}
      >
        {againstOptions(against).map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Lines added and removed, in their colours; a count of none muted. */
export function Lines({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="changes-lines">
      <span className={added === 0 ? 'none' : 'changes-added'}>+{added}</span>{' '}
      <span className={removed === 0 ? 'none' : 'changes-removed'}>−{removed}</span>
    </span>
  );
}

/**
 * A file's row: its status letter, name, folder and lines, then `after` (a review's comments,
 * V60); a click does what `label` says. A workspace's opens its diff in VS Code; a review's Files
 * page shows it (`current` the one shown).
 */
export function FileRow<File extends WorkspaceFileChange>({
  file,
  label,
  hover,
  current,
  after,
  onOpen,
}: {
  file: File;
  label: string;
  hover: string;
  current?: boolean;
  after?: ReactNode;
  onOpen: (file: File) => void;
}) {
  const { name, folder } = splitPath(file.path);
  const lines = linesOf(file);
  return (
    <button
      type="button"
      className="changes-file"
      aria-label={label}
      {...(current ? { 'aria-current': true } : {})}
      {...tip(hover)}
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
      {after}
    </button>
  );
}

function Files({
  files,
  empty,
  editing,
  onOpen,
}: {
  files: { count: number; listed: WorkspaceFileChange[] };
  empty: string;
  /** The file the agent edits now (V89): it pulses. */
  editing?: string | undefined;
  onOpen: (file: WorkspaceFileChange) => void;
}) {
  if (files.count === 0) return <p className="changes-empty">{empty}</p>;
  const more = moreText(files.count, files.listed.length);
  return (
    <>
      <ul className="changes-list">
        {files.listed.map((file) => (
          <li
            key={file.path}
            className={editing && isPath(editing, file.path) ? 'editing' : undefined}
          >
            <FileRow
              file={file}
              label={`Open the changes to ${file.path} in VS Code`}
              hover={fileTitle(file)}
              onOpen={onOpen}
            />
          </li>
        ))}
      </ul>
      {more && <p className="changes-empty">{more}</p>}
    </>
  );
}

/** Whether a tool's subject (a path, maybe absolute) names the repo-relative `path`. */
const isPath = (subject: string, path: string) => subject === path || subject.endsWith(`/${path}`);

/**
 * A workspace's branch at the right of its terminal (V29d, decision 186): its commits since the
 * fork point and the files they change — what Review will show —, and the files its worktree has
 * not committed. A file opens as its diff in VS Code, what its row counts (V43): the branch's from
 * the fork point, one not committed from the worktree's HEAD. A workspace's side card since V89
 * (decision 832): what its agent does now first, then what it has not committed, live, the file
 * it edits pulsing; then its commits and files. Its changes are read by the page (`changes`), for
 * the head's counts too; a finished workspace's (History) reads its own.
 */
/** A commit's time: today's as the time of day, as the proofs write it (V93); older, its age. */
function commitTime(iso: string, now: number): string {
  const date = new Date(iso);
  if (date.toDateString() !== new Date(now).toDateString()) return shortAge(iso, now);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function ChangesPanel({
  branch,
  version,
  finished = false,
  changes: given,
  onPicked,
  now,
  editing,
  onSaid,
  page = false,
  facts,
  brief,
  run = false,
}: {
  branch: string;
  /** The list as last read: the changes are read again with it. */
  version: unknown;
  /**
   * A finished workspace's (V77), in History: read only — what it is reviewed against is not
   * picked — and no worktree, so nothing not committed.
   */
  finished?: boolean;
  /** Its changes, read by the page (V89); absent, the panel reads them. */
  changes?: WorkspaceChanges | string | null;
  /** What it is reviewed against was picked: the page reads its changes again. */
  onPicked?: () => void;
  /** What the agent does now, first (V89). */
  now?: ReactNode;
  /** The file the agent edits now, by its tool's subject (V89). */
  editing?: string | undefined;
  /** How opening a file went, in words, for the workspace's head. */
  onSaid: (words: string) => void;
  /**
   * Outside the terminal view (V93, proof 02): the workspace's facts first, then its brief, its
   * commits and its files; in it (proof 08), what the agent does, what is not committed, its
   * commits and its brief.
   */
  page?: boolean;
  /** The workspace's facts (Kind, Agent, Model, Plan first, Permissions), outside the terminal. */
  facts?: ReactNode;
  /** Its brief's first lines (V93). */
  brief?: string | undefined;
  /** Beside a Hive workspace's Run tab (V93). */
  run?: boolean;
}) {
  const [picks, setPicks] = useState(0);
  const read = useChanges(branch, version, picks, given === undefined);
  const changes = given === undefined ? read : given;
  const picked = onPicked ?? (() => setPicks((n) => n + 1));
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
  const shown = changes !== null && typeof changes !== 'string' ? changes : null;
  // The Run tab's side card leaves out an empty worktree, as proof 02 draws it (V93).
  const nothingUncommitted = shown?.uncommitted?.count === 0;
  const uncommitted = shown && !finished && !(run && nothingUncommitted) && (
    <section className="changes-section" aria-label="Not committed" key="uncommitted">
      <h2>
        Not committed{' '}
        {shown.uncommitted && <span className="changes-count">{shown.uncommitted.count}</span>}
      </h2>
      {shown.uncommitted ? (
        <Files files={shown.uncommitted} empty="Nothing" editing={editing} onOpen={opener(true)} />
      ) : (
        <p className="changes-empty">Its worktree is gone</p>
      )}
    </section>
  );
  const briefSection = brief && (
    <section className="changes-section" aria-label="Brief" key="brief">
      <h2>Brief</h2>
      <p className="changes-brief">{brief}</p>
    </section>
  );
  return (
    <aside className="changes" aria-label="Changes">
      {page ? facts : now}
      {page && briefSection}
      {changes === null && <p className="changes-empty">Reading its changes…</p>}
      {typeof changes === 'string' && <p className="changes-empty error">{changes}</p>}
      {shown && (
        <>
          {!page && uncommitted}
          <section className="changes-section" aria-label="Commits">
            <h2>
              Commits <span className="changes-count">{shown.commits.count}</span>
            </h2>
            {finished ? (
              <p className="changes-against">{sinceText(shown.since)}</p>
            ) : (
              <AgainstChoice branch={branch} changes={shown} onPicked={picked} onSaid={onSaid} />
            )}
            {shown.tip === null ? (
              <p className="changes-empty">
                {finished ? 'Where its branch ended is not known' : 'Its branch is gone'}
              </p>
            ) : shown.commits.count === 0 ? (
              <p className="changes-empty">No commits yet</p>
            ) : (
              <ol className="changes-list">
                {shown.commits.listed.map((commit) => (
                  <li key={commit.sha} className="changes-commit" {...tip(commitTitle(commit))}>
                    <span className="changes-sha">{commit.sha.slice(0, 7)}</span>
                    <span className="changes-subject">{commit.subject}</span>
                    <time className="changes-age" dateTime={commit.date}>
                      {commitTime(commit.date, Date.now())}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            {commitsMore && <p className="changes-empty">{commitsMore}</p>}
          </section>
          {!page && briefSection}
          {/* The terminal's side card lists its files once it has some (proof 08 draws none). */}
          {(page || shown.files.count > 0) && (
            <section className="changes-section" aria-label="Files">
              <h2>
                Files <span className="changes-count">{shown.files.count}</span>
                {shown.files.count > 0 && (
                  <Lines added={shown.files.added} removed={shown.files.removed} />
                )}
              </h2>
              <Files files={shown.files} empty="No files changed yet" onOpen={opener(false)} />
            </section>
          )}
        </>
      )}
    </aside>
  );
}

/** The files a branch changed, committed or not, each once: the head's Files (V89). */
export function changedFiles(changes: WorkspaceChanges): number {
  const paths = new Set(changes.files.listed.map((file) => file.path));
  for (const file of changes.uncommitted?.listed ?? []) paths.add(file.path);
  // Lists are cut at 300: a count past that is the larger of the two.
  return Math.max(paths.size, changes.files.count, changes.uncommitted?.count ?? 0);
}
