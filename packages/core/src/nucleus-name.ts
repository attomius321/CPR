// Nucleus's name as the person reads it (decisions 682, 683): "Alpha Ceph" while Hive mode is on,
// "Nucleus" with it off. Only the name it is shown and calls itself by: its id (`nucleus` in
// records, files, `/api/nucleus`, settings) and its session's name stay. The viewer imports only
// types from here: its two literals are typed by `NucleusNames`, so a change here fails its
// typecheck until it follows.

/** Nucleus's names: with Hive mode off, and on. */
export const NUCLEUS_NAMES = { off: 'Nucleus', hive: 'Alpha Ceph' } as const;

export type NucleusNames = typeof NUCLEUS_NAMES;

/** One of Nucleus's names. */
export type NucleusName = NucleusNames[keyof NucleusNames];

/** Nucleus's name with Hive mode on or off. */
export function nucleusName(hive: boolean): NucleusName {
  return hive ? NUCLEUS_NAMES.hive : NUCLEUS_NAMES.off;
}
