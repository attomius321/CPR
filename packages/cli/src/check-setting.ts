// The check in Settings (fix/settings-page): `merge.checks`, which the merger runs before a merge
// lands and Hive on every commit (one check for both modes), read and set from the page.
import { fileGitState, type CheckChange, type CheckSetting, type GitRepo } from '@symbiote/core';
import { foundCheck, readMergeConfig } from './merge-config.js';
import { PromptRefused, readPrompts } from './prompts.js';
import { writeConfigAt } from './config-write.js';

/** The most commands a check takes, and the longest command (the page says the same). */
export const MAX_COMMANDS = 20;
export const MAX_COMMAND_LENGTH = 1_000;

/** `/api/settings/checks`: read, and set. */
export interface CheckSettingService {
  read(): Promise<CheckSetting>;
  /** Saves the commands as `merge.checks`, or removes it (`null`); answers the check after it. */
  set(change: CheckChange): Promise<CheckSetting>;
}

/** The check of the project at `root`, the one found read from `repo`'s HEAD as Hive's is. */
export function checkSettingService(repo: GitRepo, root: string): CheckSettingService {
  const read = async (): Promise<CheckSetting> => {
    const file = readPrompts(root);
    const { checks } = readMergeConfig(root);
    const [git, found] = await Promise.all([
      fileGitState(repo, file.file),
      foundCheck(repo, 'HEAD').catch(() => null),
    ]);
    return {
      file: file.file,
      version: file.version,
      git,
      ...(checks ? { commands: checks } : {}),
      ...(found ? { found } : {}),
      ...(file.warning
        ? { warning: `${file.file} is not JSON: the check Symbiote finds is run` }
        : {}),
    };
  };
  return {
    read,
    async set({ commands, version }) {
      const problem = commands === null ? null : commandsProblem(commands);
      if (problem) throw new PromptRefused(problem, 400);
      await writeConfigAt(root, ['merge', 'checks'], commands ?? undefined, version);
      return read();
    },
  };
}

/** Why `commands` cannot be the check, or null (trimmed, empty ones dropped, first). */
function commandsProblem(commands: readonly string[]): string | null {
  if (commands.length === 0) {
    return 'at least one command, or null for the check Symbiote finds';
  }
  if (commands.length > MAX_COMMANDS) return `at most ${MAX_COMMANDS} commands`;
  if (commands.some((c) => /[\r\n]/.test(c))) return 'each command on one line';
  if (commands.some((c) => c.length > MAX_COMMAND_LENGTH)) {
    return `each command at most ${MAX_COMMAND_LENGTH.toLocaleString('en-US')} characters`;
  }
  return null;
}

/** `POST /api/settings/checks`'s body, checked: throws with what is wrong. */
export function parseCheckChange(body: string): CheckChange {
  const value = JSON.parse(body) as unknown;
  if (!value || typeof value !== 'object') throw new Error('a change: { commands, version }');
  const { commands, version } = value as Record<string, unknown>;
  if (typeof version !== 'string') throw new Error('version: as the check was read');
  if (commands === null) return { commands: null, version };
  if (!Array.isArray(commands) || commands.some((c) => typeof c !== 'string')) {
    throw new Error('commands: a list of commands, or null for the check Symbiote finds');
  }
  const kept = (commands as string[]).map((c) => c.trim()).filter((c) => c !== '');
  const problem = commandsProblem(kept);
  if (problem) throw new Error(`commands: ${problem}`);
  return { commands: kept, version };
}
