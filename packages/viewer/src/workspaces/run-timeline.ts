// A Hive workspace's Run tab (V92, decisions 861–866): each round as a timeline — the writer's
// commits and time, the check's commands, the running review — the newest open and the others
// folded to a line; and a stop or a landing in words. Pure: from Hive's detail and the branch's
// commits (each with its lines), as recorded.
import type { HiveCheck, HiveReview, WorkspaceCommit, WorkspaceHiveDetail } from '@symbiote/core';
import { clockWords } from './hive-live.js';
import { costWords } from './hive-rounds.js';

/** A state's tone, as `StatusLabel` and the timeline's marks draw it. */
export type RunTone = 'run' | 'ok' | 'fail' | 'warn';

/** A round's writer: its commits (newest first), their lines, its time, what it did. */
export interface RunWriter {
  words: string;
  commits: WorkspaceCommit[];
  added: number;
  removed: number;
  /** From the round's start to its check's; absent while unknown (a record before 693). */
  ms?: number;
}

/** One round of the Run tab. */
export interface RunRound {
  round: number;
  /** The round Hive is on: open; the others fold to a line. */
  current: boolean;
  status: { text: string; tone: RunTone };
  /** The folded line's words: the first defect proven, else the command that failed. */
  gist?: string;
  /** "check 7:02 · review $0.44". */
  facts: string;
  /** Its span, in ms since the epoch: the writer's start, the last run's end. */
  from?: number;
  to?: number;
  writer: RunWriter;
  /** Its last check and running review. */
  check?: HiveCheck;
  review?: HiveReview;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const kept = (review: HiveReview | undefined) => review?.findings.filter((f) => f.kept) ?? [];
const startOf = (check: HiveCheck | undefined) =>
  check?.started === undefined ? undefined : Date.parse(check.started);

/** When a round's runs ended: its check's start, its time, its review's. */
function endOf(check: HiveCheck | undefined, review: HiveReview | undefined): number | undefined {
  const started = startOf(check);
  if (started === undefined || !check) return undefined;
  return started + check.ms + (review?.ms ?? 0);
}

/** What the writer did in `round`, from what the round before it found. */
function writerWords(round: number, before: { check?: HiveCheck; review?: HiveReview }): string {
  if (round === 1) return 'wrote the goal';
  const proven = kept(before.review).length;
  if (proven > 0) return `fixed the proven ${proven === 1 ? 'defect' : 'defects'}`;
  if (before.check && !before.check.ok) return 'fixed the failing check';
  return 'went on';
}

/** A round's verdict as its status says it. */
function statusOf(
  check: HiveCheck | undefined,
  review: HiveReview | undefined,
  running: boolean,
): RunRound['status'] {
  if (running) return { text: 'In progress', tone: 'run' };
  if (review?.verdict === 'changes') {
    return { text: `${plural(kept(review).length, 'defect')} proven`, tone: 'fail' };
  }
  if (review?.verdict === 'approved') return { text: 'Approved', tone: 'ok' };
  if (check && !check.ok) return { text: 'Check failed', tone: 'fail' };
  if (review?.verdict === 'failed') return { text: 'No answer', tone: 'warn' };
  if (review?.verdict === 'unavailable') return { text: 'Not reviewed', tone: 'warn' };
  if (check?.ok) return { text: 'Check passed', tone: 'ok' };
  return { text: 'Not checked', tone: 'warn' };
}

/** Hive works on the round now: the writer writes, or the check or the review runs. */
const working = (step: WorkspaceHiveDetail['step']) =>
  step === 'writing' || step === 'checking' || step === 'reviewing';

/**
 * The rounds, the newest first: each one's writer (its commits between the round before's checked
 * commit and its own), its last check and review, its status and folded line. `commits` is the
 * branch's, newest first; `created` when the workspace started (round 1's writer starts then).
 */
export function runRounds(
  detail: Pick<WorkspaceHiveDetail, 'step' | 'round' | 'checks' | 'reviews' | 'live'>,
  commits: readonly WorkspaceCommit[],
  created: string,
): RunRound[] {
  const last = Math.max(
    detail.round,
    ...detail.checks.map((c) => c.round),
    ...detail.reviews.map((r) => r.round),
  );
  const index = (sha: string | undefined) =>
    sha === undefined ? -1 : commits.findIndex((c) => c.sha === sha);
  const rounds: RunRound[] = [];
  let before: { check?: HiveCheck; review?: HiveReview } = {};
  let from: number | undefined = Date.parse(created);
  for (let round = 1; round <= last; round++) {
    const check = detail.checks.findLast((c) => c.round === round);
    const review = detail.reviews.findLast((r) => r.round === round);
    const current = round === detail.round;
    // Its commits: newer than the round before's checked commit, up to its own check's.
    const upTo = check ? index(check.at) : 0;
    const after = index(before.check?.at);
    const mine = upTo < 0 ? [] : commits.slice(upTo, after < 0 ? commits.length : after);
    // The check running now in the round Hive is on: the writer's time ends at its start.
    const running = current && detail.live?.kind === 'check' ? detail.live : undefined;
    const started = running ? Date.parse(running.started) : startOf(check);
    const writer: RunWriter = {
      words: writerWords(round, before),
      commits: mine,
      added: mine.reduce((sum, c) => sum + (c.added ?? 0), 0),
      removed: mine.reduce((sum, c) => sum + (c.removed ?? 0), 0),
      ...(from !== undefined && started !== undefined ? { ms: started - from } : {}),
    };
    const proven = kept(review)[0];
    const facts = [
      check ? `check ${clockWords(check.ms)}` : undefined,
      review?.cost !== undefined ? `review ${costWords(review.cost)}` : undefined,
    ].filter((fact): fact is string => fact !== undefined);
    const to = endOf(check, review);
    rounds.push({
      round,
      current,
      status: statusOf(check, review, current && working(detail.step)),
      ...(proven ? { gist: proven.defect } : check?.failed ? { gist: check.failed } : {}),
      facts: facts.join(' · '),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      writer,
      ...(check ? { check } : {}),
      ...(review ? { review } : {}),
    });
    before = { ...(check ? { check } : {}), ...(review ? { review } : {}) };
    from = to;
  }
  return rounds.reverse();
}

/** A finished check's command, as the Run tab lists it. */
export interface CheckRow {
  command: string;
  mark: 'passed' | 'failed' | 'skipped';
  /** "1:51"; "" for a command not run. */
  time: string;
}

/**
 * A finished check's commands (decision 862): each one run with its time, those after a failure
 * not run; a check recorded before its steps (693), only the command that failed.
 */
export function checkRows(check: HiveCheck): CheckRow[] {
  const steps = check.steps ?? [];
  if (steps.length === 0) {
    return check.failed
      ? [{ command: check.failed, mark: 'failed', time: clockWords(check.ms) }]
      : [];
  }
  const ran: CheckRow[] = steps.map((step) => ({
    command: step.command,
    mark: step.ok ? 'passed' : 'failed',
    time: clockWords(step.ms),
  }));
  const rest = (check.commands ?? []).slice(steps.length);
  return [...ran, ...rest.map((command): CheckRow => ({ command, mark: 'skipped', time: '' }))];
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const sentence = (text: string) => capital(text.replace(/[.\s]+$/, '')) + '.';

/** Why Hive stopped a workspace (decision 865): its round cap, its budget, else its note. */
export function stopWords(
  detail: Pick<WorkspaceHiveDetail, 'step' | 'round' | 'rounds' | 'note'>,
): { title: string; why: string } | null {
  if (detail.step !== 'stuck') return null;
  const note = detail.note ?? 'Hive cannot go on';
  if (note.startsWith('its spend reached its budget')) {
    return { title: 'Hive stopped at its budget', why: sentence(note) };
  }
  if (detail.round >= detail.rounds && detail.rounds > 0) {
    return {
      title: `Hive stopped after ${plural(detail.rounds, 'round')}`,
      why: `${sentence(note)} Each failure went back to the writer; at the round cap Hive stops and records why, and changes nothing else.`,
    };
  }
  return { title: 'Hive stopped', why: sentence(note) };
}

const short = (sha: string) => sha.slice(0, 7);

/** Where and how Hive landed a workspace (decision 866); null while it has not. */
export function landedWords(
  detail: Pick<WorkspaceHiveDetail, 'branch' | 'step' | 'landings' | 'request'>,
): { title: string; line: string; at?: string } | null {
  const landing = detail.landings?.findLast((l) => l.outcome === 'landed');
  if (!landing) return null;
  const at = landing.ended ? { at: landing.ended } : {};
  if (landing.via === 'request' && detail.request) {
    const { request } = detail;
    const forge = request.forge === 'github' ? 'GitHub' : 'GitLab';
    const sign = request.forge === 'github' ? '#' : '!';
    return {
      title: `Landed in ${landing.into}`,
      line: `Merged on ${forge} through ${sign}${request.number}`,
      ...at,
    };
  }
  const merge = landing.merge ? ` as ${short(landing.merge)}` : '';
  const pushed = landing.pushed;
  const push = !pushed
    ? ''
    : pushed.ok
      ? `; pushed ${landing.into} and ${detail.branch} to ${pushed.remote}`
      : `; not pushed: ${pushed.error}`;
  return {
    title: `Landed in ${landing.into}`,
    line: `Merged through the merge queue${merge}${push}`,
    ...at,
  };
}
