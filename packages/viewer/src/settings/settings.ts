// The Settings page's prompts (V28b): pure helpers for the list, the editor and what saving
// says. The prompts and Symbiote's texts come from `symbiote view` (`/api/settings/prompts`).
import type { PromptKey, PromptSetting, PromptSettings } from '@symbiote/core';
import { nucleusName } from '../shell/names.js';

/**
 * The agents Symbiote brings, by their prompts' group: each one entry under "Prebuilt agents" and
 * one page for its settings — its model, its effort, its prompt (fix/scout-merger-scribe-settings).
 */
export const PREBUILT_AGENTS = ['Merger', 'Nucleus', 'Scribe'] as const;
/**
 * Agents whose page is an entry of their prompt's own group, not of "Prebuilt agents": Hive's
 * running reviewer (HV3, decision 680), in the Hive group.
 */
const GROUPED_AGENTS = { 'hive.reviewer': 'Reviewer' } as const;
export type PrebuiltAgent =
  (typeof PREBUILT_AGENTS)[number] | (typeof GROUPED_AGENTS)[keyof typeof GROUPED_AGENTS];
export const PREBUILT_GROUP = 'Prebuilt agents';

const prebuilt = (group: string): group is (typeof PREBUILT_AGENTS)[number] =>
  (PREBUILT_AGENTS as readonly string[]).includes(group);

/**
 * A prompts' group as Settings shows it: Nucleus's by its name, Alpha Ceph while Hive mode is on
 * (decision 682); its key stays `Nucleus`.
 */
export function agentName(group: string, hive: boolean): string {
  return group === 'Nucleus' ? nucleusName(hive) : group;
}

const groupedAgent = (key: PromptKey): PrebuiltAgent | undefined =>
  (GROUPED_AGENTS as Partial<Record<PromptKey, PrebuiltAgent>>)[key];
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

/** Hive's prompts' group (HV2): listed only while Hive mode is on (decision 657). */
export const HIVE_GROUP = 'Hive';

/**
 * The list by group, in the server's order: a prompt an entry (Workspaces, Reviews), a prebuilt
 * agent one entry for all its prompts, under "Prebuilt agents" where the first of them comes.
 * Hive's group only in Hive mode; Nucleus named Alpha Ceph by `alpha` (Hive's, but for Nucleus held
 * through Hive's arrival, V86).
 */
export function promptGroups(
  prompts: readonly PromptSetting[],
  { hive = false, alpha = hive }: { hive?: boolean; alpha?: boolean } = {},
): { group: string; entries: SettingsEntry[] }[] {
  const groups = new Map<string, SettingsEntry[]>();
  const agents = new Map<PrebuiltAgent, SettingsEntry>();
  for (const prompt of prompts) {
    if (prompt.group === HIVE_GROUP && !hive) continue;
    const grouped = groupedAgent(prompt.key);
    const agent = prebuilt(prompt.group) ? prompt.group : grouped;
    const group = agent && !grouped ? PREBUILT_GROUP : prompt.group;
    const entries = groups.get(group) ?? [];
    groups.set(group, entries);
    const known = agent && agents.get(agent);
    if (known) {
      known.prompts.push(prompt);
    } else if (agent) {
      const entry = { key: prompt.key, name: agentName(agent, alpha), prompts: [prompt], agent };
      agents.set(agent, entry);
      entries.push(entry);
    } else {
      entries.push({ key: prompt.key, name: prompt.title, prompts: [prompt] });
    }
  }
  const listed = [...groups].map(([group, entries]) => ({ group, entries }));
  // In Hive mode its group first, its reviewer first in it, as proof 04 lists them (V93).
  const hiveGroup = listed.find((g) => g.group === HIVE_GROUP);
  if (!hiveGroup) return listed;
  hiveGroup.entries.sort((a, b) => Number(b.agent !== undefined) - Number(a.agent !== undefined));
  return [hiveGroup, ...listed.filter((g) => g !== hiveGroup)];
}

/** The entries that are not prompts (fix/settings-page): their keys in `?prompt=`. */
export const CHECKS = 'checks';
export const HIVE = 'hive-mode';
export const LIBRARY = 'skill-library';
export const APPEARANCE = 'appearance';
export type EntryKey = PromptKey | typeof CHECKS | typeof HIVE | typeof LIBRARY | typeof APPEARANCE;

/** An entry of Settings' list: a prompt's, an agent's (all its prompts), or a setting's. */
export interface NavEntry {
  key: EntryKey;
  name: string;
  /** The prompts on its page; none on a setting's. */
  prompts: PromptSetting[];
  /** The prebuilt agent whose page it is. */
  agent?: PrebuiltAgent;
  /** What else finds it in the list's filter: its config keys, what is on its page. */
  terms?: readonly string[];
}

/** A group of prompts under Prompts, folding: Hive's, Workspaces', Reviews'. */
export interface NavFold {
  group: string;
  entries: NavEntry[];
}

/** A section of the list: its entries, then its folding groups (Prompts' only). */
export interface NavSection {
  name: string;
  entries: NavEntry[];
  folds: NavFold[];
}

const setting = (key: EntryKey, name: string, terms: readonly string[]): NavEntry => ({
  key,
  name,
  prompts: [],
  terms,
});
const REPOSITORY: NavEntry[] = [
  setting(CHECKS, 'Checks', ['merge.checks', 'tests', 'commands']),
  setting(HIVE, 'Hive mode', ['hive.lands', 'landing', 'limits', 'budget', 'pause', 'rounds']),
];
const MACHINE = [setting(LIBRARY, 'Skill library', ['skills', 'folder'])];
const BROWSER = [
  setting(APPEARANCE, 'Appearance', ['theme', 'dark', 'light', 'text size', 'intro']),
];

/** The agents in the list's order: the person's own first, Hive's reviewer after Symbiote's. */
const AGENT_ORDER: readonly PrebuiltAgent[] = ['Nucleus', 'Merger', 'Scribe', 'Reviewer'];

/**
 * Settings' list (fix/settings-page) by what is set, in both modes: This repository (its check,
 * one for the merger and Hive, and Hive mode), Agents (each its page; Suggest settings', the
 * advisor's, last), Prompts in folding groups (Hive's first while it is on), This machine, This
 * browser. Without the prompts (`null`), the settings that are not prompts.
 */
export function settingsNav(
  prompts: readonly PromptSetting[] | null,
  { hive = false, alpha = hive }: { hive?: boolean; alpha?: boolean } = {},
): NavSection[] {
  const repository = { name: 'This repository', entries: REPOSITORY, folds: [] };
  const rest = [
    { name: 'This machine', entries: MACHINE, folds: [] },
    { name: 'This browser', entries: BROWSER, folds: [] },
  ];
  if (!prompts) return [repository, ...rest];
  const agents: NavEntry[] = [];
  const advisor: NavEntry[] = [];
  const folds: NavFold[] = [];
  for (const { group, entries } of promptGroups(prompts, { hive, alpha })) {
    const own = entries.filter((e) => !e.agent && e.key !== 'advisor');
    agents.push(...entries.filter((e) => e.agent));
    advisor.push(...entries.filter((e) => e.key === 'advisor'));
    if (own.length > 0 && group !== PREBUILT_GROUP) folds.push({ group, entries: own });
  }
  const rank = (e: NavEntry) => AGENT_ORDER.indexOf(e.agent ?? 'Nucleus');
  return [
    repository,
    {
      name: 'Agents',
      entries: [...agents.sort((a, b) => rank(a) - rank(b)), ...advisor],
      folds: [],
    },
    { name: 'Prompts', entries: [], folds },
    ...rest,
  ];
}

/** Whether `entry` is found by `query` (lower case): its name, its prompts' titles, its terms. */
const finds = (entry: NavEntry, query: string) =>
  [entry.name, ...entry.prompts.map((p) => p.title), ...(entry.terms ?? [])].some((text) =>
    text.toLowerCase().includes(query),
  );

/**
 * The list as the filter leaves it: the entries found by name, an agent's prompt titles or a
 * setting's config keys; a section's or a group's name keeps all of it. Empty sections go.
 */
export function filterNav(sections: readonly NavSection[], query: string): NavSection[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...sections];
  const kept: NavSection[] = [];
  for (const section of sections) {
    if (section.name.toLowerCase().includes(q)) {
      kept.push(section);
      continue;
    }
    const entries = section.entries.filter((e) => finds(e, q));
    const folds = section.folds
      .map((fold) =>
        fold.group.toLowerCase().includes(q)
          ? fold
          : { ...fold, entries: fold.entries.filter((e) => finds(e, q)) },
      )
      .filter((fold) => fold.entries.length > 0);
    if (entries.length > 0 || folds.length > 0) kept.push({ ...section, entries, folds });
  }
  return kept;
}

/**
 * Whether a group of prompts is open: every one while filtering; else as the person left it
 * (`kept`, by group), else when it holds the entry open.
 */
export function foldOpen(
  fold: NavFold,
  {
    open,
    kept,
    query,
  }: { open: string | null; kept: Readonly<Record<string, boolean>>; query: string },
): boolean {
  if (query.trim() !== '') return true;
  return kept[fold.group] ?? fold.entries.some((e) => e.key === open);
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
