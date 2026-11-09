// A page agent's models and effort levels (V30b, V47): what is installed, the model and level it
// starts on, checked against what each agent lists.
import {
  EFFORT_LEVEL,
  type AgentEfforts,
  type AgentKind,
  type AgentModels,
  type DefaultModel,
  type AgentLevels,
} from '@symbiote/core';
import type { Codex } from './codex.js';
import { readPrompts } from './prompts.js';
import { readWorkspaceConfig } from './workspaces.js';
import type { ClaudeCode } from './claude-code.js';
import { AGENT_NAMES, effortOnProblem, levelsOn, modelProblem } from './agent-levels.js';
import { type PageAgentContext, PageAgentRefused } from './page-agent-context.js';

/**
 * The agents a page agent runs: Claude Code and Codex.
 */
export const PAGE_AGENTS: readonly AgentKind[] = ['claude', 'codex'];

export const commandOf = (agent: { claude?: ClaudeCode; codex?: Codex }) =>
  agent.claude?.command ?? agent.codex?.command ?? '';

/** The model asked for (V50): checked against the agent's list; null and absent pass. */
export async function checkModel(
  agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
  asked: string | null | undefined,
): Promise<void> {
  if (!asked) return;
  const problem = modelProblem(asked, AGENT_NAMES[agent.kind], (await modelsOf(agent))?.models);
  if (problem) throw new PageAgentRefused(problem, 400);
}

/** An effort level's word (V30b): what a request may name, before the agent's list is read. */
export const isLevel = (value: unknown): value is string =>
  typeof value === 'string' && EFFORT_LEVEL.test(value);

/** The models an agent lists (V47); null unread. */
export async function modelsOf(agent: {
  claude?: ClaudeCode;
  codex?: Codex;
}): Promise<AgentModels | null> {
  if (agent.codex) return agent.codex.models();
  const models = (await agent.claude?.models()) ?? null;
  return models ? { models } : null;
}

/** The levels an agent takes (V30b): Claude Code's `--help`, Codex's app server; null unread. */
async function defaultLevelsOf(agent: {
  claude?: ClaudeCode;
  codex?: Codex;
}): Promise<AgentEfforts | null> {
  if (agent.codex) return agent.codex.efforts();
  const levels = (await agent.claude?.efforts()) ?? null;
  return levels ? { levels } : null;
}

/** The page agent's levels. */
export function pageAgentLevels({
  claude,
  codex,
  root,
  spec,
}: Pick<PageAgentContext, 'claude' | 'codex' | 'root' | 'spec'>) {
  /** The agents installed: `agent.kind` first, else Claude Code, else Codex (decision 240). */
  async function installed(): Promise<{ kind: AgentKind; claude?: ClaudeCode; codex?: Codex }[]> {
    const first = readWorkspaceConfig(root).agent;
    // `agent.kind` first when it is one of theirs (a stable sort keeps the others' order).
    const order = [...PAGE_AGENTS].sort((a, b) => Number(b === first) - Number(a === first));
    const found: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex }[] = [];
    for (const kind of order) {
      if (kind === 'claude') {
        const agent = await claude();
        if (agent) found.push({ kind, claude: agent });
      } else {
        const agent = await codex();
        if (agent) found.push({ kind, codex: agent });
      }
    }
    return found;
  }

  /**
   * The model a new conversation starts on (V47): the project's (`nucleus.model`) when its agent
   * lists it — the box may pick the other agent, whose list will not have it —, else none passed
   * (Claude Code's `agent.model`, or the agent's own).
   */
  async function modelFor(agent: {
    claude?: ClaudeCode;
    codex?: Codex;
  }): Promise<string | undefined> {
    const project = spec.model.read(root);
    if (!project) return undefined;
    return (await modelsOf(agent))?.models.some((m) => m.id === project) ? project : undefined;
  }

  /** The model an agent runs on without the project's (V47), when Symbiote knows it. */
  async function defaultModelOf(agent: {
    kind: AgentKind;
    codex?: Codex;
  }): Promise<DefaultModel | undefined> {
    if (agent.kind === 'claude') {
      const project = readWorkspaceConfig(root).model;
      return project ? { id: project, by: 'project' } : undefined;
    }
    const listed = await agent.codex?.models();
    return listed?.default ? { id: listed.default, by: 'agent' } : undefined;
  }

  /**
   * The model an agent's new conversation runs on (V47) — `asked` (V50; null: none), else the
   * project's when it lists it; without one, Claude Code's `agent.model` — and the levels it takes
   * there; the default's without one.
   */
  async function onModel(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    asked?: string | null,
  ): Promise<{
    model: string | undefined;
    models: AgentModels | null;
    fallback: AgentEfforts | null;
  }> {
    const picked = asked === undefined ? await modelFor(agent) : (asked ?? undefined);
    const model = picked ?? (agent.kind === 'claude' ? readWorkspaceConfig(root).model : undefined);
    return {
      model,
      models: model ? await modelsOf(agent) : null,
      fallback: await defaultLevelsOf(agent),
    };
  }

  /**
   * The levels an agent takes on the model its new conversation would start on (V30b, V47), or on
   * the one asked (V50).
   */
  async function levelsOf(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    asked?: string | null,
  ): Promise<AgentEfforts | null> {
    const { model, models, fallback } = await onModel(agent, asked);
    return levelsOn(models?.models, model, fallback);
  }

  /** Why `effort` cannot start a conversation of `agent`'s, on its model (or `asked`), or null. */
  async function levelProblem(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    effort: string,
    asked?: string | null,
  ): Promise<string | null> {
    const { model, models, fallback } = await onModel(agent, asked);
    return effortOnProblem(effort, AGENT_NAMES[agent.kind], models?.models, model, fallback);
  }

  /**
   * The level a new conversation starts at: the one asked, if the agent lists it; none for null;
   * else the project's (`nucleus.effort`, `scribe.effort`) when the agent lists it, its own
   * otherwise — the project's file may name another agent's level, or an older one's.
   */
  async function levelFor(
    agent: { kind: AgentKind; claude?: ClaudeCode; codex?: Codex },
    effort: string | null | undefined,
    asked?: string | null,
  ): Promise<string | undefined> {
    if (effort === null) return undefined;
    if (effort === undefined) {
      const project = spec.effort.read(root);
      if (!project) return undefined;
      return (await levelsOf(agent, asked))?.levels.includes(project) ? project : undefined;
    }
    const problem = await levelProblem(agent, effort, asked);
    if (problem) throw new PageAgentRefused(problem, 400);
    return effort;
  }

  async function efforts(): Promise<AgentLevels> {
    const agents = await Promise.all(
      (await installed()).map(async (agent) => {
        const [efforts, listed, defaultModel] = await Promise.all([
          levelsOf(agent),
          modelsOf(agent),
          defaultModelOf(agent),
        ]);
        return {
          kind: agent.kind,
          ...(efforts ? { efforts } : {}),
          ...(listed ? { models: listed.models } : {}),
          ...(defaultModel ? { defaultModel } : {}),
        };
      }),
    );
    const effort = spec.effort.read(root);
    const model = spec.model.read(root);
    return {
      agents,
      ...(effort ? { effort } : {}),
      ...(model ? { model } : {}),
      file: readPrompts(root).file,
    };
  }

  return { installed, modelFor, levelProblem, levelFor, efforts };
}

export type PageAgentLevels = ReturnType<typeof pageAgentLevels>;
