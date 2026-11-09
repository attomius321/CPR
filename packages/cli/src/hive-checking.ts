// Hive's checking step (HV2): the project's check on the branch's tip, run, watched and its
// failures sent back.
import type { HiveCheck, HiveCheckStep, WorkspaceSummary } from '@symbiote/core';
import { readHive, type HiveFile } from './hive-record.js';
import { hiveLogId, hiveLogs } from './hive-live.js';
import { projectCheck } from './merge-config.js';
import type { ReviewPlace } from './reviews.js';
import { readThreadEnd } from './thread.js';
import { symbioteFolder } from './workspace-record.js';
import type { Stop, Running, HiveContext } from './hive-context.js';
import { awaiting, type HiveRoundSteps, lastLines, plural } from './hive-round.js';
import type { HiveReviewSteps } from './hive-reviewing.js';

/** The same commands, in the same order: a check's result holds only for the commands it ran. */
const sameCommands = (ran: string[] | undefined, now: string[]) =>
  ran !== undefined && ran.length === now.length && ran.every((c, i) => c === now[i]);

/** The checking step's functions. */
export function hiveChecking(
  ctx: Pick<HiveContext, 'checks' | 'closed' | 'repo' | 'root' | 'run' | 'workspaces'>,
  {
    act,
    event,
    landingOf,
    leaveTo,
    moveTo,
    nextRound,
    pushOut,
    roundsAgain,
    save,
    stamp,
    turnOf,
    reviewing,
  }: Pick<
    HiveRoundSteps,
    | 'act'
    | 'event'
    | 'landingOf'
    | 'leaveTo'
    | 'moveTo'
    | 'nextRound'
    | 'pushOut'
    | 'roundsAgain'
    | 'save'
    | 'stamp'
    | 'turnOf'
  > &
    Pick<HiveReviewSteps, 'reviewing'>,
) {
  const { checks, repo, root, run, workspaces } = ctx;
  /**
   * Runs the project's check on the branch's tip (decision 654), unless a check of the same
   * commands passed on that commit already: then its review (decision 716).
   */
  async function checking(
    where: ReviewPlace,
    record: HiveFile,
    known?: WorkspaceSummary,
  ): Promise<void> {
    const summary = known ?? (await workspaces.summaryOf(record.branch));
    if (!summary?.tip) return;
    const landing = await landingOf(record.branch, summary);
    if (landing) return leaveTo(where, record, landing);
    const tip = summary.tip;
    const check = await projectCheck(repo, root, tip).catch(() => null);
    const passed =
      check &&
      record.checks.findLast(
        (c) => c.at === tip && c.ok && sameCommands(c.commands, check.commands),
      );
    if (passed) {
      const next = await moveTo(
        where,
        record,
        { step: 'reviewing', checked: tip, note: undefined },
        'reviewing',
        { passed: passed.round },
      );
      return reviewing(where, next);
    }
    if (!check) {
      // No check, but a review all the same (decision 674): the note stays for the person.
      const note = 'no check is set or found';
      const next = await moveTo(
        where,
        record,
        { step: 'reviewing', checked: tip, note },
        'reviewing',
        { note },
      );
      return reviewing(where, next);
    }
    // HV8: with a request open, a push would put an unchecked commit on it; the landing pushes
    // what the rounds passed, and the request updates then (769's rounds before the push).
    const push = awaiting(record.request) ? Promise.resolve() : pushOut(where, record.branch, tip);
    return act(
      record.branch,
      push.then(() => runCheck(where, record, tip, check.commands, summary.worktree.path)),
    );
  }

  /**
   * The running check's place in its record (decisions 693, 694): read again, and written only
   * while the record is still checking and this runner still runs that check, so nothing written
   * meanwhile is undone by an older copy.
   */
  async function markCheck(
    where: ReviewPlace,
    branch: string,
    running: Running,
    check: NonNullable<HiveFile['check']>,
  ): Promise<void> {
    const fresh = await readHive(where, branch);
    if (fresh?.step !== 'checking' || checks.get(branch) !== running) return;
    const next: HiveFile = { ...fresh, check };
    delete next.interrupted;
    await save(where, next);
  }

  async function runCheck(
    where: ReviewPlace,
    record: HiveFile,
    tip: string,
    commands: string[],
    worktree: string,
  ): Promise<void> {
    const began = Date.now();
    const started = stamp();
    // Its log beside the record (decision 695): each command a step, its output as it comes.
    const id = hiveLogId(started);
    const log = hiveLogs(where, record.branch).of(id);
    let output = '';
    let failedCommand: string | undefined;
    const steps: HiveCheckStep[] = [];
    for (const [index, command] of commands.entries()) {
      if (ctx.closed) return;
      const since = Date.now();
      log.step('check', command);
      const running: Running = {
        run: run(command, worktree, { onOutput: (chunk) => log.out(chunk) }),
      };
      checks.set(record.branch, running);
      if (running.run.pid !== undefined) {
        await markCheck(where, record.branch, running, {
          pid: running.run.pid,
          started,
          at: tip,
          commands,
          step: index,
          since: stamp(),
          done: steps.map(({ ok, ms }) => ({ ok, ms })),
          log: id,
        });
      }
      if (index === 0) {
        await event(where, record.branch, 'check-started', {
          round: record.round,
          commit: tip,
          commands,
          log: id,
        });
      }
      const result = await running.run.done;
      checks.delete(record.branch);
      if (ctx.closed) return;
      if (running.stopped) return stoppedCheck(where, record.branch, running.stopped);
      const ok = result.code === 0;
      log.end(ok);
      steps.push({ command, ok, ms: Date.now() - since });
      output += result.output;
      if (!ok) {
        failedCommand = command;
        break;
      }
    }
    const fresh = (await readHive(where, record.branch)) ?? record;
    const ran: HiveCheck = {
      round: fresh.round,
      at: tip,
      ok: failedCommand === undefined,
      ms: Date.now() - began,
      ...(failedCommand ? { failed: failedCommand } : {}),
      output: lastLines(output),
      started,
      commands,
      steps,
      log: id,
    };
    const after: HiveFile = { ...fresh, checks: [...fresh.checks, ran] };
    delete after.check;
    await save(where, after);
    await event(where, record.branch, 'check', {
      round: ran.round,
      ok: ran.ok,
      ms: ran.ms,
      ...(ran.failed ? { failed: ran.failed } : {}),
    });
    // Merged or queued while it ran (HV3's record: a failure sent at 14:19:23, merged 14:22:42).
    const landing = await landingOf(record.branch);
    if (landing) return leaveTo(where, after, landing);
    if (ran.ok) {
      const next = await moveTo(
        where,
        after,
        { step: 'reviewing', checked: tip, note: undefined },
        'reviewing',
      );
      return reviewing(where, next);
    }
    await nextRound(
      where,
      after,
      'hive.check',
      {
        output: ran.output ?? '',
        command: failedCommand ?? '',
        branch: record.branch,
        at: tip.slice(0, 7),
        round: String(ran.round),
        rounds: String(after.rounds),
      },
      // The card's words: plain text, no Markdown.
      (rounds) => `the check failed ${plural(rounds, 'time')}: ${failedCommand ?? ''}`,
    );
  }

  /** A check stopped before its end: no result; the step kept, the person's turn, or the landing. */
  async function stoppedCheck(where: ReviewPlace, branch: string, why: Stop): Promise<void> {
    const record = await readHive(where, branch);
    if (!record || record.step === 'landed') return;
    if (why === 'merged' || why === 'queued') {
      return leaveTo(where, record, why, { stopped: 'check' });
    }
    if (why === 'took-over') {
      const turn = await turnOf(where, branch, record.since);
      await roundsAgain(where, record, turn?.prompt?.at ?? stamp());
      return;
    }
    const kept: HiveFile = { ...record, interrupted: true };
    delete kept.check;
    await save(where, kept);
    await event(where, branch, 'check-stopped', { why });
  }

  /**
   * While a check runs: the branch's landing stops it (decision 717), as does a message the writer
   * got (the person took over).
   */
  async function watchCheck(where: ReviewPlace, record: HiveFile): Promise<void> {
    const running = checks.get(record.branch);
    if (!running || running.stopped) return;
    const landing = await landingOf(record.branch);
    if (checks.get(record.branch) !== running || running.stopped) return;
    if (landing) {
      running.stopped = landing;
      running.run.kill();
      return;
    }
    const thread = await readThreadEnd(symbioteFolder(where), record.branch);
    const prompt = thread.findLast((e) => e.kind === 'prompt');
    if (prompt && prompt.at > record.since) {
      running.stopped = 'took-over';
      running.run.kill();
    }
  }

  return { checking, watchCheck };
}

export type HiveCheckSteps = ReturnType<typeof hiveChecking>;
