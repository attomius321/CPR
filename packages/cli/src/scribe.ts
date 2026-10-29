// Scribe (V41): an agent on the Skills page that writes the checkout's skills, one conversation per
// repository, as Scout's (`pageAgent`). It writes only in `.claude/skills/` (decision 275), and in
// the skill library when one is set (SK1, decision 430): Claude Code through Scribe's gate
// (`scribe-gate.ts`), in `default` mode, where its own rules ask the person before each write, the
// library given with `--add-dir`; Codex in `workspace-write` started in `.claude/skills`, its only
// writable folder with the library's. Its record is `symbiote/scribe.json`. It never commits: the
// person does. Since V77 its instructions are its system prompt, as Scout's (decision 562): a
// conversation opens with no request, and its terminal takes the first.
import { statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GitRepo, PromptKey } from '@symbiote/core';
import type { LibraryService } from './library.js';
import { fillPrompt, readPrompts } from './prompts.js';
import { readWorkspaceConfig } from './workspaces.js';
import { pageAgent, type PageAgentOptions, type PageAgentSpec, type Scout } from './scout.js';
import { real } from './thread.js';
import { CLAUDE_SKILLS, CODEX_SKILLS } from './skills.js';

const skillsOf = (root: string) => join(root, CLAUDE_SKILLS);

/**
 * Scribe's instructions: the project's `scribe`, its `{library}` the prompt `library` when a skill
 * library is set; without one, the line holding `{library}` goes with the blank line after it, and
 * the text is what it was before SK1. A project's text from before V77 may still hold `{request}`:
 * filled with nothing.
 */
export function scribePrompt(
  prompts: Readonly<Record<PromptKey, string>>,
  values: { skills: string; checkout: string; library?: string },
): string {
  const library = values.library
    ? fillPrompt(prompts.library, { folder: values.library, skills: values.skills }).trimEnd()
    : '';
  const template = library
    ? prompts.scribe
    : prompts.scribe.replace(/^\{library\}(?:\n\n?|$)/m, '');
  return fillPrompt(template, {
    request: '',
    skills: values.skills,
    checkout: values.checkout,
    library,
  }).trimEnd();
}

/** Scribe's spec, the skill library read from `library` at each start (SK1). */
function scribeSpec(library: LibraryService | undefined): PageAgentSpec {
  /** The library's folder: there, and not one of the checkout's own skills folders. */
  const libraryAt = (root: string): string | undefined => {
    const folder = library?.setting()?.folder;
    if (!folder) return undefined;
    try {
      if (!statSync(folder).isDirectory()) return undefined;
    } catch {
      return undefined;
    }
    const own = [CLAUDE_SKILLS, CODEX_SKILLS].map((f) => real(join(root, f)));
    return own.includes(real(folder)) ? undefined : folder;
  };
  const folders = (root: string) => {
    const folder = libraryAt(root);
    return folder ? [folder] : [];
  };
  return {
    name: 'Scribe',
    about:
      "Scribe's conversation in this checkout (V41): an agent started in Symbiote that writes skills in .claude/skills. Not a workspace.",
    record: 'scribe.json',
    settings: 'scribe-settings.json',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'],
    permissionMode: 'default',
    gateArgs: (root) => [skillsOf(root), ...folders(root)],
    folders,
    // A background session refuses an edit in the checkout until it enters a worktree of its own
    // (Claude Code 2.1.309): Scribe's skills are for the checkout's Skills page, so its own settings
    // say none, for its session only.
    claudeSettings: { worktree: { bgIsolation: 'none' } },
    prompt: (_root, text) => text,
    instructions: (root) => {
      const folder = libraryAt(root);
      return scribePrompt(readPrompts(root).text, {
        skills: skillsOf(root),
        checkout: root,
        ...(folder ? { library: folder } : {}),
      });
    },
    codex: (root) => ({ cwd: skillsOf(root), writes: true }),
    prepare: async (root) => {
      await mkdir(skillsOf(root), { recursive: true });
    },
    effort: { read: (root) => readWorkspaceConfig(root).scribeEffort, key: ['scribe', 'effort'] },
    model: { read: (root) => readWorkspaceConfig(root).scribeModel, key: ['scribe', 'model'] },
  };
}

/**
 * Scribe in `repo`'s checkout, its record beside the reviews (`symbiote/`, else Symbiote's cache);
 * the skill library's folder its too when `library` has one (SK1).
 */
export function scribe(
  repo: GitRepo,
  cacheDir: string,
  { library, ...options }: PageAgentOptions & { library?: LibraryService },
): Scout {
  return pageAgent(scribeSpec(library), repo, cacheDir, {
    gate: fileURLToPath(new URL('./scribe-hook.js', import.meta.url)),
    ...options,
  });
}
