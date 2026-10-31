// A Hive workspace's Review tab (HV3, decision 681): what Hive did with it — each round's check and
// running review, their findings and the tests kept for the writer — and Land, the person's press
// that takes the place of a branch review in Hive mode: an approval of the commit Hive checked and
// reviewed, recorded for the person, then queued into its target as Merge into does (V26). Nothing
// is sent to the writer, which Hive would read as the person taking over.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitRepo, HiveLogRead, MergeEntry, WorkspaceHiveDetail } from '@symbiote/core';
import type { HiveRecord } from './hive.js';
import { hiveLive, hiveLogs, isHiveLogId } from './hive-live.js';
import { hiveTestsDir, readHive, readHives, type HiveFile } from './hive-record.js';
import type { Merger } from './merges.js';
import { reviewPlace, type BranchReviews } from './reviews.js';
import { WorkspaceRefused } from './workspace-record.js';

/** What the Review tab asks of a Hive workspace. */
export interface HiveWorkspace {
  /** Its rounds; null when Hive does not drive it. */
  detail(branch: string): Promise<WorkspaceHiveDetail | null>;
  /** A kept test's text: a file of a round's kept findings; null when there is none. */
  test(branch: string, round: number, path: string): Promise<string | null>;
  /** Land: the checked and reviewed commit approved for the person, and queued. */
  land(branch: string): Promise<MergeEntry>;
  /**
   * A check's or a review's log from byte `from` (decision 695); null when its record names no
   * such log.
   */
  log(branch: string, id: string, from: number): Promise<HiveLogRead | null>;
}

/** The logs a record names: its checks' and reviews', and the run in progress. */
const logsOf = (record: HiveFile) =>
  new Set(
    [
      ...record.checks.map((c) => c.log),
      ...record.reviews.map((r) => r.log),
      record.check?.log,
      record.review?.log,
    ].filter((id): id is string => id !== undefined),
  );

/** The Review tab's service of `repo`'s Hive workspaces. */
export function hiveWorkspace(
  repo: GitRepo,
  cacheDir: string,
  {
    hive,
    reviews,
    merges,
  }: {
    hive: Pick<HiveRecord, 'on'>;
    reviews: Pick<BranchReviews, 'resolve' | 'finish'>;
    merges: Pick<Merger, 'targets' | 'enqueue'>;
  },
): HiveWorkspace {
  const recordOf = async (branch: string) => readHive(await reviewPlace(repo, cacheDir), branch);

  /** The files of `round`'s kept findings: the only ones the tab may read. */
  const keptFiles = (record: HiveFile, round: number) =>
    new Set(
      record.reviews
        .filter((r) => r.round === round)
        .flatMap((r) => r.findings.filter((f) => f.kept).flatMap((f) => f.files)),
    );

  return {
    async detail(branch) {
      const record = await recordOf(branch);
      if (!record) return null;
      const where = await reviewPlace(repo, cacheDir);
      const on = await hive.on().catch(() => false);
      // What runs now (decision 697), while Hive is on.
      const live = on ? await hiveLive(where, record, () => readHives(where)) : undefined;
      return {
        branch: record.branch,
        step: record.step,
        round: record.round,
        rounds: record.rounds,
        on,
        ...(record.checked ? { checked: record.checked } : {}),
        ...(record.note ? { note: record.note } : {}),
        checks: record.checks,
        reviews: record.reviews,
        ...(live ? { live } : {}),
        tests: join(hiveTestsDir(where, branch, 1), '..'),
      };
    },

    async test(branch, round, path) {
      const record = await recordOf(branch);
      if (!record || !keptFiles(record, round).has(path)) return null;
      const where = await reviewPlace(repo, cacheDir);
      return readFile(join(hiveTestsDir(where, branch, round), path), 'utf8').catch(() => null);
    },

    async log(branch, id, from) {
      const record = await recordOf(branch);
      if (!record || !isHiveLogId(id) || !logsOf(record).has(id)) return null;
      return hiveLogs(await reviewPlace(repo, cacheDir), branch).read(id, from);
    },

    async land(branch) {
      if (!(await hive.on().catch(() => false))) {
        throw new WorkspaceRefused(
          'Hive is off: review and land the branch as any workspace, from its review',
          409,
        );
      }
      const record = await recordOf(branch);
      if (!record) throw new WorkspaceRefused(`Hive does not drive ${branch}`, 409);
      if (record.step !== 'landing' || !record.checked) {
        throw new WorkspaceRefused(
          `Hive has not asked to land ${branch}: it is ${record.step} (round ${record.round} of ${record.rounds})`,
          409,
        );
      }
      const { info } = await reviews.resolve(branch);
      if (info.head !== record.checked) {
        throw new WorkspaceRefused(
          `${branch} has commits after ${record.checked.slice(0, 7)}, the commit Hive checked and reviewed: Hive checks and reviews them first`,
          409,
        );
      }
      const review = record.reviews.findLast((r) => r.at === record.checked);
      const said =
        review?.verdict === 'approved'
          ? `checked and reviewed by Hive at ${record.checked.slice(0, 7)} (round ${review.round})`
          : `checked by Hive at ${record.checked.slice(0, 7)}${record.note ? `; ${record.note}` : ''}`;
      await reviews.finish(
        info,
        {
          event: 'approve',
          body: `Landed from its Review tab in Hive mode: ${said}.`,
          comments: [],
        },
        () => Promise.reject(new Error('a landing has no comment')),
      );
      const { into } = await merges.targets(branch);
      const target = into ?? info.into;
      if (!target) throw new WorkspaceRefused(`no branch to land ${branch} in`, 409);
      return merges.enqueue({ branch, into: target });
    },
  };
}
