import { createHash } from 'node:crypto';
import { SymbioteError } from '@symbiote/core';

/**
 * A forge's refusal (HV11, decision 1023): its HTTP status and its answer, cut, kept for the
 * record; 0 when the forge was not reached.
 */
export class ForgeError extends SymbioteError {
  override name = 'ForgeError';
  constructor(
    message: string,
    readonly status: number,
    readonly answer: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers: Record<string, string>;
  /** Names the token variables, for the authentication error message. */
  tokenHint: string;
}

/** A JSON API call with errors a person can act on (missing token, no access, not found). */
export async function api<T>(url: string, options: ApiOptions): Promise<T> {
  return (await answered<T>(url, options)).body;
}

/** A JSON API call, its body and its answer's headers (HV11: GitHub's `x-oauth-scopes`). */
export async function answered<T>(
  url: string,
  options: ApiOptions,
): Promise<{ body: T; headers: Headers }> {
  const response = await call(url, options);
  const text = await response.text();
  return { body: (text ? JSON.parse(text) : undefined) as T, headers: response.headers };
}

/** The most of a forge's answer an error keeps. */
const ANSWER = 300;

/** What a read gave besides its body: where the list goes on. */
export interface ReadAnswer<T> {
  body: T;
  /** The `Link` header's `rel="next"` address (both forges). */
  next?: string;
  /** GitLab's `x-next-page`. */
  nextPage?: string;
}

interface Kept {
  etag: string;
  answer: ReadAnswer<unknown>;
}

/**
 * Answers kept by address and the headers sent (IS1, decision 950): a token's answer is never
 * another's. A read sends the ETag it got; a 304 is answered from here, and GitHub does not count
 * it against the rate limit.
 */
const conditional = new Map<string, Kept>();
const KEPT = 100;

/** Forgets every answer kept (tests). */
export function clearConditional(): void {
  conditional.clear();
}

/** A conditional GET (IS1): the body and the next page, a 304 answered from what was kept. */
export async function read<T>(url: string, options: ApiOptions): Promise<ReadAnswer<T>> {
  const key = `${url}\n${createHash('sha256').update(JSON.stringify(options.headers)).digest('hex')}`;
  const kept = conditional.get(key);
  const response = await call(url, {
    ...options,
    method: 'GET',
    headers: { ...options.headers, ...(kept ? { 'if-none-match': kept.etag } : {}) },
  });
  if (response.status === 304 && kept) {
    conditional.delete(key);
    conditional.set(key, kept);
    return kept.answer as ReadAnswer<T>;
  }
  const text = await response.text();
  const next = nextLink(response.headers.get('link'));
  const nextPage = response.headers.get('x-next-page');
  const answer: ReadAnswer<T> = {
    body: (text ? JSON.parse(text) : undefined) as T,
    ...(next ? { next } : {}),
    ...(nextPage ? { nextPage } : {}),
  };
  const etag = response.headers.get('etag');
  conditional.delete(key);
  if (etag) {
    conditional.set(key, { etag, answer });
    if (conditional.size > KEPT) conditional.delete(conditional.keys().next().value ?? '');
  }
  return answer;
}

/** The `rel="next"` address of a `Link` header. */
function nextLink(header: string | null): string | undefined {
  for (const part of header?.split(',') ?? []) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** The fetch, its failures in words. A 304 is the caller's. */
async function call(
  url: string,
  { method = 'GET', body, headers, tokenHint }: ApiOptions,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        'user-agent': 'symbiote',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    const message = (error as Error).message;
    throw new ForgeError(`could not reach ${new URL(url).host}: ${message}`, 0, message, {
      cause: error,
    });
  }

  const { status } = response;
  if (status === 401) {
    throw new ForgeError(
      `${new URL(url).host} rejected the request: authentication failed (set ${tokenHint})`,
      status,
      (await response.text()).slice(0, ANSWER),
    );
  }
  const limited = rateLimited(response);
  if (limited) {
    throw new ForgeError(
      `${new URL(url).host}'s rate limit is used up${limited === true ? '' : `; it resets at ${limited}`} (set ${tokenHint} for more)`,
      status,
      (await response.text()).slice(0, ANSWER),
    );
  }
  if (status === 403 || status === 404) {
    const text = await response.text();
    throw new ForgeError(
      `${new URL(url).host} answered ${status} for ${new URL(url).pathname}: ` +
        `not found, or no access with the current token (${tokenHint})${text ? ` — ${text.slice(0, 200)}` : ''}`,
      status,
      text.slice(0, ANSWER),
    );
  }
  if (status === 304) return response;
  if (!response.ok) {
    const text = (await response.text()).slice(0, ANSWER);
    throw new ForgeError(`${new URL(url).host} answered ${status}: ${text}`, status, text);
  }
  return response;
}

/**
 * Whether a 403 or 429 is a rate limit (IS1): its reset as `YYYY-MM-DD HH:MM UTC` when the forge
 * says it (GitHub's `x-ratelimit-reset`, GitLab's `ratelimit-reset`, or `retry-after`), else true.
 */
function rateLimited(response: Response): string | boolean {
  if (response.status !== 403 && response.status !== 429) return false;
  const header = (name: string) => response.headers.get(name);
  const used = header('x-ratelimit-remaining') === '0' || header('ratelimit-remaining') === '0';
  const retry = Number(header('retry-after'));
  if (!used && response.status !== 429 && !retry) return false;
  const reset = Number(header('x-ratelimit-reset') ?? header('ratelimit-reset'));
  const at = reset > 0 ? reset * 1000 : retry > 0 ? Date.now() + retry * 1000 : 0;
  return at ? new Date(at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : true;
}

export const PER_PAGE = 100;
/** A safety stop: 5,000 comments is more than any review thread worth reading. */
const MAX_PAGES = 50;

/** Every item of a paginated list (`?per_page=100&page=n`): pages until a short one. */
export async function paged<T>(get: (query: string) => Promise<T[]>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await get(`per_page=${PER_PAGE}&page=${page}`);
    items.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return items;
}
