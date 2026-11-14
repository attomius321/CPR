// What both forges' issue reads share (IS1): the list's cursor, a label's colour, the size of a
// page.
import { SymbioteError } from '@symbiote/core';
import type { IssueLabel } from './types.js';

/** Issues a page of the list holds (decision 946). */
export const ISSUES_PER_PAGE = 30;
/** API pages read at most to fill one (GitHub's list mixes in pull requests: 64 of 100 on vite). */
export const MAX_CALLS = 3;
/** Comments read of one issue: its first API page (decision 948). */
export const COMMENTS = 100;

/**
 * Where a list goes on: the forge's page (and GitHub's `after` cursor, which its `Link` carries),
 * and how many issues of that page were shown already. The page gets it as text and sends it
 * back: only this shape is taken (decision 946), never an address.
 */
export interface Cursor {
  page: number;
  after?: string;
  skip: number;
}

const CURSOR = /^(\d{1,6})~([A-Za-z0-9+/=_-]{0,300})~(\d{1,3})$/;

export function writeCursor({ page, after, skip }: Cursor): string {
  return `${page}~${after ?? ''}~${skip}`;
}

/** Whether `text` has a cursor's shape (IS1): the server refuses any other before the forge. */
export function isIssueCursor(text: string): boolean {
  const match = CURSOR.exec(text);
  return !!match && Number(match[1]) >= 1;
}

export function readCursor(text: string): Cursor {
  const match = CURSOR.exec(text);
  const page = Number(match?.[1]);
  if (!match || page < 1)
    throw new SymbioteError(`'${text.slice(0, 40)}' is not a page of this list`);
  return { page, ...(match[2] ? { after: match[2] } : {}), skip: Number(match[3]) };
}

/** The page and cursor an API's next address names, as a cursor at its start. */
export function cursorOf(next: string | undefined): Cursor | undefined {
  if (!next) return undefined;
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    return undefined;
  }
  const page = Number(url.searchParams.get('page') ?? '');
  const after = url.searchParams.get('after') ?? undefined;
  if (!(page >= 1) && !after) return undefined;
  const cursor = { page: page >= 1 ? page : 1, ...(after ? { after } : {}), skip: 0 };
  // A cursor the forge gave that this list would refuse ends the list rather than break it.
  return CURSOR.test(writeCursor(cursor)) ? cursor : undefined;
}

/** A label; its colour kept only when it is one (`#rrggbb`): the forge's text is untrusted. */
export function labelOf(label: { name?: string; color?: string | null } | string): IssueLabel {
  if (typeof label === 'string') return { name: label };
  const color = label.color?.replace(/^#/, '') ?? '';
  return {
    name: label.name ?? '',
    ...(/^[0-9a-f]{6}$/i.test(color) ? { color: `#${color.toLowerCase()}` } : {}),
  };
}

/**
 * Labels known to exist, by API and project (HV11, decision 1018): each is made once a project,
 * whichever forge object a call makes.
 */
const knownLabels = new Set<string>();

/** Whether `name` is known to exist in `project` at `api`. */
export const labelKnown = (api: string, project: string, name: string) =>
  knownLabels.has(`${api}\n${project}\n${name}`);

export function knowLabel(api: string, project: string, name: string): void {
  knownLabels.add(`${api}\n${project}\n${name}`);
}

/** Forgets the labels known (tests). */
export function clearKnownLabels(): void {
  knownLabels.clear();
}
