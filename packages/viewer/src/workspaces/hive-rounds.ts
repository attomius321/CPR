// A Hive workspace's rounds in words (HV3, decision 681): its Review tab's checks and running
// reviews by round, a verdict's and a finding's words, and where its landing is (HV4). Pure.
import type {
  HiveCheck,
  HiveFinding,
  HiveLanding,
  HiveReview,
  WorkspaceHiveDetail,
} from '@symbiote/core';

/** One round of the writer's: the checks and running reviews Hive ran on what it committed. */
export interface HiveRound {
  round: number;
  checks: HiveCheck[];
  reviews: HiveReview[];
}

/** The rounds, the newest first, each one's checks and reviews in the order they ran. */
export function hiveRounds(detail: Pick<WorkspaceHiveDetail, 'checks' | 'reviews'>): HiveRound[] {
  const rounds = new Map<number, HiveRound>();
  const of = (round: number) => {
    let found = rounds.get(round);
    if (!found) rounds.set(round, (found = { round, checks: [], reviews: [] }));
    return found;
  };
  for (const check of detail.checks) of(check.round).checks.push(check);
  for (const review of detail.reviews) of(review.round).reviews.push(review);
  return [...rounds.values()].sort((a, b) => b.round - a.round);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A time in words: "12 s", "6 min 40 s", "1 h 5 min". */
export function durationWords(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return s % 60 === 0 ? `${min} min` : `${min} min ${s % 60} s`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** A cost by Claude Code's own count, in dollars at list price: "$0.75". */
export const costWords = (cost: number) => `$${cost.toFixed(2)}`;

/** A review's verdict, as its badge says it, and its tone. */
export function verdictWords(review: HiveReview): { text: string; tone: 'ok' | 'bad' | 'warn' } {
  const kept = review.findings.filter((f) => f.kept).length;
  switch (review.verdict) {
    case 'changes':
      return { text: `${plural(kept, 'defect')} proven`, tone: 'bad' };
    case 'approved':
      return { text: 'Approved', tone: 'ok' };
    case 'failed':
      return { text: 'No answer', tone: 'warn' };
    default:
      return { text: 'Not run', tone: 'warn' };
  }
}

/** What happened to a finding on Symbiote's rerun: kept (proven) or dropped, and why. */
export const findingWords = (finding: HiveFinding) =>
  finding.kept
    ? { text: 'Proven', why: undefined }
    : { text: 'Dropped', why: finding.why ?? 'not rerun' };

/** A check in words: "Passed in 6 min 40 s" or "Failed: `pnpm check`". */
export const checkWords = (check: HiveCheck) =>
  check.ok ? `Passed in ${durationWords(check.ms)}` : `Failed after ${durationWords(check.ms)}`;

/**
 * Where Hive's landing is (HV4, decision 774): "Landing in main: checking the merge"; before its
 * entry is queued, "Hive: landing it".
 */
export function landingLine(landing: HiveLanding | undefined): string {
  if (!landing || landing.outcome) return 'Hive: landing it';
  const at = `Landing in ${landing.into}`;
  switch (landing.state) {
    case 'merging':
      return `${at}: merging`;
    case 'checking':
      return `${at}: checking the merge`;
    case 'ready':
      return `${at}: waiting for your checkout`;
    default:
      return `${at}: queued`;
  }
}

/** A workspace Hive landed (HV4): where, and whether that branch was pushed. */
export function landedLine(landing: HiveLanding | undefined): string {
  if (landing?.outcome !== 'landed') return 'Merged';
  const { pushed } = landing;
  const push = !pushed ? '' : pushed.ok ? ' · pushed' : ` · not pushed: ${pushed.error}`;
  return `Landed in ${landing.into}${push}`;
}

/** A landing that ended, in words (HV4): what became of it. */
export function landingOutcome(landing: HiveLanding): string {
  switch (landing.outcome) {
    case 'landed':
      return landedLine(landing);
    case 'conflict':
      return `Conflicts with ${landing.into}: ${landing.files?.join(', ') ?? ''}`;
    case 'check-failed':
      return `The check failed on the merge: ${landing.failed ?? ''}`;
    case 'cannot-fast-forward':
      return `${landing.into} moved past a fast-forward`;
    case 'diverged':
      return `${landing.into} and its remote have diverged`;
    case undefined:
      return landingLine(landing);
    default:
      return landing.message ?? 'Not landed';
  }
}

/** Where Hive is, for the Review tab's head. */
export function stepWords(detail: WorkspaceHiveDetail): string {
  const round = `round ${detail.round} of ${detail.rounds}`;
  const ended = detail.step === 'landed' || detail.step === 'answered';
  if (!detail.on && !ended && detail.step !== 'landing') {
    return `Hive is off: ${detail.step}, ${round}, waits`;
  }
  switch (detail.step) {
    case 'writing':
      return `The writer's turn, ${round}`;
    case 'checking':
      return `Running the check, ${round}`;
    case 'reviewing':
      return `The running reviewer at work, ${round}`;
    case 'landing':
      if (!detail.on) return 'Hive is off: review and land it as any workspace';
      return landingLine(detail.landings?.at(-1));
    case 'stuck':
      return `Stopped: ${detail.note ?? 'Hive cannot go on'}`;
    case 'answered':
      return 'Answered: read its report';
    default:
      return landedLine(detail.landings?.at(-1));
  }
}
