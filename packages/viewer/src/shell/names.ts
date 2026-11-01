// Nucleus's name on the pages (decisions 682, 683): Alpha Ceph while Hive mode is on. The names
// are core's (`NUCLEUS_NAMES`), written again here because the viewer imports only types from
// core: typed by core's, so a change there fails this file's typecheck until it follows.
import type { NucleusName, NucleusNames } from '@symbiote/core';
import { useNucleusPhase } from './alpha-ceph.js';
import { useHive } from './hive.js';

const NAMES: NucleusNames = { off: 'Nucleus', hive: 'Alpha Ceph' };

/** Nucleus's name with Hive mode on or off. */
export function nucleusName(hive: boolean): NucleusName {
  return hive ? NAMES.hive : NAMES.off;
}

/**
 * Whether Nucleus is Alpha Ceph now: Hive mode on, and Nucleus not held through Hive's arrival
 * (V86, decision 731: it stays Nucleus until the sidenav plays its change).
 */
export function useAlphaCeph(): boolean {
  const hive = useHive();
  return useNucleusPhase() === 'held' ? false : hive;
}

/** Nucleus's name now, again as Hive mode turns on or off. */
export function useNucleusName(): NucleusName {
  return nucleusName(useAlphaCeph());
}
