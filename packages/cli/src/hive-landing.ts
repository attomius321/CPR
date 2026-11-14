// Hive's landing step (HV4): its approval and the merge queue, waiting for a merge, the queue's
// end followed.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MergeState, HiveLanding, MergeEntry, WorkspaceSummary } from '@symbiote/core';
import type { ChangeRequest, Forge } from '@symbiote/forge';
import { readHive, type HiveFile } from './hive-record.js';
import { hiveLogId, hiveLogPath } from './hive-live.js';
import type { ReviewPlace } from './reviews.js';
import type { HiveContext } from './hive-context.js';
import { awaiting, type HiveRoundSteps, lastLines, QUEUED } from './hive-round.js';
import type { HiveCheckSteps } from './hive-checking.js';
import { requestWords, type HiveForgeSteps, approvalOf } from './hive-forge.js';

/** The merge queue's states while a merge runs or waits its turn. */
const MERGING: ReadonlySet<MergeState> = new Set<MergeState>([
  'queued',
  'merging',
  'resolving',
  'checking',
]);

/** What failed, for the writer: the files, or the command and its last lines. */
function whyOf(landing: HiveLanding, into: string): string {
  if (landing.files?.length) {
    const n = landing.files.length;
    return `${landing.files.join(', ')} conflict${n === 1 ? 's' : ''} with ${into}.`;
  }
  if (landing.failed) {
    return `the check failed on the merge: \`${landing.failed}\`. Its last lines:\n\n\`\`\`\n${landing.output ?? ''}\n\`\`\``;
  }
  return `${landing.message ?? 'the merge failed'}.`;
}

/** The landing step's functions. */
export function hiveLand(
  ctx: Pick<
    HiveContext,
    'cacheDir' | 'closed' | 'landRetryMs' | 'lander' | 'merges' | 'now' | 'repo' | 'workspaces'
  >,
  {
    act,
    event,
    landingFailed,
    landingOf,
    leaveTo,
    moveTo,
    pushOut,
    roundsAgain,
    save,
    stamp,
    turnOf,
    checking,
    openRequest,
    watchRequest,
  }: Pick<
    HiveRoundSteps,
    | 'act'
    | 'event'
    | 'landingFailed'
    | 'landingOf'
    | 'leaveTo'
    | 'moveTo'
    | 'pushOut'
    | 'roundsAgain'
    | 'save'
    | 'stamp'
    | 'turnOf'
  > &
    Pick<HiveCheckSteps, 'checking'> &
    Pick<HiveForgeSteps, 'openRequest' | 'watchRequest'>,
) {
  const { cacheDir, landRetryMs, lander, merges, now, repo, workspaces } = ctx;
  /**
   * Landing asked, or stopped for the person: merged, or the person's message, or new commits;
   * nothing while the merge queue has the branch (decision 717).
   */
  async function waiting(where: ReviewPlace, record: HiveFile): Promise<void> {
    const turn = await turnOf(where, record.branch, record.since);
    if (!turn) return;
    const { summary, prompt } = turn;
    const landing = await landingOf(record.branch, summary);
    if (landing === 'merged' || (landing === 'queued' && record.step !== 'landing')) {
      return leaveTo(where, record, landing);
    }
    if (landing) return;
    if (prompt && prompt.at > record.since) return roundsAgain(where, record, prompt.at);
    const moved =
      record.step === 'landing' &&
      record.checked !== undefined &&
      summary.tip !== null &&
      summary.tip !== record.checked &&
      summary.agent.state !== 'working' &&
      (summary.worktree.changed ?? 0) === 0;
    if (moved) {
      const next = await moveTo(where, record, { step: 'checking' }, 'checking', { moved: true });
      return checking(where, next, summary);
    }
  }

  /**
   * At `landing` with a lander (HV4, decisions 767–770): the landing in flight followed, else the
   * commit Hive checked and reviewed approved and queued; new commits are checked first, and a
   * merge of the person's is theirs (717).
   */
  async function landing(where: ReviewPlace, record: HiveFile): Promise<void> {
    if (!lander) return waiting(where, record);
    const summary = await workspaces.summaryOf(record.branch);
    if (!summary) return;
    const last = record.landings?.at(-1);
    if (last?.via === 'request' && !last.outcome)
      return waitingForMerge(where, record, last, summary);
    if (last && !last.outcome) return follow(where, record, last, summary);
    if (summary.merged && awaiting(record.request)) {
      return void (await watchRequest(where, record, summary));
    }
    if (summary.merged) return void (await moveTo(where, record, { step: 'landed' }, 'landed'));
    const queue = await merges().catch(() => null);
    if (!queue || queue.some((m) => m.branch === record.branch && QUEUED.has(m.state))) return;
    const moved =
      summary.tip !== null &&
      record.checked !== undefined &&
      summary.tip !== record.checked &&
      summary.agent.state !== 'working' &&
      (summary.worktree.changed ?? 0) === 0;
    if (moved) {
      const next = await moveTo(where, record, { step: 'checking' }, 'checking', { moved: true });
      return checking(where, next, summary);
    }
    if (!summary.tip || summary.tip !== record.checked) return;
    return act(record.branch, land(where, record.branch, summary));
  }

  /** Approves the checked commit as Hive's and queues it into the start branch (767). */
  async function land(where: ReviewPlace, branch: string, summary: WorkspaceSummary) {
    if (!lander) return;
    const tip = summary.tip;
    if (!tip) return;
    let record = await readHive(where, branch);
    if (!record || record.step !== 'landing' || ctx.closed) return;
    // HV8: by a pull or merge request where the repository says so, read at each landing.
    // HV10c: a workspace from an issue by `hive.issues.lands`, a request unless set otherwise.
    const requests =
      lander.requests?.by(summary.issue !== undefined) === 'request' ? lander.requests : undefined;
    if (!record.pushed?.ok || record.pushed.sha !== tip) {
      await pushOut(where, branch, tip);
      record = (await readHive(where, branch)) ?? record;
    }
    const stop = async (note: string) =>
      void (await moveTo(where, record, { step: 'stuck', note }, 'stuck', { note }));
    if (requests && (!record.pushed?.ok || record.pushed.sha !== tip)) {
      // A request needs the branch on the forge (792).
      return stop(`the branch was not pushed to origin: ${record.pushed?.error ?? 'not pushed'}`);
    }
    const { info } = await lander.reviews.resolve(branch);
    if (info.head !== tip) return;
    const targets = await lander.merges.targets(branch);
    const into =
      summary.from && targets.branches.includes(summary.from) ? summary.from : targets.into;
    if (!into) return stop(`no branch to land ${branch} in`);
    let forge: Forge | undefined;
    let seen: ChangeRequest | undefined;
    if (requests) {
      const found = await requests.forge();
      if ('why' in found) return stop(`Hive lands by pull or merge request, but ${found.why}`);
      forge = found.forge;
      // A request on record is read through the one gate first (791): merged lands the workspace,
      // closed stops it, open is updated below; not due or not read, the landing waits its turn.
      const prior = record.request;
      if (prior?.state === 'closed') {
        return stop(`its ${requestWords(prior)} was closed without a merge`);
      }
      if (prior) {
        const gate = await watchRequest(where, record, summary, { landing: true });
        if (gate.seen !== 'open') return;
        seen = gate.read;
      }
    }
    await lander.reviews.finish(
      info,
      { event: 'approve', body: approvalOf(record, tip), comments: [], via: 'hive' },
      () => Promise.reject(new Error('a landing has no comment')),
    );
    if (requests && forge)
      return openRequest(where, branch, summary, { into, tip, forge, requests, seen });
    const at = stamp();
    let entry: MergeEntry;
    try {
      entry = await lander.merges.enqueue({ branch, into, by: 'hive' });
    } catch (error) {
      // Refused before it is queued: a fast-forward its target cannot take, say (V67).
      const refused: HiveLanding = {
        round: record.round,
        at: tip,
        into,
        entry: 'none',
        queued: at,
        message: (error as Error).message,
      };
      const fresh = (await readHive(where, branch)) ?? record;
      return landingFailed(
        where,
        { ...fresh, landings: [...(fresh.landings ?? []), refused] },
        refused,
        {
          outcome: 'refused',
          why: (error as Error).message,
        },
      );
    }
    const attempt: HiveLanding = {
      round: record.round,
      at: tip,
      into,
      entry: entry.id,
      queued: entry.queued,
      state: entry.state,
    };
    const fresh = (await readHive(where, branch)) ?? record;
    await save(where, { ...fresh, landings: [...(fresh.landings ?? []), attempt] });
    await event(where, branch, 'land-queued', { into, entry: entry.id, commit: tip });
  }

  /**
   * At `landing`, waiting for the person's merge on the forge (HV8): its branch in the start branch
   * already is the gate's to tell (merged on the forge, or outside its request); else the person's
   * message starts the rounds again (the request stays open); new commits are checked first; a
   * commit checked since updates the request; else the gate reads it when due (791).
   */
  async function waitingForMerge(
    where: ReviewPlace,
    record: HiveFile,
    last: HiveLanding,
    summary: WorkspaceSummary,
  ): Promise<void> {
    if (summary.merged) return void (await watchRequest(where, record, summary));
    const turn = await turnOf(where, record.branch, record.since);
    if (turn?.prompt && turn.prompt.at > record.since && record.request?.state === 'open') {
      return roundsAgain(where, record, turn.prompt.at);
    }
    const moved =
      summary.tip !== null &&
      record.checked !== undefined &&
      summary.tip !== record.checked &&
      summary.agent.state !== 'working' &&
      (summary.worktree.changed ?? 0) === 0;
    if (moved) {
      const next = await moveTo(where, record, { step: 'checking' }, 'checking', { moved: true });
      return checking(where, next, summary);
    }
    if (summary.tip && summary.tip === record.checked && record.checked !== last.at) {
      return act(record.branch, land(where, record.branch, summary));
    }
    return void (await watchRequest(where, record, summary));
  }

  /** The landing in flight: landed, still merging, refused by the person's checkout, or failed. */
  async function follow(
    where: ReviewPlace,
    record: HiveFile,
    last: HiveLanding,
    summary: WorkspaceSummary,
  ): Promise<void> {
    if (!lander) return;
    const queue = await merges().catch(() => null);
    if (!queue) return;
    const entry = queue.find((e) => e.id === last.entry);
    const replace = (landing: HiveLanding): HiveFile => ({
      ...record,
      landings: [...(record.landings ?? []).slice(0, -1), landing],
    });
    if (!entry) {
      if (summary.merged) {
        const done: HiveLanding = { ...last, outcome: 'landed', ended: stamp() };
        delete done.state;
        await moveTo(where, replace(done), { step: 'landed' }, 'landed', { into: last.into });
        return;
      }
      // Taken out of the queue by the person: stopping beats guessing.
      const note = `its landing in ${last.into} was taken out of the merge queue`;
      const done: HiveLanding = { ...last, outcome: 'failed', ended: stamp(), message: note };
      delete done.state;
      await moveTo(where, replace(done), { step: 'stuck', note }, 'stuck', { note });
      return;
    }
    if (entry.state === 'landed') {
      const done: HiveLanding = {
        ...last,
        outcome: 'landed',
        ended: entry.landed ?? stamp(),
        ...(entry.merge ? { merge: entry.merge } : {}),
        ...(entry.pushed ? { pushed: entry.pushed } : {}),
      };
      delete done.state;
      delete done.message;
      await moveTo(where, replace(done), { step: 'landed' }, 'landed', {
        into: last.into,
        merge: entry.merge,
        pushed: entry.pushed?.ok ?? false,
      });
      return;
    }
    const said = {
      state: entry.state,
      ...(entry.message ? { message: entry.message } : {}),
    } as const;
    if (MERGING.has(entry.state)) {
      if (last.state !== entry.state || last.message !== entry.message) {
        const now: HiveLanding = { ...last, ...said };
        if (!entry.message) delete now.message;
        await save(where, replace(now));
      }
      return;
    }
    if (entry.state === 'ready') {
      // The person's checkout refused the fast-forward (770): Land again once a while has passed.
      const due = !last.tried || now().getTime() - Date.parse(last.tried) >= landRetryMs;
      await save(where, replace({ ...last, ...said, ...(due ? { tried: stamp() } : {}) }));
      if (due) await lander.merges.land(entry.id).catch(() => undefined);
      return;
    }
    // needs-you or failed: back to the writer (769).
    const outcome: NonNullable<HiveLanding['outcome']> = entry.diverged
      ? 'diverged'
      : entry.conflicts?.length
        ? 'conflict'
        : entry.behind
          ? 'cannot-fast-forward'
          : entry.check?.ok === false
            ? 'check-failed'
            : 'failed';
    const kept = await keepLog(where, record.branch, entry.id);
    const done: HiveLanding = {
      ...last,
      outcome,
      ended: stamp(),
      ...(entry.conflicts?.length ? { files: entry.conflicts } : {}),
      ...(entry.check?.ok === false && entry.check.failed
        ? { failed: entry.check.failed, output: lastLines(entry.check.output ?? '') }
        : {}),
      ...(entry.message ? { message: entry.message } : {}),
      ...(kept ? { log: kept } : {}),
    };
    delete done.state;
    // Out of the queue first: the target is free, and a message may go (717).
    await lander.merges.remove(entry.id);
    return landingFailed(where, replace(done), done, { outcome, why: whyOf(done, entry.into) });
  }

  /** A merge's log kept beside Hive's record, its entry about to be removed; its id. */
  async function keepLog(where: ReviewPlace, branch: string, entry: string) {
    const id = hiveLogId(stamp());
    const to = hiveLogPath(where, branch, id);
    try {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(cacheDir, 'state', repo.id, 'merges', `${entry}.jsonl`), to);
      return id;
    } catch {
      return undefined;
    }
  }

  return { waiting, landing };
}
