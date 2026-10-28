// The advisor (V75): one turn of the picked agent on its small model, with no tools, that sizes a
// brief and suggests the start's model, effort level and plan first. The Start page shows it as a
// proposal the person accepts or dismisses (decision 548); it runs only when they press Suggest
// settings (decision 549).
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EFFORT_LEVEL,
  type AgentModel,
  type SuggestRequest,
  type WorkspaceSuggestion,
} from '@symbiote/core';
import { runProgram, runWithInput, type Run, type RunWithInput } from './programs.js';
import { fillPrompt } from './prompts.js';
import { briefOf } from './workspace-brief.js';
import { WorkspaceRefused } from './workspace-record.js';

/** How long the advisor may take: 3–5 s measured (V75 spike), 20 s at most. */
export const ADVISOR_TIMEOUT_MS = 20_000;

/** The agents the advisor runs on: those that list their models (Hermes lists none). */
export type AdvisingAgent = 'claude' | 'codex';

/** Each agent's small model and its level, unless the project names others (decision 544). */
export const ADVISOR_DEFAULTS: Readonly<Record<AdvisingAgent, { model: string; effort: string }>> =
  {
    claude: { model: 'haiku', effort: 'low' },
    codex: { model: 'gpt-6-luna', effort: 'low' },
  };

/** What `{models}` becomes: a line for each model the agent lists, in its order. */
export function modelLines(models: readonly AgentModel[]): string {
  return models
    .map((m) => {
      const about = m.description ? `: ${m.description.replace(/\.$/, '')}` : '';
      const levels = m.efforts?.levels.length ? m.efforts.levels.join(', ') : 'none';
      return `- ${m.id} "${m.name}"${about}. Levels: ${levels}.`;
    })
    .join('\n');
}

/**
 * The answer's shape, for Claude Code's `--json-schema` and Codex's `--output-schema`: a listed
 * model, a level some listed model takes, plan first and why (decision 547). Every field required
 * and no other: the one shape both vendors' structured outputs accept.
 */
export function adviceSchema(models: readonly AgentModel[]): Record<string, unknown> {
  const levels = [...new Set(models.flatMap((m) => m.efforts?.levels ?? []))];
  return {
    type: 'object',
    properties: {
      model: { type: 'string', enum: ['default', ...models.map((m) => m.id)] },
      effort: { type: 'string', enum: ['default', ...levels] },
      planFirst: { type: 'boolean' },
      why: {
        type: 'string',
        description: 'One sentence naming the signal in the brief that decided the size',
      },
    },
    required: ['model', 'effort', 'planFirst', 'why'],
    additionalProperties: false,
  };
}

/**
 * The advisor's message: the brief as the agent would be given it, between `<task>` tags, and the
 * documents by name only (decision 550).
 */
export function adviceTask(request: Omit<SuggestRequest, 'agent'>): string {
  const brief = briefOf(request.kind, request.title, request.parts);
  const documents = request.documents?.length
    ? `\nAttached documents (names only): ${request.documents.join(', ')}\n`
    : '';
  return `<task>\n${brief}${documents}</task>`;
}

/**
 * The model and level the advisor runs on: the project's (`advisor.model`, `advisor.effort`) when
 * the agent lists the model and it takes the level, else the agent's small model at `low`; no
 * model (the agent's default) and no level when it lists neither.
 */
export function advisorOn(
  agent: AdvisingAgent,
  models: readonly AgentModel[],
  project: { model?: string | undefined; effort?: string | undefined },
): { model?: AgentModel; effort?: string } {
  const listed = (id: string | undefined) => models.find((m) => m.id === id);
  const model = listed(project.model) ?? listed(ADVISOR_DEFAULTS[agent].model);
  if (!model) return {};
  const levels = model.efforts?.levels ?? [];
  const effort = [project.effort, ADVISOR_DEFAULTS[agent].effort].find(
    (level) => level !== undefined && levels.includes(level),
  );
  return effort ? { model, effort } : { model };
}

/**
 * Claude Code's arguments: one turn (`-p`), its system prompt replaced by the advisor's, the
 * answer held to `schema`, no tools, no hooks or plugins, no transcript kept. The brief goes on
 * stdin, so a brief that starts with `-` is never read as an option.
 */
export function claudeAdviceArgs(request: {
  model?: string | undefined;
  effort?: string | undefined;
  instructions: string;
  schema: Record<string, unknown>;
}): string[] {
  return [
    '-p',
    ...(request.model ? ['--model', request.model] : []),
    ...(request.effort ? ['--effort', request.effort] : []),
    '--system-prompt',
    request.instructions,
    '--json-schema',
    JSON.stringify(request.schema),
    '--output-format',
    'json',
    '--safe-mode',
    '--strict-mcp-config',
    '--tools',
    '',
    '--no-session-persistence',
  ];
}

/**
 * Codex's arguments: `exec` read-only, its instructions replaced by the advisor's file
 * (`model_instructions_file`: 12,441 tokens a call instead of about 15,900, V75 spike), the answer
 * held to the schema file and written to `answerFile`, nothing kept. Its stdin must be closed:
 * open, `codex exec` waits for more input (240 s, V75 spike).
 */
export function codexAdviceArgs(request: {
  model?: string | undefined;
  effort?: string | undefined;
  instructionsFile: string;
  schemaFile: string;
  answerFile: string;
  task: string;
}): string[] {
  return [
    'exec',
    ...(request.model ? ['-m', request.model] : []),
    ...(request.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(request.effort)}`] : []),
    '-c',
    `model_instructions_file=${JSON.stringify(request.instructionsFile)}`,
    '-s',
    'read-only',
    '--ephemeral',
    '--skip-git-repo-check',
    '--output-schema',
    request.schemaFile,
    '-o',
    request.answerFile,
    '--',
    request.task,
  ];
}

/**
 * Claude Code's result (`--output-format json`): the schema's answer is its `structured_output`
 * (V75 spike); `stop_reason: "refusal"` when its safeguards declined; null otherwise.
 */
export function parseClaudeAdvice(stdout: string): { answer: unknown } | { declined: true } | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const result = value as { structured_output?: unknown; stop_reason?: unknown };
  if (result.structured_output && typeof result.structured_output === 'object') {
    return { answer: result.structured_output };
  }
  return result.stop_reason === 'refusal' ? { declined: true } : null;
}

/**
 * The answer held to the agent's list, as a start is (V47): a model it lists ("default": none),
 * and a level that model takes, else none and its default level applies (decision 338). Enum
 * casing is not guaranteed, so values are matched without case. Null when it names a model the
 * agent does not list, or lacks a field.
 */
export function adviceOf(
  answer: unknown,
  models: readonly AgentModel[],
): Omit<WorkspaceSuggestion, 'agent' | 'by'> | null {
  if (!answer || typeof answer !== 'object') return null;
  const { model, effort, planFirst, why } = answer as Record<string, unknown>;
  if (typeof model !== 'string' || typeof effort !== 'string') return null;
  if (typeof planFirst !== 'boolean' || typeof why !== 'string') return null;
  const sentence = why.replace(/\s+/g, ' ').trim();
  if (sentence === '') return null;
  const picked =
    model.toLowerCase() === 'default'
      ? null
      : models.find((m) => m.id.toLowerCase() === model.toLowerCase());
  if (picked === undefined) return null;
  const level = effort.toLowerCase();
  const takes = picked
    ? (picked.efforts?.levels.includes(level) ?? false)
    : level !== 'default' && EFFORT_LEVEL.test(level);
  return {
    ...(picked ? { model: picked.id } : {}),
    ...(takes ? { effort: level } : {}),
    planFirst,
    why: sentence,
  };
}

/**
 * Asks the agent for a suggestion on `request`'s brief, in a folder of its own in Symbiote's cache
 * (no project's CLAUDE.md or AGENTS.md read), removed after. A refusal, no answer in time, or an
 * answer Symbiote cannot use throws, with the words the Start page shows.
 */
export async function advise({
  agent,
  models,
  prompt,
  request,
  config,
  cacheDir,
  run = runProgram,
  runInput = runWithInput,
  now = Date.now,
  timeoutMs = ADVISOR_TIMEOUT_MS,
}: {
  agent: { kind: AdvisingAgent; command: string; name: string };
  models: readonly AgentModel[];
  /** The `advisor` prompt in use: the project's, else Symbiote's. */
  prompt: string;
  request: Omit<SuggestRequest, 'agent'>;
  config: { model?: string | undefined; effort?: string | undefined };
  cacheDir: string;
  run?: Run;
  runInput?: RunWithInput;
  now?: () => number;
  timeoutMs?: number;
}): Promise<WorkspaceSuggestion> {
  const on = advisorOn(agent.kind, models, config);
  const instructions = fillPrompt(prompt, { agent: agent.name, models: modelLines(models) });
  const schema = adviceSchema(models);
  const task = adviceTask(request);
  await mkdir(join(cacheDir, 'advisor'), { recursive: true });
  const folder = await mkdtemp(join(cacheDir, 'advisor', 'run-'));
  const started = now();
  let answer: { answer: unknown } | { declined: true } | null;
  let code: number | null;
  try {
    if (agent.kind === 'claude') {
      const result = await runInput(
        agent.command,
        claudeAdviceArgs({ model: on.model?.id, effort: on.effort, instructions, schema }),
        { cwd: folder, input: task, timeoutMs },
      );
      code = result.code;
      answer = parseClaudeAdvice(result.stdout);
    } else {
      const files = {
        instructionsFile: join(folder, 'instructions.md'),
        schemaFile: join(folder, 'schema.json'),
        answerFile: join(folder, 'answer.json'),
      };
      await writeFile(files.instructionsFile, instructions);
      await writeFile(files.schemaFile, JSON.stringify(schema));
      const result = await run(
        agent.command,
        codexAdviceArgs({ model: on.model?.id, effort: on.effort, task, ...files }),
        { cwd: folder, timeoutMs },
      );
      code = result.code;
      const text = await readFile(files.answerFile, 'utf8').catch(() => null);
      answer = text === null ? null : parseJson(text);
    }
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
  if (answer && 'declined' in answer) {
    throw new WorkspaceRefused(`${agent.name} declined the request`, 502);
  }
  if (!answer) {
    if (now() - started >= timeoutMs) {
      throw new WorkspaceRefused(
        `${agent.name} gave no answer within ${Math.round(timeoutMs / 1000)} s`,
        502,
      );
    }
    if (code !== 0) {
      throw new WorkspaceRefused(
        code === null
          ? `${agent.name} could not be started`
          : `${agent.name} ended with exit code ${code} and no answer`,
        502,
      );
    }
  }
  const advice = answer ? adviceOf(answer.answer, models) : null;
  if (!advice) throw new WorkspaceRefused('the answer was not one Symbiote can use', 502);
  return {
    agent: agent.kind,
    ...advice,
    by: {
      model: on.model?.id ?? 'default',
      name: on.model?.name ?? `${agent.name}'s default`,
      ...(on.effort ? { effort: on.effort } : {}),
    },
  };
}

/** `text` as JSON, as an answer: null when it is not. */
function parseJson(text: string): { answer: unknown } | null {
  try {
    return { answer: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}
