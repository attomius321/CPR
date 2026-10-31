// History's calls to `symbiote view` (V9–V15): rows, shape and branches of the history, the
// repository's refs and state, a checkout, a branch review, and the diffs it starts and stops.
import type {
  BranchReviewList,
  CheckoutResult,
  CheckoutTarget,
  HistoryPage,
  HistoryRefs,
  HistoryScope,
  HistoryShape,
} from '@symbiote/core';
import { graphLoaded, type Loaded, type Pair } from './commits.js';

/** History's API and the diffs it starts live at the server's root (`symbiote view`). */
const API_ROOT = '/';

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-symbiote': '1' };

/** The history changed since the page listed it (a branch moved): it must list it again. */
export class StaleHistory extends Error {}

export async function fetchRows(
  scope: HistoryScope,
  from: number,
  to: number,
  version?: string,
): Promise<HistoryPage> {
  const query = new URLSearchParams({ scope, from: String(from), to: String(to) });
  if (version) query.set('version', version);
  const response = await fetch(`${API_ROOT}api/history?${query}`);
  if (response.status === 409) throw new StaleHistory();
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as HistoryPage;
}

export async function fetchShape(scope: HistoryScope, version: string): Promise<HistoryShape> {
  const query = new URLSearchParams({ scope, version });
  const response = await fetch(`${API_ROOT}api/history/shape?${query}`);
  if (response.status === 409) throw new StaleHistory();
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as HistoryShape;
}

/** The branches with their tips' rows in this listing (V10b). */
export async function fetchBranches(scope: HistoryScope, version: string): Promise<HistoryRefs> {
  const query = new URLSearchParams({ scope, version });
  const response = await fetch(`${API_ROOT}api/history/refs?${query}`);
  if (response.status === 409) throw new StaleHistory();
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as HistoryRefs;
}

/** The rows of commits in a listing, by SHA; null for one it does not list (decision 634). */
export async function fetchRowsOf(
  scope: HistoryScope,
  version: string,
  shas: readonly string[],
): Promise<(number | null)[]> {
  const query = new URLSearchParams({ scope, version });
  for (const sha of shas) query.append('sha', sha);
  const response = await fetch(`${API_ROOT}api/history/rows?${query}`);
  if (response.status === 409) throw new StaleHistory();
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as { rows: (number | null)[] }).rows;
}

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

/** Checks out a target; resolves with where HEAD is, or rejects with git's (or Symbiote's) words.
 * */
export async function postCheckout(target: CheckoutTarget): Promise<CheckoutResult> {
  const response = await fetch(`${API_ROOT}api/checkout`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(target),
  });
  if (response.ok) return (await response.json()) as CheckoutResult;
  const text = await response.text();
  let message = text;
  try {
    message = (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    // a plain-text refusal
  }
  throw new Error(message);
}

/** Starts analyzing a pair (or finds it analyzed); resolves with its page's URL. */
export async function startDiff(pair: Pair): Promise<string> {
  const response = await fetch(`${API_ROOT}api/diffs`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(pair),
  });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as { url: string }).url;
}

/** Starts reviewing a branch (V15); resolves with its page's URL, or rejects with why not. */
export async function startReview(ref: string): Promise<string> {
  const response = await fetch(`${API_ROOT}api/reviews`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify({ ref }),
  });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as { url: string }).url;
}

/** The reviewer's branch reviews (V15); null when the server keeps none. */
export async function fetchReviews(): Promise<BranchReviewList | null> {
  const response = await fetch(`${API_ROOT}api/reviews`);
  return response.ok ? ((await response.json()) as BranchReviewList) : null;
}

export async function stopDiff(pair: Pair): Promise<void> {
  await fetch(`${API_ROOT}api/diffs/stop`, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(pair),
  });
}

/** This page's graph, or how its analysis is going. */
export async function fetchGraph(url: string): Promise<Loaded> {
  try {
    const response = await fetch(url);
    const body: unknown = await response.json().catch(() => null);
    return graphLoaded(response.status, body);
  } catch {
    return { kind: 'missing' };
  }
}
