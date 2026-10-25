// The kinds of work and the brief (V24): each kind's parts, their headings and order, and the
// brief Symbiote writes from them.
import {
  WORK_KINDS,
  type BriefPart,
  type BriefParts,
  type WorkKind,
  type WorkKindSpec,
} from '@symbiote/core';

/** Longest brief: it goes on the agent's command line (Windows takes 32,767 characters). */
export const MAX_BRIEF = 20_000;

/** Longest title: a workspace's name in lists and the start of its branch's (V24). */
export const MAX_TITLE = 200;

/** Each part's heading in the brief, in the brief's order (V24). */
export const HEADINGS: Record<BriefPart, string> = {
  goal: 'Goal',
  happens: 'What happens',
  restructure: 'What to restructure',
  change: 'What to change',
  question: 'Question',
  reproduce: 'How to reproduce',
  known: 'What is known',
  where: 'Where to look',
  outOfScope: 'Out of scope',
  notes: 'Notes',
  doneWhen: 'Done when',
};

/** Every part a brief can have, in its order. */
export const BRIEF_PARTS = Object.keys(HEADINGS) as BriefPart[];

/**
 * The kinds of work (V24, decision 122): the one part each needs, its others, and Done when's
 * text until the person changes it. What each kind's agent is told is its start prompt (V28).
 */
export const KINDS: Record<
  WorkKind,
  { name: string; required: BriefPart; optional: BriefPart[]; doneWhen?: string }
> = {
  feature: { name: 'Feature', required: 'goal', optional: ['where', 'outOfScope', 'notes'] },
  fix: {
    name: 'Fix',
    required: 'happens',
    optional: ['reproduce', 'where', 'notes'],
    doneWhen: 'A test that fails today passes, and {checks pass}.',
  },
  refactor: {
    name: 'Refactor',
    required: 'restructure',
    optional: ['where', 'outOfScope', 'notes'],
    doneWhen:
      'Behaviour is unchanged: existing tests pass without changing what they assert, and ' +
      '{checks pass}.',
  },
  chore: {
    name: 'Chore',
    required: 'change',
    optional: ['where', 'outOfScope', 'notes'],
    doneWhen: 'Nothing else changes, and {checks pass}.',
  },
  spike: {
    name: 'Spike',
    required: 'question',
    optional: ['known', 'where', 'notes'],
    doneWhen: 'A written answer: what was tried, what was measured, and a recommendation.',
  },
};

/** A kind's parts in the brief's order, Done when last. */
export const partsOf = (kind: WorkKind): BriefPart[] => {
  const { required, optional } = KINDS[kind];
  return BRIEF_PARTS.filter(
    (part) => part === required || part === 'doneWhen' || optional.includes(part),
  );
};

/** The kinds as the start page offers them. */
export function workKinds(): WorkKindSpec[] {
  return WORK_KINDS.map((kind) => {
    const { name, required, doneWhen } = KINDS[kind];
    return {
      kind,
      name,
      parts: partsOf(kind).map((part) => ({
        part,
        heading: HEADINGS[part],
        ...(part === required ? { required: true as const } : {}),
      })),
      ...(doneWhen ? { doneWhen } : {}),
    };
  });
}

/** A part's text as written, without the blank lines and spaces around it. */
const written = (text: string | undefined) => (text ?? '').replace(/^\s*\n/, '').trimEnd();

/**
 * The brief Symbiote gives the agent (V24, decisions 123–124): `# <Kind>: <title>`, then each part
 * with text under its heading in the brief's order, Done when last; the person's text as written.
 */
export function briefOf(kind: WorkKind, title: string, parts: BriefParts): string {
  const sections = [`# ${KINDS[kind].name}: ${title.trim()}`];
  for (const part of partsOf(kind)) {
    const text = written(parts[part]);
    if (text.trim() !== '') sections.push(`## ${HEADINGS[part]}\n${text}`);
  }
  return `${sections.join('\n\n')}\n`;
}
