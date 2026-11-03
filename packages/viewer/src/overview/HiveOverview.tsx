// Hive mode's Overview (V91, decisions 856–857; proof `spikes/hive-redesign` 01-overview): five
// figures, the stopped workspaces called out with why, those in flight on their stage tracks,
// landed today, the limits Hive keeps (pacing, budget), today's events.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AgentLevels,
  HiveLandingSetting,
  HivePacingSetting,
  WorkKind,
  WorkspaceDay,
  WorkspaceHive,
} from '@symbiote/core';
import { TurnOffHive } from '../settings/HiveOff.js';
import { runHref } from '../workspaces/tab-address.js';
import { useShell } from '../shell/shell-context.js';
import { AGENT_NAMES as USAGE_AGENTS, shownWindows, usageTone } from '../shell/usage.js';
import { useUsage } from '../shell/useUsage.js';
import { Figure, Gauge } from '../ui/Figures.js';
import { getJson } from '../ui/http.js';
import {
  AnsweredIcon,
  BugIcon,
  ClockIcon,
  CoinsIcon,
  DoneIcon,
  ForwardIcon,
  HexagonIcon,
  MergeIcon,
  PlusIcon,
  RunningIcon,
  SettingsIcon,
  StoppedIcon,
  ChevronIcon,
} from '../ui/icons.js';
import { PageHead } from '../ui/PageHead.js';
import { StageTrack } from '../ui/StageTrack.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { tip } from '../ui/tip.js';
import { useNow, useSecondsWhile } from '../workspaces/clock.js';
import { liveWords } from '../workspaces/hive-live.js';
import { landingLine } from '../workspaces/hive-rounds.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { hiveSteps } from '../workspaces/workspace-steps.js';
import { activityText, modelName, workspaceName } from '../workspaces/workspaces.js';
import { clockOf, isToday } from './day.js';
import { hiveFeed } from './feed.js';
import {
  flightRows,
  hiveFigures,
  landedRows,
  stoppedRows,
  type FlightRow,
  type StoppedRow,
} from './hive-overview.js';
import { Since } from '../workspaces/HeadSteps.js';
import { Empty, Feed, OverviewCard } from './parts.js';
import { useDay } from './useDay.js';
import { dollars, medianFigure, plural, resetsWords, windowName } from './words.js';

/** How many stopped workspaces are called out before "and N more" (decision 857). */
const STOPPED_SHOWN = 3;

/**
 * The running reviewer's model and level (HV3, decision 680): the project's, else Symbiote's
 * default, as Settings reads them (`GET /api/hive/reviewer/efforts`).
 */
export function reviewerWords(levels: AgentLevels | null): string | null {
  if (!levels) return null;
  const agent = levels.agents[0];
  const model = levels.model ?? agent?.defaultModel?.id;
  const effort = levels.effort ?? agent?.efforts?.default;
  if (!model && !effort) return null;
  return [model ? modelName(model) : 'Default model', effort].filter(Boolean).join(' · ');
}

/**
 * Hive's settings the Limits show, read once (Settings changes them; decision 851); Start's in Hive
 * mode too (V92).
 */
export function useHiveSettings() {
  const [pacing, setPacing] = useState<HivePacingSetting | null>(null);
  const [landing, setLanding] = useState<HiveLandingSetting | null>(null);
  const [reviewer, setReviewer] = useState<AgentLevels | null>(null);
  useEffect(() => {
    let live = true;
    getJson<HivePacingSetting>('/api/hive/pacing')
      .then((read) => live && setPacing(read))
      .catch(() => {});
    getJson<HiveLandingSetting>('/api/hive/landing')
      .then((read) => live && setLanding(read))
      .catch(() => {});
    getJson<AgentLevels>('/api/hive/reviewer/efforts')
      .then((read) => live && setReviewer(read))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return { pacing, landing, reviewer };
}

export function HiveOverview() {
  const shell = useShell();
  const state = useWorkspaces();
  const { day, today } = useDay(state);
  const workspaces = useMemo(() => state.list?.workspaces ?? [], [state.list]);
  const { pacing, landing, reviewer } = useHiveSettings();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<WorkKind | 'all'>('all');

  const flight = useMemo(() => flightRows(workspaces, day), [workspaces, day]);
  const stopped = useMemo(() => stoppedRows(workspaces), [workspaces]);
  const landed = useMemo(
    () => landedRows(day, workspaces).filter((row) => isToday(row.at, today)),
    [day, workspaces, today],
  );
  const figures = hiveFigures(workspaces, day, today);
  const feed = hiveFeed(day, workspaces, today);
  const kinds = [
    ...new Set(flight.flatMap((row) => (row.workspace.kind ? [row.workspace.kind] : []))),
  ];
  const shown = kind === 'all' ? flight : flight.filter((row) => row.workspace.kind === kind);
  const into = day?.into ?? 'its start branch';
  const by = landing?.by === 'request' ? 'through a pull request' : 'through the merge queue';
  const timeToLand = medianFigure(figures.timeToLand.medianMs);
  const { byStage } = figures.inFlight;

  return (
    <div className="overview" data-mode="hive">
      <PageHead
        className="overview-head"
        icon={<HexagonIcon />}
        title="Overview"
        line={
          <>
            Hive drives each workspace from its brief to landed · lands in{' '}
            <code className="overview-ref">{into}</code> {by}
          </>
        }
        actions={
          <>
            <TurnOffHive label="Turn off Hive" icon onError={setError} />
            <button
              type="button"
              className="button primary"
              {...tip('Start a workspace: Hive drives it', { keys: 'n' })}
              onClick={() => shell?.startWorkspace()}
            >
              <PlusIcon />
              New goal
            </button>
          </>
        }
      />
      <div className="overview-body">
        {error && (
          <p className="overview-error error" role="alert">
            {error}
          </p>
        )}
        <section className="overview-card figures" aria-label="Figures">
          <Figure
            icon={<RunningIcon />}
            label="In flight"
            value={figures.inFlight.count}
            note={
              figures.inFlight.count === 0
                ? 'nothing in flight'
                : `write ${byStage.write} · check ${byStage.check} · review ${byStage.review} · land ${byStage.land}`
            }
          />
          <Figure
            icon={<MergeIcon />}
            label="Landed today"
            value={figures.landed.today}
            bars={figures.landed.perDay}
            note={
              figures.landed.today === 0
                ? 'none today · 7 days'
                : `${figures.landed.notPushed === 0 ? 'all pushed to origin' : `${figures.landed.notPushed} not pushed`} · 7 days`
            }
          />
          <Figure
            icon={<BugIcon />}
            label="Defects caught"
            value={figures.defects.today}
            note={
              figures.defects.fixed > 0
                ? `proven by failing tests, ${figures.defects.fixed} fixed`
                : 'proven by failing tests'
            }
          />
          <Figure
            icon={<ClockIcon />}
            label="Time to land"
            value={timeToLand.value}
            unit={timeToLand.unit}
            note="brief to landed, today"
          />
          <Figure
            icon={<CoinsIcon />}
            label="Spend today"
            value={day ? dollars(figures.spend.today) : '—'}
            note={
              figures.spend.perLanding !== null
                ? `${dollars(figures.spend.perLanding)} a landing on average`
                : `in ${plural(figures.spend.workspaces, 'workspace')}`
            }
          />
        </section>
        <div className="overview-grid">
          <div className="overview-col">
            {stopped.slice(0, STOPPED_SHOWN).map((row) => (
              <StoppedCard key={row.branch} row={row} />
            ))}
            {stopped.length > STOPPED_SHOWN && (
              <p className="overview-more">
                and {plural(stopped.length - STOPPED_SHOWN, 'more stopped workspace')} in the
                sidenav
              </p>
            )}
            <OverviewCard
              title="In flight"
              count={flight.length}
              className="flight"
              end={
                kinds.length > 1 ? (
                  <select
                    className="overview-kinds"
                    aria-label="Which kinds"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as WorkKind | 'all')}
                  >
                    <option value="all">All kinds</option>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                ) : undefined
              }
            >
              {shown.length === 0 ? (
                <Empty>Nothing in flight. New goal starts one.</Empty>
              ) : (
                <div className="data-table">
                  <div className="table-head" aria-hidden="true">
                    <span>Workspace</span>
                    <span>Stage</span>
                    <span>Round</span>
                    <span className="cell-end">Time</span>
                    <span className="cell-end">Spend</span>
                  </div>
                  {shown.map((row) => (
                    <FlightTableRow key={row.workspace.branch} row={row} />
                  ))}
                </div>
              )}
            </OverviewCard>
            <OverviewCard
              title="Landed today"
              count={landed.length}
              className="landed"
              end={
                <a className="link overview-link" href="/workspace-history">
                  History
                  <ChevronIcon open={false} />
                </a>
              }
            >
              {landed.length === 0 ? (
                <Empty>{day ? 'Nothing landed yet today.' : 'Reading the day…'}</Empty>
              ) : (
                <div className="data-table">
                  <div className="table-head" aria-hidden="true">
                    <span>Workspace</span>
                    <span>Rounds</span>
                    <span>Landed</span>
                    <span className="cell-end">Spend</span>
                    <span className="cell-end">At</span>
                  </div>
                  {landed.map((row) => (
                    <div key={row.branch} className="table-row compact">
                      <span className="cell-line">
                        {row.answered ? <AnsweredIcon /> : <DoneIcon />}
                        <span className="cell-title">{row.title}</span>
                      </span>
                      <span className="cell-muted">
                        {row.answered
                          ? 'Spike · answered'
                          : [
                              plural(row.rounds, 'round'),
                              row.defects > 0 && `${plural(row.defects, 'defect')} caught`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                      </span>
                      <span className="cell-muted">
                        {row.answered ? (
                          'no commits'
                        ) : (
                          <>
                            {row.merge && (
                              <code className="overview-sha">{row.merge.slice(0, 7)}</code>
                            )}{' '}
                            {row.request ??
                              (row.pushed === undefined
                                ? ''
                                : row.pushed
                                  ? 'pushed'
                                  : 'not pushed')}
                          </>
                        )}
                      </span>
                      <span className="cell-num cell-end">{dollars(row.spend)}</span>
                      <span className="cell-muted cell-num cell-end">{clockOf(row.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </OverviewCard>
          </div>
          <div className="overview-col">
            <LimitsCard pacing={pacing} landing={landing} reviewer={reviewer} day={day} />
            <OverviewCard
              title="Events"
              className="events"
              end={
                <a className="link overview-link" href="/workspace-history">
                  History
                  <ChevronIcon open={false} />
                </a>
              }
            >
              <Feed items={feed} empty={day ? 'Nothing yet today.' : 'Reading the day…'} />
            </OverviewCard>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A workspace Hive stopped, called out with why (decision 857). */
function StoppedCard({ row }: { row: StoppedRow }) {
  return (
    <section className="overview-card stopped-card" aria-label={`Stopped: ${row.title}`}>
      <StoppedIcon />
      <div className="stopped-words">
        <div className="cell-line">
          <b className="cell-title">{row.title}</b>
          <StatusLabel tone="error">
            Stopped · {row.round} of {plural(row.rounds, 'round')}
          </StatusLabel>
        </div>
        <p className="stopped-why" {...(row.note ? tip(row.note) : {})}>
          {row.note
            ? `${row.note.charAt(0).toUpperCase()}${row.note.slice(1)}`
            : 'Hive cannot go on'}
        </p>
      </div>
      {/* Its Run tab's address (V92): the shell opens it in place. */}
      <a
        className="button secondary"
        href={runHref(row.branch)}
        {...tip('Its Run tab: each round, what failed')}
      >
        Read why
        <ForwardIcon />
      </a>
    </section>
  );
}

/** Each step in flight in a word, as the proof says it. */
const STEP_WORDS: Partial<Record<WorkspaceHive['step'], string>> = {
  writing: 'Writing',
  checking: 'Checking',
  reviewing: 'Reviewing',
  landing: 'Landing',
};

/** A workspace in flight on its stage track: what runs now, its round, time and spend. */
function FlightTableRow({ row }: { row: FlightRow }) {
  const { workspace, hive, spend } = row;
  const model = hiveSteps(hive);
  const now = useSecondsWhile(hive.live !== undefined);
  const live = liveWords(hive, now || Date.now());
  const doing = workspace.activity?.doing;
  // What runs now, as recorded: the check's command and its time, what the reviewer runs, the
  // writer's tool, the landing's state.
  const detail: ReactNode = live?.detail ? (
    <>
      <code>{live.detail}</code> · {live.time}
    </>
  ) : live ? (
    live.time
  ) : hive.step === 'landing' ? (
    landingLine(hive.landing, hive.request)
  ) : doing && 'tool' in doing ? (
    activityText(doing)
  ) : (
    model.detail
  );
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
      <div className="cell-2">
        <div className="overview-stage">
          <StageTrack steps={model.steps} at={model.at} state={model.mark} />
          <span className={`overview-stage-word stage-${model.tone}`}>
            {live?.head ?? STEP_WORDS[hive.step] ?? model.word}
          </span>
        </div>
        {detail && <span className="cell-sub">{detail}</span>}
      </div>
      <span className="cell-num">
        {hive.round}/{hive.rounds}
      </span>
      <span className="cell-num cell-end">
        <Since since={workspace.created} />
      </span>
      <span className="cell-num cell-end">{spend ? dollars(spend.total) : '—'}</span>
    </div>
  );
}

/** Hive's limits (HV5): usage against where it pauses, the budget, rounds, reviewer, landing. */
function LimitsCard({
  pacing,
  landing,
  reviewer,
  day,
}: {
  pacing: HivePacingSetting | null;
  landing: HiveLandingSetting | null;
  reviewer: AgentLevels | null;
  day: WorkspaceDay | null;
}) {
  const report = useUsage();
  const now = useNow();
  const claude = report?.subscriptions.find((s) => s.agent === 'claude');
  const pauseAt = pacing?.pauseAt;
  // Hive's round cap as its records say it (HV2): no setting holds it.
  const rounds = day?.hive[0]?.rounds;
  const reviewedBy = reviewerWords(reviewer);
  return (
    <OverviewCard
      title="Limits"
      className="limits"
      end={
        <a className="link overview-link" href="/settings">
          <SettingsIcon />
          Settings
        </a>
      }
    >
      {claude ? (
        <div className="overview-usage">
          {shownWindows(claude).map((w) => {
            const name = `${USAGE_AGENTS.claude} usage, ${w.minutes === 300 ? '5 hours' : windowName(w.minutes).toLowerCase()}`;
            const resets = resetsWords(w, now);
            return (
              <div key={w.minutes} className="overview-limit">
                <div className="overview-limit-top">
                  <span>{name}</span>
                  <b>{Math.round(w.usedPercent)}%</b>
                </div>
                <Gauge
                  percent={w.usedPercent}
                  {...(typeof pauseAt === 'number' ? { mark: pauseAt } : {})}
                  tone={usageTone(w.usedPercent, claude.limited, w.warning)}
                  label={`${name}: ${Math.round(w.usedPercent)} % used`}
                />
                <div className="overview-limit-help">
                  <span>
                    {typeof pauseAt === 'number'
                      ? `Hive pauses at ${pauseAt} %`
                      : pauseAt === false
                        ? 'Hive does not pause for usage'
                        : ''}
                  </span>
                  <span>{resets ?? ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>{report?.off ? 'Usage is not read here.' : 'Claude’s usage not read yet.'}</Empty>
      )}
      {pacing?.pause && (
        <p className="overview-paused">
          <StatusLabel tone="info">Paused</StatusLabel> Hive waits for usage before it starts an
          agent
        </p>
      )}
      <dl className="fact-list overview-facts">
        <dt>Budget per workspace</dt>
        <dd>{pacing ? (pacing.budget === null ? 'none' : dollars(pacing.budget)) : '—'}</dd>
        {rounds !== undefined && (
          <>
            <dt>Rounds per workspace</dt>
            <dd>{rounds}</dd>
          </>
        )}
        <dt>Reviewer</dt>
        <dd>{reviewedBy ?? '—'}</dd>
        <dt>Lands by</dt>
        <dd>{landing ? (landing.by === 'request' ? 'Pull request' : 'Merge queue') : '—'}</dd>
      </dl>
    </OverviewCard>
  );
}
