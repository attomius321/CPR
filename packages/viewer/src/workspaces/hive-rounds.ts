// A Hive workspace's rounds in words (HV3, decision 681): its Review tab's checks and running
// reviews by round, a verdict's and a finding's words, and where its landing is (HV4). Pure.
import type {
  HiveCheck,
  HiveFinding,
  HiveLanding,
  HiveRequest,
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

const FORGES = {
  github: { name: 'GitHub', sign: '#', kind: 'Pull request' },
  gitlab: { name: 'GitLab', sign: '!', kind: 'Merge request' },
} as const;

/** A request as its forge names it (HV8): "#12 on GitHub", "!12 on GitLab". */
export const requestName = (request: Pick<HiveRequest, 'forge' | 'number'>) =>
  `${FORGES[request.forge].sign}${request.number} on ${FORGES[request.forge].name}`;

/** "Pull request" or "Merge request". */
export const requestKind = (request: Pick<HiveRequest, 'forge'>) => FORGES[request.forge].kind;

/**
 * Hive's request merged on its forge, the start branch not brought up yet (HV8, 770, 789): Hive
 * still waits for the person's checkout, in any step. The workspace's `merged` is then Hive's own
 * fetch of `origin`'s branch, not a landing.
 */
export const waitsForCheckout = (request: HiveRequest | undefined): request is HiveRequest =>
  request?.state === 'merged' && !request.pulled?.ok;

/** "Merged on GitHub: main waits for your checkout". */
export const checkoutLine = (request: HiveRequest) =>
  `Merged on ${FORGES[request.forge].name}: ${request.into} waits for your checkout`;

/** A request's state, for the Review tab (HV8). */
export function requestState(request: HiveRequest): {
  text: string;
  tone: 'ok' | 'bad' | 'hive';
} {
  if (request.state === 'merged') return { text: 'Merged', tone: 'ok' };
  if (request.state === 'closed') return { text: 'Closed without a merge', tone: 'bad' };
  if (request.conflict)
    return { text: `Cannot be merged: a conflict with ${request.into}`, tone: 'bad' };
  return { text: 'Open: waiting for your merge', tone: 'hive' };
}

/** What became of Symbiote's graph review on the request (HV8, decision 790). */
export function reviewWords(request: HiveRequest): string {
  const { review } = request;
  const at = 'Symbiote’s review';
  if (!review) return `${at}: not posted yet`;
  if (review.error) return `${at}: not posted: ${review.error}`;
  if (review.posted === 0) return `${at}: no new findings to post`;
  return `${at}: ${plural(review.posted, 'finding')} posted`;
}

/**
 * Where Hive's landing is (HV4, decision 774): "Landing in main: checking the merge"; before its
 * entry is queued, "Hive: landing it". By request (HV8): "Waiting for your merge: #12 on GitHub".
 */
export function landingLine(landing: HiveLanding | undefined, request?: HiveRequest): string {
  if (!landing || landing.outcome) return 'Hive: landing it';
  if (landing.via === 'request' && request) {
    if (request.state === 'merged') return checkoutLine(request);
    return `Waiting for your merge: ${requestName(request)}`;
  }
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

/** A workspace Hive landed (HV4): where, and whether that branch was pushed; by request, where. */
export function landedLine(landing: HiveLanding | undefined, request?: HiveRequest): string {
  if (landing?.outcome !== 'landed') return 'Merged';
  if (landing.via === 'request' && request) {
    const sign = `${FORGES[request.forge].sign}${request.number}`;
    const pulled =
      request.pulled && !request.pulled.ok
        ? ` · ${request.into} not brought up: ${request.pulled.error ?? 'not fetched'}`
        : '';
    return `Landed in ${landing.into} on ${FORGES[request.forge].name} · ${sign}${pulled}`;
  }
  const { pushed } = landing;
  const push = !pushed ? '' : pushed.ok ? ' · pushed' : ` · not pushed: ${pushed.error}`;
  return `Landed in ${landing.into}${push}`;
}

/** A landing that ended, in words (HV4): what became of it. */
export function landingOutcome(landing: HiveLanding, request?: HiveRequest): string {
  const forge = landing.via === 'request' && request ? FORGES[request.forge].name : null;
  switch (landing.outcome) {
    case 'landed':
      return landedLine(landing, request);
    case 'conflict':
      if (forge) {
        const files = landing.files ?? [];
        const n = files.length;
        return n
          ? `Cannot be merged on ${forge}: ${files.join(', ')} conflict${n === 1 ? 's' : ''} with ${landing.into}`
          : `Cannot be merged on ${forge}: a conflict with ${landing.into}`;
      }
      return `Conflicts with ${landing.into}: ${landing.files?.join(', ') ?? ''}`;
    case 'check-failed':
      return `The check failed on the merge: ${landing.failed ?? ''}`;
    case 'cannot-fast-forward':
      return `${landing.into} moved past a fast-forward`;
    case 'diverged':
      return `${landing.into} and its remote have diverged`;
    case 'closed':
      return `Closed on ${forge ?? 'the forge'} without a merge`;
    case undefined:
      return landingLine(landing, request);
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
      return landingLine(detail.landings?.at(-1), detail.request);
    case 'stuck':
      return `Stopped: ${detail.note ?? 'Hive cannot go on'}`;
    case 'answered':
      return 'Answered: read its report';
    default:
      return landedLine(detail.landings?.at(-1), detail.request);
  }
}
