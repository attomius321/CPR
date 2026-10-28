// Suggest settings on the Start page (V75): why its button waits, the advisor's proposal in words,
// and the run's choices once the person accepts it (decision 548). The advisor runs only when the
// button is pressed (decision 549).
import type { AgentOption, WorkspaceSuggestion } from '@symbiote/core';
import { AGENT_NAMES, keptEffort, keptModel, type RunChoices } from './workspaces.js';

/** Why Suggest settings cannot be pressed now, in the words its tip shows; null when it can. */
export function suggestBlocked({
  agent,
  main,
  heading,
  running,
}: {
  agent: Pick<AgentOption, 'kind' | 'models'> | null;
  /** The brief's main part, as typed, and its heading ("Goal"). */
  main: string;
  heading: string;
  /** A start under way. */
  running: boolean;
}): string | null {
  if (running) return 'A start is under way';
  if (!agent) return 'No agent is installed';
  if (agent.kind === 'hermes') return 'Hermes lists no models to suggest from';
  if (!agent.models?.length) return `${AGENT_NAMES[agent.kind]} lists no models Symbiote can read`;
  if (main.trim() === '') {
    return `Write ${/^What /.test(heading) ? '' : 'the '}${heading.toLowerCase()} first`;
  }
  return null;
}

/**
 * The proposal as the cards would hold it: the model while the agent lists it, the level while
 * that model takes it (`keptModel`, `keptEffort`), else their defaults.
 */
export function proposedChoices(
  suggestion: WorkspaceSuggestion,
  agent: Pick<AgentOption, 'models' | 'efforts'>,
): { model?: string; effort?: string; planFirst: boolean } {
  const model = keptModel(suggestion.model, agent);
  const effort = keptEffort(suggestion.effort, agent, model);
  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    planFirst: suggestion.planFirst,
  };
}

/**
 * The proposal in words — "Haiku 5.5 suggests Opus 5.5 at high effort, plan first" — by the names
 * the agent lists, and whether the cards hold it already.
 */
export function proposalWords(
  suggestion: WorkspaceSuggestion,
  agent: Pick<AgentOption, 'kind' | 'models' | 'efforts'>,
  current: { model?: string | undefined; effort?: string | undefined; planFirst: boolean },
): { words: string; same: boolean } {
  const name = AGENT_NAMES[agent.kind];
  const proposed = proposedChoices(suggestion, agent);
  const who = suggestion.by.model === 'default' ? name : suggestion.by.name;
  const model = proposed.model
    ? (agent.models?.find((m) => m.id === proposed.model)?.name ?? proposed.model)
    : `${name}'s default model`;
  const level = proposed.effort ? `${proposed.effort} effort` : 'its default level';
  const plan = proposed.planFirst ? 'plan first' : 'no plan first';
  return {
    words: `${who} suggests ${model} at ${level}, ${plan}`,
    same:
      proposed.model === current.model &&
      proposed.effort === current.effort &&
      proposed.planFirst === current.planFirst,
  };
}

/** The run's choices with the proposal accepted: its model, level and plan first, nothing else. */
export function withProposal(
  run: RunChoices,
  suggestion: WorkspaceSuggestion,
  agent: Pick<AgentOption, 'models' | 'efforts'>,
): RunChoices {
  const { model, effort, planFirst } = proposedChoices(suggestion, agent);
  const next: RunChoices = { ...run, planFirst };
  delete next.model;
  delete next.effort;
  return { ...next, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
