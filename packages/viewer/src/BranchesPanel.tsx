import { memo, useMemo, type RefObject } from 'react';
import type { HistoryRefs, HistoryScope } from '@cpr/core';
import { branchTree, type PanelEntry } from './branches.js';
import type { ReviewMark } from './branchReviews.js';
import { FeatureMark } from './FeatureMark.js';
import type { AgentChip } from './features.js';

type BranchEntry = Extract<PanelEntry, { kind: 'branch' }>;

/** `↑2 ↓1`, and what it means. */
function tracking(entry: BranchEntry): { text: string; title: string } | null {
  if (!entry.upstream) return null;
  if (entry.gone) return { text: 'gone', title: `${entry.upstream} was deleted` };
  const parts: string[] = [];
  const says: string[] = [];
  if (entry.ahead) {
    parts.push(`↑${entry.ahead}`);
    says.push(
      `${entry.ahead} commit${entry.ahead === 1 ? '' : 's'} not pushed to ${entry.upstream}`,
    );
  }
  if (entry.behind) {
    parts.push(`↓${entry.behind}`);
    says.push(`${entry.behind} not pulled`);
  }
  return parts.length === 0 ? null : { text: parts.join(' '), title: says.join(', ') };
}

/**
 * The branches panel (V10b): Local and Remotes by folder, a filter on top; a click goes to the
 * branch's tip row. Under 900 px it is shown only while `open` (over the rows).
 */
export const BranchesPanel = memo(function BranchesPanel({
  refs,
  scope,
  current,
  marks,
  agents,
  open,
  filter,
  onFilter,
  toggled,
  onToggle,
  filterRef,
  onGo,
}: {
  /** Null until the branches are listed. */
  refs: HistoryRefs | null;
  scope: HistoryScope;
  current: string | null;
  /** Each reviewed branch's mark, by ref name (V15, V16). */
  marks: ReadonlyMap<string, ReviewMark>;
  /** Each feature's mark by ref name, a link to the feature (V18b). */
  agents: ReadonlyMap<string, AgentChip & { href: string }>;
  open: boolean;
  /** The filter and the folders flipped open or closed: kept by the page across listings. */
  filter: string;
  onFilter: (filter: string) => void;
  toggled: ReadonlySet<string>;
  onToggle: (key: string) => void;
  filterRef: RefObject<HTMLInputElement | null>;
  onGo: (entry: BranchEntry) => void;
}) {
  const entries = useMemo(
    () => (refs ? branchTree(refs, { current, filter, toggled }) : []),
    [refs, current, filter, toggled],
  );
  return (
    <aside className={open ? 'branches open' : 'branches'} aria-label="Branches">
      <input
        ref={filterRef}
        type="text"
        className="branches-filter"
        placeholder="Filter branches"
        aria-label="Filter branches"
        aria-keyshortcuts="/"
        value={filter}
        onChange={(event) => onFilter(event.target.value)}
        onKeyDown={(event) => {
          // Enter goes to the first branch listed: type a few letters, then Enter. (Escape
          // leaves the field, keeping the filter, as everywhere in the viewer.)
          if (event.key !== 'Enter') return;
          const branch = entries.find((e): e is BranchEntry => e.kind === 'branch');
          if (branch && !(branch.row === null && scope === 'all')) onGo(branch);
        }}
      />
      {!refs ? (
        <p className="hint">Listing branches…</p>
      ) : entries.length === 0 ? (
        <p className="hint">{filter ? 'No branch matches' : 'No branches'}</p>
      ) : (
        <ul className="branches-list">
          {entries.map((entry) => {
            // A feature's mark: its own link beside the entry (no link inside a button).
            const agent = entry.kind === 'branch' ? agents.get(entry.name) : undefined;
            return (
              <li key={entry.key} className={agent ? 'has-feature' : undefined}>
                <Entry
                  entry={entry}
                  scope={scope}
                  mark={entry.kind === 'branch' ? marks.get(entry.name) : undefined}
                  onToggle={onToggle}
                  onGo={onGo}
                />
                {agent && <FeatureMark chip={agent} />}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
});

function Entry({
  entry,
  scope,
  mark,
  onToggle,
  onGo,
}: {
  entry: PanelEntry;
  scope: HistoryScope;
  mark: ReviewMark | undefined;
  onToggle: (key: string) => void;
  onGo: (entry: BranchEntry) => void;
}) {
  if (entry.kind === 'section') {
    return (
      <h2 className="branches-section">
        {entry.label} <span className="branches-count">{entry.count}</span>
      </h2>
    );
  }
  const indent = { paddingLeft: 8 + entry.depth * 14 };
  if (entry.kind === 'folder') {
    return (
      <button
        type="button"
        className="branches-folder"
        style={indent}
        aria-expanded={entry.open}
        onClick={() => onToggle(entry.key)}
      >
        <span className="branches-caret" aria-hidden="true">
          {entry.open ? '▾' : '▸'}
        </span>
        <span className="branches-name">{entry.label}/</span>
        <span className="branches-count">{entry.count}</span>
      </button>
    );
  }
  const track = tracking(entry);
  // Under "This branch" a tip not listed is in every branch's history: the click goes there.
  const unlisted = entry.row === null && scope === 'all';
  return (
    <button
      type="button"
      className={`branches-branch${entry.current ? ' current' : ''}${unlisted ? ' unlisted' : ''}`}
      style={indent}
      title={unlisted ? `${entry.name}: its commits are not in this clone's history` : entry.name}
      aria-disabled={unlisted || undefined}
      onClick={() => !unlisted && onGo(entry)}
    >
      {entry.current && (
        <span className="branches-current" aria-label="checked out">
          ●
        </span>
      )}
      <span className="branches-name">{entry.label}</span>
      {mark && (
        <span className={`ref-review ref-review-${mark.tone}`} title={mark.title}>
          {mark.mark}
        </span>
      )}
      {track && (
        <span className={entry.gone ? 'branches-track gone' : 'branches-track'} title={track.title}>
          {track.text}
        </span>
      )}
    </button>
  );
}
