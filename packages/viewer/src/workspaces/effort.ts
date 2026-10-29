// The effort stepper (fix/scout-effort-level): a stop for the agent's own level, then one for each
// level it lists (V30b's choices), on the start page and Settings.

/** A stop: the agent's own level (`''`, no level passed) or one it lists, in words. */
export interface EffortChoice {
  value: string;
  label: string;
}

/** The stop `value` is at; the agent's own (the first) for a level the stops do not offer. */
export function stopOf(choices: readonly EffortChoice[], value: string | undefined): number {
  return Math.max(
    0,
    choices.findIndex((choice) => choice.value === (value ?? '')),
  );
}

/**
 * A stop's word under the track: Default for the agent's own (its label says whose), else the
 * level, capitalised as the person's mockup writes them (V63): Low, Max, an x before one kept
 * (xHigh).
 */
export const stopWord = (choice: EffortChoice): string =>
  choice.value === ''
    ? 'Default'
    : choice.label.replace(
        /^(x?)(\p{Ll})/u,
        (_, x: string, first: string) => x + first.toUpperCase(),
      );
