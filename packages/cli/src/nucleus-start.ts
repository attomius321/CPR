// Nucleus's start without a Confirm (NU8): the person's setting, kept as Hive mode is, in
// `symbiote/nucleus-start.json` and never committed (decision 782); on whatever it says while Hive
// mode is on (decision 783). Read by the MCP at each call (`withoutConfirm`), set only by Settings.
import type { GitRepo, WithoutConfirm } from '@symbiote/core';
import { repositorySwitch, type HiveRecord } from './hive.js';
import { WorkspaceRefused } from './workspace-record.js';

/** `GET /api/nucleus/start-confirm`: what holds now, the person's own choice, Hive mode. */
export interface NucleusStartState {
  withoutConfirm: boolean;
  own: boolean;
  hive: boolean;
}

/** The setting as the MCP and Settings read it. */
export interface NucleusStart {
  /** Why Nucleus's start goes without a Confirm now: Hive first, then the setting; else none. */
  why(): Promise<WithoutConfirm | undefined>;
  read(): Promise<NucleusStartState>;
  /** The person's choice; refused (409) while Hive is on, which decides then. */
  set(on: boolean): Promise<void>;
}

/** The person's setting for `repo`: `symbiote/nucleus-start.json`, as `repositoryHive` keeps Hive. */
export function repositoryNucleusStart(
  repo: GitRepo,
  cacheDir: string,
  { now = () => new Date() } = {},
): HiveRecord {
  return repositorySwitch(repo, cacheDir, 'nucleus-start.json', { now });
}

/** The setting `own` with Hive mode's record `hive` over it; a record that fails reads as off. */
export function nucleusStart(own: HiveRecord, hive?: HiveRecord): NucleusStart {
  const on = (record?: HiveRecord) => record?.on().catch(() => false) ?? Promise.resolve(false);
  return {
    async why() {
      if (await on(hive)) return 'hive';
      return (await on(own)) ? 'setting' : undefined;
    },
    async read() {
      const [mine, hiving] = await Promise.all([on(own), on(hive)]);
      return { withoutConfirm: mine || hiving, own: mine, hive: hiving };
    },
    async set(value) {
      if (await on(hive)) {
        throw new WorkspaceRefused(
          'Hive mode is on: Nucleus starts workspaces without a Confirm until it is off',
          409,
        );
      }
      await own.set(value);
    },
  };
}
