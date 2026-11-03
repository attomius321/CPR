// A workspace's tab in its address (V21; V92, decision 860): `&thread`, `&terminal`, `&activity`,
// `&brief`, `&run` (a Hive workspace's Run tab; `&review`, its name before V92, opens it too) or
// `&shell=<n>`. Pure.
import { shellOfUrl } from './shells.js';
import type { View } from './WorkspaceTabs.js';

/** The tab `search` picks; null: none (the terminal where one can run, else the thread). */
export function viewOfSearch(search: string): View | null {
  const params = new URLSearchParams(search);
  if (params.has('thread')) return 'thread';
  if (params.has('terminal')) return 'terminal';
  if (params.has('activity')) return 'activity';
  if (params.has('brief')) return 'brief';
  if (params.has('run') || params.has('review')) return 'run';
  return shellOfUrl(search) !== null ? 'shell' : null;
}

/** A workspace's Run tab (Read why on the Overview, decision 857). */
export const runHref = (branch: string) => `/?branch=${encodeURIComponent(branch)}&run`;
