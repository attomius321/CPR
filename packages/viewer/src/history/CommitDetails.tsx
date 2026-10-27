// A commit's details in Git's pane (V66b): its message, people, parents and refs, its files
// against its first parent, and the open file's diff.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Commit, CommitInfo, LineCount } from '@symbiote/core';
import { fetchCommit, fetchCommitFile, fetchCommitLines } from './git-api.js';
import { withLines } from './details.js';
import { GitDiff } from './GitDiff.js';
import { longDate, relativeDate, shortSha } from './commits.js';
import { FileRow, Lines } from '../workspaces/ChangesPanel.js';
import { fileFacts } from '../workspaces/changes.js';
import { tip } from '../ui/tip.js';

export function CommitDetails({
  sha,
  commit,
  parentRows,
  starting,
  onJump,
  onReview,
}: {
  sha: string;
  /** The row's commit: its branches and tags. */
  commit: Commit | undefined;
  /** Each parent's row, when listed (-1 or absent when not). */
  parentRows: readonly number[];
  /** A comparison is being started. */
  starting: boolean;
  onJump: (row: number) => void;
  /** Review this commit: against its first parent, on a diff's page. */
  onReview: (parent: string) => void;
}) {
  const [info, setInfo] = useState<CommitInfo | null>(null);
  const [lines, setLines] = useState<LineCount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    setInfo(null);
    setLines([]);
    setError(null);
    setOpen(null);
    setCopied(false);
    fetchCommit(sha)
      .then((read) => {
        if (!live) return;
        setInfo(read);
        // Lines after the names: a blobless clone fetches blobs to count them (V66 spike).
        return fetchCommitLines(sha).then((counted) => live && setLines(counted));
      })
      .catch((e: unknown) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [sha]);
  const files = useMemo(() => (info ? withLines(info.files, lines) : []), [info, lines]);
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
  const load = useCallback(() => fetchCommitFile(sha, open ?? ''), [sha, open]);

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
                  onOpen={(picked) => setOpen((now) => (now === picked.path ? null : picked.path))}
                />
              </li>
            ))}
          </ul>
        )}
        {open && (
          <section className="git-details-diff" aria-label={`Changes to ${open}`}>
            <h3 className="git-details-part">{open}</h3>
            <GitDiff path={open} load={load} />
          </section>
        )}
      </div>
    </>
  );
}
