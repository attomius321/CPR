// The merger's settings (V26, V46d, V47): `symbiote/config.json`'s `merge` section, and the project's
// check: the one set in `merge.checks`, else the one Symbiote finds.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveCommit,
  EFFORT_LEVEL,
  MERGE_STRATEGIES,
  type GitRepo,
  type MergeCheckRun,
  type AgentKind,
  type MergeStrategy,
} from '@symbiote/core';
import { guessCheck, treeAt } from './check.js';
import { CONFIG_FILES } from './plugins.js';

/**
 * What `symbiote/config.json` says of merges: `merge.checks` (one command or several),
 * `merge.push`, `merge.strategy` (V67), and the merger agent's `merge.agent` and `merge.model`
 * (V26c) and `merge.effort` (V46d).
 */
export interface MergeConfig {
  checks?: string[];
  push: boolean;
  strategy?: MergeStrategy;
  agent?: AgentKind;
  model?: string;
  effort?: string;
}

/** The merge section of the config file in `root`; anything unknown is ignored. */
export function readMergeConfig(root: string): MergeConfig {
  const file = configFile(root);
  if (!file) return { push: false };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return { push: false };
  }
  const merge = (value as { merge?: unknown } | null)?.merge;
  const v = (merge && typeof merge === 'object' ? merge : {}) as {
    checks?: unknown;
    push?: unknown;
    strategy?: unknown;
    agent?: unknown;
    model?: unknown;
    effort?: unknown;
  };
  const listed =
    typeof v.checks === 'string' ? [v.checks] : Array.isArray(v.checks) ? v.checks : [];
  const checks = listed.filter((c): c is string => typeof c === 'string' && c.trim() !== '');
  return {
    ...(checks.length > 0 ? { checks } : {}),
    push: v.push === true,
    ...(isStrategy(v.strategy) ? { strategy: v.strategy } : {}),
    ...(v.agent === 'claude' || v.agent === 'codex' ? { agent: v.agent } : {}),
    ...(typeof v.model === 'string' && v.model !== '' ? { model: v.model } : {}),
    ...(typeof v.effort === 'string' && EFFORT_LEVEL.test(v.effort) ? { effort: v.effort } : {}),
  };
}

const configFile = (root: string) => CONFIG_FILES.find((name) => existsSync(join(root, name)));

/**
 * The project's check (V26a): `merge.checks` in the config at `root`, else the command guessed from
 * the commit `at` (V24b), a package script after its package manager's install. The merger runs
 * it on a merge, Hive on a workspace's tip (HV2, decision 654); null when there is none.
 */
export async function projectCheck(
  repo: GitRepo,
  root: string,
  at: string,
): Promise<Pick<MergeCheckRun, 'commands' | 'source'> | null> {
  const { checks } = readMergeConfig(root);
  if (checks) return { commands: checks, source: `${configFile(root)} (merge.checks)` };
  return foundCheck(repo, at);
}

/**
 * The check Symbiote finds in the commit `at`'s files (V24b; a SHA or a ref), `merge.checks` aside: what runs
 * when the project sets none, as Settings shows it (fix/settings-page); null when there is none.
 */
export async function foundCheck(
  repo: GitRepo,
  at: string,
): Promise<Pick<MergeCheckRun, 'commands' | 'source'> | null> {
  // A ref resolved first: the tree is read by SHA only, and Hive's page asks at HEAD.
  const sha = /^[0-9a-f]{40,64}$/i.test(at) ? at : await resolveCommit(repo, at);
  const guess = await guessCheck(await treeAt(repo, sha));
  if (!guess) return null;
  // A package script needs the dependencies, which Symbiote's worktree does not have at first.
  if (guess.source.startsWith('package.json')) {
    const manager = guess.command.split(' ')[0] ?? 'npm';
    return {
      commands: [`${manager} install`, guess.command],
      source: `${guess.source}, after an install`,
    };
  }
  return { commands: [guess.command], source: guess.source };
}

export const isStrategy = (value: unknown): value is MergeStrategy =>
  (MERGE_STRATEGIES as readonly unknown[]).includes(value);

/** The model the merger asks Claude Code on without `merge.model` (V26c). */
export const MERGER_CLAUDE_MODEL = 'sonnet';

/** The model the merger agent of `kind` is asked on: `merge.model`, else Symbiote's for Claude Code. */
export const modelOf = (kind: AgentKind, config: MergeConfig): string | undefined =>
  config.model ?? (kind === 'claude' ? MERGER_CLAUDE_MODEL : undefined);
