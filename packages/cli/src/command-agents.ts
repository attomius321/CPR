// The agents a command finds (V18, V20a, V26c): Claude Code, Codex, the merger agent, and their
// effort levels and models.
import { homedir } from 'node:os';
import type { AgentEfforts, AgentModels, AgentKind } from '@symbiote/core';
import { claudeMerger, codexMerger, type MergerAgent } from './merge-agent.js';
import { readClaudeProfile } from './usage.js';
import { codex, findCodex, type Codex } from './codex.js';
import { readWorkspaceConfig } from './workspaces.js';
import { claudeCode, claudeModelsFile, findClaude, type ClaudeCode } from './claude-code.js';
import { version } from './command-context.js';

/**
 * Claude Code for workspaces (V18), found when first needed and looked for again until it is; its
 * models kept in Symbiote's cache for every view (V47).
 */
export function agentFinder(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
  cacheDir: string,
): () => Promise<ClaudeCode | null> {
  let found: ClaudeCode | null = null;
  return async () => {
    if (found) return found;
    const command = await findClaude(env);
    if (!command) return null;
    const { model } = readWorkspaceConfig(root);
    found = claudeCode(command, {
      cwd: root,
      ...(model ? { model } : {}),
      modelsFile: claudeModelsFile(cacheDir, command),
      // The plan the status bar names (V29c), not the one its token kept from login.
      plan: async () => (await readClaudeProfile({ env, home: homedir() })).plan,
    });
    return found;
  };
}

/** Codex for workspaces (V20a), found as Claude Code is; on its app server when it has one (V27a).
 * */
export function codexFinder(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): () => Promise<Codex | null> {
  let found: Codex | null = null;
  return async () => {
    if (found) return found;
    const command = await findCodex(env);
    if (!command) return null;
    found = codex(command, { cwd: root, version });
    return found;
  };
}

/**
 * The merger agent (V26c): `kind` (`merge.agent`), else `agent.kind`, else Claude Code, else
 * Codex, whichever is installed.
 */
export function mergerFinder(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): (kind?: AgentKind) => Promise<MergerAgent | null> {
  return async (kind) => {
    const first = kind ?? readWorkspaceConfig(root).agent;
    const order: AgentKind[] = first === 'codex' ? ['codex', 'claude'] : ['claude', 'codex'];
    for (const each of kind ? order.filter((k) => k === kind) : order) {
      const command = each === 'claude' ? await findClaude(env) : await findCodex(env);
      if (command) return each === 'claude' ? claudeMerger(command) : codexMerger(command);
    }
    return null;
  };
}

/**
 * An agent's effort levels for the merger (V46d): Claude Code's `--help`, Codex's models (which
 * start its app server); null when unread.
 */
export function levelsFinder(
  claude: () => Promise<ClaudeCode | null>,
  codexOf: () => Promise<Codex | null>,
): (kind: AgentKind) => Promise<AgentEfforts | null> {
  return async (kind) => {
    if (kind === 'codex') return (await (await codexOf())?.efforts()) ?? null;
    const levels = (await (await claude())?.efforts()) ?? null;
    return levels ? { levels } : null;
  };
}

/** An agent's models (V47), for the merger's in Settings: Claude Code's kept list, Codex's. */
export function modelsFinder(
  claude: () => Promise<ClaudeCode | null>,
  codexOf: () => Promise<Codex | null>,
): (kind: AgentKind) => Promise<AgentModels | null> {
  return async (kind) => {
    if (kind === 'codex') return (await (await codexOf())?.models()) ?? null;
    const models = (await (await claude())?.models()) ?? null;
    return models ? { models } : null;
  };
}
