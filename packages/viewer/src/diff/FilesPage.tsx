import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { Graph, ReviewFile } from '@symbiote/core';
import { label } from '../graph/flow.js';
import { CommentIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';
import { FileRow, Lines } from '../workspaces/ChangesPanel.js';
import { fileFacts } from '../workspaces/changes.js';
import { describeAnchor, type Anchor, type Draft, type Side } from './comments.js';
import type { DiffRow } from './detail.js';
import { LineNumber } from './DetailPanel.js';
import {
  changeWords,
  draftsByLine,
  foldRows,
  lineAnchor,
  parseFileDiff,
  rowKey,
  type FileDiff,
  type Fold,
} from './file-diff.js';
import { describeOpen, openInEditor, type OpenTarget } from './open.js';
import { OpenIcon } from './OpenIcon.js';
import { ReviewTab, type ReviewProps } from './ReviewTab.js';

/** Rows drawn before "Show all" (decision 436): a generated file's diff stays quick to draw. */
const MAX_ROWS = 2000;
/** How long "Opened in VS Code …" stays; an error stays until the next open. */
const NOTE_MS = 8000;

export type FilesTab = 'files' | 'review';

/** The review's comments on the Files page: the drafts, and which lines take one. */
export interface FileComments {
  drafts: readonly Draft[];
  /** Unchanged lines take comments (a branch review); a forge's only its changed ones. */
  unchanged: boolean;
  onAdd: (anchor: Anchor, body: string) => void;
  onRemove: (id: string) => void;
}

/** A line to show, from the review tab: its file and its place ({@link rowKey}). */
export interface FileFocus {
  path: string;
  key: string;
}

/**
 * The change's files with git's lines (`./api/files`), read once per graph; meanwhile, and where
 * the server has none (a graph opened from a file), the graph's own files without lines.
 */
export function useReviewFiles(graph: Graph | undefined, served: boolean): ReviewFile[] {
  const [files, setFiles] = useState<ReviewFile[]>(graph?.files ?? []);
  useEffect(() => {
    setFiles(graph?.files ?? []);
    if (!graph || !served) return;
    let live = true;
    fetch('./api/files')
      .then((response) => (response.ok ? (response.json() as Promise<ReviewFile[]>) : null))
      .then((read) => {
        if (live && read) setFiles(read);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [graph, served]);
  return files;
}

type DiffState =
  | { status: 'loading' }
  | { status: 'ready'; diff: FileDiff }
  | { status: 'failed'; error: string }
  /** No server to read it from: a graph opened from a file. */
  | { status: 'none' };

/** Each file's diff, read once per page: by the head reviewed and the path. */
const diffs = new Map<string, Promise<FileDiff>>();

function fetchFileDiff(graph: Graph, path: string): Promise<FileDiff> {
  const key = `${graph.revisions.head.sha ?? graph.revisions.head.ref}:${path}`;
  let diff = diffs.get(key);
  if (!diff) {
    diff = fetch(`./api/file?path=${encodeURIComponent(path)}`).then(async (response) => {
      if (response.status === 413) throw new Error('Too large to draw here: a diff over 5 MB.');
      if (!response.ok) throw new Error(`Could not read its diff (${response.status}).`);
      return parseFileDiff(await response.text());
    });
    // A failed read is tried again the next time the file is opened.
    diff.catch(() => diffs.delete(key));
    diffs.set(key, diff);
  }
  return diff;
}

function useFileDiff(graph: Graph, path: string, served: boolean): DiffState {
  const [state, setState] = useState<DiffState>({ status: served ? 'loading' : 'none' });
  useEffect(() => {
    if (!served) return setState({ status: 'none' });
    let live = true;
    setState({ status: 'loading' });
    fetchFileDiff(graph, path).then(
      (diff) => live && setState({ status: 'ready', diff }),
      (error: unknown) => live && setState({ status: 'failed', error: (error as Error).message }),
    );
    return () => {
      live = false;
    };
  }, [graph, path, served]);
  return state;
}

interface Props {
  graph: Graph;
  files: readonly ReviewFile[];
  /** The file shown, by path; null for the first. */
  open: string | null;
  onOpenFile: (path: string) => void;
  /** `./api/file` gives each file's diff. */
  served: boolean;
  /** The server opens files in VS Code (`/api/open`). */
  canOpen: boolean;
  tab: FilesTab;
  onTab: (tab: FilesTab) => void;
  /** Present where the page takes a review: its tab, and comments on lines. */
  review?: ReviewProps | undefined;
  comments?: FileComments | undefined;
  /** Shows what a comment in the review tab is on. */
  onOpenDraft: (draft: Draft) => void;
  focus: FileFocus | null;
  /** The list's resize handle, drawn between it and the diff. */
  handle: ReactNode;
}

/**
 * The Files page (V60, decision 431): the change's files at the left, drawn as a workspace's
 * changes panel draws them, and the review's tab; the file picked, its diff, beside them.
 */
export function FilesPage({
  graph,
  files,
  open,
  onOpenFile,
  served,
  canOpen,
  tab,
  onTab,
  review,
  comments,
  onOpenDraft,
  focus,
  handle,
}: Props) {
  const shown = files.find((file) => file.path === open) ?? files[0];
  const commented = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of files) {
      const n = [...draftsByLine(comments?.drafts ?? [], file).values()].flat().length;
      if (n > 0) counts.set(file.path, n);
    }
    return counts;
  }, [files, comments?.drafts]);
  return (
    <>
      <nav className="sidebar files-side" aria-label="Files">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'files'} onClick={() => onTab('files')}>
            Files <span className="count">{files.length}</span>
          </button>
          {review && (
            <button role="tab" aria-selected={tab === 'review'} onClick={() => onTab('review')}>
              Review <span className="count">{review.draft.drafts.length}</span>
            </button>
          )}
        </div>
        {tab === 'review' && review ? (
          <ReviewTab graph={graph} review={review} onOpen={onOpenDraft} canOpen={canOpen} />
        ) : (
          <div className="list">
            {files.length === 0 ? (
              <p className="muted pad">No file changed.</p>
            ) : (
              <ul className="changes-list files-list">
                {files.map((file) => {
                  const count = commented.get(file.path);
                  return (
                    <li key={file.path}>
                      <FileRow
                        file={file}
                        label={`Show the changes to ${file.path}`}
                        hover={fileFacts(file)}
                        current={file === shown}
                        after={
                          count !== undefined && (
                            <span
                              className="files-commented"
                              aria-label={`${count} comment${count === 1 ? '' : 's'}`}
                            >
                              <CommentIcon />
                              {count}
                            </span>
                          )
                        }
                        onOpen={() => onOpenFile(file.path)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </nav>
      {handle}
      {shown ? (
        <FileView
          key={shown.path}
          graph={graph}
          file={shown}
          served={served}
          canOpen={canOpen}
          comments={comments}
          focus={focus?.path === shown.path ? focus : null}
        />
      ) : (
        <p className="hint files-none">No file changed.</p>
      )}
    </>
  );
}

/** Where a file opens in VS Code from its head: its first change, head's side if it has one. */
function firstChange(file: ReviewFile, rows: readonly DiffRow[]): OpenTarget {
  const row = rows.find((r) => r.type !== 'same');
  if (row?.type === 'del' || file.status === 'deleted') {
    return { side: 'base', file: file.previousPath ?? file.path, line: row?.base ?? 1, column: 1 };
  }
  return { side: 'head', file: file.path, line: row?.head ?? 1, column: 1 };
}

/** A row's line in VS Code: on `side` (its number clicked), else head's, else base's. */
function rowOpen(file: ReviewFile, row: DiffRow, side?: Side): OpenTarget | null {
  const which = side ?? (row.head !== undefined ? 'head' : 'base');
  const line = row[which];
  if (line === undefined) return null;
  return {
    side: which,
    file: which === 'base' ? (file.previousPath ?? file.path) : file.path,
    line,
    column: 1,
  };
}

/** Why there are no rows, in words. */
function noRows(file: ReviewFile, state: DiffState): string | null {
  if (state.status === 'loading') return 'Reading its diff…';
  if (state.status === 'none')
    return 'Its diff shows when the change is opened with symbiote view.';
  if (state.status === 'failed') return state.error;
  if (state.diff.kind === 'binary') return 'A binary file: no lines to show.';
  if (state.diff.kind === 'none') {
    return file.previousPath && file.previousPath !== file.path
      ? `Moved from ${file.previousPath}; no line changed.`
      : 'No line changed: only its mode.';
  }
  return null;
}

/** One file's diff: its head, its rows folded to the changes, and the comments on its lines. */
function FileView({
  graph,
  file,
  served,
  canOpen,
  comments,
  focus,
}: {
  graph: Graph;
  file: ReviewFile;
  served: boolean;
  canOpen: boolean;
  comments: FileComments | undefined;
  focus: FileFocus | null;
}) {
  const state = useFileDiff(graph, file.path, served);
  const rows = useMemo(
    () => (state.status === 'ready' && state.diff.kind === 'rows' ? state.diff.rows : []),
    [state],
  );
  /** Folds opened, by where they start. */
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [all, setAll] = useState(false);
  /** The line a comment is being written on, and what it says so far. */
  const [writing, setWriting] = useState<{ key: string; anchor: Anchor } | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!note || note.error) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);
  const byLine = useMemo(
    () => draftsByLine(comments?.drafts ?? [], file),
    [comments?.drafts, file],
  );
  // Rows with comments, the one written on and the one asked for are drawn, folds or not.
  const pinned = useMemo(() => {
    const keys = new Set([...byLine.keys(), writing?.key, focus?.key]);
    return new Set(rows.flatMap((row, i) => (keys.has(rowKey(row)) ? [i] : [])));
  }, [rows, byLine, writing, focus]);
  const folds = useMemo(() => foldRows(rows, opened, undefined, pinned), [rows, opened, pinned]);
  // The first MAX_ROWS rows, with their folds, until Show all.
  const drawn = useMemo(() => {
    if (all) return folds;
    let count = 0;
    const cut = folds.findIndex((fold) => fold.kind === 'row' && ++count > MAX_ROWS);
    return cut < 0 ? folds : folds.slice(0, cut);
  }, [folds, all]);
  const cutOff = drawn.length < folds.length;

  const code = useRef<HTMLDivElement>(null);
  // A line asked for from the review tab: in view once its rows are drawn.
  useEffect(() => {
    if (!focus || rows.length === 0) return;
    code.current?.querySelector(`[data-key="${focus.key}"]`)?.scrollIntoView({ block: 'center' });
  }, [focus, rows]);

  const open = (target: OpenTarget | null) => {
    if (!target) return;
    void openInEditor(target).then((answer) =>
      setNote({ text: describeOpen(target, answer), error: !answer.ok }),
    );
  };
  const add = () => {
    if (!writing || !comments || !text.trim()) return;
    comments.onAdd(writing.anchor, text);
    setText('');
    setWriting(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      add();
    } else if (event.key === 'Escape') setWriting(null);
  };
  const empty = noRows(file, state);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));

  const row = (fold: Fold & { kind: 'row' }) => {
    const { row } = fold;
    const key = rowKey(row);
    const anchor = comments ? lineAnchor(file, row, comments.unchanged) : null;
    const onClick = (event: MouseEvent) => {
      if (canOpen && (event.ctrlKey || event.metaKey)) return open(rowOpen(file, row));
      if (anchor) setWriting({ key, anchor });
    };
    const drafts = byLine.get(key) ?? [];
    const here = writing?.key === key;
    return (
      <Fragment key={fold.index}>
        <div
          className={`row row-${row.type}${anchor ? ' pickable' : ''}${here || focus?.key === key ? ' anchored' : ''}`}
          role="row"
          data-key={key}
          {...(anchor || canOpen ? { onClick } : {})}
        >
          <LineNumber
            row={row}
            side="base"
            onOpen={canOpen ? (r, side) => open(rowOpen(file, r, side)) : undefined}
          />
          <LineNumber
            row={row}
            side="head"
            onOpen={canOpen ? (r, side) => open(rowOpen(file, r, side)) : undefined}
          />
          <span className="mark">{row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}</span>
          <span className="text">{row.text}</span>
        </div>
        {(drafts.length > 0 || here) && (
          <div className="file-comments">
            {drafts.map((draft) => {
              const node = draft.symbol === undefined ? undefined : nodes.get(draft.symbol);
              return (
                <div key={draft.id} className="draft">
                  <div className="draft-where">
                    <span className="muted">{node ? `On ${label(node)}` : 'On this line'}</span>
                    <button
                      className="link"
                      aria-label={`Delete comment on line ${draft.anchor?.line ?? ''}`}
                      onClick={() => comments?.onRemove(draft.id)}
                    >
                      Delete
                    </button>
                  </div>
                  <p className="draft-body">{draft.body}</p>
                </div>
              );
            })}
            {here && writing && (
              <div className="file-comment-form">
                <textarea
                  id="comment-input"
                  className="comment-input"
                  aria-label="Comment"
                  placeholder="Leave a comment (sent with the review)"
                  rows={3}
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                />
                <div className="comment-actions">
                  <span className="muted">{describeAnchor(writing.anchor)}</span>
                  <span className="file-comment-buttons">
                    <button className="link" onClick={() => setWriting(null)}>
                      Cancel
                    </button>
                    <button
                      className="review"
                      onClick={add}
                      disabled={!text.trim()}
                      {...tip('Add the comment', { keys: 'Ctrl+Enter' })}
                    >
                      Add comment
                    </button>
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <section className="file-view" aria-label={`Changes to ${file.path}`}>
      <header className="file-head">
        <h2 className="file-path">{file.path}</h2>
        <span className="file-words">{changeWords(file)}</span>
        {file.added !== undefined && file.removed !== undefined && (
          <Lines added={file.added} removed={file.removed} />
        )}
        {canOpen && (
          <button
            id="open-in-editor"
            type="button"
            className="open-editor"
            {...tip(`Open ${file.path} in VS Code at its first change`, { keys: 'o' })}
            onClick={() => open(firstChange(file, rows))}
          >
            <OpenIcon />
            Open in VS Code
            <kbd aria-hidden="true">o</kbd>
          </button>
        )}
        {canOpen && note && (
          <span className={`open-note${note.error ? ' open-error' : ''}`} role="status">
            {note.text}
          </span>
        )}
      </header>
      {empty ? (
        <p className={`hint${state.status === 'failed' ? ' error' : ''}`}>{empty}</p>
      ) : (
        <div className="code file-code" role="table" aria-label={`Diff of ${file.path}`} ref={code}>
          {drawn.map((fold) =>
            fold.kind === 'row' ? (
              row(fold)
            ) : (
              <button
                key={`gap-${fold.start}`}
                type="button"
                className="fold"
                onClick={() => setOpened((current) => new Set(current).add(fold.start))}
              >
                {fold.end - fold.start} unchanged line{fold.end - fold.start === 1 ? '' : 's'}
              </button>
            ),
          )}
          {cutOff && (
            <button className="more" onClick={() => setAll(true)}>
              Show all {rows.length} lines
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** The Files page's keys, in the help of its bar: `c` with a review, `o` when VS Code opens. */
export function FilesKeys({ review, canOpen }: { review: boolean; canOpen: boolean }) {
  const keys: [ReactNode, string][] = [
    [
      <>
        <kbd>j</kbd>/<kbd>k</kbd>
      </>,
      'next/previous file',
    ],
    ...(review ? [[<kbd>c</kbd>, 'comment'] as [ReactNode, string]] : []),
    ...(canOpen ? [[<kbd>o</kbd>, 'VS Code'] as [ReactNode, string]] : []),
    [<kbd>g</kbd>, 'graph'],
  ];
  return (
    <p className="keys">
      {keys.map(([key, words], i) => (
        <span key={words} className="key-entry">
          {key} {words}
          {i < keys.length - 1 ? ' · ' : ''}
        </span>
      ))}
    </p>
  );
}
