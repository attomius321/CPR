// The advisor (V75): a proposal for the Start page, and its model and level on each agent, as
// Settings shows them.
import { EFFORT_LEVEL, MODEL_ID, type AgentKind, type AgentLevels } from '@symbiote/core';
import { PromptRefused, readPrompts, writeConfig } from './prompts.js';
import {
  ADVISING_AGENTS,
  advise,
  advisorChoices,
  advisorOn,
  type AdvisingAgent,
  type AdvisorPick,
} from './workspace-advice.js';
import {
  AGENT_NAMES,
  effortOnProblem,
  effortWordProblem,
  modelProblem,
  modelWordProblem,
} from './agent-levels.js';
import { WorkspaceRefused } from './workspace-record.js';
import type { WorkspacesContext, Workspaces } from './workspace-context.js';
import { type WorkspaceAgent, type FoundAgent, effortsOf, modelsOf } from './workspace-agent.js';

/** The advisor's proposal and settings. */
export function workspaceAdvisor(
  {
    advisor,
    cacheDir,
    config,
    root,
  }: Pick<WorkspacesContext, 'advisor' | 'cacheDir' | 'config' | 'root'>,
  { defaultAgent, found }: Pick<WorkspaceAgent, 'defaultAgent' | 'found'>,
) {
  /** `kind` as an agent the advisor runs on (V75c); refused for one that lists no models. */
  function advising(kind: AgentKind): AdvisingAgent {
    const known = ADVISING_AGENTS.find((k) => k === kind);
    if (!known) {
      throw new WorkspaceRefused(
        `${AGENT_NAMES[kind]} lists no models: Symbiote suggests settings for Claude Code and Codex`,
        400,
      );
    }
    return known;
  }

  /** The advisor's models and levels on `kind` (V75c), as Settings shows them. */
  async function advisorOf(kind: AgentKind): Promise<AgentLevels> {
    const on = advising(kind);
    const pick = config().advisor?.[on] ?? {};
    const about = {
      ...(pick.effort ? { effort: pick.effort } : {}),
      ...(pick.model ? { model: pick.model } : {}),
      file: readPrompts(root).file,
    };
    const agent = await found(on);
    if (!agent) return { agents: [], ...about };
    const [listed, levels] = await Promise.all([modelsOf(agent), effortsOf(agent)]);
    return { agents: [advisorChoices(on, listed, levels, pick)], ...about };
  }

  /** `kind`'s agent for a change of the advisor's settings; refused when it is not installed. */
  async function advisorAgent(kind: AgentKind): Promise<FoundAgent> {
    const agent = await found(advising(kind));
    if (!agent) throw new WorkspaceRefused(`${AGENT_NAMES[kind]} is not installed`, 409);
    return agent;
  }

  /** Writes `advisor.<kind>.<key>` (V75c), or removes it; a config that is not JSON refuses. */
  async function writeAdvisor(
    kind: AgentKind,
    key: keyof AdvisorPick,
    value: string | null,
  ): Promise<AgentLevels> {
    try {
      await writeConfig(root, ['advisor', kind, key], value ?? undefined);
    } catch (error) {
      if (error instanceof PromptRefused) throw new WorkspaceRefused(error.message, error.status);
      throw error;
    }
    return advisorOf(kind);
  }

  const ops: Pick<Workspaces, 'suggest' | 'advisor' | 'setAdvisorModel' | 'setAdvisorEffort'> = {
    async suggest(request) {
      const agent = request.agent ? await found(request.agent) : await defaultAgent();
      if (!agent) {
        throw new WorkspaceRefused(
          request.agent
            ? `${AGENT_NAMES[request.agent]} is not installed`
            : 'no agent is installed',
          409,
        );
      }
      const listed = await modelsOf(agent);
      if (!listed?.models.length) {
        throw new WorkspaceRefused(
          `${AGENT_NAMES[agent.kind]} lists no models Symbiote can read`,
          409,
        );
      }
      const pick = config().advisor?.[agent.kind] ?? {};
      // The agent's own levels only when it runs on its own model: neither model is listed.
      const levels = advisorOn(agent.kind, listed.models, pick).model
        ? null
        : await effortsOf(agent);
      return advise({
        agent: {
          kind: agent.kind,
          command: agent.kind === 'claude' ? agent.claude.command : agent.codex.command,
          name: AGENT_NAMES[agent.kind],
        },
        models: listed.models,
        prompt: readPrompts(root).text.advisor,
        request,
        config: pick,
        levels,
        cacheDir,
        ...advisor,
      });
    },

    advisor: advisorOf,

    async setAdvisorModel(kind, { model }) {
      advising(kind);
      if (model !== null) {
        if (typeof model !== 'string' || !MODEL_ID.test(model)) {
          throw new WorkspaceRefused(modelWordProblem(model), 400);
        }
        const agent = await advisorAgent(kind);
        const problem = modelProblem(model, AGENT_NAMES[kind], (await modelsOf(agent))?.models);
        if (problem) throw new WorkspaceRefused(problem, 400);
      }
      return writeAdvisor(kind, 'model', model);
    },

    async setAdvisorEffort(kind, { effort }) {
      const on = advising(kind);
      if (effort !== null) {
        if (typeof effort !== 'string' || !EFFORT_LEVEL.test(effort)) {
          throw new WorkspaceRefused(effortWordProblem(effort), 400);
        }
        const agent = await advisorAgent(kind);
        // The levels of the model the advisor runs on: the project's, else its small model.
        const listed = (await modelsOf(agent))?.models;
        const problem = effortOnProblem(
          effort,
          AGENT_NAMES[kind],
          listed,
          advisorOn(on, listed ?? [], config().advisor?.[on] ?? {}).model?.id,
          await effortsOf(agent),
        );
        if (problem) throw new WorkspaceRefused(problem, 400);
      }
      return writeAdvisor(kind, 'effort', effort);
    },
  };
  return { ops };
}
