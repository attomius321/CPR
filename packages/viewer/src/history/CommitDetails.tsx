// A commit's details in Git's pane (V66b): its message, people, parents and refs, its files
// against its first parent; a file clicked shows in the rows' place (V70).
import { useEffect, useMemo, useState } from 'react';
import type { ChangedFile, Commit, CommitInfo, LineCount } from '@symbiote/core';
import { fetchCommit, fetchCommitLines } from './git-api.js';
import { withLines, type WithLines } from './details.js';
import { longDate, relativeDate, shortSha } from './commits.js';
import { FileRow, Lines } from '../workspaces/ChangesPanel.js';
import { fileFacts } from '../workspaces/changes.js';
import { tip } from '../ui/tip.js';

/** A commit as read for the pane and the file shown (V70): its details, then its files' lines. */
export interface CommitRead {
  sha: string;
  info: CommitInfo | null;
  /** Its files with their lines, once counted. */
  files: WithLines<ChangedFile>[];
  lines: LineCount[];
  error: string | null;
}

/** Reads the commit at `sha` (none when null): its details, then its lines. */
export function useCommitRead(sha: string | null): CommitRead | null {
  const [read, setRead] = useState<Omit<CommitRead, 'files'> | null>(null);
  useEffect(() => {
    if (!sha) {
      setRead(null);
      return;
    }
    let live = true;
    setRead({ sha, info: null, lines: [], error: null });
    fetchCommit(sha)
      .then((info) => {
        if (!live) return;
        setRead({ sha, info, lines: [], error: null });
        // Lines after the names: a blobless clone fetches blobs to count them (V66 spike).
        return fetchCommitLines(sha).then(
          (lines) => live && setRead({ sha, info, lines, error: null }),
        );
      })
      .catch(
        (e: unknown) =>
          live && setRead({ sha, info: null, lines: [], error: (e as Error).message }),
      );
    return () => {
      live = false;
    };
  }, [sha]);
  return useMemo(
    () =>
      read && read.sha === sha
        ? { ...read, files: read.info ? withLines(read.info.files, read.lines) : [] }
        : null,
    [read, sha],
  );
}

export function CommitDetails({
  read,
  commit,
  parentRows,
  starting,
  open,
  onOpen,
  onJump,
  onReview,
}: {
  read: CommitRead;
  /** The row's commit: its branches and tags. */
  commit: Commit | undefined;
  /** Each parent's row, when listed (-1 or absent when not). */
  parentRows: readonly number[];
  /** A comparison is being started. */
  starting: boolean;
  /** The file shown in the rows' place (V70). */
  open: string | null;
  /** Shows a file, or none (the one shown clicked again). */
  onOpen: (path: string | null) => void;
  onJump: (row: number) => void;
  /** Review this commit: against its first parent, on a diff's page. */
  onReview: (parent: string) => void;
}) {
  const { sha, info, files, lines, error } = read;
  const [copied, setCopied] = useState(false);
  const totals = useMemo(
    () =>
      lines.reduce(
        (sum, line) => ({
          added: sum.added + (line.added ?? 0),
          removed: sum.removed + (line.removed ?? 0),
        }),
        { added: 0, removed: 0 },
      ),
    [lines],
  );
  if (error)
    return <p className="hint error git-details-hint">Could not read the commit: {error}</p>;
  if (!info) return <p className="hint git-details-hint">Reading {shortSha(sha)}…</p>;
  const now = Date.now();
  const { author, committer } = info;
  const sameCommitter =
    committer.name === author.name &&
    committer.email === author.email &&
    committer.date === author.date;
  const refs = (commit?.refs ?? []).filter((ref) => ref.kind !== 'head');
  const parent = info.parents[0];
  return (
    <>
      <header className="git-details-head">
        <h2 className="git-details-title">{info.subject}</h2>
        <button
          type="button"
          className="button secondary git-details-action"
          disabled={!parent || starting}
          {...tip(
            parent
              ? 'Its changes against its parent, on a review page'
              : 'A root commit: no parent to compare with',
          )}
          onClick={() => parent && onReview(parent)}
        >
          {starting ? 'Starting…' : 'Review this commit'}
        </button>
      </header>
      <div className="git-details-body">
        {info.body && <pre className="git-details-message">{info.body}</pre>}
        <dl className="git-details-facts">
          <dt>Commit</dt>
          <dd>
            <code>{shortSha(info.sha)}</code>
            <button
              type="button"
              className="link git-copy"
              {...tip(info.sha, { code: true })}
              onClick={() => {
                void navigator.clipboard?.writeText(info.sha).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy SHA'}
            </button>
          </dd>
          <dt>Author</dt>
          <dd>
            {author.name} <span className="muted">&lt;{author.email}&gt;</span>
            {' · '}
            <time dateTime={author.date} {...tip(longDate(author.date))}>
              {relativeDate(author.date, now)}
            </time>
          </dd>
          {!sameCommitter && (
            <>
              <dt>Committer</dt>
              <dd>
                {committer.name} <span className="muted">&lt;{committer.email}&gt;</span>
                {' · '}
                <time dateTime={committer.date} {...tip(longDate(committer.date))}>
                  {relativeDate(committer.date, now)}
                </time>
              </dd>
            </>
          )}
          <dt>{info.parents.length === 1 ? 'Parent' : 'Parents'}</dt>
          <dd>
            {info.parents.length === 0
              ? 'None: a root commit'
              : info.parents.map((p, i) => {
                  const row = parentRows[i];
                  return row !== undefined && row >= 0 ? (
                    <button
                      key={p}
                      type="button"
                      className="link git-parent"
                      aria-label={`Go to the parent ${shortSha(p)}`}
                      {...tip('Go to its row')}
                      onClick={() => onJump(row)}
                    >
                      <code>{shortSha(p)}</code>
                    </button>
                  ) : (
                    <code key={p} className="git-parent">
                      {shortSha(p)}
                    </code>
                  );
                })}
          </dd>
          {refs.length > 0 && (
            <>
              <dt>On</dt>
              <dd className="git-details-refs">
                {refs.map((ref) => (
                  <span key={`${ref.kind}:${ref.name}`} className={`ref ref-${ref.kind}`}>
                    {ref.name}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
        <h3 className="git-details-part">
          {files.length === 1 ? '1 file' : `${files.length} files`}
          {lines.length > 0 && <Lines added={totals.added} removed={totals.removed} />}
          {info.parents.length > 1 && <span className="muted"> against its first parent</span>}
        </h3>
        {files.length === 0 ? (
          <p className="changes-empty">No file changed.</p>
        ) : (
          <ul className="changes-list git-files">
            {files.map((file) => (
              <li key={file.path}>
                <FileRow
                  file={file}
                  label={`Show the diff of ${file.path}`}
                  hover={`${fileFacts(file)}. Shows its diff`}
                  current={open === file.path}
                  onOpen={(picked) => onOpen(open === picked.path ? null : picked.path)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
