// The check as Settings' Checks page edits it (fix/settings-page): pure, the server's own rules
// (`packages/cli/src/check-setting.ts`) said before a save.
import type { CheckSetting } from '@symbiote/core';

/** The most commands a check takes, and the longest command, as `symbiote view` takes them. */
export const MAX_COMMANDS = 20;
export const MAX_COMMAND_LENGTH = 1_000;

/** The commands as they are saved: each trimmed, the empty rows dropped. */
export const cleanCommands = (commands: readonly string[]): string[] =>
  commands.map((c) => c.trim()).filter((c) => c !== '');

/** Why the server would refuse `commands` as the check, or null. */
export function checksProblem(commands: readonly string[]): string | null {
  const kept = cleanCommands(commands);
  if (kept.length === 0) {
    return 'At least one command: or Reset, for the check Symbiote finds.';
  }
  if (kept.length > MAX_COMMANDS) return `At most ${MAX_COMMANDS} commands (${kept.length}).`;
  if (kept.some((c) => /[\r\n]/.test(c))) return 'Each command on one line.';
  if (kept.some((c) => c.length > MAX_COMMAND_LENGTH)) {
    return `Each command at most ${MAX_COMMAND_LENGTH.toLocaleString('en-US')} characters.`;
  }
  return null;
}

/** Whether the draft would change the saved commands (`undefined`: none set). */
export function checksEdited(
  saved: readonly string[] | undefined,
  draft: readonly string[] | undefined,
): boolean {
  if (draft === undefined) return false;
  const next = cleanCommands(draft);
  const now = saved ?? [];
  return next.length !== now.length || next.some((c, i) => c !== now[i]);
}

/** What the config file's state in git means for the check in it, as `gitNote` for the prompts. */
export function checkGitNote({ file, git }: Pick<CheckSetting, 'file' | 'git'>): string {
  switch (git) {
    case 'none':
      return `A save writes ${file}: commit it to share the check.`;
    case 'new':
      return `Saved in ${file}, not committed: commit it to share the check with everyone who uses this repository.`;
    case 'changed':
      return `${file} has changes not committed: commit them to share them.`;
    case 'committed':
      return `Shared: ${file} is committed as it is.`;
    case 'ignored':
      return `${file} is ignored by git here: the check stays on this machine.`;
  }
}
