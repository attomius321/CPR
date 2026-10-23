import type { Finding, Graph, GraphNode, Project } from '@symbiote/core';
import type { ReactNode } from 'react';
import { groupOf, label, tone } from '../graph/flow.js';
import { pathInProject, projectOf } from '../graph/projects.js';
import { byProject, type FileChanges } from './review.js';
import { ReviewTab, type ReviewProps } from './ReviewTab.js';
import { ChevronIcon, CloseIcon } from '../ui/icons.js';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

export type SidebarTab = 'changes' | 'findings' | 'review';

interface Props {
  graph: Graph;
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
}

/**
 * The review checklist (changed symbols by file, by project when they span several), the
 * findings and, under `symbiote pr`, the review to post, in tabs.
 */
export function Sidebar({
  graph,
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
}: Props) {
  const commented = new Map<string, number>();
  for (const d of review?.draft.drafts ?? []) {
    commented.set(d.symbol, (commented.get(d.symbol) ?? 0) + 1);
  }
  const total = changes.reduce((n, f) => n + f.symbols.length, 0);
  const matches = shown.reduce((n, f) => n + f.symbols.length, 0);
  const done = changes.reduce((n, f) => n + f.symbols.filter((s) => reviewed.has(s.id)).length, 0);
  const findings = [...graph.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
  // By project only when the changes span two or more.
  const grouped = changes.some((f) => f.project);
  const progress = new Map<string, { done: number; total: number }>();
  for (const { project: of, symbols } of changes) {
    if (!of) continue;
    const entry = progress.get(of.folder) ?? { done: 0, total: 0 };
    entry.total += symbols.length;
    entry.done += symbols.filter((s) => reviewed.has(s.id)).length;
    progress.set(of.folder, entry);
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

  const fileList = (files: FileChanges[], of?: Project) =>
    files.map(({ file, symbols }) => (
      <div key={file} className="list-file">
        <div className="list-file-name" title={file}>
          {of ? pathInProject(file, of) : file}
        </div>
        {symbols.map((node) => (
          <ChangeItem
            key={node.id}
            node={node}
            current={node.id === selected}
            reviewed={reviewed.has(node.id)}
            stale={stale.has(node.id)}
            comments={commented.get(node.id)}
            onSelect={onSelect}
            onToggleReviewed={onToggleReviewed}
          />
        ))}
      </div>
    ));

  return (
    <nav className="sidebar" aria-label="Review">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
          Changes{' '}
          <span className="count">
            {done}/{total}
          </span>
        </button>
        <button role="tab" aria-selected={tab === 'findings'} onClick={() => setTab('findings')}>
          Findings <span className="count">{graph.findings.length}</span>
        </button>
        {review && (
          <button role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>
            Review <span className="count">{review.draft.drafts.length}</span>
          </button>
        )}
      </div>
      <div className="progress" aria-label={`${done} of ${total} reviewed`}>
        <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
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
                          title={of.folder === '' ? 'repository root' : of.folder}
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
                        <span className="list-project-progress" title={`${ok} of ${all} reviewed`}>
                          {ok}/{all}
                        </span>
                        <button
                          className="list-project-only"
                          aria-pressed={project === of.folder}
                          onClick={() => onProject(project === of.folder ? null : of.folder)}
                          title={
                            project === of.folder
                              ? 'Show all projects (p)'
                              : `Show only ${of.name} and what it is linked to (p)`
                          }
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
        <ReviewTab graph={graph} review={review} onSelect={onSelect} canOpen={canOpen} />
      ) : (
        <div className="list">
          {findings.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              project={projectName(finding.symbol)}
              current={finding.symbol === selected}
              onSelect={onSelect}
            />
          ))}
          {findings.length === 0 && <p className="muted pad">No findings.</p>}
        </div>
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
}: {
  grouped: boolean;
  review: boolean;
  canOpen: boolean;
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

/** A changed symbol in the list: its reviewed box, its name, and marks. */
function ChangeItem({
  node,
  current,
  reviewed,
  stale,
  comments,
  onSelect,
  onToggleReviewed,
}: {
  node: GraphNode;
  current: boolean;
  reviewed: boolean;
  stale: boolean;
  comments: number | undefined;
  onSelect: (id: string) => void;
  onToggleReviewed: (id: string) => void;
}) {
  return (
    <div
      className={`list-item tone-${tone(node)}${current ? ' current' : ''}${reviewed ? ' done' : ''}${stale ? ' stale' : ''}`}
    >
      <input
        type="checkbox"
        checked={reviewed}
        onChange={() => onToggleReviewed(node.id)}
        aria-label={`Mark ${label(node)} reviewed`}
      />
      <button className="list-link" onClick={() => onSelect(node.id)}>
        <span className="dot" />
        {label(node)}
      </button>
      {stale && (
        <span className="stale-mark" title="Changed since you reviewed it">
          ↻
        </span>
      )}
      {comments !== undefined && (
        <span className="commented" title="Comments on this symbol">
          💬 {comments}
        </span>
      )}
    </div>
  );
}

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
  return (
    <button
      className={`finding-row finding-${finding.severity}${current ? ' current' : ''}`}
      onClick={() => onSelect(finding.symbol)}
    >
      <span className={`badge badge-${finding.severity}`}>{finding.severity}</span>
      <span className="finding-row-rule">
        {finding.rule}
        {project && <span className="finding-row-project">{project}</span>}
      </span>
      <span className="finding-row-message">{finding.message}</span>
    </button>
  );
}
