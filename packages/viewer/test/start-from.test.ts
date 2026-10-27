import type { StartBranch } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { markedParts, startChoices, type StartGroup } from '../src/workspaces/start-from.js';

const sha = (c: string) => c.repeat(40);
// As the server lists them (V33): the default branch first, then local, then only on a remote.
const BRANCHES: StartBranch[] = [
  { name: 'main', sha: sha('a') },
  { name: 'feature/start-workspace-source-start-from', sha: sha('b') },
  { name: 'milestone/v65-review-against', sha: sha('c') },
  { name: 'Fix/Title-Bar', sha: sha('d') },
  { name: 'feature/old-start', sha: sha('e'), remote: true },
  { name: 'chore/journal', sha: sha('f'), remote: true },
];
/** The groups as short strings: a heading with its count, then each label, its marks in []. */
const shape = (groups: StartGroup[]) =>
  groups.map((group) => [
    group.heading ? `${group.heading} ${group.choices.length}` : '-',
    ...group.choices.map((choice) =>
      markedParts(choice.label, choice.marks)
        .map((part) => (part.marked ? `[${part.text}]` : part.text))
        .join(''),
    ),
  ]);

describe('startChoices', () => {
  it('lists every branch in the order given, local then only on a remote', () => {
    expect(shape(startChoices(BRANCHES, undefined, ''))).toEqual([
      [
        'Local 4',
        'main',
        'feature/start-workspace-source-start-from',
        'milestone/v65-review-against',
        'Fix/Title-Bar',
      ],
      ['Only on a remote 2', 'feature/old-start', 'chore/journal'],
    ]);
  });

  it("puts a History row's commit first, its value empty", () => {
    const groups = startChoices(BRANCHES, sha('9'), '  ');
    expect(groups[0]).toEqual({
      key: 'commit',
      choices: [{ value: '', label: 'The commit 9999999', marks: [] }],
    });
    expect(groups.map((g) => g.key)).toEqual(['commit', 'local', 'remote']);
  });

  it('keeps names holding every word, in any order and case, and marks the first of each', () => {
    expect(shape(startChoices(BRANCHES, undefined, 'AGAINST v65'))).toEqual([
      ['Local 1', 'milestone/[v65]-review-[against]'],
    ]);
    expect(shape(startChoices(BRANCHES, undefined, 'start'))).toEqual([
      ['Local 1', 'feature/[start]-workspace-source-start-from'],
      ['Only on a remote 1', 'feature/old-[start]'],
    ]);
    expect(shape(startChoices(BRANCHES, undefined, 'title-b'))).toEqual([
      ['Local 1', 'Fix/[Title-B]ar'],
    ]);
  });

  it('merges marks that overlap or touch', () => {
    expect(shape(startChoices(BRANCHES, undefined, 'feat ture/'))).toEqual([
      ['Local 1', '[feature/]start-workspace-source-start-from'],
      ['Only on a remote 1', '[feature/]old-start'],
    ]);
    expect(shape(startChoices(BRANCHES, undefined, 'chore /journal'))).toEqual([
      ['Only on a remote 1', '[chore/journal]'],
    ]);
  });

  it('finds the commit by its words and its short SHA', () => {
    expect(shape(startChoices(BRANCHES, sha('9'), '9999'))).toEqual([
      ['-', 'The commit [9999]999'],
    ]);
    expect(shape(startChoices(BRANCHES, sha('9'), 'commit'))).toEqual([
      ['-', 'The [commit] 9999999'],
    ]);
  });

  it('leaves out a group with no match, and everything when nothing matches', () => {
    expect(startChoices(BRANCHES, sha('9'), 'journal').map((g) => g.key)).toEqual(['remote']);
    expect(startChoices(BRANCHES, sha('9'), 'nothing-like-it')).toEqual([]);
  });
});

describe('markedParts', () => {
  it('cuts a label at its marks', () => {
    expect(
      markedParts('feature/one', [
        [0, 3],
        [8, 11],
      ]),
    ).toEqual([
      { text: 'fea', marked: true },
      { text: 'ture/', marked: false },
      { text: 'one', marked: true },
    ]);
    expect(markedParts('main', [])).toEqual([{ text: 'main', marked: false }]);
  });
});
