// A workspace's page in words: its newest merge, when it started, its brief's first words.
import type { MergeEntry } from '@symbiote/core';

/** The workspace's newest entry in the merge queue, if any. */
export function mergeOf(entries: readonly MergeEntry[], branch: string): { merge?: MergeEntry } {
  const merge = entries.filter((entry) => entry.branch === branch).at(-1);
  return merge ? { merge } : {};
}

/** When it started: the time today, else the day. */
export function startedAt(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A brief's first words for the side card (V93): its goal's first paragraph, no Markdown marks. */
export function briefFirst(brief: string): string | undefined {
  const lines = brief
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const text = lines.join(' ').replace(/\*\*|__|`/g, '');
  return text === '' ? undefined : text.length > 240 ? `${text.slice(0, 240).trimEnd()}…` : text;
}
