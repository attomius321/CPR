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
  | 'verdict.approve'
  | 'verdict.push'
  | 'verdict.address'
  | 'verdict.where'
  | 'reviews'
  | 'merger'
  /** Scout's instructions, its first prompt with the question (V35). */
  | 'scout'
  /** Scribe's instructions, its first prompt with the person's request (V41). */
  | 'scribe';

/** Every prompt, in the Settings page's order. */
export const PROMPT_KEYS: readonly PromptKey[] = [
  'start.feature',
  'start.fix',
  'start.refactor',
  'start.chore',
  'start.spike',
  'plan.first',
  'plan.direct',
  'verdict.approve',
  'verdict.push',
  'verdict.address',
  'verdict.where',
  'reviews',
  'merger',
  'scout',
  'scribe',
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
  /** Whose prompt: `Workspaces`, `Reviews`, `Merger` or `Scout`. */
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
