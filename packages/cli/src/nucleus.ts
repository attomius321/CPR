// Nucleus (NU1; Scout from V35 until NU1): the person's orchestrator in Symbiote, a page agent
// (`page-agent.ts`) in the checkout `symbiote view` runs in. It changes no file: Claude Code runs
// with read tools and Bash through Symbiote's gate (`nucleus-gate.ts`, decision 236); Codex in its
// read-only sandbox on its app server. Since MC1 both have Symbiote's MCP server (`mcp-bridge.ts`),
// its only way to act: workspaces, reviews, merges, the asked ones on the person's Confirm. Since
// V50 its conversation starts with no question, its instructions its system prompt.
import { fileURLToPath } from 'node:url';
import type { GitRepo } from '@symbiote/core';
import {
  pageAgent,
  type PageAgent,
  type PageAgentOptions,
  type PageAgentSpec,
} from './page-agent.js';
import { fillPrompt, readPrompts } from './prompts.js';
import { readWorkspaceConfig } from './workspaces.js';

/** The name Nucleus's session and thread are given: how a new one is told from the person's. */
export const NUCLEUS_NAME = 'Scout';

/** The record's first key: what it is, for anyone who opens it. */
export const NUCLEUS_ABOUT =
  "Scout's conversation in this checkout (V35): a read-only agent started in Symbiote. Not a workspace.";

/** Nucleus's: read-only in the checkout, `prompts.scout`, `scout.effort`. */
const NUCLEUS: PageAgentSpec = {
  name: NUCLEUS_NAME,
  about: NUCLEUS_ABOUT,
  record: 'scout.json',
  settings: 'scout-settings.json',
  tools: ['Read', 'Grep', 'Glob', 'Bash'],
  permissionMode: 'dontAsk',
  gateArgs: () => [],
  prompt: (_root, text) => text,
  // A project's text from before V50 may still hold {question}: filled with nothing.
  instructions: (root) => fillPrompt(readPrompts(root).text.scout, { question: '' }).trimEnd(),
  codex: (root) => ({ cwd: root, writes: false }),
  effort: { read: (root) => readWorkspaceConfig(root).nucleusEffort, key: ['scout', 'effort'] },
  model: { read: (root) => readWorkspaceConfig(root).nucleusModel, key: ['scout', 'model'] },
  mcp: { file: 'scout-mcp.json' },
};

/** Nucleus in `repo`'s checkout, its record beside the reviews (`symbiote/`, else Symbiote's cache). */
export function nucleus(repo: GitRepo, cacheDir: string, options: PageAgentOptions): PageAgent {
  return pageAgent(NUCLEUS, repo, cacheDir, {
    gate: fileURLToPath(new URL('./nucleus-hook.js', import.meta.url)),
    bridge: fileURLToPath(new URL('./mcp-stdio.js', import.meta.url)),
    ...options,
  });
}
