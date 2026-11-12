// The pages' calls to `symbiote view` (V18): reads, and writes with the headers the server asks
// for: JSON, the custom header, and the page key (SC1, decision 930).
import { noteKeyRefusal, pageKey } from './page-key.js';

/**
 * What the page alone may ask with: `x-symbiote: 1` and the page key once the page has one; a
 * read that only the page may make sends them too (the Confirm's asks, a workspace's shells).
 */
export async function pageHeaders(): Promise<Record<string, string>> {
  const key = await pageKey();
  return { 'x-symbiote': '1', ...(key ? { 'x-symbiote-key': key } : {}) };
}

/** What a write sends: JSON and `pageHeaders()`. */
export async function writeHeaders(): Promise<Record<string, string>> {
  return { 'content-type': 'application/json', ...(await pageHeaders()) };
}

/**
 * A write to `symbiote view` (a POST unless `init` says otherwise) with `writeHeaders()`: its
 * answer; a refusal for want of the page key is told to the page ("Open from Symbiote").
 */
export async function write(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, {
    method: 'POST',
    ...init,
    headers: { ...(await writeHeaders()), ...(init.headers as Record<string, string>) },
  });
  noteKeyRefusal(response);
  return response;
}

/** A write's answer, or the server's words (`{ error }` or text) as an error. */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await write(path, { body: JSON.stringify(body) });
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

/** A file's bytes as base64, for the server (V36's images, V40's documents). */
export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // A data URL, as asked: its text after the comma.
    reader.onload = () => resolve((reader.result as string).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error(`${file.name} could not be read`));
    reader.readAsDataURL(file);
  });
}
