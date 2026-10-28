// The kind of work on the start page (V24c): a radio group (keys 1–5 and the arrows), and what
// each kind is for behind its "?". Drawn as the mockup's tabs since V63, an icon each.
import type { ReactNode } from 'react';
import type { WorkKind, WorkKindSpec } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { BranchIcon, ChoreIcon, FixIcon, RefactorIcon, SpikeIcon } from '../ui/icons.js';
import { KIND_ABOUT } from './brief.js';
import { tip } from '../ui/tip.js';

/** Each kind's icon: its tab here, a workspace's head (V72). */
export const KIND_ICONS: Record<WorkKind, ReactNode> = {
  feature: <BranchIcon />,
  fix: <FixIcon />,
  refactor: <RefactorIcon />,
  chore: <ChoreIcon />,
  spike: <SpikeIcon />,
};

/** The kinds of work, `current` checked; `onPick` with the kind picked. */
export function StartKinds({
  kinds,
  current,
  onPick,
}: {
  kinds: WorkKindSpec[];
  current: WorkKindSpec;
  onPick: (kind: WorkKindSpec) => void;
}) {
  const kindIndex = kinds.indexOf(current);
  return (
    <div className="kind-row">
      <div
        className="kind-picker"
        role="radiogroup"
        aria-label="Kind of work"
        onKeyDown={(event) => {
          const n = Number(event.key);
          const to =
            n >= 1 && n <= kinds.length
              ? kinds[n - 1]
              : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                ? kinds[(kindIndex + 1) % kinds.length]
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                  ? kinds[(kindIndex - 1 + kinds.length) % kinds.length]
                  : undefined;
          if (!to) return;
          event.preventDefault();
          onPick(to);
          const radios = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
          radios[kinds.indexOf(to)]?.focus();
        }}
      >
        {kinds.map((kind, i) => (
          <button
            key={kind.kind}
            type="button"
            role="radio"
            aria-checked={kind.kind === current.kind}
            tabIndex={kind.kind === current.kind ? 0 : -1}
            className="kind"
            {...tip(kind.name, { keys: `${i + 1}` })}
            onClick={() => onPick(kind)}
          >
            {KIND_ICONS[kind.kind]}
            {kind.name}
          </button>
        ))}
      </div>
      <Help label="About the kinds of work" id="kind-about">
        <dl className="kind-about">
          {kinds.map((kind) => (
            <div key={kind.kind} className={kind.kind === current.kind ? 'current' : undefined}>
              <dt>{kind.name}</dt>
              <dd>{KIND_ABOUT[kind.kind]}</dd>
            </div>
          ))}
        </dl>
      </Help>
    </div>
  );
}
