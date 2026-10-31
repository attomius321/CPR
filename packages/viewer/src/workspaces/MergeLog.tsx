import type { MergeEntry } from '@symbiote/core';
import { mergeLive } from './merges.js';
import { StepLog } from './StepLog.js';

/**
 * A merge's log (V46a, decisions 314 and 316): its steps — the merge, the merger agent, each check
 * command, the landing — and everything they wrote, from `/api/merges/log` as it is written,
 * whichever Symbiote merges (`StepLog`). Nothing is drawn for a merge with no log once it no
 * longer runs (one made before V46).
 */
export function MergeLog({
  entry,
  hidden = false,
  onLogged,
}: {
  entry: MergeEntry;
  /** Kept, streaming, while another view is shown (V46c). */
  hidden?: boolean;
  onLogged?: () => void;
}) {
  return (
    <StepLog
      id={entry.id}
      source={(from) => `/api/merges/log?id=${encodeURIComponent(entry.id)}&from=${from}`}
      state={{
        running: ['merging', 'resolving', 'checking'].includes(entry.state),
        checking: entry.state === 'checking',
        ...(entry.check?.commands ? { commands: entry.check.commands } : {}),
      }}
      live={mergeLive([entry])}
      hidden={hidden}
      {...(onLogged ? { onLogged } : {})}
    />
  );
}
