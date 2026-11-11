import type { Finding, Graph, GraphNode, Project, Severity } from '@symbiote/core';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { groupOf, kindMark, label, stylesheetId, tone, type ChangeKind } from '../graph/flow.js';
import { pathInProject, projectOf } from '../graph/projects.js';
import {
  byProject,
  reviewItems,
  reviewProgress,
  type FileChanges,
  type FindingFold,
} from './review.js';
import { ReviewTab, type ReviewProps } from './ReviewTab.js';
import type { Draft } from './comments.js';
import {
  AlertIcon,
  ChevronIcon,
  CloseIcon,
  CommentIcon,
  FailedIcon,
  ForwardIcon,
  HelpIcon,
} from '../ui/icons.js';
import { tip } from '../ui/tip.js';
import { plural } from '../ui/plural.js';

export type SidebarTab = 'changes' | 'findings' | 'review';

interface Props {
  graph: Graph;
  /** The findings listed, worst first, and the settled signature changes folded (V100). */
  findings: { shown: Finding[]; folds: FindingFold[] };
  /** A head's pill asked for this severity (V100): its first finding is shown, then cleared. */
  findingAt: { severity: Severity } | null;
  onFindingShown: () => void;
  changes: FileChanges[];
  /** The changes the search leaves. */
  shown: FileChanges[];
  search: string;
  onSearch: (search: string) => void;
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  reviewed: ReadonlySet<string>;
  /** Reviewed before, but changed since (a new push). */
  stale: ReadonlySet<string>;
  selected: string | null;
  onSelect: (id: string) => void;
  onToggleReviewed: (id: string) => void;
  /** The one project shown (by folder), or null for all. */
  project: string | null;
  onProject: (folder: string | null) => void;
  /** Projects (by folder) folded in the list. */
  collapsed: ReadonlySet<string>;
  onCollapse: (folder: string) => void;
  /** Present when the review can be posted to the forge (`symbiote pr`). */
  review?: ReviewProps | undefined;
  /** Whether the server opens files in VS Code (the `o` key). */
  canOpen: boolean;
  /** Shows what a comment in the review tab is on (V60). */
  onOpenDraft: (draft: Draft) => void;
}

/**
 * The review checklist (changed symbols by file, by project when they span several), the
 * findings and, under `symbiote pr`, the review to post, in tabs.
 */
export function Sidebar({
  graph,
  findings,
  findingAt,
  onFindingShown,
  changes,
  shown,
  search,
  onSearch,
  tab,
  onTab: setTab,
  reviewed,
  stale,
  selected,
  onSelect,
  onToggleReviewed,
  project,
  onProject,
  collapsed,
  onCollapse,
  review,
  canOpen,
  onOpenDraft,
}: Props) {
  const commented = new Map<string, number>();
  for (const { symbol } of review?.draft.drafts ?? []) {
    if (symbol !== undefined) commented.set(symbol, (commented.get(symbol) ?? 0) + 1);
  }
  // Items (V105, decision 980): a changed symbol, or a stylesheet with all its rules.
  const { done, total } = reviewProgress(changes, reviewed);
  const matches = reviewItems(shown).length;
  const sheets = changes.filter((f) => f.stylesheet).length;
  /** The folds opened, by their project's folder. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  /** The stylesheets whose rules are shown under their row (V105), by file. */
  const [openSheets, setOpenSheets] = useState<ReadonlySet<string>>(new Set());
  const toggleSheet = (file: string) =>
    setOpenSheets((current) => {
      const next = new Set(current);
      if (!next.delete(file)) next.add(file);
      return next;
    });
  const findingList = useRef<HTMLDivElement>(null);
  // A head's pill (V100, decision 968): the first finding of its severity at the list's top, and
  // focused, so the keyboard goes on from it.
  useEffect(() => {
    if (!findingAt || tab !== 'findings') return;
    const row = findingList.current?.querySelector<HTMLElement>(
      `.finding-row.finding-${findingAt.severity}`,
    );
    row?.scrollIntoView({ block: 'start' });
    row?.focus({ preventScroll: true });
    onFindingShown();
  }, [findingAt, tab, onFindingShown]);
  // By project only when the changes span two or more.
  const grouped = changes.some((f) => f.project);
  const progress = new Map<string, { done: number; total: number }>();
  for (const file of changes) {
    if (!file.project) continue;
    const entry = progress.get(file.project.folder) ?? { done: 0, total: 0 };
    const own = reviewProgress([file], reviewed);
    entry.total += own.total;
    entry.done += own.done;
    progress.set(file.project.folder, entry);
  }
  const shownProject =
    project === null ? undefined : changes.find((f) => f.project?.folder === project)?.project;
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  /** A finding's project, named when the list is by project. */
  const projectName = (symbol: string): string | undefined => {
    const node = nodes.get(symbol);
    const file = node ? groupOf(node).file : undefined;
    return grouped && file ? projectOf(file, graph.projects ?? [])?.name : undefined;
  };

  const findingRow = (finding: Finding) => (
    <FindingRow
      key={finding.id}
      finding={finding}
      project={projectName(finding.symbol)}
      current={finding.symbol === selected}
      onSelect={onSelect}
    />
  );

  const changeItem = (node: GraphNode, part = false) => (
    <ChangeItem
      key={node.id}
      node={node}
      part={part}
      current={node.id === selected}
      reviewed={reviewed.has(node.id)}
      stale={stale.has(node.id)}
      comments={commented.get(node.id)}
      onSelect={onSelect}
      onToggleReviewed={onToggleReviewed}
    />
  );

  const fileList = (files: FileChanges[], of?: Project) =>
    files.map(({ file, stylesheet, symbols }) => {
      // While searching, a stylesheet shows the rules that match.
      const open = openSheets.has(file) || search.trim() !== '';
      return (
        <div key={file} className="list-file">
          <div className="list-file-name" {...tip(file)}>
            {of ? pathInProject(file, of) : file}
          </div>
          {stylesheet ? (
            <>
              <StylesheetItem
                file={file}
                symbols={symbols}
                open={open}
                // The pick's own row is current once its rules are shown.
                current={!open && symbols.some((s) => s.id === selected)}
                reviewed={symbols.every((s) => reviewed.has(s.id))}
                stale={symbols.some((s) => stale.has(s.id))}
                comments={symbols.reduce((n, s) => n + (commented.get(s.id) ?? 0), 0)}
                onSelect={onSelect}
                onToggleReviewed={onToggleReviewed}
                onToggleOpen={() => toggleSheet(file)}
              />
              {open && symbols.map((node) => changeItem(node, true))}
            </>
          ) : (
            symbols.map((node) => changeItem(node))
          )}
        </div>
      );
    });

  return (
    <nav className="sidebar" aria-label="Review">
      <div className="card-head tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
          Changes <span className="count">{total}</span>
        </button>
        <button role="tab" aria-selected={tab === 'findings'} onClick={() => setTab('findings')}>
          Findings <span className="count">{findings.shown.length}</span>
        </button>
        {review && (
          <button role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>
            Review <span className="count">{review.draft.drafts.length}</span>
          </button>
        )}
      </div>
      {/* How far the review is (V90, decision 840): in words, and a bar. */}
      <div className="review-progress">
        <div className="review-progress-words">
          {sheets === 0 ? (
            <span>
              {done} of {total} changed symbol{total === 1 ? '' : 's'} reviewed
            </span>
          ) : (
            // A stylesheet counts once (V105, decision 980).
            <span
              {...tip(
                `${plural(total - sheets, 'symbol')} and ${plural(sheets, 'stylesheet')}: a stylesheet's rules count as one`,
              )}
            >
              {done} of {plural(total, 'change')} reviewed
            </span>
          )}
          <span className="review-progress-keys">j / k next</span>
        </div>
        <div className="progress" aria-label={`${done} of ${total} reviewed`}>
          <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      </div>

      {tab === 'changes' ? (
        <>
          <div className="search">
            <input
              id="change-search"
              className="search-input"
              type="text"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => {
                // Enter goes to the first match; j/k then walk the rest.
                const first = shown[0]?.symbols[0];
                if (e.key === 'Enter' && first) {
                  onSelect(first.id);
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search files and symbols"
              aria-label="Search changes"
              autoComplete="off"
              spellCheck={false}
            />
            {search && (
              <>
                <span className="count" aria-live="polite">
                  {matches}/{total}
                </span>
                <button
                  className="search-clear"
                  onClick={() => onSearch('')}
                  aria-label="Clear search"
                >
                  <CloseIcon />
                </button>
              </>
            )}
          </div>
          <div className="list">
            {stale.size > 0 && (
              <p className="stale-note">
                ↻ {stale.size} symbol{stale.size === 1 ? '' : 's'} changed since you reviewed{' '}
                {stale.size === 1 ? 'it' : 'them'}
              </p>
            )}
            {shownProject && (
              <p className="project-note">
                Only <strong>{shownProject.name}</strong> and what it is linked to
                <button className="link" onClick={() => onProject(null)}>
                  Show all projects
                </button>
              </p>
            )}
            {grouped
              ? byProject(shown).map(({ project: of, files }) => {
                  if (!of) return fileList(files);
                  const folded = collapsed.has(of.folder);
                  const { done: ok = 0, total: all = 0 } = progress.get(of.folder) ?? {};
                  return (
                    <section key={of.folder} className="list-project" aria-label={of.name}>
                      <div className="list-project-head">
                        <button
                          className="list-project-toggle"
                          aria-expanded={!folded}
                          onClick={() => onCollapse(of.folder)}
                          {...tip(of.folder === '' ? 'Repository root' : of.folder, {
                            code: of.folder !== '',
                          })}
                        >
                          <span className="list-project-caret" aria-hidden="true">
                            <ChevronIcon open={!folded} />
                          </span>
                          <span className="list-project-name">{of.name}</span>
                          {of.kind && (
                            <span className="project-kind">
                              {of.kind === 'application' ? 'app' : 'lib'}
                            </span>
                          )}
                        </button>
                        <span
                          className="list-project-progress"
                          {...tip(`${ok} of ${all} reviewed`, {
                            tone: ok === all ? 'ok' : undefined,
                          })}
                        >
                          {ok}/{all}
                        </span>
                        <button
                          className="list-project-only"
                          aria-pressed={project === of.folder}
                          onClick={() => onProject(project === of.folder ? null : of.folder)}
                          {...tip(
                            project === of.folder
                              ? 'Show all projects'
                              : `Show only ${of.name} and what it is linked to`,
                            { keys: 'p' },
                          )}
                        >
                          only
                        </button>
                      </div>
                      {!folded && fileList(files, of)}
                    </section>
                  );
                })
              : fileList(shown)}
            {total === 0 && <p className="muted pad">No symbol changed.</p>}
            {total > 0 && matches === 0 && (
              <p className="muted pad">No changed file or symbol matches “{search.trim()}”.</p>
            )}
          </div>
        </>
      ) : tab === 'review' && review ? (
        <ReviewTab graph={graph} review={review} onOpen={onOpenDraft} canOpen={canOpen} />
      ) : (
        <div className="list" ref={findingList}>
          {findings.shown.map(findingRow)}
          {/* The settled signature changes, a row per project below the rest (V100, 969). */}
          {findings.folds.map((fold) => {
            const folder = fold.project?.folder ?? '';
            const open = opened.has(folder);
            return (
              <Fragment key={`fold:${folder}`}>
                <FoldRow
                  count={fold.findings.length}
                  project={grouped ? fold.project?.name : undefined}
                  open={open}
                  onToggle={() =>
                    setOpened((current) => {
                      const next = new Set(current);
                      if (!next.delete(folder)) next.add(folder);
                      return next;
                    })
                  }
                />
                {open && fold.findings.map(findingRow)}
              </Fragment>
            );
          })}
          {graph.findings.length === 0 && <p className="muted pad">No findings.</p>}
        </div>
      )}
      {review && tab !== 'review' && (
        <footer className="sidebar-foot">
          <CommentIcon />
          <span>
            {review.draft.drafts.length === 0
              ? 'No comment drafted'
              : `${review.draft.drafts.length} comment${review.draft.drafts.length === 1 ? '' : 's'} drafted`}
          </span>
          <button type="button" className="button sidebar-finish" onClick={() => setTab('review')}>
            Finish review
          </button>
        </footer>
      )}
    </nav>
  );
}

/**
 * A diff's keys, in the help of its bar (V37: a strip under the change list, three lines in the
 * review tab): `p` when the list is by project, `c` when there is a review to comment in, `o` when
 * VS Code can open a line.
 */
export function DiffKeys({
  grouped,
  review,
  canOpen,
  files = false,
}: {
  grouped: boolean;
  review: boolean;
  canOpen: boolean;
  /** The Files page is a key away (V60). */
  files?: boolean;
}) {
  // Each key with its words, so a line never ends between them.
  const keys: [ReactNode, string][] = [
    [
      <>
        <kbd>j</kbd>/<kbd>k</kbd>
      </>,
      'next/previous',
    ],
    [<kbd>r</kbd>, 'reviewed'],
    [<kbd>f</kbd>, 'focus'],
    ...(grouped ? [[<kbd>p</kbd>, 'project'] as [ReactNode, string]] : []),
    [<kbd>/</kbd>, 'search'],
    ...(review ? [[<kbd>c</kbd>, 'comment'] as [ReactNode, string]] : []),
    ...(canOpen ? [[<kbd>o</kbd>, 'VS Code'] as [ReactNode, string]] : []),
    ...(files ? [[<kbd>g</kbd>, 'files'] as [ReactNode, string]] : []),
    [<kbd>Esc</kbd>, 'close'],
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

/**
 * A changed symbol in the list: its reviewed box, its name, and marks. A rule shown under its
 * stylesheet's row (`part`, V105) has no box: the stylesheet's marks them all.
 */
function ChangeItem({
  node,
  part,
  current,
  reviewed,
  stale,
  comments,
  onSelect,
  onToggleReviewed,
}: {
  node: GraphNode;
  part: boolean;
  current: boolean;
  reviewed: boolean;
  stale: boolean;
  comments: number | undefined;
  onSelect: (id: string) => void;
  onToggleReviewed: (id: string) => void;
}) {
  return (
    <div
      className={`list-item tone-${tone(node)}${part ? ' list-part' : ''}${current ? ' current' : ''}${reviewed ? ' done' : ''}${stale ? ' stale' : ''}`}
    >
      {!part && (
        <input
          type="checkbox"
          checked={reviewed}
          onChange={() => onToggleReviewed(node.id)}
          aria-label={`Mark ${label(node)} reviewed`}
        />
      )}
      {/* Beside the name, not in it: the button is named by the symbol alone. */}
      <KindMark node={node} />
      <button className="list-link" onClick={() => onSelect(node.id)}>
        {label(node)}
      </button>
      {stale && (
        <span
          className="stale-mark"
          role="img"
          aria-label="Changed since you reviewed it"
          {...tip('Changed since you reviewed it', { tone: 'warn' })}
        >
          ↻
        </span>
      )}
      {comments !== undefined && (
        <span className="commented" {...tip('Comments on this symbol')}>
          💬 {comments}
        </span>
      )}
    </div>
  );
}

/** A changed symbol's kind as on its node (V90): `+`, `−`, `~`, an arrow for moved. */
function KindMark({ node }: { node: GraphNode }) {
  const mark = kindMark(tone(node));
  if (!mark) return null;
  return (
    <span className={`symbol-mark mark-${mark.kind}`} role="img" aria-label={mark.kind}>
      {mark.glyph ?? <ForwardIcon />}
    </span>
  );
}

const CHANGE_KINDS: readonly ChangeKind[] = ['added', 'modified', 'removed', 'moved'];

/**
 * A stylesheet of changed rules as one row (V105, decision 980): one box marks them all, its name
 * picks its first rule (its card on the canvas), the caret shows its rules under it.
 */
function StylesheetItem({
  file,
  symbols,
  open,
  current,
  reviewed,
  stale,
  comments,
  onSelect,
  onToggleReviewed,
  onToggleOpen,
}: {
  file: string;
  symbols: GraphNode[];
  open: boolean;
  current: boolean;
  reviewed: boolean;
  stale: boolean;
  comments: number;
  onSelect: (id: string) => void;
  onToggleReviewed: (id: string) => void;
  onToggleOpen: () => void;
}) {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const counts = new Map<ChangeKind, number>();
  for (const node of symbols) {
    const kind = tone(node) as ChangeKind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const noun = symbols.every((s) => s.kind === 'rule') ? 'rule' : 'symbol';
  const first = symbols[0];
  return (
    <div
      className={`list-item list-sheet${current ? ' current' : ''}${reviewed ? ' done' : ''}${stale ? ' stale' : ''}`}
    >
      <input
        type="checkbox"
        checked={reviewed}
        onChange={() => onToggleReviewed(stylesheetId(file))}
        aria-label={`Mark ${name} reviewed`}
      />
      <button
        className="list-sheet-toggle"
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} the ${noun}s of ${name}`}
        onClick={onToggleOpen}
      >
        <ChevronIcon open={open} />
      </button>
      <button className="list-link" onClick={() => first && onSelect(first.id)}>
        {plural(symbols.length, noun)}
      </button>
      {CHANGE_KINDS.filter((kind) => counts.has(kind)).map((kind) => (
        <span
          key={kind}
          className={`list-sheet-mark tone-${kind}`}
          role="img"
          aria-label={`${counts.get(kind)} ${kind}`}
        >
          {kindMark(kind)?.glyph ?? <ForwardIcon />}
          {counts.get(kind)}
        </span>
      ))}
      {stale && (
        <span
          className="stale-mark"
          role="img"
          aria-label="Changed since you reviewed it"
          {...tip('Changed since you reviewed it', { tone: 'warn' })}
        >
          ↻
        </span>
      )}
      {comments > 0 && (
        <span className="commented" {...tip('Comments on its rules')}>
          💬 {comments}
        </span>
      )}
    </div>
  );
}

const SEVERITY_ICONS = { error: FailedIcon, warning: AlertIcon, info: HelpIcon } as const;

function FindingRow({
  finding,
  project,
  current,
  onSelect,
}: {
  finding: Finding;
  /** The symbol's project, when the change spans several. */
  project: string | undefined;
  current: boolean;
  onSelect: (id: string) => void;
}) {
  const Icon = SEVERITY_ICONS[finding.severity];
  return (
    <button
      className={`finding-row finding-${finding.severity}${current ? ' current' : ''}`}
      onClick={() => onSelect(finding.symbol)}
    >
      {/* Its severity as an icon and, for a reader, a word (V90, decision 840). */}
      <span className={`finding-icon severity-${finding.severity}`} aria-label={finding.severity}>
        <Icon />
      </span>
      <span className="finding-row-message">{finding.message}</span>
      <span className="finding-row-rule">
        {finding.rule}
        {project && <span className="finding-row-project">{project}</span>}
      </span>
    </button>
  );
}

/**
 * A project's settled signature changes as one row (V100, decision 969): changed compatibly, or
 * with every user updated in this change. A click opens them under it.
 */
function FoldRow({
  count,
  project,
  open,
  onToggle,
}: {
  count: number;
  /** Its project, when the change spans several. */
  project: string | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="finding-row finding-fold"
      aria-expanded={open}
      onClick={onToggle}
      {...tip('Changed compatibly, or every user was updated in this change')}
    >
      <span className="finding-icon">
        <ChevronIcon open={open} />
      </span>
      <span className="finding-row-message">
        {plural(count, 'signature change')}, nothing left to update
      </span>
      <span className="finding-row-rule">
        signature-changed
        {project && <span className="finding-row-project">{project}</span>}
      </span>
    </button>
  );
}
