// The kind of work on the start page (V24c): a radio group (keys 1–5 and the arrows), what each
// kind is for in its tip. Line tabs in the brief's card head since V93 (proof 06-start; V63's
// mockup tabs before, with a "?" for the kinds).
import type { ReactNode } from 'react';
import type { WorkKind, WorkKindSpec } from '@symbiote/core';
import { ChoreIcon, SparkIcon, FixIcon, RefactorIcon, SpikeIcon } from '../ui/icons.js';
import { KIND_ABOUT } from './brief.js';
import { tip } from '../ui/tip.js';

/** Each kind's icon: its tab here, a workspace's head (V72). */
export const KIND_ICONS: Record<WorkKind, ReactNode> = {
  feature: <SparkIcon />,
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
    <div className="card-head kind-row">
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
            {...tip(`${kind.name}\n${KIND_ABOUT[kind.kind]}`, { keys: `${i + 1}` })}
            onClick={() => onPick(kind)}
          >
            {KIND_ICONS[kind.kind]}
            {kind.name}
          </button>
        ))}
      </div>
    </div>
  );
}
