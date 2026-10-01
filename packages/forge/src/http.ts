import { CprError } from '@cpr/core';

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers: Record<string, string>;
  /** Names the token variables, for the authentication error message. */
  tokenHint: string;
}

/** A JSON API call with errors a person can act on (missing token, no access, not found). */
export async function api<T>(
  url: string,
  { method = 'GET', body, headers, tokenHint }: ApiOptions,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        'user-agent': 'cpr',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new CprError(`could not reach ${new URL(url).host}: ${(error as Error).message}`, {
      cause: error,
    });
  }

  if (response.status === 401) {
    throw new CprError(
      `${new URL(url).host} rejected the request: authentication failed (set ${tokenHint})`,
    );
  }
  if (response.status === 403 || response.status === 404) {
    const text = await response.text();
    throw new CprError(
      `${new URL(url).host} answered ${response.status} for ${new URL(url).pathname}: ` +
        `not found, or no access with the current token (${tokenHint})${text ? ` — ${text.slice(0, 200)}` : ''}`,
    );
  }
  if (!response.ok) {
    throw new CprError(
      `${new URL(url).host} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
