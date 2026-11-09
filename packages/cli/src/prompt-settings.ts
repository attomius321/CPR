// The Settings page's prompts (V28b): every prompt with its spec, default and the project's text;
// a change parsed and saved.
import {
  fileGitState,
  nucleusName,
  PROMPT_KEYS,
  type GitRepo,
  type PromptChange,
  type PromptKey,
  type PromptSettings,
} from '@symbiote/core';
import { readPrompts } from './prompts.js';
import { DEFAULT_PROMPTS, nucleusAbout } from './prompt-text.js';
import { SPECS } from './prompt-specs.js';
import { writePrompt } from './config-write.js';

/** The Settings page's prompts (`/api/settings/prompts`). */
export interface PromptSettingsService {
  prompts(): Promise<PromptSettings>;
  /** Saves a change, and answers the prompts as they are after it. */
  setPrompt(change: PromptChange): Promise<PromptSettings>;
}

/** The prompts of `repo`'s checkout, as the Settings page shows and changes them (V28). */
export function promptSettingsService(
  repo: GitRepo,
  { hive }: { hive?: () => Promise<boolean> } = {},
): PromptSettingsService {
  const settings = async (): Promise<PromptSettings> => {
    const read = readPrompts(repo.root);
    // Nucleus's prompt is said in its name: Alpha Ceph's in Hive mode (decision 682).
    const named = nucleusName((await hive?.()) ?? false);
    return {
      file: read.file,
      version: read.version,
      git: await fileGitState(repo, read.file),
      ...(read.warning ? { warning: read.warning } : {}),
      prompts: PROMPT_KEYS.map((key) => {
        const { fixed, ...spec } = SPECS[key];
        const warning = read.warnings[key];
        return {
          key,
          ...spec,
          ...(key === 'nucleus' ? { about: nucleusAbout(named) } : {}),
          text: read.text[key],
          default: DEFAULT_PROMPTS[key],
          changed: read.changed.has(key),
          ...(warning ? { warning } : {}),
          ...(fixed ? { fixed } : {}),
        };
      }),
    };
  };
  return {
    prompts: settings,
    async setPrompt(change) {
      await writePrompt(repo.root, change);
      return settings();
    },
  };
}

/** `POST /api/settings/prompts`'s body, checked: throws with what is wrong. */
export function parsePromptChange(body: string): PromptChange {
  const value = JSON.parse(body) as unknown;
  if (!value || typeof value !== 'object') throw new Error('a change: { key, text, version }');
  const { key, text, version } = value as Record<string, unknown>;
  if (typeof key !== 'string' || !PROMPT_KEYS.includes(key as PromptKey)) {
    throw new Error(`key: one of ${PROMPT_KEYS.join(', ')}`);
  }
  if (text !== null && typeof text !== 'string') {
    throw new Error("text: the prompt, or null for Symbiote's");
  }
  if (typeof version !== 'string') throw new Error('version: as the prompts were read');
  return { key: key as PromptKey, text, version };
}
