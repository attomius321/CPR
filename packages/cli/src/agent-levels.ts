// Whether an agent can start at an effort level (V30b) and on a model (V47): the checks a
// workspace's start, Nucleus, Scribe and the merger share, for Claude Code and Codex alike.
import type { AgentEfforts, AgentKind, AgentModel } from '@symbiote/core';

/** Each agent's name, as messages say it. */
export const AGENT_NAMES: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  hermes: 'Hermes',
};

/** Why `effort` is not an effort level at all: a word, never an option or a sentence (V30b). */
export const effortWordProblem = (effort: unknown): string =>
  `an effort level is a word, such as high: ${JSON.stringify(effort)}`;

/**
 * Why the agent `name` cannot start at `effort` (V30b), or null: it must be one of the `levels` it
 * lists, and those must be readable (an unknown level, Claude Code ignores without failing).
 */
export function effortProblem(
  effort: string,
  name: string,
  levels: readonly string[] | undefined,
): string | null {
  if (!levels) return `Symbiote cannot read ${name}'s effort levels: start it at its default`;
  if (levels.includes(effort)) return null;
  const listed =
    levels.length > 1 ? `${levels.slice(0, -1).join(', ')} or ${levels.at(-1)}` : levels[0];
  return `${name} takes ${listed}: ${effort}`;
}

/** Why `model` is not a model's ID at all: never an option or a sentence (V47). */
export const modelWordProblem = (model: unknown): string =>
  `a model is its ID, such as sonnet: ${JSON.stringify(model)}`;

/**
 * Why the agent `name` cannot start on `model` (V47), or null: it must be one of the `models` it
 * lists, and those must be readable.
 */
export function modelProblem(
  model: string,
  name: string,
  models: readonly AgentModel[] | null | undefined,
): string | null {
  if (!models) return `Symbiote cannot read ${name}'s models: start it on its default`;
  if (models.some((m) => m.id === model)) return null;
  return `${name} lists no model ${model}: pick one it lists`;
}

/**
 * Why the agent `name` cannot start at `effort` on `model` (V47), or null: the model's own levels
 * when the agent lists it — none for a model that takes none —, else `fallback`, its default
 * model's.
 */
export function effortOnProblem(
  effort: string,
  name: string,
  models: readonly AgentModel[] | null | undefined,
  model: string | undefined,
  fallback: AgentEfforts | null,
): string | null {
  const listed = model ? models?.find((m) => m.id === model) : undefined;
  if (listed && !listed.efforts)
    return `${listed.name} takes no effort level: start it at its default`;
  return effortProblem(effort, listed?.name ?? name, (listed?.efforts ?? fallback)?.levels);
}

/**
 * The levels an agent takes on `model` (V47): the model's own when the agent lists it (none for a
 * model that takes none), else `fallback`, its default model's (Claude Code's `--help`).
 */
export function levelsOn(
  models: readonly AgentModel[] | null | undefined,
  model: string | undefined,
  fallback: AgentEfforts | null,
): AgentEfforts | null {
  const listed = model ? models?.find((m) => m.id === model) : undefined;
  if (!listed) return fallback;
  return listed.efforts ?? null;
}
