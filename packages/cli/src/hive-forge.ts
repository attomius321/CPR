// Hive's landing by request (HV8): the pull or merge request opened and reviewed, and the one
// gate that reads it on the forge until the person merges or closes it.
import {
  mergeBase,
  type HiveLanding,
  type HiveRequest,
  type WorkspaceSummary,
} from '@symbiote/core';
import type { ChangeRequest, Forge } from '@symbiote/forge';
import { readHive, type HiveFile } from './hive-record.js';
import {
  bringUp,
  conflictFiles,
  FORGE_WORDS,
  requestBody,
  type HiveRequests,
} from './hive-request.js';
import type { ReviewPlace } from './reviews.js';
import type { GateSeen, HiveContext } from './hive-context.js';
import { awaiting, type HiveRoundSteps, plural, short } from './hive-round.js';

/** What Hive's approval says it rests on: the check, the review, what did not run (767). */
export function approvalOf(record: HiveFile, tip: string): string {
  const check = record.checks.findLast((c) => c.at === tip && c.ok);
  const review = record.reviews.findLast((r) => r.at === tip);
  const checked = check
    ? `checked (${plural(check.commands?.length ?? 1, 'command')}, round ${check.round})`
    : 'not checked: no check is set or found';
  const reviewed =
    review?.verdict === 'approved'
      ? `reviewed (approved, round ${review.round})`
      : `not reviewed${record.note && record.note !== 'no check is set or found' ? `: ${record.note.replace(/^not reviewed: /, '')}` : ''}`;
  return `Approved by Hive at ${short(tip)}: ${checked}; ${reviewed}.`;
}

/** Times Hive posts its graph review on a commit before it gives up on it (790). */
const REVIEW_TRIES = 3;

/** "pull request #12" or "merge request !12", for the notes a person reads (HV8). */
export const requestWords = (request: Pick<HiveRequest, 'forge' | 'number'>) => {
  const words = FORGE_WORDS[request.forge];
  return `${words.request} ${words.sign}${request.number}`;
};

/** The forge step's functions. */
export function hiveForge(
  ctx: Pick<
    HiveContext,
    'checks' | 'closed' | 'lander' | 'now' | 'repo' | 'requestPollMs' | 'reviews' | 'workspaces'
  >,
  {
    event,
    landingFailed,
    moveTo,
    save,
    stamp,
  }: Pick<HiveRoundSteps, 'event' | 'landingFailed' | 'moveTo' | 'save' | 'stamp'>,
) {
  const { checks, lander, now, repo, requestPollMs, reviews, workspaces } = ctx;
  /**
   * Opens the branch's pull or merge request into `into` (HV8, decisions 788, 790), or updates the
   * one open; ready, its description the brief and what ran; then Symbiote's graph review on it.
   * Recorded as a landing attempt that waits for the person's merge on the forge.
   */
  async function openRequest(
    where: ReviewPlace,
    branch: string,
    summary: WorkspaceSummary,
    {
      into,
      tip,
      forge,
      requests,
      seen,
    }: {
      into: string;
      tip: string;
      forge: Forge;
      requests: HiveRequests;
      /** The recorded request as the gate just read it, open. */
      seen: ChangeRequest | undefined;
    },
  ): Promise<void> {
    const record = await readHive(where, branch);
    if (!record || ctx.closed) return;
    const prior = record.request;
    const stop = async (note: string) =>
      void (await moveTo(where, record, { step: 'stuck', note }, 'stuck', { note }));
    if (prior?.state === 'closed')
      return stop(`its ${requestWords(prior)} was closed without a merge`);
    // Never a new request while the record holds one not seen closed: only the one the gate read
    // open is updated; a merged one is the gate's to land.
    if (prior && (prior.state !== 'open' || seen?.number !== prior.number)) return;
    const words = FORGE_WORDS[forge.kind];
    const body = requestBody(record, {
      brief: summary.brief,
      approval: approvalOf(record, tip),
      kind: forge.kind,
    });
    let request;
    let opened = false;
    try {
      request = prior ? seen : await forge.findOpenRequest(branch, into);
      if (request) {
        await forge.updateDescription(request, body);
      } else {
        request = await forge.openChangeRequest({
          head: branch,
          base: into,
          title: summary.title ?? branch,
          body,
        });
        opened = true;
      }
    } catch (error) {
      return stop(
        `the ${words.request} could not be opened on ${words.name}: ${(error as Error).message}`,
      );
    }
    const fresh = (await readHive(where, branch)) ?? record;
    const same = prior?.number === request.number && prior.state === 'open';
    const kept: HiveRequest = {
      forge: forge.kind,
      number: request.number,
      url: request.url,
      into,
      at: tip,
      opened: same ? prior.opened : stamp(),
      state: 'open',
      read: stamp(),
      ...(same && prior.review ? { review: prior.review } : {}),
    };
    const attempt: HiveLanding = {
      round: fresh.round,
      at: tip,
      into,
      entry: `${words.sign}${request.number}`,
      queued: stamp(),
      via: 'request',
    };
    // Written meanwhile (a gate's read, a merge): a request on record not seen closed is never
    // replaced by another; its attempt is replaced only by its own.
    const held = fresh.request;
    if (held && held.state !== 'closed' && held.number !== request.number) return;
    const last = fresh.landings?.at(-1);
    const earlier =
      last?.via === 'request' && !last.outcome && last.entry === attempt.entry
        ? (fresh.landings ?? []).slice(0, -1)
        : (fresh.landings ?? []);
    await save(where, { ...fresh, request: kept, landings: [...earlier, attempt] });
    await event(where, branch, opened ? 'request-opened' : 'request-updated', {
      into,
      commit: tip,
      number: request.number,
      url: request.url,
    });
    await reviewRequest(where, branch, forge, requests, request);
  }

  /**
   * Symbiote's graph review on the request (decision 790), once a commit: its new findings posted
   * as a comment review; a failure recorded and tried again at the next reads, 3 times at most.
   */
  async function reviewRequest(
    where: ReviewPlace,
    branch: string,
    forge: Forge,
    requests: HiveRequests,
    read: ChangeRequest,
  ): Promise<void> {
    const record = await readHive(where, branch);
    const request = record?.request;
    if (!record || !request || request.state !== 'open' || ctx.closed) return;
    const before = request.review?.at === request.at ? request.review : undefined;
    if (before && (!before.error || (before.tries ?? 1) >= REVIEW_TRIES)) return;
    const tries = (before?.tries ?? 0) + 1;
    let review: NonNullable<HiveRequest['review']>;
    try {
      const base = (await mergeBase(repo, request.into, request.at)) ?? request.into;
      const posted = await requests.review(forge, read, base, request.at);
      review = {
        at: request.at,
        posted: posted.posted,
        ...(posted.url ? { url: posted.url } : {}),
      };
    } catch (error) {
      review = { at: request.at, posted: 0, error: (error as Error).message, tries };
    }
    const fresh = (await readHive(where, branch)) ?? record;
    if (!fresh.request || fresh.request.number !== request.number) return;
    await save(where, { ...fresh, request: { ...fresh.request, review } });
    await event(where, branch, review.error ? 'request-review-failed' : 'request-reviewed', {
      posted: review.posted,
      ...(review.error ? { error: review.error } : {}),
    });
  }

  /**
   * A branch merged into the start branch outside its open request (717: a merge of the person's
   * is theirs): the request no longer awaited, its landing attempt ended as landed, saying so. The
   * request itself stays open on the forge; `unread`: the forge could not say.
   */
  function landedOutside(record: HiveFile, unread?: string): HiveFile {
    const request = record.request;
    if (!request || request.state !== 'open') return record;
    const words = FORGE_WORDS[request.forge];
    const said = unread
      ? `merged into ${request.into}; its ${requestWords(request)} could not be read on ${words.name}: ${unread}`
      : `merged into ${request.into} outside its ${requestWords(request)}, which stays open on ${words.name}`;
    const last = record.landings?.at(-1);
    const after: HiveFile = { ...record };
    delete after.request;
    if (last?.via === 'request' && !last.outcome) {
      const done: HiveLanding = { ...last, outcome: 'landed', ended: stamp(), message: said };
      delete done.state;
      after.landings = [...(record.landings ?? []).slice(0, -1), done];
    }
    return after;
  }

  /** Whether the request is due a read (791). */
  const dueRead = (request: HiveRequest) =>
    !request.read || now().getTime() - Date.parse(request.read) >= requestPollMs;

  /** A check or review still running ends: the branch landed (717). */
  function stopRunning(branch: string): void {
    const running = checks.get(branch);
    if (running && !running.stopped) {
      running.stopped = 'merged';
      running.run.kill();
    }
    const reviewing = reviews.get(branch);
    if (reviewing && !reviewing.stopped) {
      reviewing.stopped = 'merged';
      reviewing.run.stop();
    }
  }

  /**
   * The one gate to the forge for a request Hive waits on (HV8, decisions 789, 791): every read of
   * it, and every fetch of the start branch after its merge, goes through here, at most once a
   * `requestPollMs` (its `read`, stamped before anything else). Reached from the landing step, the
   * watch in each other step, a branch merged into the start branch (`leaveTo`, `landing`), and
   * the person's checkout in the way. What it finds:
   * - merged before, its start branch's fast-forward refused: the fetch and fast-forward again;
   * - merged on the forge: landed by its request, the start branch brought up;
   * - closed: stopped at landing;
   * - open, its branch in the start branch already: merged outside it, landed (717);
   * - open and cannot merge, at landing: back to the writer (769);
   * - open: its graph review posted if it is not yet.
   * A failed read is recorded and tried again when due; with the branch merged already, it lands,
   * saying the forge could not be read.
   */
  async function watchRequest(
    where: ReviewPlace,
    given: HiveFile,
    known?: WorkspaceSummary,
    { landing = false }: { landing?: boolean } = {},
  ): Promise<GateSeen> {
    const requests = lander?.requests;
    if (!requests || ctx.closed || !awaiting(given.request)) return { seen: 'none' };
    if (!dueRead(given.request)) return { seen: 'not-due' };
    const record = (await readHive(where, given.branch)) ?? given;
    const request = record.request;
    if (!awaiting(request)) return { seen: 'none' };
    if (!dueRead(request)) return { seen: 'not-due' };
    // Its read stamped first: whatever follows, the next waits its turn.
    const stamped: HiveFile = { ...record, request: { ...request, read: stamp() } };
    await save(where, stamped);
    const ended = (done: Promise<void>) => done.then((): GateSeen => ({ seen: 'ended' }));
    if (request.state === 'merged') return ended(mergedOnForge(where, stamped, request.merge));
    const merged = async () =>
      (known ?? (await workspaces.summaryOf(record.branch).catch(() => null)))?.merged ?? false;
    const outside = async (unread?: string) => {
      stopRunning(record.branch);
      await moveTo(
        where,
        landedOutside(stamped, unread),
        {
          step: 'landed',
          message: undefined,
          check: undefined,
          review: undefined,
          note: undefined,
        },
        'landed',
        { into: request.into, outside: true },
      );
    };
    const failed = async (error: string): Promise<GateSeen> => {
      if (await merged()) return ended(outside(error));
      const fresh = (await readHive(where, record.branch)) ?? stamped;
      if (fresh.request) await save(where, { ...fresh, request: { ...fresh.request, error } });
      return { seen: 'failed' };
    };
    const found = await requests.forge();
    if ('why' in found) return failed(found.why);
    let read: ChangeRequest;
    try {
      read = await found.forge.getChangeRequest(request.number);
    } catch (error) {
      return failed((error as Error).message);
    }
    if (read.state === 'merged') return ended(mergedOnForge(where, stamped, read.mergeCommit));
    if (read.state === 'closed') return ended(closedOnForge(where, stamped));
    if (await merged()) return ended(outside());
    const last = stamped.landings?.at(-1);
    // At a landing the request is about to be updated with a newer commit: its conflict or review
    // is of the commit it shows now, read again once it has the new one.
    const waiting =
      !landing && stamped.step === 'landing' && last?.via === 'request' && !last.outcome;
    if (waiting && read.conflict && read.head.sha === request.at && last) {
      return ended(conflictOnForge(where, stamped, last));
    }
    const fresh = (await readHive(where, record.branch)) ?? stamped;
    if (fresh.request) {
      const now: HiveRequest = { ...fresh.request };
      delete now.error;
      if (read.conflict) now.conflict = true;
      else delete now.conflict;
      await save(where, { ...fresh, request: now });
    }
    if (waiting) await reviewRequest(where, record.branch, found.forge, requests, read);
    return { seen: 'open', read };
  }

  /**
   * Merged on the forge: the start branch fetched and fast-forwarded (770); the person's checkout
   * in the way, tried again at the gate's next turn (`watchRequest`); else landed — diverged, too:
   * the forge merged it. Called only by the gate.
   */
  async function mergedOnForge(where: ReviewPlace, record: HiveFile, merge?: string) {
    const request = record.request;
    if (!request) return;
    const result = await bringUp(repo, request.into);
    const pulled = {
      at: stamp(),
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
    };
    const now: HiveRequest = {
      ...request,
      state: 'merged',
      ...(merge ? { merge } : {}),
      pulled,
    };
    delete now.conflict;
    delete now.error;
    const last = record.landings?.at(-1);
    const open = last?.via === 'request' && !last.outcome ? last : undefined;
    if (!result.ok && result.refused) {
      const landings = open
        ? [
            ...(record.landings ?? []).slice(0, -1),
            { ...open, state: 'ready' as const, message: result.error },
          ]
        : record.landings;
      await save(where, { ...record, request: now, ...(landings ? { landings } : {}) });
      if (request.state !== 'merged') {
        await event(where, record.branch, 'request-merged', { pulled: false, error: result.error });
      }
      return;
    }
    const done: HiveLanding | undefined = open
      ? { ...open, outcome: 'landed', ended: stamp(), ...(merge ? { merge } : {}) }
      : undefined;
    if (done) {
      delete done.state;
      delete done.message;
    }
    const landings = done ? [...(record.landings ?? []).slice(0, -1), done] : record.landings;
    stopRunning(record.branch);
    await moveTo(
      where,
      { ...record, request: now, ...(landings ? { landings } : {}) },
      { step: 'landed', message: undefined, check: undefined, review: undefined, note: undefined },
      'landed',
      {
        into: request.into,
        request: request.number,
        ...(merge ? { merge } : {}),
        pulled: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      },
    );
  }

  /** Closed without a merge (789): stopped at landing, with why; at other steps, at the next one. */
  async function closedOnForge(where: ReviewPlace, record: HiveFile) {
    const request = record.request;
    if (!request) return;
    const now: HiveRequest = { ...request, state: 'closed' };
    delete now.error;
    delete now.conflict;
    const last = record.landings?.at(-1);
    const landings =
      last?.via === 'request' && !last.outcome
        ? [
            ...(record.landings ?? []).slice(0, -1),
            { ...last, outcome: 'closed' as const, ended: stamp() },
          ]
        : record.landings;
    const after: HiveFile = { ...record, request: now, ...(landings ? { landings } : {}) };
    await event(where, record.branch, 'request-closed', { number: request.number });
    if (record.step !== 'landing') return save(where, after);
    const note = `its ${requestWords(request)} was closed without a merge`;
    await moveTo(where, after, { step: 'stuck', note }, 'stuck', { note });
  }

  /**
   * The forge cannot merge it (789, as 769): the start branch brought up to the forge's, the files
   * found locally, `hive.land` to the writer; the request stays open and updates on the next push.
   */
  async function conflictOnForge(where: ReviewPlace, record: HiveFile, last: HiveLanding) {
    const request = record.request;
    if (!request) return;
    await bringUp(repo, request.into);
    const files = await conflictFiles(repo, request.into, request.at);
    const words = FORGE_WORDS[request.forge];
    const n = files.length;
    const what = n
      ? `${files.join(', ')} conflict${n === 1 ? 's' : ''} with ${request.into}`
      : `it conflicts with ${request.into}`;
    const why = `its ${requestWords(request)} cannot be merged on ${words.name}: ${what}.`;
    const done: HiveLanding = {
      ...last,
      outcome: 'conflict',
      ended: stamp(),
      ...(n ? { files } : {}),
      message: why,
    };
    const now: HiveRequest = { ...request, conflict: true };
    delete now.error;
    const after: HiveFile = {
      ...record,
      request: now,
      landings: [...(record.landings ?? []).slice(0, -1), done],
    };
    return landingFailed(where, after, done, { outcome: 'conflict', why });
  }

  return { openRequest, watchRequest };
}

export type HiveForgeSteps = ReturnType<typeof hiveForge>;
