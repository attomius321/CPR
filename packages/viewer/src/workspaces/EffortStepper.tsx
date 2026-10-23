import { useEffect, useRef, type CSSProperties } from 'react';
import { stopOf, stopWord, type EffortChoice } from './effort.js';

/**
 * An agent's effort level as a stepper (fix/scout-effort-level): a track with a stop for each
 * choice, the agent's own first, and a handle dragged from stop to stop; the keys step one level,
 * a stop's word picks it. The browser's range input underneath gives the drag, the keys and its
 * role; it says the level's name, not its number. `onCommit` comes when the handle is let go (or a
 * key or a word moved it), `onChange` at every stop on the way.
 */
export function EffortStepper({
  label,
  choices,
  value,
  title,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  choices: readonly EffortChoice[];
  /** The level, `''` for the agent's own. */
  value: string;
  title?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const at = stopOf(choices, value);
  const last = choices.length - 1;
  // The input's own `change`: once a drag is let go. React's onChange is every `input` on the way.
  useEffect(() => {
    const field = input.current;
    if (!field || !onCommit) return;
    const commit = () => onCommit(choices[Number(field.value)]?.value ?? '');
    field.addEventListener('change', commit);
    return () => field.removeEventListener('change', commit);
  }, [choices, onCommit]);
  if (last < 1) return null;
  const pick = (stop: number) => {
    const next = choices[stop]?.value ?? '';
    input.current?.focus();
    if (stop === at) return;
    onChange(next);
    onCommit?.(next);
  };

  return (
    <div className="effort-stepper" style={{ '--last': last } as CSSProperties}>
      <div className="effort-rail" aria-hidden="true">
        {choices.map((choice, stop) => (
          <span key={choice.value} style={{ '--stop': stop } as CSSProperties} />
        ))}
      </div>
      <input
        ref={input}
        className="effort-range"
        type="range"
        min={0}
        max={last}
        step={1}
        value={at}
        aria-label={label}
        aria-valuetext={choices[at]?.label}
        title={title}
        disabled={disabled}
        onChange={(event) => onChange(choices[Number(event.target.value)]?.value ?? '')}
      />
      {/* The words, for the pointer: the input says the level to a screen reader. */}
      <div className="effort-stops" aria-hidden="true">
        {choices.map((choice, stop) => (
          <span
            key={choice.value}
            className={stop === at ? 'at' : undefined}
            style={{ '--stop': stop } as CSSProperties}
            title={choice.label}
            onClick={disabled ? undefined : () => pick(stop)}
          >
            {stopWord(choice)}
          </span>
        ))}
      </div>
    </div>
  );
}
