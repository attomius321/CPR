// What Hive runs now on a workspace (decisions 698, 699): its words ticking each second from the
// recorded starts, on its card, in its page's head, and on the folded sidenav's rail.
import type { WorkspaceHive } from '@symbiote/core';
import { tip } from '../ui/tip.js';
import { useSeconds } from './clock.js';
import { clockWords, liveWords } from './hive-live.js';

/** One line: "Checking 4/4: pnpm test:e2e · 4:12 of ~7 min" (the head's). */
export function HiveNowLine({ hive }: { hive: Pick<WorkspaceHive, 'live' | 'note'> }) {
  const now = useSeconds();
  return <>{liveWords(hive, now)?.line ?? null}</>;
}

/**
 * On a card: what it runs and its time, then the command running or what the reviewer runs, each
 * cut to its line, all of it in the tip.
 */
export function HiveNowCard({ hive }: { hive: WorkspaceHive }) {
  const now = useSeconds();
  const words = liveWords(hive, now);
  if (!words) return null;
  return (
    <div className="hive-live" {...tip(words.line)}>
      <p className="workspace-state hive-live-head">
        <strong>{words.head}</strong>
        <span className="hive-live-time"> · {words.time}</span>
      </p>
      {words.detail && (
        <p className={`hive-live-detail${hive.live?.kind === 'check' ? ' command' : ''}`}>
          {words.detail}
        </p>
      )}
    </div>
  );
}

/** On the folded rail, under the card's dot: how long Hive's run has lasted, "4:12". */
export function HiveRailTime({ hive }: { hive: WorkspaceHive }) {
  const now = useSeconds();
  if (!hive.live) return null;
  return (
    <span className="hive-rail-time" aria-hidden="true">
      {clockWords(now - Date.parse(hive.live.started))}
    </span>
  );
}
