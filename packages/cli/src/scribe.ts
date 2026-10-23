// Scribe (V41): an agent on the Skills page that writes the checkout's skills, one conversation per
// repository, as Scout's (`pageAgent`). It writes only in `.claude/skills/` (decision 275): Claude
// Code through Scribe's gate (`scribe-gate.ts`), in `default` mode, where its own rule for `.claude`
// asks the person before each write; Codex in `workspace-write` started in that folder, its only
// writable one. Its record is `symbiote/scribe.json`. It never commits: the person does.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GitRepo } from '@symbiote/core';
import { fillPrompt, readPrompts } from './prompts.js';
import { pageAgent, type PageAgentOptions, type PageAgentSpec, type Scout } from './scout.js';
import { CLAUDE_SKILLS } from './skills.js';

const skillsOf = (root: string) => join(root, CLAUDE_SKILLS);

const SCRIBE: PageAgentSpec = {
  name: 'Scribe',
  about:
    "Scribe's conversation in this checkout (V41): an agent started in Symbiote that writes skills in .claude/skills. Not a workspace.",
  record: 'scribe.json',
  settings: 'scribe-settings.json',
  tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'],
  permissionMode: 'default',
  gateArgs: (root) => [skillsOf(root)],
  prompt: (root, text) =>
    fillPrompt(readPrompts(root).text.scribe, {
      request: text,
      skills: skillsOf(root),
      checkout: root,
    }),
  codex: (root) => ({ cwd: skillsOf(root), writes: true }),
  prepare: async (root) => {
    await mkdir(skillsOf(root), { recursive: true });
  },
};

/** Scribe in `repo`'s checkout, its record beside the reviews (`symbiote/`, else Symbiote's cache). */
export function scribe(repo: GitRepo, cacheDir: string, options: PageAgentOptions): Scout {
  return pageAgent(SCRIBE, repo, cacheDir, {
    gate: fileURLToPath(new URL('./scribe-hook.js', import.meta.url)),
    ...options,
  });
}
