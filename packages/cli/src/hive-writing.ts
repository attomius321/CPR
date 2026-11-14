// Hive's writing step (HV2): the writer started, answered, restarted; its turn's end read.
import { type AgentStateName, worktreeStatus, type WorkspaceSummary } from '@symbiote/core';
import { HIVE_DECIDES, type HiveFile } from './hive-record.js';
import type { ReviewPlace } from './reviews.js';
import type { HiveContext } from './hive-context.js';
import { type HiveRoundSteps, plural, arrived } from './hive-round.js';
import type { HiveCheckSteps } from './hive-checking.js';
import { readActivityEnd } from './thread.js';
import { symbioteFolder } from './workspace-record.js';
import { refusedHosts } from './writer-reach.js';

/** How much of the activity file's end a turn's refused hosts are read from. */
const REFUSED_BYTES = 512_000;

/**
 * The hosts Claude Code's sandbox refused an issue's writer since `since` (decision 1064), as its
 * commands' recorded output names them.
 */
async function refusedSince(where: ReviewPlace, branch: string, since: string): Promise<string[]> {
  const tools = await readActivityEnd(symbioteFolder(where), branch, REFUSED_BYTES).catch(() => []);
  const text = tools
    .filter((t) => t.phase === 'end' && t.at >= since && t.output)
    .map((t) => t.output)
    .join('\n');
  return refusedHosts(text);
}

/** The agent's states with a session at work or done with a turn: whose turns Hive must see. */
const SESSION_STATES: ReadonlySet<AgentStateName> = new Set<AgentStateName>([
  'working',
  'needs-you',
  'plan-ready',
  'ready',
  'done',
]);

/**
 * Whether the writer asks the person (773, 794): it needs the person, and not as an interrupted
 * turn with nothing named. Claude Code lists a session it just resumed as `working` and `idle`
 * for a moment, which reads as an interrupted turn: every message, Hive's or the person's, is
 * sent by a stop and a resume, and that is not the writer asking.
 */
const asks = (agent: WorkspaceSummary['agent']) =>
  agent.state === 'needs-you' && (!agent.interrupted || agent.waitingFor !== undefined);

/** The writing step's functions. */
export function hiveWriting(
  {
    now,
    pacing,
    unseenMs,
    workspaces,
  }: Pick<HiveContext, 'now' | 'pacing' | 'unseenMs' | 'workspaces'>,
  {
    deliver,
    event,
    landingOf,
    leaveTo,
    moveTo,
    nextRound,
    noteSpent,
    paced,
    queue,
    save,
    seen,
    stamp,
    turnOf,
    unseen,
    checking,
  }: Pick<
    HiveRoundSteps,
    | 'deliver'
    | 'event'
    | 'landingOf'
    | 'leaveTo'
    | 'moveTo'
    | 'nextRound'
    | 'noteSpent'
    | 'paced'
    | 'queue'
    | 'save'
    | 'seen'
    | 'stamp'
    | 'turnOf'
    | 'unseen'
  > &
    Pick<HiveCheckSteps, 'checking'>,
) {
  /**
   * A writer the gate held at the workspace's start (HV5): started once the gate lets it, its turn
   * read from then on; not a restart (773). A refused start stops, with why.
   */
  async function startHeld(where: ReviewPlace, given: HiveFile): Promise<void> {
    // Started meanwhile by the person (the page's Start the agent): theirs, held no more.
    const summary = await workspaces.summaryOf(given.branch);
    if (!summary) return;
    const state = summary.agent.state;
    if (SESSION_STATES.has(state) || ['failed', 'stopped', 'not-started'].includes(state)) {
      const theirs: HiveFile = { ...given };
      delete theirs.unstarted;
      delete theirs.paused;
      await save(where, theirs);
      await event(where, given.branch, 'writer-started', { by: 'person' });
      return;
    }
    const record = await paced(where, given);
    if (!record) return;
    const next: HiveFile = { ...record, since: stamp() };
    delete next.unstarted;
    await save(where, next);
    try {
      await workspaces.startAgent(record.branch);
    } catch (error) {
      const note = `its agent could not be started: ${(error as Error).message}`;
      await moveTo(where, next, { step: 'stuck', note }, 'stuck', { note, stop: 'failed' });
      return;
    }
    await event(where, record.branch, 'writer-started');
  }

  /**
   * Hive answers in place of the person (773): a plan gets its OK, a question or a permission "no
   * one answers", the writer's turn stopped to say it; after 3, Hive stops, with why.
   */
  async function answer(
    where: ReviewPlace,
    record: HiveFile,
    key: 'hive.plan' | 'hive.decide',
  ): Promise<void> {
    const decided = (record.decided ?? 0) + 1;
    if (decided > HIVE_DECIDES) {
      const note = `the writer asked for the person ${decided} times: no one answers in Hive mode`;
      const stuck: HiveFile = { ...record, step: 'stuck', since: stamp(), note };
      delete stuck.message;
      await save(where, stuck);
      await event(where, record.branch, 'stuck', { note, stop: 'asked' });
      return;
    }
    const next = await queue(
      where,
      { ...record, decided },
      key,
      {},
      { stop: key === 'hive.decide' },
    );
    await deliver(where, next);
  }

  /** A writer that failed or never started is started again, once (773); then Hive stops. */
  async function restart(
    where: ReviewPlace,
    record: HiveFile,
    summary: WorkspaceSummary,
  ): Promise<void> {
    const why = summary.agent.error?.split('\n')[0];
    if ((record.restarted ?? 0) >= 1) {
      const note = `its agent failed twice${why ? `: ${why}` : ''}`;
      const stuck: HiveFile = { ...record, step: 'stuck', since: stamp(), note };
      delete stuck.message;
      await save(where, stuck);
      await event(where, record.branch, 'stuck', { note, stop: 'failed' });
      return;
    }
    const gated = await paced(where, record);
    if (!gated) return;
    const next: HiveFile = { ...gated, restarted: (gated.restarted ?? 0) + 1, since: stamp() };
    delete next.message;
    await save(where, next);
    await event(where, record.branch, 'restarted', { ...(why ? { why } : {}) });
    try {
      await workspaces.startAgent(record.branch);
    } catch (error) {
      const note = `its agent could not be started again: ${(error as Error).message}`;
      await moveTo(where, next, { step: 'stuck', note }, 'stuck', { note, stop: 'failed' });
    }
  }

  /** The writer's turn (decision 653). */
  async function writing(where: ReviewPlace, given: HiveFile): Promise<void> {
    let record = given;
    if (record.unstarted) return startHeld(where, record);
    const message = record.message;
    if (message && !message.sent && !message.taken) return deliver(where, record);
    const turn = await turnOf(where, record.branch, record.since);
    if (!turn) return;
    const { summary } = turn;
    const landing = await landingOf(record.branch, summary);
    if (landing) return leaveTo(where, record, landing);
    // No gate waits for the person in Hive mode (HV4, decision 773).
    const state = summary.agent.state;
    if (state === 'failed' || state === 'not-started') return restart(where, record, summary);
    if (message?.taken && !message.sent && arrived(turn.thread, message)) {
      record = await seen(where, record, message);
    }
    if (!turn.prompt || turn.prompt.at < record.since) {
      // No prompt since the step began: no turn of it can end where Hive sees it (decision 719),
      // while a session works or has finished. An agent that never started, failed or was stopped
      // says so on its card. An older runner's `sent` (before 718) proved nothing: its time counts.
      const from = message ? (message.taken ?? message.at) : record.since;
      const live = SESSION_STATES.has(summary.agent.state);
      if (live && (message?.copy || now().getTime() - Date.parse(from) >= unseenMs)) {
        return unseen(where, record);
      }
      return;
    }
    if (state === 'plan-ready') return answer(where, record, 'hive.plan');
    if (asks(summary.agent)) return answer(where, record, 'hive.decide');
    if (!turn.ended) return;
    await event(where, record.branch, 'turn-ended', { round: record.round });
    // An issue's writer the sandbox refused a host: stopped, never the host allowed (1064).
    if (summary.issue) {
      const refused = await refusedSince(where, record.branch, record.since);
      if (refused.length > 0) {
        const note = `Claude Code's sandbox refused ${refused.join(', ')}: add it to hive.sandbox.allowedDomains in Settings → Hive if the writer needs it, then start the agent again`;
        return void (await moveTo(where, record, { step: 'stuck', note }, 'stuck', {
          note,
          stop: 'sandbox',
          refused,
        }));
      }
    }
    // Claude Code wrote its count of the session at the turn's end (HV5): kept for the Review tab.
    if (pacing) record = await noteSpent(where, record, await pacing.writer(turn.thread));
    const changed = summary.worktree.changed ?? 0;
    if (changed > 0) {
      const files = await worktreeStatus(summary.worktree.path).catch(() => []);
      const names = files.slice(0, 10).map((f) => f.path);
      const what = `${plural(changed, 'file')} not committed: ${names.join(', ')}${changed > names.length ? ', …' : ''}`;
      return nextRound(
        where,
        record,
        'hive.commit',
        { what, branch: record.branch },
        (rounds) => `${plural(rounds, 'turn')} left work not committed`,
      );
    }
    if (summary.ahead === 0) {
      // A spike's answer is its report: nothing to check (the start prompt says so).
      if (summary.kind === 'spike') {
        return void (await moveTo(where, record, { step: 'answered' }, 'answered', { commits: 0 }));
      }
      return nextRound(
        where,
        record,
        'hive.commit',
        { what: `no commit on ${record.branch}`, branch: record.branch },
        (rounds) => `${plural(rounds, 'turn')} ended with no commit`,
      );
    }
    const next = await moveTo(where, record, { step: 'checking' }, null);
    return checking(where, next, summary);
  }

  return { writing };
}
