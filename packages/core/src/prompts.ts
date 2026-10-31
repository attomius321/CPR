// The texts Symbiote's agents are told (V28): what `symbiote view`'s Settings page reads and
// changes. Types and the keys only; the CLI keeps Symbiote's texts and reads and writes `prompts`
// in config.json.
import type { FileGitState } from './git/branches.js';
import type { WorkKind } from './workspaces.js';

/** A prompt's key under `prompts` in `symbiote/config.json`: `start.fix` is `prompts.start.fix`. */
export type PromptKey =
  | `start.${WorkKind}`
  | 'plan.first'
  | 'plan.direct'
  /** What `{documents}` becomes when the person gave files with the brief (V40). */
  | 'documents'
  | 'verdict.approve'
  | 'verdict.push'
  | 'verdict.address'
  | 'verdict.where'
  | 'reviews'
  | 'merger'
  /**
   * Nucleus's instructions, its system prompt (V35, V50); `prompts.scout` before NU1, still read
   * while there is no `prompts.nucleus` (decision 590).
   */
  | 'nucleus'
  /** Scribe's instructions, its first prompt with the person's request (V41). */
  | 'scribe'
  /** What Scribe's `{library}` becomes when a skill library is set (SK1). */
  | 'library'
  /** The advisor's instructions (V75): how it sizes a brief and suggests the start's settings. */
  | 'advisor'
  /** What `{hive}` becomes in a Hive workspace's start prompt (HV2). */
  | 'hive.start'
  /** What Hive sends the writer when the check fails (HV2). */
  | 'hive.check'
  /** What Hive sends the writer when it ended a turn with work not committed, or none (HV2). */
  | 'hive.commit'
  /** What Hive sends a writer it stopped, once Hive is on again (HV2). */
  | 'hive.resume'
  /** What Hive sends the writer with the tests its running reviewer proved defects with (HV3). */
  | 'hive.review'
  /** The running reviewer's instructions, its appended system prompt (HV3). */
  | 'hive.reviewer';

/** Every prompt, in the Settings page's order. */
export const PROMPT_KEYS: readonly PromptKey[] = [
  'start.feature',
  'start.fix',
  'start.refactor',
  'start.chore',
  'start.spike',
  'plan.first',
  'plan.direct',
  'documents',
  'advisor',
  'verdict.approve',
  'verdict.push',
  'verdict.address',
  'verdict.where',
  'reviews',
  'merger',
  'nucleus',
  'scribe',
  'library',
  'hive.start',
  'hive.check',
  'hive.review',
  'hive.commit',
  'hive.resume',
  'hive.reviewer',
];

/** A name a prompt may hold as `{name}`, replaced by what it stands for when it is used. */
export interface PromptPlaceholder {
  name: string;
  /** What it stands for: "the workspace's branch". */
  about: string;
  /** A prompt without it is refused, and Symbiote's text used instead. */
  required?: true;
}

/** A prompt as the Settings page shows it. */
export interface PromptSetting {
  key: PromptKey;
  /** Whose prompt: `Workspaces`, `Reviews`, `Merger` or `Nucleus`. */
  group: string;
  /** Its name in the group: "Fix", "Plan first", "symbiote/AGENTS.md". */
  title: string;
  /** When it is told, and to whom. */
  about: string;
  /** The text in use: the project's when it has one Symbiote can use, else Symbiote's. */
  text: string;
  /** Symbiote's text. */
  default: string;
  /** The project's own text is in use. */
  changed: boolean;
  placeholders: PromptPlaceholder[];
  /** Longest text accepted, in characters. */
  max: number;
  /** Why the project's value in the file is not used, Symbiote's text being used instead. */
  warning?: string;
  /** What Symbiote adds after it, which a project cannot change: the merger's answer format. */
  fixed?: string;
}

/** `GET /api/settings/prompts`, and what a change answers. */
export interface PromptSettings {
  /** Where the project's prompts are kept, repo-relative: `symbiote/config.json`. */
  file: string;
  /** The file's version as read: a change names it, and is refused when the file changed since. */
  version: string;
  /** The file in git: shared once committed. */
  git: FileGitState;
  /** Why none of the file's prompts can be used (it is not JSON). */
  warning?: string;
  prompts: PromptSetting[];
}

/** `POST /api/settings/prompts`: a prompt's new text, or `null` for Symbiote's. */
export interface PromptChange {
  key: PromptKey;
  text: string | null;
  /** `PromptSettings.version`, as the page read it. */
  version: string;
}
