// A Hive workspace's rounds in words (HV3, decision 681): its Review tab's checks and running
// reviews by round, a verdict's and a finding's words, and what landing asks. Pure.
import type {
  HiveCheck,
  HiveFinding,
  HiveReview,
  WorkspaceHive,
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
 * What landing asks while Hive is on (HV3): Land, after what Hive did — checked and reviewed, or
 * not reviewed (no sandbox, the reviewer failed twice), or no check found.
 */
export function landingWords(hive: Pick<WorkspaceHive, 'note' | 'review'>): string {
  const note = hive.note ?? '';
  if (note.startsWith('not reviewed') || note.startsWith('the running review failed')) {
    return 'Not reviewed: look, then land it';
  }
  if (note) return 'No check ran: check, then land it';
  if (hive.review?.verdict === 'approved') return 'Checked and reviewed: land it';
  return 'Checked: land it';
}

/** Where Hive is, for the Review tab's head. */
export function stepWords(detail: WorkspaceHiveDetail): string {
  const round = `round ${detail.round} of ${detail.rounds}`;
  if (!detail.on && detail.step !== 'landed' && detail.step !== 'landing') {
    return `Hive is off: ${detail.step}, ${round}, waits`;
  }
  switch (detail.step) {
    case 'writing':
      return `The writer's turn, ${round}`;
    case 'checking':
      return `Running the check, ${round}`;
    case 'reviewing':
      return `The running reviewer at work, ${round}`;
    case 'landing': {
      if (!detail.on) return 'Hive is off: review and land it as any workspace';
      const last = detail.reviews.at(-1);
      return landingWords({
        ...(detail.note ? { note: detail.note } : {}),
        ...(last
          ? {
              review: {
                round: last.round,
                at: last.at,
                verdict: last.verdict,
                kept: last.findings.filter((f) => f.kept).length,
              },
            }
          : {}),
      });
    }
    case 'stuck':
      return `Hive stopped: ${detail.note ?? 'it needs you'}`;
    default:
      return 'Landed';
  }
}
