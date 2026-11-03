// What Hive runs now on a workspace (decisions 698, 699): its words ticking each second from the
// recorded starts, in its page's head and the bar under its terminal.
import type { WorkspaceHive } from '@symbiote/core';
import { useSeconds } from './clock.js';
import { liveWords } from './hive-live.js';

/** One line: "Checking 4/4: pnpm test:e2e · 4:12 of ~7 min" (the head's). */
export function HiveNowLine({ hive }: { hive: Pick<WorkspaceHive, 'live' | 'note'> }) {
  const now = useSeconds();
  return <>{liveWords(hive, now)?.line ?? null}</>;
}
