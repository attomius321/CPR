// Settings' Issues group in words (HV9c), pure: the project's text's count (decision 1060) and a
// repository's standing against 1040's bar (1059). No word of any one repository.
import type { ClassifierSettings } from '@symbiote/core';

const number = (n: number) => n.toLocaleString('en-US');

/** "1,234 of 4,000 characters", and whether the text is over the most it may be saved at. */
export function aboutCount(text: string, max: number): { words: string; over: boolean } {
  const length = text.trim().length;
  const words = `${number(length)} of ${number(max)} characters`;
  return length > max
    ? { words: `${words}: ${number(length - max)} too many`, over: true }
    : { words, over: false };
}

/** The records under the current classifier, by decision: "6 classified …: 2 taken (1 held)". */
function classifiedWords(c: NonNullable<ClassifierSettings['standing']>['classified']): string {
  const total = c.take + c.ask + c.refuse + c.failed;
  if (total === 0) return 'None classified under this classifier yet.';
  const parts = [
    ...(c.take ? [`${c.take} taken${c.held ? ` (${c.held} held)` : ''}`] : []),
    ...(c.ask ? [`${c.ask} asked`] : []),
    ...(c.refuse ? [`${c.refuse} refused`] : []),
    ...(c.failed ? [`${c.failed} failed`] : []),
  ];
  return `${total} classified under this classifier: ${parts.join(', ')}.`;
}

/**
 * The standing's row: its value (judged takes of the bar's, or Met) and its facts: what was
 * classified, what was judged, the hostile test issues. Without a standing, why.
 */
export function standingWords(settings: ClassifierSettings): {
  value: string;
  met: boolean;
  facts: string[];
} {
  const standing = settings.standing;
  if (!standing) {
    const why =
      settings.about === null
        ? 'Counted once the project’s text is saved: each text and classifier has its own count.'
        : `${(settings.why ?? 'Not counted here').replace(/\.$/, '')}.`;
    return { value: 'Not counted', met: false, facts: [why] };
  }
  const { right, wrong } = standing.judged;
  const judged = right + wrong;
  const judgedWords =
    judged === 0
      ? 'No take judged yet: a take is judged once the work started from it lands or stops.'
      : `${judged} ${judged === 1 ? 'take' : 'takes'} judged: ${right} right, ${wrong} wrong (${Math.floor((right / judged) * 100)} %).`;
  const hostile = standing.hostile;
  const hostileWords = !hostile
    ? 'The hostile test issues have not run with this project’s text.'
    : hostile.taken === 0
      ? `None of ${hostile.of} hostile test issues taken.`
      : `${hostile.taken} of ${hostile.of} hostile test issues taken.`;
  return {
    value: standing.meets ? 'Met' : `${judged} of ${standing.bar.takes} judged`,
    met: standing.meets,
    facts: [classifiedWords(standing.classified), judgedWords, hostileWords],
  };
}
