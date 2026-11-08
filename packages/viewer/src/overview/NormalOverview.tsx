// Normal mode's Overview (V91, decisions 853–855; proof `spikes/normal-redesign` 01-overview): the
// figures, the inbox with one action a workspace, the agents at work, the merges under way,
// merged today, usage, today's events. Each action is the workspace page's or the sidenav card's.
import { useMemo, type ReactNode } from 'react';
import type { MergeEntry } from '@symbiote/core';
import { useShell } from '../shell/shell-context.js';
import { AGENT_NAMES as USAGE_AGENTS, shownWindows, usageTone } from '../shell/usage.js';
import { useUsage } from '../shell/useUsage.js';
import { Figure, Gauge } from '../ui/Figures.js';
import {
  AnsweredIcon,
  BellIcon,
  ClockIcon,
  DoneIcon,
  MergeIcon,
  ModelIcon,
  NucleusIcon,
  OverviewIcon,
  PlusIcon,
  QuestionIcon,
  ReviewIcon,
  RunningIcon,
  SpinIcon,
  ChevronIcon,
  AlertIcon,
} from '../ui/icons.js';
import { hrefOf } from '../shell/pages.js';
import { PageHead } from '../ui/PageHead.js';
import { StageTrack } from '../ui/StageTrack.js';
import { tip } from '../ui/tip.js';
import { useNow } from '../workspaces/clock.js';
import { Since } from '../workspaces/HeadSteps.js';
import { MergeControl } from '../workspaces/MergeControl.js';
import { respondTo } from '../workspaces/respond.js';
import { openReview } from '../workspaces/review-open.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import {
  activityText,
  AGENT_NAMES,
  modelName,
  runsOnWords,
  shortAge,
  workspaceGroups,
  workspaceName,
  type WorkspaceRow,
} from '../workspaces/workspaces.js';
import { clockOf, isToday } from './day.js';
import { normalFeed } from './feed.js';
import {
  findingsOf,
  findingsToRead,
  inbox,
  mergedRows,
  mergeSteps,
  normalFigures,
  type CountedFindings,
  type InboxRow,
} from './normal-overview.js';
import { useFindings } from '../workspaces/useFindings.js';
import { Empty, Feed, OverviewCard } from './parts.js';

/** An agent's short name on a chip: Claude, Codex. */
const USAGE_NAMES: Partial<Record<string, string>> = { claude: 'Claude', codex: 'Codex' };
import { useDay } from './useDay.js';
import { medianFigure, plural, resetsWords, windowName } from './words.js';
import { Loading } from '../ui/Loading.js';

export function NormalOverview() {
  const shell = useShell();
  const state = useWorkspaces();
  const { list, reviews, merges } = state;
  const { day, today } = useDay(state);
  const workspaces = useMemo(() => list?.workspaces ?? [], [list]);
  const queue = useMemo(() => merges?.merges ?? [], [merges]);
  const groups = useMemo(() => workspaceGroups(workspaces, reviews), [workspaces, reviews]);
  const rows = useMemo(() => inbox(groups, queue, reviews), [groups, queue, reviews]);
  // The findings of the changes analyzed in this run (V93, decision 892), by each tip.
  const graphs = useFindings();
  const tips = useMemo(
    () => new Map(workspaces.map((w) => [w.branch, w.tip] as const)),
    [workspaces],
  );
  const toRead = findingsToRead(
    groups.review.map(({ workspace }) => workspace.tip),
    graphs,
  );
  const merged = useMemo(
    () => mergedRows(day, queue, workspaces, reviews),
    [day, queue, workspaces, reviews],
  );
  const figures = normalFigures(rows, groups, merged, day, today);
  const merging = queue.filter((entry) => entry.state !== 'landed');
  const mergedToday = merged.filter((row) => isToday(row.at, today)).reverse();
  const feed = normalFeed(day, queue, merged, workspaces, today);

  const line = [
    rows.length > 0 ? `${plural(rows.length, 'thing')} wait for you` : 'Nothing waits for you',
    `${plural(groups.working.length, 'agent')} at work`,
    `${plural(merging.length, 'merge')} in the queue`,
  ];
  const timeToMerge = medianFigure(figures.timeToMerge.medianMs);

  return (
    <div className="overview" data-mode="normal">
      <PageHead
        className="overview-head"
        icon={<OverviewIcon />}
        title="Overview"
        line={line.join(' · ')}
        actions={
          <>
            <button
              type="button"
              className="button secondary"
              {...tip('Ask Nucleus', { keys: 'a' })}
              onClick={() => shell?.navigate({ page: 'nucleus' })}
            >
              <NucleusIcon />
              Ask Nucleus
            </button>
            <button
              type="button"
              className="button primary"
              {...tip('Start a workspace', { keys: 'n' })}
              onClick={() => shell?.startWorkspace()}
            >
              <PlusIcon />
              Start a workspace
            </button>
          </>
        }
      />
      <div className="overview-body">
        <section className="overview-card figures" aria-label="Figures">
          <Figure
            className={figures.waiting.count > 0 ? 'waiting-for-you' : undefined}
            icon={<BellIcon />}
            label="Waiting for you"
            value={figures.waiting.count}
            note={
              figures.waiting.count === 0
                ? 'nothing to answer or review'
                : [
                    figures.waiting.answers > 0 && plural(figures.waiting.answers, 'answer'),
                    figures.waiting.reviews > 0 && plural(figures.waiting.reviews, 'review'),
                    figures.waiting.merges > 0 && plural(figures.waiting.merges, 'merge'),
                  ]
                    .filter(Boolean)
                    .join(' · ')
            }
          />
          <Figure
            icon={<RunningIcon />}
            label="Agents working"
            value={figures.working.count}
            note={figures.working.agents.join(' · ') || 'none at work'}
          />
          {toRead ? (
            // Proof 01's: the findings of the reviews analyzed in this run, by severity.
            <Figure
              icon={<AlertIcon />}
              label="Findings to read"
              value={toRead.count}
              unit={`in ${plural(toRead.reviews, 'review')}`}
              note={
                <>
                  {toRead.errors > 0 && (
                    <span className="figure-error">{plural(toRead.errors, 'error')}</span>
                  )}
                  {toRead.errors > 0 && toRead.warnings > 0 && ' · '}
                  {toRead.warnings > 0 && (
                    <span className="figure-warning">{plural(toRead.warnings, 'warning')}</span>
                  )}
                  {toRead.count === 0 && 'none found'}
                </>
              }
            />
          ) : (
            <Figure
              icon={<ReviewIcon />}
              label="To review"
              value={figures.toReview.workspaces}
              {...(figures.toReview.commits > 0
                ? { unit: plural(figures.toReview.commits, 'commit') }
                : {})}
              note={
                figures.toReview.sinceReview > 0
                  ? `${plural(figures.toReview.sinceReview, 'commit')} since your review`
                  : 'workspaces with commits'
              }
            />
          )}
          <Figure
            icon={<MergeIcon />}
            label="Merged this week"
            value={figures.merged.week}
            bars={figures.merged.perDay}
            note={
              figures.merged.today > 0
                ? `${figures.merged.today} today, into ${figures.merged.into.join(', ')}`
                : 'none today'
            }
          />
          <Figure
            icon={<ClockIcon />}
            label="Time to merge"
            value={timeToMerge.value}
            unit={timeToMerge.unit}
            note="start to merged, this week"
          />
        </section>
        <div className="overview-grid">
          <div className="overview-col">
            <Inbox rows={rows} graphs={graphs} tips={tips} />
            <OverviewCard title="Agents at work" count={groups.working.length} className="work">
              {groups.working.length === 0 ? (
                <Empty>No agent is at work.</Empty>
              ) : (
                <div className="data-table">
                  {groups.working.map((row) => (
                    <WorkRow key={row.workspace.branch} row={row} />
                  ))}
                </div>
              )}
            </OverviewCard>
            {merging.length > 0 && (
              <OverviewCard
                title="Merging"
                count={merging.length}
                className="merging"
                end={
                  <a
                    className="link overview-link"
                    href={hrefOf({ page: 'merge', branch: merging[0]?.branch ?? '' })}
                  >
                    The queue
                    <ChevronIcon open={false} />
                  </a>
                }
              >
                <div className="data-table">
                  {merging.map((entry) => (
                    <MergingRow key={entry.id} entry={entry} />
                  ))}
                </div>
              </OverviewCard>
            )}
            <OverviewCard
              title="Merged today"
              count={mergedToday.length}
              className="merged"
              end={
                <a className="link overview-link" href="/workspace-history">
                  History
                  <ChevronIcon open={false} />
                </a>
              }
            >
              {mergedToday.length === 0 ? (
                <Empty>
                  {day ? (
                    'Nothing merged yet today.'
                  ) : (
                    <Loading inline>Reading git’s merges…</Loading>
                  )}
                </Empty>
              ) : (
                <div className="data-table">
                  {mergedToday.map((row) => (
                    <div key={row.sha} className="table-row compact">
                      <span className="cell-line">
                        <DoneIcon />
                        <span className="cell-title">{row.title}</span>
                      </span>
                      <span className="cell-muted">
                        {row.by === 'you'
                          ? 'approved by you'
                          : row.by === 'hive'
                            ? 'landed by Hive'
                            : `into ${row.into}`}
                      </span>
                      <span className="cell-muted">
                        <code className="overview-sha">{row.sha.slice(0, 7)}</code>{' '}
                        {row.pushed === undefined ? '' : row.pushed ? 'pushed' : 'not pushed'}
                      </span>
                      <span className="cell-muted cell-num cell-end">{clockOf(row.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </OverviewCard>
          </div>
          <div className="overview-col">
            <UsageCard working={groups.working.length} />
            <OverviewCard
              title="Today"
              className="events"
              end={
                <a className="link overview-link" href="/workspace-history">
                  History
                  <ChevronIcon open={false} />
                </a>
              }
            >
              <Feed
                items={feed}
                empty={day ? 'Nothing yet today.' : <Loading inline>Reading the day…</Loading>}
              />
            </OverviewCard>
          </div>
        </div>
      </div>
    </div>
  );
}

const KIND_ICONS: Record<InboxRow['kind'], () => ReactNode> = {
  plan: BellIcon,
  asks: QuestionIcon,
  review: ReviewIcon,
  approved: ReviewIcon,
  answered: AnsweredIcon,
  merge: MergeIcon,
};

/** A review's findings after its commits (proof 01): errors red, warnings amber; none unknown. */
function FindingWords({ found }: { found: { errors: number; warnings: number } | undefined }) {
  if (!found || found.errors + found.warnings === 0) return null;
  return (
    <span className="need-detail">
      {found.errors > 0 && <span className="figure-error"> · {plural(found.errors, 'error')}</span>}
      {found.warnings > 0 && (
        <span className="figure-warning"> · {plural(found.warnings, 'warning')}</span>
      )}
    </span>
  );
}

/** The inbox (decision 854): each that waits for the person, the oldest first, its one action. */
function Inbox({
  rows,
  graphs,
  tips,
}: {
  rows: readonly InboxRow[];
  /** The kept graphs' findings (decision 892): a review row says its own. */
  graphs: readonly CountedFindings[];
  tips: ReadonlyMap<string, string | null>;
}) {
  const now = useNow();
  return (
    <OverviewCard
      title="Waiting for you"
      count={rows.length}
      className="inbox"
      end={rows.length > 1 ? <span className="overview-end-note">Oldest first</span> : undefined}
    >
      {rows.length === 0 ? (
        <Empty>Nothing waits for you.</Empty>
      ) : (
        <div className="data-table">
          {rows.map((row) => {
            const Icon = KIND_ICONS[row.kind];
            return (
              <div key={row.key} className="table-row" data-kind={row.kind}>
                <div className="cell-2">
                  <span className="cell-title">{row.title}</span>
                  <span className="cell-branch">{row.branch}</span>
                </div>
                <div className="need for-you">
                  <Icon />
                  <b>{row.words}</b>
                  {row.detail && <span className="need-detail">{row.detail}</span>}
                  {row.kind === 'review' && (
                    <FindingWords found={findingsOf(tips.get(row.branch) ?? null, graphs)} />
                  )}
                </div>
                <span className="cell-muted cell-num cell-end">
                  {row.since ? shortAge(row.since, now) : ''}
                </span>
                <span className="cell-end inbox-action">
                  <InboxAction row={row} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </OverviewCard>
  );
}

/** A row's one action: the way the workspace page or the sidenav card already does it. */
function InboxAction({ row }: { row: InboxRow }) {
  const shell = useShell();
  const button = (label: string, run: () => void, about: string) => (
    <button type="button" className="button secondary small" {...tip(about)} onClick={run}>
      {label}
    </button>
  );
  switch (row.action) {
    case 'respond':
      // The sidenav card's Respond: the workspace on its terminal (V48); a plan's Approve plan is
      // there, under the plan (V89).
      return button(
        row.kind === 'plan' ? 'Respond' : 'Answer',
        () => respondTo(row.branch, (route) => shell?.navigate(route)),
        `Answer ${row.title}\nIts terminal, focused`,
      );
    case 'review':
      return button(
        'Review',
        () =>
          void openReview(row.branch).catch((error: unknown) =>
            shell?.notify({ text: (error as Error).message, error: true }),
          ),
        `Review ${row.title}\nIts change, as the workspace's Review opens it`,
      );
    case 'merge':
      // The workspace head's Merge into (V26a): the same control, the same queue.
      return <MergeControl branch={row.branch} />;
    case 'open':
      return button(
        'Open',
        () => shell?.navigate({ page: 'merge', branch: row.branch }),
        `Open the merge of ${row.branch}`,
      );
    case 'read':
      return button(
        'Read',
        () => shell?.navigate({ page: 'workspace', branch: row.branch }),
        `Read ${row.title}'s report`,
      );
  }
}

/** An agent at work: what it does now, its agent and model, how long its turn has run. */
function WorkRow({ row }: { row: WorkspaceRow }) {
  const { workspace } = row;
  const doing = workspace.activity?.doing;
  const subject = doing && 'tool' in doing ? doing.subject : undefined;
  const words = row.next.doing ?? 'Working';
  // "Running" in bold, "pnpm test" in mono: the subject as recorded, when the words end with it.
  const shown = subject && doing && 'tool' in doing ? activityText(doing) : words;
  const verb = subject && shown.endsWith(subject) ? shown.slice(0, -subject.length).trim() : words;
  const runsOn = runsOnWords(workspace.agent);
  // The chip: the agent's short name, then its model when known, else the level it was asked at.
  const { kind, runsOn: read, model, effort } = workspace.agent;
  const on = read?.model ?? model;
  const chip = kind
    ? [USAGE_NAMES[kind] ?? AGENT_NAMES[kind], on ? modelName(on) : (read?.effort ?? effort)]
        .filter(Boolean)
        .join(' · ')
    : null;
  return (
    <div className="table-row">
      <div className="cell-2">
        <a
          className="cell-title link overview-name"
          href={`/?branch=${encodeURIComponent(workspace.branch)}`}
        >
          {workspaceName(workspace)}
        </a>
        <span className="cell-branch">{workspace.branch}</span>
      </div>
      <div className="need">
        <SpinIcon />
        <b className="run-words">{verb}</b>
        {subject && verb !== words && <code className="need-detail">{subject}</code>}
      </div>
      {chip ? (
        <span className="overview-chip" {...(runsOn ? tip(runsOn.tip) : {})}>
          <ModelIcon />
          {chip}
        </span>
      ) : (
        <span />
      )}
      <span className="cell-num cell-end overview-time">
        {workspace.activity?.since ? <Since since={workspace.activity.since} /> : ''}
      </span>
    </div>
  );
}

/** A merge under way on its track: Merge, Check, Land. */
function MergingRow({ entry }: { entry: MergeEntry }) {
  const steps = mergeSteps(entry);
  const tone = steps.mark === 'you' ? 'you' : steps.mark === 'bad' ? 'bad' : 'run';
  return (
    <div className="table-row">
      <div className="cell-2">
        <a
          className="cell-title link overview-name"
          href={`/?merge=${encodeURIComponent(entry.branch)}`}
        >
          {entry.title.replace(/^Merge [^:]+: /, '')}
        </a>
        <span className="cell-branch">
          {entry.branch} → {entry.into}
        </span>
      </div>
      <div className="overview-stage">
        <StageTrack steps={steps.steps} at={steps.at} state={steps.mark} />
        <span className={`overview-stage-word stage-${tone}`}>{steps.word}</span>
        {entry.state === 'checking' && entry.check && (
          <code className="need-detail">{entry.check.commands.join(' && ')}</code>
        )}
      </div>
      <span className="cell-muted">
        {entry.by === 'hive' ? 'approved by Hive' : 'approved by you'}
      </span>
      <span className="cell-num cell-end overview-time">
        <Since since={entry.queued} />
      </span>
    </div>
  );
}

/** Each subscription's windows (V29c's read, shared with the status bar). */
function UsageCard({ working }: { working: number }) {
  const report = useUsage();
  const now = useNow();
  const subscriptions = report?.subscriptions ?? [];
  const first = subscriptions[0];
  return (
    <OverviewCard
      title="Usage"
      className="usage-card"
      end={
        first ? (
          <span className="overview-end-note">
            {[USAGE_AGENTS[first.agent], first.plan].filter(Boolean).join(' ')}
          </span>
        ) : undefined
      }
    >
      {subscriptions.length === 0 ? (
        <Empty>{report?.off ? 'Usage is not read here.' : 'No subscription read yet.'}</Empty>
      ) : (
        <div className="overview-usage">
          {subscriptions.map((subscription, s) =>
            shownWindows(subscription).map((w, i) => {
              const name = windowName(w.minutes);
              const resets = resetsWords(w, now);
              const label =
                subscriptions.length > 1 ? `${USAGE_AGENTS[subscription.agent]}, ${name}` : name;
              return (
                <div key={`${subscription.agent}:${w.minutes}`} className="overview-limit">
                  <div className="overview-limit-top">
                    <span>{label}</span>
                    <b>{Math.round(w.usedPercent)}%</b>
                  </div>
                  <Gauge
                    percent={w.usedPercent}
                    tone={usageTone(w.usedPercent, subscription.limited, w.warning)}
                    label={`${label}: ${Math.round(w.usedPercent)} % used`}
                  />
                  <div className="overview-limit-help">
                    <span>{resets ?? ''}</span>
                    {s === 0 && i === 0 && <span>{plural(working, 'agent')} running</span>}
                  </div>
                </div>
              );
            }),
          )}
        </div>
      )}
    </OverviewCard>
  );
}
