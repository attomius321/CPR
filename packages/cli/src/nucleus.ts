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
import { openWorktrees } from './nucleus-gate.js';
import { fillPrompt, readPrompts } from './prompts.js';
import { workspacesDir } from './workspace-record.js';
import { readWorkspaceConfig } from './workspaces.js';

/** The name Nucleus's session and thread are given: how a new one is told from the person's. */
export const NUCLEUS_NAME = 'Nucleus';

/** The record's first key: what it is, for anyone who opens it. */
export const NUCLEUS_ABOUT =
  "Nucleus's conversation in this checkout (NU1): the person's orchestrator, started in Symbiote. Not a workspace.";

/** What it reads and runs in the checkout: files, and git's reads through its gate (decision 236). */
const READS = ['Read', 'Grep', 'Glob', 'Bash'];

/** Claude Code's tools on the web (NU1, decision 592): a search, and a page read by GET. */
const WEB = ['WebSearch', 'WebFetch'];

/** Whether its next conversation has the web: unless `nucleus.web` is false (decision 594). */
const webOn = (root: string) => readWorkspaceConfig(root).nucleusWeb !== false;

/**
 * Nucleus's: read-only in the checkout and the open workspaces' worktrees (V80), the web,
 * `prompts.nucleus`, `nucleus.effort`; Scout's record, files and settings from before NU1 still
 * read (decisions 590, 591).
 */
const NUCLEUS: PageAgentSpec = {
  name: NUCLEUS_NAME,
  about: NUCLEUS_ABOUT,
  record: 'nucleus.json',
  settings: 'nucleus-settings.json',
  tools: (root) => (webOn(root) ? [...READS, ...WEB] : READS),
  permissionMode: 'dontAsk',
  // No `folders`, which Codex would write: its gate opens the worktrees at each call (V80); the web
  // a flag after them (NU1).
  gateArgs: (root, where) => [root, workspacesDir(where), ...(webOn(root) ? ['--web'] : [])],
  prompt: (_root, text) => text,
  // A project's text from before V50 may still hold {question}: filled with nothing.
  instructions: (root) => fillPrompt(readPrompts(root).text.nucleus, { question: '' }).trimEnd(),
  codex: (root) => ({ cwd: root, writes: false }),
  // As its gate opens them to Claude Code: the checkout and the open workspaces' worktrees.
  codexReads: (root, where) => [root, ...openWorktrees(root, workspacesDir(where))],
  // Codex's search runs at OpenAI: its read-only sandbox keeps the network off (decision 593).
  codexConfig: (root) => ({ web_search: webOn(root) ? 'live' : 'disabled' }),
  effort: {
    read: (root) => readWorkspaceConfig(root).nucleusEffort,
    key: ['nucleus', 'effort'],
    older: ['scout', 'effort'],
  },
  model: {
    read: (root) => readWorkspaceConfig(root).nucleusModel,
    key: ['nucleus', 'model'],
    older: ['scout', 'model'],
  },
  mcp: { file: 'nucleus-mcp.json', as: 'nucleus' },
  former: {
    name: 'Scout',
    record: 'scout.json',
    files: ['scout-settings.json', 'scout-mcp.json'],
  },
};

/** Nucleus in `repo`'s checkout, its record beside the reviews (`symbiote/`, else Symbiote's cache). */
export function nucleus(repo: GitRepo, cacheDir: string, options: PageAgentOptions): PageAgent {
  return pageAgent(NUCLEUS, repo, cacheDir, {
    gate: fileURLToPath(new URL('./nucleus-hook.js', import.meta.url)),
    bridge: fileURLToPath(new URL('./mcp-stdio.js', import.meta.url)),
    ...options,
  });
}
