// The Settings page's prompts (V28b): pure helpers for the list, the editor and what saving
// says. The prompts and Symbiote's texts come from `symbiote view` (`/api/settings/prompts`).
import type { PromptKey, PromptSetting, PromptSettings } from '@symbiote/core';

/**
 * The agents Symbiote brings, by their prompts' group: each one entry under "Prebuilt agents" and
 * one page for its settings — its model, its effort, its prompt (fix/scout-merger-scribe-settings).
 */
export const PREBUILT_AGENTS = ['Merger', 'Scout', 'Scribe'] as const;
export type PrebuiltAgent = (typeof PREBUILT_AGENTS)[number];
export const PREBUILT_GROUP = 'Prebuilt agents';

const prebuilt = (group: string): group is PrebuiltAgent =>
  (PREBUILT_AGENTS as readonly string[]).includes(group);

/** An entry of Settings' list, and the page it opens. */
export interface SettingsEntry {
  /** The page's key in `?prompt=`: its prompt's, an agent's first prompt's. */
  key: PromptKey;
  /** Its name in the list: the prompt's title, or the agent's name. */
  name: string;
  /** The prompts on its page. */
  prompts: PromptSetting[];
  /** The prebuilt agent whose page it is. */
  agent?: PrebuiltAgent;
}

/**
 * The list by group, in the server's order: a prompt an entry (Workspaces, Reviews), a prebuilt
 * agent one entry for all its prompts, under "Prebuilt agents" where the first of them comes.
 */
export function promptGroups(
  prompts: readonly PromptSetting[],
): { group: string; entries: SettingsEntry[] }[] {
  const groups = new Map<string, SettingsEntry[]>();
  const agents = new Map<PrebuiltAgent, SettingsEntry>();
  for (const prompt of prompts) {
    const agent = prebuilt(prompt.group) ? prompt.group : undefined;
    const group = agent ? PREBUILT_GROUP : prompt.group;
    const entries = groups.get(group) ?? [];
    groups.set(group, entries);
    const known = agent && agents.get(agent);
    if (known) {
      known.prompts.push(prompt);
    } else if (agent) {
      const entry = { key: prompt.key, name: agent, prompts: [prompt], agent };
      agents.set(agent, entry);
      entries.push(entry);
    } else {
      entries.push({ key: prompt.key, name: prompt.title, prompts: [prompt] });
    }
  }
  return [...groups].map(([group, entries]) => ({ group, entries }));
}

/** The entry's mark in the list, for any of its prompts: not saved, not used, then changed. */
export function markOf(
  prompts: readonly PromptSetting[],
  edited: readonly PromptKey[],
): 'unsaved' | 'warning' | 'changed' | null {
  if (prompts.some((p) => edited.includes(p.key))) return 'unsaved';
  if (prompts.some((p) => p.warning)) return 'warning';
  return prompts.some((p) => p.changed) ? 'changed' : null;
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
