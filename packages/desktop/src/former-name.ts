import { existsSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Symbiote's former name: its settings folder and the viewer's choices were kept under it. The
 * one place the app names it (the CLI has its own, `packages/cli/src/former-name.ts`).
 */
const FORMER_NAME = 'cpr';

/** Moves the former settings folder beside `config` to it, once: only while `config` is absent. */
export function moveFormerConfig(config: string): void {
  if (basename(config) !== 'symbiote' || existsSync(config)) return;
  try {
    renameSync(join(dirname(config), FORMER_NAME), config);
  } catch {
    // None, or another start moved it just now.
  }
}

/** The key a viewer's choice had under the former name. */
export const formerChoice = (key: string): string => key.replace(/^symbiote\./, `${FORMER_NAME}.`);
