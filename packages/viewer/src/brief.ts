// The start page's brief (V24c): a kind of work, its title and parts, kept across kinds. Pure
// helpers; the kinds and their parts come from `cpr view` (`FeatureOptions.kinds`).
import type { BriefPart, BriefParts, CheckGuess, WorkKind, WorkKindSpec } from '@cpr/core';

/** The parts the start page puts under "More": every kind's optional ones but Done when. */
export type MorePart = 'reproduce' | 'known' | 'where' | 'outOfScope' | 'notes';
const MORE: readonly MorePart[] = ['reproduce', 'known', 'where', 'outOfScope', 'notes'];

/** What the start page holds; the draft `cpr view` keeps while it is not started. */
export interface BriefForm {
  kind: WorkKind;
  title: string;
  /** The kind's one required part: one text whose label changes with the kind. */
  main: string;
  doneWhen: string;
  /** More's parts, each kept when a kind without it is picked. */
  more: Partial<Record<MorePart, string>>;
  /** A branch name the person typed; null while it follows the title. */
  branch: string | null;
}

/** What each part asks, as its text area's placeholder. */
export const HINTS: Record<BriefPart, string> = {
  goal: 'What should it do, and why?',
  happens: 'What goes wrong, and what should happen instead?',
  restructure: 'What, and why is the current shape a problem?',
  change: 'What, and why now? Dependencies, config, docs, tooling.',
  question: 'What do you want to find out, and what will you decide with the answer?',
  reproduce: 'Steps, a command, an error message.',
  known: 'What you know or have tried already.',
  where: 'Files, folders, functions, or code to follow.',
  outOfScope: 'What not to change.',
  notes: 'Anything else: links, constraints, people to ask.',
  doneWhen: 'How will you know it works? A check the agent can run.',
};

/** What each kind is for, in a line: the start page's info beside the kinds. */
export const KIND_ABOUT: Record<WorkKind, string> = {
  feature: 'Something new the code should do.',
  fix: 'Something that goes wrong. The agent reproduces it with a failing test first.',
  refactor: 'A better shape for code that works. Behaviour and what tests assert stay.',
  chore: 'Upkeep: dependencies, config, docs, tooling. Nothing else changes.',
  spike: 'A question to answer. The agent reports what it found and commits nothing.',
};

/** The check with its verb, for Done when's `{checks pass}`. */
export function checkWords(guess: CheckGuess | null): string {
  return guess ? `\`${guess.command}\` passes` : "the project's checks pass";
}

/** Done when's text for a kind until the person changes it; empty for a kind without one. */
export function doneWhenDefault(spec: WorkKindSpec, guess: CheckGuess | null): string {
  return spec.doneWhen?.replace('{checks pass}', checkWords(guess)) ?? '';
}

export function requiredPart(spec: WorkKindSpec): BriefPart {
  return spec.parts.find((p) => p.required)?.part ?? 'goal';
}

/** A kind's parts under "More", in the brief's order. */
export function morePartsOf(spec: WorkKindSpec): MorePart[] {
  return spec.parts.map((p) => p.part).filter((p): p is MorePart => MORE.includes(p as MorePart));
}

export function newForm(spec: WorkKindSpec, guess: CheckGuess | null): BriefForm {
  return {
    kind: spec.kind,
    title: '',
    main: '',
    doneWhen: doneWhenDefault(spec, guess),
    more: {},
    branch: null,
  };
}

/**
 * The form for another kind: every text kept; Done when becomes the new kind's default only while
 * it is the old kind's (untouched).
 */
export function withKind(
  form: BriefForm,
  from: WorkKindSpec,
  to: WorkKindSpec,
  guess: CheckGuess | null,
): BriefForm {
  const untouched = form.doneWhen === doneWhenDefault(from, guess);
  return {
    ...form,
    kind: to.kind,
    doneWhen: untouched ? doneWhenDefault(to, guess) : form.doneWhen,
  };
}

/** The form once the guessed check arrives: an untouched default names it. */
export function withCheck(
  form: BriefForm,
  spec: WorkKindSpec,
  before: CheckGuess | null,
  after: CheckGuess | null,
): BriefForm {
  if (form.doneWhen !== doneWhenDefault(spec, before)) return form;
  return { ...form, doneWhen: doneWhenDefault(spec, after) };
}

/** The parts to send: the kind's own, each with text; the required one under its name. */
export function formParts(form: BriefForm, spec: WorkKindSpec): BriefParts {
  const parts: BriefParts = {};
  const has = (text: string | undefined): text is string => (text ?? '').trim() !== '';
  if (has(form.main)) parts[requiredPart(spec)] = form.main;
  for (const part of morePartsOf(spec)) {
    const text = form.more[part];
    if (has(text)) parts[part] = text;
  }
  if (has(form.doneWhen)) parts.doneWhen = form.doneWhen;
  return parts;
}

/** A part's text as the brief has it: without the blank lines and spaces around it. */
const written = (text: string) => text.replace(/^\s*\n/, '').trimEnd();

/**
 * How long the brief `cpr view` makes of the form will be (`briefOf`: `# <Kind>: <title>`, then
 * `## <heading>` and each part's text, a blank line between), to count against its limit.
 */
export function briefLength(form: BriefForm, spec: WorkKindSpec): number {
  const parts = formParts(form, spec);
  const sections = [`# ${spec.name}: ${form.title.trim()}`];
  for (const { part, heading } of spec.parts) {
    const text = parts[part];
    if (text !== undefined) sections.push(`## ${heading}\n${written(text)}`);
  }
  return `${sections.join('\n\n')}\n`.length;
}

/** A title and the required part: what a start needs. */
export function formReady(form: BriefForm): boolean {
  return form.title.trim() !== '' && form.main.trim() !== '';
}

/**
 * A saved draft (`/api/workspaces/draft`), read as a form: null when it is not one of a known
 * kind; anything not text is left out; no Done when saved is the kind's default.
 */
export function readDraft(
  value: unknown,
  kinds: readonly WorkKindSpec[],
  guess: CheckGuess | null,
): BriefForm | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const spec = kinds.find((k) => k.kind === v.kind);
  if (!spec) return null;
  const text = (x: unknown) => (typeof x === 'string' ? x : '');
  const more: BriefForm['more'] = {};
  const saved = (v.more && typeof v.more === 'object' ? v.more : {}) as Record<string, unknown>;
  for (const part of MORE) if (typeof saved[part] === 'string') more[part] = saved[part];
  return {
    kind: spec.kind,
    title: text(v.title),
    main: text(v.main),
    doneWhen: typeof v.doneWhen === 'string' ? v.doneWhen : doneWhenDefault(spec, guess),
    more,
    branch: typeof v.branch === 'string' ? v.branch : null,
  };
}
