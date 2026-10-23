// The pages' calls to `symbiote view` (V18): reads, and writes with the header the server asks for.

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-symbiote': '1' };

/** A write's answer, or the server's words (`{ error }` or text) as an error. */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.ok) return JSON.parse(text) as T;
  throw new Error(serverWords(text));
}

/** What a refusal says: its `{ error }`, or its text. */
export function serverWords(text: string): string {
  try {
    return (JSON.parse(text) as { error?: string } | null)?.error ?? text;
  } catch {
    return text; // a plain-text refusal
  }
}

/** A read's answer, or the server's words as an error. */
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}
