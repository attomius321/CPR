import type { AgentKind, AgentOption, ScoutConversation, ScoutStateName } from '@symbiote/core';
import type { EffortChoice } from '../workspaces/effort.js';
import {
  AGENT_NAMES,
  effortChoices,
  keptEffort,
  keptModel,
  modelChoices,
  type ModelChoice,
} from '../workspaces/workspaces.js';

/**
 * What the sidenav says of Scout (V35, decision 238): `working` while it answers; `answered` when
 * an answer came while the person was on another page, until they open Scout; nothing otherwise.
 */
export type ScoutMark = 'working' | 'answered' | null;

/** Turns that end on the person: an answer, a dialog, a turn ended by Esc. */
const ENDED: readonly ScoutStateName[] = ['answered', 'needs-you', 'interrupted'];

/** The mark after a new read of Scout's state (`state`: none without a conversation). */
export function nextScoutMark(
  shown: ScoutMark,
  state: ScoutStateName | undefined,
  onScout: boolean,
): ScoutMark {
  if (state === 'working') return 'working';
  if (onScout || state === undefined || !ENDED.includes(state)) return null;
  return shown === 'working' || shown === 'answered' ? 'answered' : null;
}

/** Scout's state in words, as its page's head says it. */
export function scoutStateText(conversation: ScoutConversation): string {
  switch (conversation.state) {
    case 'ready':
      return 'Ready: ask in its terminal';
    case 'working':
      return 'Answering';
    case 'answered':
      return 'Answered: ask more in its terminal';
    case 'needs-you':
      return 'Waiting for you in its terminal';
    case 'interrupted':
      return 'Interrupted: waiting for you';
    case 'stopped':
      return 'Stopped: its terminal continues the conversation';
    case 'failed':
      return 'Failed: start a new conversation';
    case 'gone':
      return 'Its session is gone: start a new conversation';
    case 'unknown':
      return conversation.error ? `Unknown: ${conversation.error}` : 'Unknown';
  }
}

/** What Scout's head offers and shows: an agent's models and levels, and the ones picked. */
export interface HeadChoices {
  models: ModelChoice[];
  model: string;
  efforts: EffortChoice[];
  effort: string;
}

/**
 * What Scout's head offers and shows (V50): the agent's models and the levels the model takes;
 * the conversation's model and level (`''`: the agent's own), or before one the project's
 * (`scout.model`, `scout.effort`) where the agent lists them. Nothing before the levels are read.
 * Since V52 the head is what New conversation starts on: `picked`, the person's changes there,
 * go over them; a model picked keeps the level shown when it takes it, else the agent's own.
 */
export function headChoices(
  agent: Pick<AgentOption, 'kind' | 'efforts' | 'models' | 'defaultModel'> | undefined,
  conversation: Pick<ScoutConversation, 'model' | 'effort'> | null,
  project: { model?: string; effort?: string },
  picked: { model?: string; effort?: string } = {},
): HeadChoices {
  if (!agent) return { models: [], model: '', efforts: [], effort: '' };
  const model =
    picked.model ??
    (conversation ? (conversation.model ?? '') : (keptModel(project.model, agent) ?? ''));
  const on = model || undefined;
  const shown =
    picked.effort ??
    (conversation ? (conversation.effort ?? '') : (keptEffort(project.effort, agent, on) ?? ''));
  return {
    models: modelChoices(agent),
    model,
    efforts: effortChoices(agent, on),
    effort: picked.model === undefined ? shown : (keptEffort(shown, agent, on) ?? ''),
  };
}

/** A model and a level in words, by the head's lists: "on Sonnet 5.5 at high". */
function onWords(head: HeadChoices, model: string, effort: string, levels: boolean): string {
  const name = head.models.find((m) => m.value === model)?.label ?? model;
  const words = [
    head.models.length > 0 ? `on ${name}` : '',
    levels ? `at ${effort || 'its default level'}` : '',
  ];
  return words.filter((w) => w !== '').join(' ');
}

/**
 * New conversation in Scout's head (V52, decision 392): whether the head's choices differ from
 * the running conversation's — the next starts on them, the button then the page's first — and
 * its title, naming both. Only what the head shows is compared: no models read, no model.
 */
export function newConversation(
  head: HeadChoices & { kind: AgentKind },
  conversation: Pick<ScoutConversation, 'kind' | 'model' | 'effort'>,
): { differs: boolean; title: string } {
  const ends = 'its session is stopped and removed';
  const model = conversation.model ?? '';
  const effort = conversation.effort ?? '';
  const other = head.kind !== conversation.kind;
  const differs =
    other ||
    (head.models.length > 0 && head.model !== model) ||
    (head.efforts.length > 0 && head.effort !== effort);
  if (!differs) {
    return {
      differs,
      title: `Ends this conversation (${ends}) and starts another on this one's agent, model and effort`,
    };
  }
  const now = other
    ? `${AGENT_NAMES[conversation.kind]}'s`
    : onWords(head, model, effort, effort !== '' || head.efforts.length > 0);
  const next = onWords(head, head.model, head.effort, head.efforts.length > 0);
  const agent = other ? `with ${AGENT_NAMES[head.kind]}${next ? ',' : ''} ` : '';
  return {
    differs,
    title: `Ends this conversation (${now ? `${now}; ` : ''}${ends}) and starts another ${agent}${next}, as picked here`,
  };
}
