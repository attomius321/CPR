import type { KeyboardEvent } from 'react';
import { stopOf, stopWord, type EffortChoice } from './effort.js';
import { tip } from '../ui/tip.js';

/**
 * An agent's effort as a segmented control (V93, decision 883; proof 06-start's `.effort`): a
 * radio a level, the agent's own first, its word short (Default, Low … Max) and its name whole
 * for screen readers and in its tip; the arrows, Home and End move between them.
 */
export function EffortSegments({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly EffortChoice[];
  /** The level, `''` for the agent's own. */
  value: string;
  onChange: (value: string) => void;
}) {
  if (choices.length < 2) return null;
  const at = stopOf(choices, value);
  const last = choices.length - 1;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? Math.min(last, at + 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? Math.max(0, at - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    onChange(choices[to]?.value ?? '');
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
  return (
    <div className="effort-segments" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {choices.map((choice, stop) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={stop === at}
          aria-label={choice.label}
          tabIndex={stop === at ? 0 : -1}
          {...tip(choice.label)}
          onClick={() => onChange(choice.value)}
        >
          {stopWord(choice)}
        </button>
      ))}
    </div>
  );
}
