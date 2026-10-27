// Git's header's remotes (V66e): Fetch, Pull (fast-forward only, merging or rebasing) and Push,
// with the branch's commits to pull and to push.
import { useEffect, useRef, useState } from 'react';
import type { PullMode, SyncState } from '@symbiote/core';
import { syncWords } from './details.js';
import { ChevronIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';

export type SyncRun = 'fetch' | 'pull' | 'push';

const MODES: { mode: PullMode; label: string; about: string }[] = [
  {
    mode: 'ff-only',
    label: 'Fast-forward only',
    about: 'Moves the branch to its upstream; refused when they diverged',
  },
  {
    mode: 'merge',
    label: 'Merge',
    about: "Merges the upstream's commits in: a merge commit if needed",
  },
  { mode: 'rebase', label: 'Rebase', about: "Replays the branch's own commits on its upstream" },
];

export function SyncBar({
  sync,
  running,
  onRun,
}: {
  sync: SyncState | null;
  /** The run in progress, if any: the others wait. */
  running: SyncRun | null;
  onRun: (run: SyncRun, mode?: PullMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  const words = sync ? syncWords(sync) : 'Reading the branch’s upstream…';
  const detached = sync?.branch === null;
  const noRemote = sync !== null && sync.remotes.length === 0;
  const busy = running !== null;
  return (
    <span className="git-sync" role="group" aria-label="Remotes">
      <button
        type="button"
        className="button secondary git-sync-button"
        disabled={busy || noRemote}
        {...tip(
          noRemote
            ? 'No remote to fetch from'
            : 'Fetch every remote, branches gone from them pruned',
        )}
        onClick={() => onRun('fetch')}
      >
        {running === 'fetch' ? 'Fetching…' : 'Fetch'}
      </button>
      <span className="git-pull" ref={box}>
        <button
          type="button"
          className="button secondary git-sync-button"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy || detached || !sync?.upstream}
          {...tip(words)}
          onClick={() => setOpen((o) => !o)}
        >
          {running === 'pull' ? 'Pulling…' : 'Pull'}
          {!!sync?.behind && <span className="git-count">↓{sync.behind}</span>}
          <ChevronIcon open={open} />
        </button>
        {open && (
          <span className="more-menu git-pull-menu" role="menu" aria-label="Pull">
            {MODES.map(({ mode, label, about }) => (
              <button
                key={mode}
                type="button"
                role="menuitem"
                {...tip(about, { side: 'right' })}
                onClick={() => {
                  setOpen(false);
                  onRun('pull', mode);
                }}
              >
                {label}
              </button>
            ))}
          </span>
        )}
      </span>
      <button
        type="button"
        className="button secondary git-sync-button"
        disabled={busy || detached || noRemote}
        {...tip(words)}
        onClick={() => onRun('push')}
      >
        {running === 'push' ? 'Pushing…' : 'Push'}
        {!!sync?.ahead && <span className="git-count">↑{sync.ahead}</span>}
      </button>
    </span>
  );
}
