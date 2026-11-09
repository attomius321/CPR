// Hive turned off and on again (HV4): its writers, checks and reviews stopped, and what the
// sessions show reconciled when it is back on.
import { rm } from 'node:fs/promises';
import { readHive, type HiveFile } from './hive-record.js';
import { killGroup } from './programs.js';
import type { ReviewPlace } from './reviews.js';
import type { HiveContext } from './hive-context.js';
import type { HiveRoundSteps } from './hive-round.js';

/** The off step's functions. */
export function hiveOff(
  {
    checks,
    copiesOf,
    log,
    reviews,
    toStop,
    workspaces,
  }: Pick<HiveContext, 'checks' | 'copiesOf' | 'log' | 'reviews' | 'toStop' | 'workspaces'>,
  { event, queue, save, turnOf }: Pick<HiveRoundSteps, 'event' | 'queue' | 'save' | 'turnOf'>,
) {
  /** Hive turned off (decision 655): its checks killed, its working writers to stop. */
  async function turnOff(where: ReviewPlace, records: HiveFile[]): Promise<void> {
    for (const record of records) {
      const running = checks.get(record.branch);
      if (running) {
        running.stopped = 'off';
        running.run.kill();
      } else if (record.step === 'checking' && record.check) {
        killGroup(record.check.pid, 'SIGKILL');
      }
      const review = reviews.get(record.branch);
      if (review) {
        review.stopped = 'off';
        review.run.stop();
      } else if (record.step === 'reviewing' && record.review) {
        killGroup(record.review.pid, 'SIGKILL');
      }
      if (record.step === 'writing') toStop.add(record.branch);
      await event(where, record.branch, 'off', { step: record.step });
    }
    await stopWriters(where);
  }

  /** Stops each writer Hive off must stop, while it works or waits; a failure is tried again. */
  async function stopWriters(where: ReviewPlace): Promise<void> {
    for (const branch of [...toStop]) {
      const summary = await workspaces.summaryOf(branch).catch(() => null);
      const live = summary && ['working', 'needs-you'].includes(summary.agent.state);
      if (!live) {
        toStop.delete(branch);
        continue;
      }
      try {
        await workspaces.stopAgent(branch);
      } catch (error) {
        log?.warn({ branch, error: (error as Error).message }, 'hive could not stop a writer');
        continue;
      }
      toStop.delete(branch);
      const record = await readHive(where, branch);
      if (record) await save(where, { ...record, interrupted: true });
      await event(where, branch, 'stopped');
    }
  }

  /**
   * A new holder, or Hive on again (decision 655): checks left by a killed runner killed, to run
   * again; a writer Hive stopped told to continue, unless its turn went on meanwhile.
   */
  async function reconcile(where: ReviewPlace, records: HiveFile[]): Promise<void> {
    toStop.clear();
    for (const record of records) {
      if (reviews.has(record.branch)) continue;
      // Copies a review of another runner left (decision 675): none is running here.
      await rm(copiesOf(record.branch), { recursive: true, force: true }).catch(() => undefined);
      if (record.step === 'reviewing') {
        if (record.review && killGroup(record.review.pid, 'SIGKILL')) {
          await event(where, record.branch, 'orphan-killed', { pid: record.review.pid });
        }
        if (record.review || record.interrupted) {
          const again: HiveFile = { ...record };
          delete again.review;
          delete again.interrupted;
          await save(where, again);
          await event(where, record.branch, 'on', { step: 'reviewing' });
        }
        continue;
      }
      if (record.step === 'checking' && !checks.has(record.branch)) {
        if (record.check && killGroup(record.check.pid, 'SIGKILL')) {
          await event(where, record.branch, 'orphan-killed', { pid: record.check.pid });
        }
        if (record.check || record.interrupted) {
          const again: HiveFile = { ...record };
          delete again.check;
          delete again.interrupted;
          await save(where, again);
          await event(where, record.branch, 'on', { step: 'checking' });
        }
        continue;
      }
      if (record.step !== 'writing' || !record.interrupted) continue;
      const turn = await turnOf(where, record.branch, record.since);
      if (!turn) continue;
      const going = turn.ended || turn.summary.agent.state === 'working';
      if (going) {
        const kept: HiveFile = { ...record };
        delete kept.interrupted;
        await save(where, kept);
        await event(where, record.branch, 'on', { going: true });
        continue;
      }
      await event(where, record.branch, 'on');
      await queue(where, record, 'hive.resume', {});
    }
  }

  return { turnOff, stopWriters, reconcile };
}
