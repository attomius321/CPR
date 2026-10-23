import type { CheckGuess, WorkKind, WorkKindSpec } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  checkWords,
  doneWhenDefault,
  formParts,
  formReady,
  morePartsOf,
  newForm,
  readDraft,
  requiredPart,
  withCheck,
  withKind,
  type BriefForm,
} from '../src/workspaces/brief.js';

/** The kinds as `symbiote view` gives them (`/api/workspaces/options`). */
const KINDS: WorkKindSpec[] = [
  {
    kind: 'feature',
    name: 'Feature',
    parts: [
      { part: 'goal', heading: 'Goal', required: true },
      { part: 'where', heading: 'Where to look' },
      { part: 'outOfScope', heading: 'Out of scope' },
      { part: 'notes', heading: 'Notes' },
      { part: 'doneWhen', heading: 'Done when' },
    ],
  },
  {
    kind: 'fix',
    name: 'Fix',
    parts: [
      { part: 'happens', heading: 'What happens', required: true },
      { part: 'reproduce', heading: 'How to reproduce' },
      { part: 'where', heading: 'Where to look' },
      { part: 'notes', heading: 'Notes' },
      { part: 'doneWhen', heading: 'Done when' },
    ],
    doneWhen: 'A test that fails today passes, and {checks pass}.',
  },
  {
    kind: 'chore',
    name: 'Chore',
    parts: [
      { part: 'change', heading: 'What to change', required: true },
      { part: 'where', heading: 'Where to look' },
      { part: 'outOfScope', heading: 'Out of scope' },
      { part: 'notes', heading: 'Notes' },
      { part: 'doneWhen', heading: 'Done when' },
    ],
    doneWhen: 'Nothing else changes, and {checks pass}.',
  },
];
const spec = (kind: WorkKind) => KINDS.find((k) => k.kind === kind) as WorkKindSpec;
const PNPM: CheckGuess = { command: 'pnpm run check', source: 'package.json (scripts.check)' };

describe('the start dialog’s brief (V24c)', () => {
  it('says the check with its verb: the command, else the project’s checks', () => {
    expect(checkWords(PNPM)).toBe('`pnpm run check` passes');
    expect(checkWords(null)).toBe("the project's checks pass");
    expect(doneWhenDefault(spec('fix'), PNPM)).toBe(
      'A test that fails today passes, and `pnpm run check` passes.',
    );
    expect(doneWhenDefault(spec('chore'), null)).toBe(
      "Nothing else changes, and the project's checks pass.",
    );
    // A Feature has none: Done when starts empty.
    expect(doneWhenDefault(spec('feature'), PNPM)).toBe('');
  });

  it('names each kind’s required part and its parts under More', () => {
    expect(requiredPart(spec('fix'))).toBe('happens');
    expect(morePartsOf(spec('fix'))).toEqual(['reproduce', 'where', 'notes']);
    expect(morePartsOf(spec('feature'))).toEqual(['where', 'outOfScope', 'notes']);
  });

  it('keeps every text across kinds; Done when follows the kind only while untouched', () => {
    const fix = { ...newForm(spec('fix'), PNPM), title: 'Dates', main: 'They sort as text.' };
    fix.more = { reproduce: 'Sort by Date.', outOfScope: 'kept from an earlier kind' };
    const chore = withKind(fix, spec('fix'), spec('chore'), PNPM);
    expect(chore).toEqual({
      ...fix,
      kind: 'chore',
      doneWhen: 'Nothing else changes, and `pnpm run check` passes.',
    });
    // Back: the same text, the Fix's default again.
    expect(withKind(chore, spec('chore'), spec('fix'), PNPM)).toEqual(fix);
    // Edited, it stays; emptied, it stays empty.
    const edited = { ...fix, doneWhen: 'The table test passes.' };
    expect(withKind(edited, spec('fix'), spec('chore'), PNPM).doneWhen).toBe(
      'The table test passes.',
    );
    expect(withKind({ ...fix, doneWhen: '' }, spec('fix'), spec('chore'), PNPM).doneWhen).toBe('');
    // To a Feature, an untouched default goes: a Feature has none.
    expect(withKind(fix, spec('fix'), spec('feature'), PNPM).doneWhen).toBe('');
  });

  it('puts the guessed command into an untouched default when it arrives', () => {
    const before = newForm(spec('fix'), null);
    expect(before.doneWhen).toBe("A test that fails today passes, and the project's checks pass.");
    expect(withCheck(before, spec('fix'), null, PNPM).doneWhen).toBe(
      'A test that fails today passes, and `pnpm run check` passes.',
    );
    const edited = { ...before, doneWhen: 'My words.' };
    expect(withCheck(edited, spec('fix'), null, PNPM)).toBe(edited);
  });

  it('sends only the kind’s parts that have text, the required one under its name', () => {
    const form: BriefForm = {
      ...newForm(spec('fix'), PNPM),
      title: 'Dates',
      main: 'They sort as text.',
      more: { reproduce: 'Sort by Date.', where: '  ', outOfScope: 'not a Fix part' },
    };
    expect(formParts(form, spec('fix'))).toEqual({
      happens: 'They sort as text.',
      reproduce: 'Sort by Date.',
      doneWhen: 'A test that fails today passes, and `pnpm run check` passes.',
    });
    expect(formParts({ ...form, doneWhen: ' ' }, spec('fix'))).not.toHaveProperty('doneWhen');
  });

  it('is ready with a title and the required part', () => {
    const form = newForm(spec('feature'), null);
    expect(formReady(form)).toBe(false);
    expect(formReady({ ...form, title: 'CSV' })).toBe(false);
    expect(formReady({ ...form, title: ' ', main: 'Export it.' })).toBe(false);
    expect(formReady({ ...form, title: 'CSV', main: 'Export it.' })).toBe(true);
  });

  it('reads a saved draft back; what is not one is none, and unknown fields are dropped', () => {
    const form: BriefForm = {
      ...newForm(spec('fix'), PNPM),
      title: 'Dates',
      main: 'M',
      more: { notes: 'N' },
      branch: 'fix/my-name',
    };
    expect(readDraft(JSON.parse(JSON.stringify(form)), KINDS, PNPM)).toEqual(form);
    expect(readDraft(null, KINDS, PNPM)).toBeNull();
    expect(readDraft({ kind: 'bug', title: 'T' }, KINDS, PNPM)).toBeNull();
    expect(
      readDraft(
        { kind: 'chore', title: 7, main: 'M', more: { notes: 'N', size: 'L', where: 3 } },
        KINDS,
        null,
      ),
    ).toEqual({
      kind: 'chore',
      title: '',
      main: 'M',
      // None saved: the kind's default.
      doneWhen: "Nothing else changes, and the project's checks pass.",
      more: { notes: 'N' },
      branch: null,
    });
    // After a start only the kind is kept: a new form of that kind.
    expect(readDraft({ kind: 'fix' }, KINDS, PNPM)).toEqual(newForm(spec('fix'), PNPM));
    // An emptied Done when stays empty.
    expect(readDraft({ ...form, doneWhen: '' }, KINDS, PNPM)?.doneWhen).toBe('');
  });
});
