import type {
  AgentKind,
  AgentModel,
  PageAgentConversation,
  PageAgentStateName,
  WorkspaceAgentState,
} from '@symbiote/core';
import { AGENT_NAMES } from '../workspaces/workspaces.js';

/**
 * What the sidenav says of Nucleus (V35, decision 238): `working` while it answers; `answered` when
 * an answer came while the person was on another page, until they open Nucleus; nothing otherwise.
 */
export type NucleusMark = 'working' | 'answered' | null;

/** Turns that end on the person: an answer, a dialog, a turn ended by Esc. */
const ENDED: readonly PageAgentStateName[] = ['answered', 'needs-you', 'interrupted'];

/** The mark after a new read of Nucleus's state (`state`: none without a conversation). */
export function nextNucleusMark(
  shown: NucleusMark,
  state: PageAgentStateName | undefined,
  onNucleus: boolean,
): NucleusMark {
  if (state === 'working') return 'working';
  if (onNucleus || state === undefined || !ENDED.includes(state)) return null;
  return shown === 'working' || shown === 'answered' ? 'answered' : null;
}

/** Nucleus's state in words, as its page's head says it. */
export function pageAgentStateText(conversation: PageAgentConversation): string {
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
 * What a page agent's conversation runs on, as its head's line says it (V78, decision 569): "with
 * Claude Code on Sonnet 5.5 at high effort". The model by its name in the agent's list, else its ID;
 * the agent's own model or level is left unsaid. Settings sets them; the page only says them.
 */
export function runsOn(
  kind: AgentKind,
  conversation: Pick<PageAgentConversation, 'model' | 'effort'> | null,
  models: readonly Pick<AgentModel, 'id' | 'name'>[] | undefined,
): string {
  const model = conversation?.model;
  const name = model ? (models?.find((m) => m.id === model)?.name ?? model) : '';
  return [
    `with ${AGENT_NAMES[kind]}`,
    name ? `on ${name}` : '',
    conversation?.effort ? `at ${conversation.effort} effort` : '',
  ]
    .filter((w) => w !== '')
    .join(' ');
}

/**
 * What the page says of a conversation started under the agent's former name (NU1, decision 591):
 * it keeps that one's tools, no web, until New conversation; null for any other.
 */
export function formerText(
  conversation: Pick<PageAgentConversation, 'startedAs'> | null,
  name: string,
): string | null {
  if (!conversation?.startedAs) return null;
  return `Started as ${conversation.startedAs}, without the web: New conversation starts ${name}.`;
}

/**
 * What Nucleus's page says of a conversation started under its other name (decision 686): Alpha
 * Ceph's, started while Hive mode was on, now off, or Nucleus's now on. It keeps the name its
 * prompt gave it until New conversation; null when the names agree, or for none.
 */
export function otherNameText(
  conversation: Pick<PageAgentConversation, 'name'> | null,
  name: string,
): string | null {
  if (!conversation) return null;
  const started = conversation.name ?? 'Nucleus';
  return started === name ? null : `Started as ${started}: New conversation starts ${name}.`;
}

/**
 * Nucleus's conversation as its Activity tab reads an agent's state (NU2): working while it
 * answers, waiting on a dialog or after Esc, else done, stopped, failed or not running.
 */
export function nucleusAgent(conversation: PageAgentConversation | null): WorkspaceAgentState {
  if (!conversation) return { state: 'not-running' };
  const kind = { kind: conversation.kind };
  switch (conversation.state) {
    case 'working':
      return { state: 'working', ...kind };
    case 'needs-you':
      return { state: 'needs-you', ...kind };
    case 'interrupted':
      return { state: 'needs-you', interrupted: true, ...kind };
    case 'ready':
    case 'answered':
      return { state: 'done', ...kind };
    case 'stopped':
      return { state: 'stopped', ...kind };
    case 'failed':
      return { state: 'failed', ...kind };
    default:
      return { state: 'not-running', ...kind };
  }
}
