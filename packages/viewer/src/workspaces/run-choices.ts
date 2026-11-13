// An agent's run, its choices and their words (V20a, V30b, V47): the models and levels an agent
// lists, the run a draft keeps, what a workspace was started with and runs on.
import type {
  AgentEfforts,
  AgentKind,
  AgentOption,
  McpVia,
  WorkspaceAgentState,
  PermissionMode,
  StartBranch,
} from '@symbiote/core';
import { AGENT_NAMES } from './workspaces.js';

/**
 * The permission modes the start page offers, as it names them. `default` is the mode that asks,
 * Claude Code's `manual`: no longer Claude Code's default, which is `auto` in 2.1.319 to 2.1.325
 * (fix/default-permission-mode).
 */
export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: 'Ask',
  acceptEdits: 'Accept edits',
  auto: 'Auto',
};

/**
 * What each permission mode lets Claude Code do, for the Permissions choice's tip, as Claude Code
 * 2.1.325 does it: Accept edits also runs mkdir, touch, rm, rmdir, mv, cp and sed unasked.
 */
export const PERMISSION_WORDS: Record<PermissionMode, string> = {
  default:
    "Claude Code's Manual mode: it asks you before each edit and each command your Claude Code settings do not allow",
  acceptEdits:
    'It edits files and runs mkdir, touch, rm, rmdir, mv, cp and sed without asking; it asks you before other commands',
  auto: "Claude Code's classifier runs what it judges low-risk and blocks the rest: it rarely asks you",
};

/** A Model choice (V47): a model's ID (`''` for the agent's default), its name, its words. */
export interface ModelChoice {
  value: string;
  label: string;
  description?: string;
}

/**
 * The Model choices for an agent (V47): its default first — named when Symbiote knows it: Codex's
 * configured model, the project's (`agent.model`), Symbiote's (the merger's), not Claude Code's
 * own (decision 337) — then the models it lists, by their names. None when Symbiote could not
 * read its models.
 */
export function modelChoices(
  agent: Pick<AgentOption, 'kind' | 'models' | 'defaultModel'>,
): ModelChoice[] {
  if (!agent.models) return [];
  const known = agent.defaultModel;
  const listed = known ? agent.models.find((m) => m.id === known.id) : undefined;
  const name = listed?.name ?? known?.id;
  const label = !known
    ? `${AGENT_NAMES[agent.kind]}'s default`
    : known.by === 'agent'
      ? `${AGENT_NAMES[agent.kind]}'s default (${name})`
      : known.by === 'project'
        ? `The project's (${name})`
        : `Symbiote's default (${name})`;
  return [
    { value: '', label, ...(listed?.description ? { description: listed.description } : {}) },
    ...agent.models.map((m) => ({
      value: m.id,
      label: m.name,
      ...(m.description ? { description: m.description } : {}),
    })),
  ];
}

/** The model picked, kept when the agent lists it; else its default. */
export function keptModel(
  model: string | undefined,
  agent: Pick<AgentOption, 'models'>,
): string | undefined {
  return model && agent.models?.some((m) => m.id === model) ? model : undefined;
}

/**
 * The levels an agent takes on `model` (V47): the model's own when the agent lists it (none for
 * a model that takes none), else the agent's, its default model's.
 */
function levelsOn(
  agent: Pick<AgentOption, 'efforts' | 'models'>,
  model: string | undefined,
): AgentEfforts | undefined {
  const listed = model ? agent.models?.find((m) => m.id === model) : undefined;
  return listed ? listed.efforts : agent.efforts;
}

/**
 * The Effort choices for an agent (V30b) on the model picked (V47): its own default first —
 * named with its level when the agent says it (Codex), not otherwise (Claude Code, decision
 * 210); Symbiote's when the level is Symbiote's choice (the advisor's, V75c) — then the levels it
 * lists, in its words. None when Symbiote could not read its levels, or the model takes none.
 */
export function effortChoices(
  agent: Pick<AgentOption, 'kind' | 'efforts' | 'models'>,
  model?: string,
): { value: string; label: string }[] {
  const efforts = levelsOn(agent, model);
  if (!efforts) return [];
  const own = efforts.default ? ` (${efforts.default})` : '';
  const whose = efforts.by === 'symbiote' ? 'Symbiote' : AGENT_NAMES[agent.kind];
  return [
    { value: '', label: `${whose}'s default${own}` },
    ...efforts.levels.map((level) => ({ value: level, label: level })),
  ];
}

/** The level picked, kept when the agent picked now takes it too, on its model; else its default. */
export function keptEffort(
  effort: string | undefined,
  agent: Pick<AgentOption, 'efforts' | 'models'>,
  model?: string,
): string | undefined {
  return effort && levelsOn(agent, model)?.levels.includes(effort) ? effort : undefined;
}

/** The run's choices on the start page (V30b): kept with the draft, so leaving loses none. */
export interface RunChoices {
  agent?: AgentKind;
  /** The model picked (V47); the agent's default when absent. */
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  planFirst?: boolean;
  /** The branch to start from (V33); the default branch when absent. */
  from?: string;
}

/**
 * The run's choices a draft kept, those that still hold: an agent still installed, a model it
 * lists and a level that model takes (V47), a permission mode Symbiote offers, a branch still
 * listed. A model and a level are kept only with their agent: they are that agent's.
 */
export function readRun(
  value: unknown,
  agents: readonly AgentOption[],
  branches: readonly StartBranch[] = [],
): RunChoices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const named = agents.find((a) => a.kind === v.agent);
  // None picked: the page's default agent, the first, is the level's.
  const agent = named ?? (v.agent === undefined ? agents[0] : undefined);
  const model = agent && typeof v.model === 'string' ? keptModel(v.model, agent) : undefined;
  const effort =
    agent && typeof v.effort === 'string' ? keptEffort(v.effort, agent, model) : undefined;
  const mode = (Object.keys(PERMISSION_LABELS) as PermissionMode[]).find(
    (m) => m === v.permissionMode,
  );
  return {
    ...(named ? { agent: named.kind } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(mode ? { permissionMode: mode } : {}),
    ...(typeof v.planFirst === 'boolean' ? { planFirst: v.planFirst } : {}),
    ...(branches.some((b) => b.name === v.from) ? { from: v.from as string } : {}),
  };
}

/**
 * How a workspace's agent was started (V30b), for its Brief tab: the agent, its model (V47) and
 * its level. Said as a start, since its session may have changed them since (decisions 211, 341).
 */
export function startedWith(
  agent: WorkspaceAgentState,
  via?: McpVia,
  nucleus = 'Nucleus',
): string | null {
  if (!agent.kind) return null;
  const model = agent.model ? ` on ${agent.model}` : '';
  const level = agent.effort ? `${agent.effort} effort` : 'its default effort';
  const through = via ? ` through ${viaName(via, nucleus)}` : '';
  return `Started${through} with ${AGENT_NAMES[agent.kind]}${model} at ${level}.`;
}

/** The families Claude Code takes as aliases of its newest model of each (`--model opus`). */
const CLAUDE_FAMILIES = /^(opus|sonnet|haiku|fable)$/;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * A model's name from its ID (V83, decision 661), as its agent's list names it:
 * `claude-opus-5-5` "Opus 5.5", `claude-haiku-4-5-20251001` "Haiku 4.5", `gpt-5.6-terra`
 * "GPT-5.6-Terra"; a Claude family alias by the family ("Opus"); any other ID as it is.
 */
export function modelName(id: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude) {
    const [, family = '', major = '', minor] = claude;
    return `${capital(family)} ${minor ? `${major}.${minor}` : major}`;
  }
  if (CLAUDE_FAMILIES.test(id)) return capital(id);
  if (/^gpt-[a-z0-9.-]+$/.test(id)) {
    return id
      .split('-')
      .map((part, i) => (i === 0 ? 'GPT' : capital(part)))
      .join('-');
  }
  return id;
}

/** A model by its name, and by its ID too when the name is more than its ID's capitals. */
const modelWords = (id: string) => {
  const name = modelName(id);
  return name.toLowerCase() === id.toLowerCase() ? name : `${name} (${id})`;
};

/** Whether a model picked at the start is the one that runs: the same, or its family's alias. */
const sameModel = (started: string, running: string) =>
  started === running ||
  modelName(started) === modelName(running) ||
  (CLAUDE_FAMILIES.test(started) && modelName(running).startsWith(`${modelName(started)} `));

/**
 * What a workspace's agent runs on (V83), for its head's chip and its card: the model by its name
 * and the level in words ("Opus 5.5 · xhigh effort"), and a tip that says whose, as of when, and
 * how it started when that differs. Before its session said it (or for an agent Symbiote does not
 * read: Codex by exec), how it started, said as that. Null with no agent.
 */
export function runsOnWords(agent: WorkspaceAgentState): { text: string; tip: string } | null {
  const kind = agent.kind;
  if (!kind) return null;
  const name = AGENT_NAMES[kind];
  /** How it started: "Sonnet at high effort", "its default model at its default effort". */
  const startedOn = (model: (id: string) => string) =>
    `${agent.model ? model(agent.model) : 'its default model'} at ${agent.effort ? `${agent.effort} effort` : 'its default effort'}`;
  const read = agent.runsOn;
  if (!read?.model && !read?.effort) {
    const text = `${agent.model ? modelName(agent.model) : 'Default model'} · ${agent.effort ? `${agent.effort} effort` : 'default effort'}`;
    const started = `${name} started on ${startedOn(modelWords)}`;
    const reads = kind === 'claude' || (kind === 'codex' && !!agent.remote);
    return { text, tip: reads ? `${started}\nWhat it runs on shows once it answers` : started };
  }
  const level = read.effort ? `${read.effort} effort` : null;
  const text = [read.model ? modelName(read.model) : 'Default model', level]
    .filter((part) => part !== null)
    .join(' · ');
  const runs = `${name} runs on ${read.model ? modelWords(read.model) : 'its default model'}${level ? ` at ${level}` : ''}`;
  const clock = read.at
    ? new Date(read.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;
  const when = !clock
    ? null
    : kind === 'codex'
      ? `As its thread says at ${clock}`
      : `As of its answer at ${clock}`;
  const changed =
    (agent.model && read.model && !sameModel(agent.model, read.model)) ||
    (agent.effort && read.effort && agent.effort !== read.effort);
  const started = changed ? `Started on ${startedOn(modelName)}` : null;
  return { text, tip: [runs, when, started].filter((line) => line !== null).join('\n') };
}

/** What a workspace or a verdict was made through (MC1): Nucleus by `nucleus`, its name now. */
export function viaName(via: McpVia, nucleus = 'Nucleus'): string {
  return via === 'nucleus' ? nucleus : 'symbiote mcp';
}
