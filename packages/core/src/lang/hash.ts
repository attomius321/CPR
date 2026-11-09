import { createHash } from 'node:crypto';

/** A symbol's signature or body hash, in every language: 16 hex characters of its parts. */
export function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}
