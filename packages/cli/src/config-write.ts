// `symbiote/config.json` written (V28, V47): a prompt saved or reset, any setting set, one write at
// a time, the file's own formatting and comments kept.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PROMPT_KEYS, type PromptChange } from '@symbiote/core';
import { applyEdits, modify, type FormattingOptions } from 'jsonc-parser';
import {
  type ProjectPrompts,
  normalized,
  problemOf,
  OLDER_KEYS,
  readPrompts,
  PromptRefused,
} from './prompts.js';
import { DEFAULT_PROMPTS } from './prompt-text.js';

/** The file's own indentation and line ends, for what is written into it. */
function formatting(source: string): FormattingOptions {
  const indent = /\n([ \t]+)"/.exec(source)?.[1] ?? '  ';
  return {
    insertSpaces: !indent.startsWith('\t'),
    tabSize: indent.startsWith('\t') ? 1 : indent.length,
    eol: source.includes('\r\n') ? '\r\n' : '\n',
  };
}

/** One write at a time: each reads the file it changes. */
let writing: Promise<unknown> = Promise.resolve();

function oneAtATime(task: () => Promise<void>): Promise<void> {
  const next = writing.then(task);
  writing = next.catch(() => undefined);
  return next;
}

/**
 * Sets `key`'s prompt in the project's config, or removes it (`null`, or Symbiote's own text), with
 * the rest of the file as it was (decision 167); an emptied section is removed with it.
 */
export function writePrompt(root: string, change: PromptChange): Promise<void> {
  return oneAtATime(() => write(root, change));
}

/**
 * Sets the value at `path` in the project's config, or removes it (`undefined`), as a prompt is
 * written: the rest of the file as it was, an emptied section removed with it. Refused (409) when
 * the file is not JSON.
 */
export function writeConfig(
  root: string,
  path: readonly string[],
  value: ConfigValue,
  older?: readonly string[],
): Promise<void> {
  return oneAtATime(async () => {
    const current = readPrompts(root);
    if (current.warning) throw new PromptRefused(`${current.file} is not JSON: fix it first`, 409);
    // The setting's name before a rename goes in the same write (NU1: `scout.effort`).
    await setIn(root, current, [[path, value], ...(older ? [[older, undefined] as const] : [])]);
  });
}

/** A value Settings writes in the project's config: a list is a check's commands. */
type ConfigValue = string | number | boolean | readonly string[] | undefined;

/**
 * `writeConfig` of a page that read the file first (fix/settings-page, the check): refused (409)
 * when the file changed since `version`, as a prompt's save is.
 */
export function writeConfigAt(
  root: string,
  path: readonly string[],
  value: ConfigValue,
  version: string,
): Promise<void> {
  return oneAtATime(async () => {
    const current = readPrompts(root);
    if (current.version !== version) {
      throw new PromptRefused(`${current.file} changed since you opened it: open it again`, 409);
    }
    if (current.warning) throw new PromptRefused(`${current.file} is not JSON: fix it first`, 409);
    await setIn(root, current, [[path, value]]);
  });
}

async function write(root: string, change: PromptChange): Promise<void> {
  const { key } = change;
  if (!PROMPT_KEYS.includes(key)) throw new PromptRefused(`not a prompt: ${String(key)}`, 400);
  const current = readPrompts(root);
  if (current.version !== change.version) {
    throw new PromptRefused(`${current.file} changed since you opened it: open it again`, 409);
  }
  if (current.warning) throw new PromptRefused(`${current.file} is not JSON: fix it first`, 409);
  const text = change.text === null ? null : normalized(change.text);
  const problem = text === null ? null : problemOf(key, text);
  if (problem) throw new PromptRefused(`prompts.${key} ${problem}`, 400);
  // A one-line prompt is a string, a longer one its lines (decision 168).
  const value =
    text === null || text === DEFAULT_PROMPTS[key]
      ? undefined
      : text.includes('\n')
        ? text.split('\n')
        : text;
  const older = OLDER_KEYS[key];
  await setIn(root, current, [
    [['prompts', ...key.split('.')], value],
    ...(older ? [[['prompts', older], undefined] as const] : []),
  ]);
}

/**
 * Sets each `path` to its `value` in the config `current` read, in order, or removes it with its
 * emptied sections.
 */
async function setIn(
  root: string,
  current: ProjectPrompts,
  changes: readonly (readonly [readonly string[], unknown])[],
): Promise<void> {
  const before = current.source ?? '{}\n';
  const options = { formattingOptions: formatting(before) };
  let after = before;
  for (const [path, value] of changes) {
    const at = path.reduce<unknown>(
      (object, part) => (object as Record<string, unknown> | undefined)?.[part],
      JSON.parse(after),
    );
    // Nothing to remove: the file as it was (`modify` would still write an emptied `{}`).
    if (value === undefined && at === undefined) continue;
    after = applyEdits(after, modify(after, [...path], value, options));
    // A section left empty goes too: `prompts.start`, then `prompts`.
    for (let end = path.length - 1; value === undefined && end > 0; end--) {
      const section = path.slice(0, end);
      const left = section.reduce<unknown>(
        (object, part) => (object as Record<string, unknown> | undefined)?.[part],
        JSON.parse(after),
      );
      if (!left || typeof left !== 'object' || Object.keys(left).length > 0) break;
      after = applyEdits(after, modify(after, [...section], undefined, options));
    }
  }
  if (after === before) return;
  await mkdir(dirname(join(root, current.file)), { recursive: true });
  await writeFile(join(root, current.file), after);
}
