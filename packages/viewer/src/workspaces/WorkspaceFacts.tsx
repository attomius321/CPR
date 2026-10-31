// What a workspace's heading says, in its panel and on its card in the sidenav: its state as a dot,
// its kind, its branch and review mark, a line of what is next and its facts, and how long its
// state has lasted (V48).
import { useEffect, useState, type ReactNode } from 'react';
import type { BranchMerge, WorkspaceAgentState, WorkspaceSummary } from '@symbiote/core';
import { reviewTip, type ReviewMark } from '../history/branchReviews.js';
import { relativeDate } from '../history/commits.js';
import { GIT_PAGE } from '../shell/pages.js';
import {
  AlertIcon,
  ClaudeMark,
  CodexMark,
  CommitIcon,
  HermesMark,
  HexagonIcon,
  MergeIcon,
  ModelIcon,
  PencilIcon,
} from '../ui/icons.js';
import { longAge, useNow } from './clock.js';
import {
  AGENT_NAMES,
  runsOnWords,
  shortAge,
  workspaceFacts,
  type WorkspaceFact,
  type WorkspaceRow,
} from './workspaces.js';
import { tip } from '../ui/tip.js';

/**
 * Whether a workspace with commits merges into the branch it is reviewed against (V17's check,
 * V65), read once per tip and pick; not at all where it is not shown (`read` false).
 */
function useMergeCheck(workspace: WorkspaceSummary, read = true): BranchMerge | null {
  const [merge, setMerge] = useState<BranchMerge | null>(null);
  const wanted = read && workspace.ahead > 0 && !workspace.merged && workspace.tip !== null;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    fetch(`/api/workspaces/merge?branch=${encodeURIComponent(workspace.branch)}`)
      .then((response) => (response.ok ? (response.json() as Promise<BranchMerge>) : null))
      .then((check) => live && setMerge(check))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [wanted, workspace.branch, workspace.tip, workspace.against]);
  return wanted ? merge : null;
}

/**
 * What is next for a workspace — what its agent runs while it works (V48f), after the agent's mark
 * (V53) — then its facts in words: commits, files not committed, the merge check. On a card the
 * facts are a row of their own (`facts` false, `CardFacts`, V79).
 */
export function WorkspaceState({
  row: { workspace, next },
  facts: withFacts = true,
}: {
  row: WorkspaceRow;
  facts?: boolean;
}) {
  const merge = useMergeCheck(workspace, withFacts);
  const said = next.doing ?? next.text;
  // Only while it works is the line the agent's action; the rest is Symbiote's to say, Hive's too.
  const agent = next.group === 'working' && !next.hive ? (workspace.agent.kind ?? 'claude') : null;
  const facts = withFacts ? workspaceFacts(workspace, merge).map((fact) => fact.words) : [];
  const text = [said, ...facts].join(' · ');
  return (
    <p className="workspace-state" {...tip(agent ? `${AGENT_NAMES[agent]}\n${text}` : text)}>
      {agent === 'codex' ? (
        <CodexMark />
      ) : agent === 'hermes' ? (
        <HermesMark />
      ) : (
        agent && <ClaudeMark />
      )}
      <strong>{said}</strong>
      {facts.map((fact) => (
        <span key={fact}> · {fact}</span>
      ))}
    </p>
  );
}

const FACT_ICONS: Record<WorkspaceFact['kind'], () => ReactNode> = {
  hive: HexagonIcon,
  commits: CommitIcon,
  changed: PencilIcon,
  gone: AlertIcon,
  clean: MergeIcon,
  conflicts: MergeIcon,
};

/**
 * A card's facts (V79): each an icon and a number or a word, named by its words (a capital first)
 * for screen readers and in its tip; the merge check and a worktree gone in their state's colour.
 */
export function CardFacts({ workspace }: { workspace: WorkspaceSummary }) {
  const merge = useMergeCheck(workspace);
  return workspaceFacts(workspace, merge).map(({ kind, shown, words }) => {
    const Icon = FACT_ICONS[kind];
    const named = words.charAt(0).toUpperCase() + words.slice(1);
    return (
      <span
        key={kind}
        className={`card-fact fact-${kind}`}
        role="img"
        aria-label={named}
        {...tip(named)}
      >
        <Icon />
        {shown}
      </span>
    );
  });
}

/**
 * What a workspace's agent runs on (V83): the Model icon (the Start page's), the model and its
 * level in words, and a tip that says whose, as of when, and how it started when that differs. In
 * the head a chip after the kind; on a card (`card`) a row of its own, its words cut to one line.
 */
export function RunsOn({ agent, card = false }: { agent: WorkspaceAgentState; card?: boolean }) {
  const words = runsOnWords(agent);
  if (!words) return null;
  const Tag = card ? 'div' : 'span';
  return (
    <Tag className={card ? 'workspace-runs' : 'runs-on'} {...tip(words.tip)}>
      <ModelIcon />
      <span className="runs-on-words">{words.text}</span>
    </Tag>
  );
}

/** A workspace's kind (V24c), in a chip for every kind (V53); none recorded before V24. */
export function KindTag({ workspace }: { workspace: WorkspaceSummary }) {
  if (!workspace.kind) return null;
  return <span className="kind-tag">{workspace.kind}</span>;
}

/**
 * A workspace's state as a dot (V29b): the colour of its mark on its branch's badges, and its shape
 * (V48): a working agent's halo pulses, a waiting one's holds, a stopped one's dot is a ring.
 */
export function StateDot({ row: { next } }: { row: WorkspaceRow }) {
  return <span className={`state-dot tone-${next.chip.tone}`} aria-hidden="true" />;
}

/**
 * How long a workspace's state has lasted (V48), on its card: "now", "12m", "2h"; else when it
 * was made, as before. Its own component: the page's clock renders it alone.
 */
export function StateAge({ workspace }: { workspace: WorkspaceSummary }) {
  const now = useNow();
  const since = workspace.activity?.since;
  if (!since) {
    return (
      <time className="commit-date" dateTime={workspace.created}>
        {relativeDate(workspace.created, now)}
      </time>
    );
  }
  return (
    <time className="commit-date state-age" dateTime={since} {...tip(`For ${longAge(since, now)}`)}>
      {shortAge(since, now)}
    </time>
  );
}

/** How long its state has lasted, in its panel's heading (V48): " · 12 min"; nothing unknown. */
export function StateFor({ workspace }: { workspace: WorkspaceSummary }) {
  const now = useNow();
  const since = workspace.activity?.since;
  if (!since) return null;
  return (
    <time className="state-for" dateTime={since}>
      {/* Kept by the flex line, which drops a leading space. */}
      {'\u00a0· '}
      {longAge(since, now)}
    </time>
  );
}

/** A workspace's branch (a link to its commits) and its review's mark. */
export function WorkspaceBranch({
  row: { workspace },
  mark,
}: {
  row: WorkspaceRow;
  mark?: ReviewMark | undefined;
}) {
  const { branch } = workspace;
  return (
    <>
      {workspace.tip === null ? (
        <span className="ref ref-branch">{branch}</span>
      ) : (
        <a
          className="ref ref-branch"
          href={`${GIT_PAGE}?branch=${encodeURIComponent(branch)}`}
          {...tip(`${branch}\nIts commits in Git`)}
          onClick={(event) => event.stopPropagation()}
        >
          {branch}
        </a>
      )}
      {mark && (
        <span className={`ref-review ref-review-${mark.tone}`} {...reviewTip(mark)}>
          {mark.mark}
        </span>
      )}
    </>
  );
}
