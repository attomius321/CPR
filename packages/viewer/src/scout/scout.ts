import type { AgentOption, ScoutConversation, ScoutStateName } from '@symbiote/core';
import type { EffortChoice } from '../workspaces/effort.js';
import {
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

/**
 * What Scout's head offers and shows (V50): the agent's models and the levels the model takes;
 * the conversation's model and level (`''`: the agent's own), or before one the project's
 * (`scout.model`, `scout.effort`) where the agent lists them. Nothing before the levels are read.
 */
export function headChoices(
  agent: Pick<AgentOption, 'kind' | 'efforts' | 'models' | 'defaultModel'> | undefined,
  conversation: Pick<ScoutConversation, 'model' | 'effort'> | null,
  project: { model?: string; effort?: string },
): { models: ModelChoice[]; model: string; efforts: EffortChoice[]; effort: string } {
  if (!agent) return { models: [], model: '', efforts: [], effort: '' };
  const model = conversation ? (conversation.model ?? '') : (keptModel(project.model, agent) ?? '');
  const on = model || undefined;
  return {
    models: modelChoices(agent),
    model,
    efforts: effortChoices(agent, on),
    effort: conversation
      ? (conversation.effort ?? '')
      : (keptEffort(project.effort, agent, on) ?? ''),
  };
}
