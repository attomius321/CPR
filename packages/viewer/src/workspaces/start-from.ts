import type { StartBranch } from '@symbiote/core';
import { shortSha } from '../history/commits.js';

/** An entry of Start from (V68): a History row's commit, or a branch. */
export interface StartChoice {
  /** A branch's name; empty for the row's commit. */
  value: string;
  label: string;
  /** The label's letters a search found, `[start, end)`, in order and apart. */
  marks: [number, number][];
}

/** The commit's entry alone, then the local branches, then those only on a remote. */
export interface StartGroup {
  key: 'commit' | 'local' | 'remote';
  /** None for the commit's. */
  heading?: string;
  choices: StartChoice[];
}

/**
 * Start from's entries for a search (V68, decision 491): those whose label holds every word of
 * `query`, any case, in the order given (the server's: the default branch first); each word's
 * first place marked. A group with no entry is left out.
 */
export function startChoices(
  branches: readonly StartBranch[],
  at: string | undefined,
  query: string,
): StartGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const choose = (value: string, label: string): StartChoice[] => {
    const marks = marksOf(label, words);
    return marks ? [{ value, label, marks }] : [];
  };
  const groups: StartGroup[] = [
    { key: 'commit', choices: at ? choose('', `The commit ${shortSha(at)}`) : [] },
    {
      key: 'local',
      heading: 'Local',
      choices: branches.filter((b) => !b.remote).flatMap((b) => choose(b.name, b.name)),
    },
    {
      key: 'remote',
      heading: 'Only on a remote',
      choices: branches.filter((b) => b.remote).flatMap((b) => choose(b.name, b.name)),
    },
  ];
  return groups.filter((group) => group.choices.length > 0);
}

/** Where each word first is in `label`, merged where they meet; null when one is not. */
function marksOf(label: string, words: readonly string[]): [number, number][] | null {
  const lower = label.toLowerCase();
  const found: [number, number][] = [];
  for (const word of words) {
    const at = lower.indexOf(word);
    if (at < 0) return null;
    found.push([at, at + word.length]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const marks: [number, number][] = [];
  for (const [start, end] of found) {
    const last = marks.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else marks.push([start, end]);
  }
  return marks;
}

/** A label in pieces, each marked or not, for drawing its marks. */
export function markedParts(
  label: string,
  marks: readonly (readonly [number, number])[],
): { text: string; marked: boolean }[] {
  const parts: { text: string; marked: boolean }[] = [];
  let at = 0;
  for (const [start, end] of marks) {
    if (start > at) parts.push({ text: label.slice(at, start), marked: false });
    parts.push({ text: label.slice(start, end), marked: true });
    at = end;
  }
  if (at < label.length) parts.push({ text: label.slice(at), marked: false });
  return parts;
}
