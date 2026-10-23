// The Settings page's prompts (V28b): pure helpers for the list, the editor and what saving
// says. The prompts and Symbiote's texts come from `symbiote view` (`/api/settings/prompts`).
import type { PromptKey, PromptSetting, PromptSettings } from '@symbiote/core';

/** The prompts by group (Workspaces, Reviews, Merger), in the server's order. */
export function promptGroups(
  prompts: readonly PromptSetting[],
): { group: string; prompts: PromptSetting[] }[] {
  const groups = new Map<string, PromptSetting[]>();
  for (const prompt of prompts) {
    const group = groups.get(prompt.group);
    if (group) group.push(prompt);
    else groups.set(prompt.group, [prompt]);
  }
  return [...groups].map(([group, of]) => ({ group, prompts: of }));
}

/** Line ends as `\n`, no blank end: as the server keeps a prompt. */
const normalized = (text: string) => text.replace(/\r\n?/g, '\n').trimEnd();

/** Why the server would refuse `text` as the prompt, or null (as `symbiote view` checks it). */
export function draftProblem(prompt: PromptSetting, text: string): string | null {
  const length = normalized(text).length;
  if (length > prompt.max) {
    return `Longer than ${prompt.max.toLocaleString('en-US')} characters (${length.toLocaleString('en-US')}).`;
  }
  const missing = prompt.placeholders.find((p) => p.required && !text.includes(`{${p.name}}`));
  return missing
    ? `{${missing.name}} is missing: the agent would not be given ${missing.about}.`
    : null;
}

/** Whether the draft would change the prompt in use. */
export const isEdited = (prompt: PromptSetting, draft: string | undefined): boolean =>
  draft !== undefined && normalized(draft) !== prompt.text;

/** Characters of the limit, and about how many tokens (4 characters each). */
export function sizeOf(prompt: PromptSetting, text: string): string {
  const n = (value: number) => value.toLocaleString('en-US');
  return `${n(text.length)} of ${n(prompt.max)} characters, about ${n(Math.ceil(text.length / 4))} tokens`;
}

/** What the config file's state in git means for the prompts in it. */
export function gitNote({ file, git }: PromptSettings): string {
  switch (git) {
    case 'none':
      return "No prompt changed: every agent is told Symbiote's text.";
    case 'new':
      return (
        `Saved in ${file}, not committed: commit it to share the prompts with everyone who uses ` +
        'this repository.'
      );
    case 'changed':
      return `${file} has changes not committed: commit them to share them.`;
    case 'committed':
      return `Shared: ${file} is committed as it is.`;
    case 'ignored':
      return `${file} is ignored by git here: the prompts stay on this machine.`;
  }
}

/** `text` with `insert` over `start`–`end` (a text area's selection), and where the cursor goes. */
export function insertAt(
  text: string,
  start: number,
  end: number,
  insert: string,
): { text: string; cursor: number } {
  return { text: text.slice(0, start) + insert + text.slice(end), cursor: start + insert.length };
}

/** `?prompt=<key>`: the prompt (or setting) open, when there is one by that key; else the first. */
export function promptOfUrl<K extends string = PromptKey>(
  search: string,
  keys: readonly K[],
): K | null {
  const asked = new URLSearchParams(search).get('prompt');
  return keys.find((key) => key === asked) ?? keys[0] ?? null;
}
