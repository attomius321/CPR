// Every text Symbiote's agents are told (V28, decisions 165–171): Symbiote's own as defaults with
// placeholders, a project's under `prompts` in `symbiote/config.json`, and the Settings page's view
// of both. A project's prompts are read at each use: a save applies to the next agent started.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMPT_KEYS, type PromptKey } from '@symbiote/core';
import { CONFIG_FILES } from './plugins.js';
import { DEFAULT_PROMPTS } from './prompt-text.js';
import { SPECS } from './prompt-specs.js';

/** The prompts in use (V28), from the project's config. */
export interface ProjectPrompts {
  /** The config file, repo-relative: the one read, or `symbiote/config.json` when there is none. */
  file: string;
  /** Its text; null when there is no file. */
  source: string | null;
  /** A hash of `source`: a change names it, and is refused when the file changed since. */
  version: string;
  text: Record<PromptKey, string>;
  /** The keys whose project text is in use. */
  changed: Set<PromptKey>;
  /** Why a key's value in the file is not used. */
  warnings: Partial<Record<PromptKey, string>>;
  /** Why none is: the file is not JSON. */
  warning?: string;
}

/** Line ends as `\n`, no blank end: how a prompt is kept and compared. */
export const normalized = (text: string) => text.replace(/\r\n?/g, '\n').trimEnd();

/** Why `text` cannot be `key`'s prompt, or null. */
export function problemOf(key: PromptKey, text: string): string | null {
  const { max, placeholders } = SPECS[key];
  if (text.length > max) return `is longer than ${max.toLocaleString('en-US')} characters`;
  const missing = placeholders.find((p) => p.required && !text.includes(`{${p.name}}`));
  if (missing) return `has no {${missing.name}}: its agent would not be given ${missing.about}`;
  return null;
}

/**
 * A prompt's name before it was renamed, still read while the project has none under the new one,
 * and removed when the new one is saved (NU1, decision 590): `prompts.scout`, Nucleus's.
 */
export const OLDER_KEYS: Partial<Record<PromptKey, string>> = { nucleus: 'scout' };

/** The value at `prompts.<key>`, as given. */
function valueAt(prompts: unknown, key: string): unknown {
  let value = prompts;
  for (const part of key.split('.')) {
    value =
      value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  }
  return value;
}

/** `prompts` from `symbiote/config.json` (else `symbiote.config.json`) at `root`, each checked
 * (V28). */
export function readPrompts(root: string): ProjectPrompts {
  const found = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  let source: string | null = null;
  if (found) {
    try {
      source = readFileSync(join(root, found), 'utf8');
    } catch {
      source = null;
    }
  }
  const file = found ?? CONFIG_FILES[0];
  const text = { ...DEFAULT_PROMPTS };
  const read: ProjectPrompts = {
    file,
    source,
    version:
      source === null ? 'none' : createHash('sha256').update(source).digest('hex').slice(0, 16),
    text,
    changed: new Set(),
    warnings: {},
  };
  if (source === null) return read;
  let prompts: unknown;
  try {
    prompts = (JSON.parse(source) as { prompts?: unknown } | null)?.prompts;
  } catch {
    return { ...read, warning: `${file} is not JSON: Symbiote's prompts are used` };
  }
  for (const key of PROMPT_KEYS) {
    const older = OLDER_KEYS[key];
    const own = valueAt(prompts, key);
    const at = own === undefined && older ? older : key;
    const value = own ?? (older ? valueAt(prompts, older) : undefined);
    if (value === undefined) continue;
    const given =
      typeof value === 'string'
        ? value
        : Array.isArray(value) && value.every((line) => typeof line === 'string')
          ? value.join('\n')
          : null;
    const problem =
      given === null
        ? 'is not text (a string, or a list of lines)'
        : problemOf(key, normalized(given));
    if (given === null || problem) {
      read.warnings[key] = `prompts.${at} ${problem}: Symbiote's is used`;
      continue;
    }
    text[key] = normalized(given);
    read.changed.add(key);
  }
  return read;
}

/** A change the Settings page cannot make: its status and why. */
export class PromptRefused extends Error {
  override name = 'PromptRefused';
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}
