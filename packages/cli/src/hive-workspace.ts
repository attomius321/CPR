// A Hive workspace's Review tab (HV3, decision 681): what Hive did with it — each round's check and
// running review, their findings and the tests kept for the writer — and, since HV4, each landing
// Hive tried and the branch's last push. Hive lands on its own (decision 767): no Land.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitRepo, HiveLogRead, WorkspaceHiveDetail } from '@symbiote/core';
import type { HiveRecord } from './hive.js';
import { hiveLive, hiveLogs, isHiveLogId } from './hive-live.js';
import { readPacingConfig, spendOf } from './hive-pacing.js';
import { hiveTestsDir, readHive, readHives, shownPause, type HiveFile } from './hive-record.js';
import { reviewPlace } from './reviews.js';

/** What the Review tab asks of a Hive workspace. */
export interface HiveWorkspace {
  /** Its rounds; null when Hive does not drive it. */
  detail(branch: string): Promise<WorkspaceHiveDetail | null>;
  /** A kept test's text: a file of a round's kept findings; null when there is none. */
  test(branch: string, round: number, path: string): Promise<string | null>;
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
      ...(record.landings ?? []).map((l) => l.log),
    ].filter((id): id is string => id !== undefined),
  );

/** The Review tab's service of `repo`'s Hive workspaces. */
export function hiveWorkspace(
  repo: GitRepo,
  cacheDir: string,
  {
    hive,
    root = repo.root,
  }: {
    hive: Pick<HiveRecord, 'on'>;
    /** Where `symbiote/config.json` is read: the budget (HV5). */
    root?: string;
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
        ...(record.landings?.length ? { landings: record.landings } : {}),
        ...(record.pushed ? { pushed: record.pushed } : {}),
        ...(record.request ? { request: record.request } : {}),
        ...(shownPause(record) ? { pause: shownPause(record) } : {}),
        // What it spent (HV5): the writer as Hive last read it, the reviews, the budget.
        spend: spendOf(record, record.spent?.writer, readPacingConfig(root).budget),
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
  };
}
