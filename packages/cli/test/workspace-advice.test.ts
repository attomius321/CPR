import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentModel } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { DEFAULT_PROMPTS, fillPrompt } from '../src/prompts.js';
import { parseSuggestRequest } from '../src/server-requests.js';
import {
  ADVISOR_TIMEOUT_MS,
  adviceOf,
  adviceSchema,
  adviceTask,
  advise,
  advisorChoices,
  advisorOn,
  claudeAdviceArgs,
  codexAdviceArgs,
  modelLines,
  parseClaudeAdvice,
} from '../src/workspace-advice.js';
import { WorkspaceRefused } from '../src/workspace-record.js';
import { readWorkspaceConfig } from '../src/workspaces.js';

/** Claude Code's list as Symbiote kept it on 2026-10-28 (V75 spike): 12 models, Haiku 4.5 without
 * levels. */
const CLAUDE_MODELS = JSON.parse(
  readFileSync(new URL('./fixtures/advice-claude-models.json', import.meta.url), 'utf8'),
) as AgentModel[];

/** Claude Code 2.1.312's whole answer with `--json-schema --output-format json` (V75 spike). */
const CLAUDE_ANSWER = readFileSync(
  new URL('./fixtures/advice-claude-answer.json', import.meta.url),
  'utf8',
);

const CODEX_MODELS: AgentModel[] = [
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    description: 'The most capable model',
    efforts: { levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    efforts: { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
  },
];

const CHORE = {
  kind: 'chore' as const,
  title: 'Bump prettier to 3.6',
  parts: { change: 'Update prettier in the root package.json to 3.6 and reformat.' },
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the advisor prompt', () => {
  it("lists each model with its ID, name, description and levels, in the agent's order", () => {
    const lines = modelLines(CLAUDE_MODELS).split('\n');
    expect(lines).toHaveLength(12);
    expect(lines[0]).toBe(
      '- opus "Opus 5.5": For complex work and everyday tasks. Levels: low, medium, high, xhigh, max.',
    );
    expect(lines[4]).toBe(
      '- claude-haiku-4-5-20251001 "Haiku 4.5": Fastest for quick answers. Levels: none.',
    );
    expect(modelLines([{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }])).toBe(
      '- gpt-6-luna "GPT-6 Luna". Levels: none.',
    );
  });

  it("is Symbiote's text with the agent and its models filled in", () => {
    expect(DEFAULT_PROMPTS.advisor).toContain('{models}');
    expect(DEFAULT_PROMPTS.advisor).toContain('{agent}');
    const text = fillPrompt(DEFAULT_PROMPTS.advisor, {
      agent: 'Claude Code',
      models: modelLines(CLAUDE_MODELS),
    });
    expect(text).toContain('The agent is Claude Code.');
    expect(text).toContain('- sonnet "Sonnet 5.5": Most efficient for simpler tasks.');
    expect(text).toContain('between <task> tags');
    expect(text).not.toMatch(/\{(agent|models)\}/);
  });

  it("puts the brief between task tags, as the agent's brief is written, documents by name", () => {
    expect(adviceTask(CHORE)).toBe(
      '<task>\n# Chore: Bump prettier to 3.6\n\n## What to change\n' +
        'Update prettier in the root package.json to 3.6 and reformat.\n</task>',
    );
    expect(adviceTask({ ...CHORE, documents: ['spec.pdf', 'notes.md'] })).toContain(
      '\nAttached documents (names only): spec.pdf, notes.md\n</task>',
    );
  });
});

describe('the schema', () => {
  it("allows only the agent's models and their levels, every field required", () => {
    expect(adviceSchema(CODEX_MODELS)).toEqual({
      type: 'object',
      properties: {
        model: { type: 'string', enum: ['default', 'gpt-6-astra', 'gpt-6-luna'] },
        effort: {
          type: 'string',
          enum: ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'none'],
        },
        planFirst: { type: 'boolean' },
        why: {
          type: 'string',
          description: 'One sentence naming the signal in the brief that decided the size',
        },
      },
      required: ['model', 'effort', 'planFirst', 'why'],
      additionalProperties: false,
    });
  });
});

describe("the advisor's own model", () => {
  it("is the agent's small model at low by default", () => {
    expect(advisorOn('claude', CLAUDE_MODELS, {})).toEqual({
      model: CLAUDE_MODELS[3],
      effort: 'low',
    });
    expect(advisorOn('codex', CODEX_MODELS, {})).toEqual({ model: CODEX_MODELS[1], effort: 'low' });
  });

  it("is the project's when the agent lists it, at a level that model takes", () => {
    expect(advisorOn('claude', CLAUDE_MODELS, { model: 'sonnet', effort: 'medium' })).toEqual({
      model: CLAUDE_MODELS[2],
      effort: 'medium',
    });
    // A model the agent does not list: the small one; a level it does not take: low.
    expect(advisorOn('claude', CLAUDE_MODELS, { model: 'gpt-6-luna', effort: 'ultra' })).toEqual({
      model: CLAUDE_MODELS[3],
      effort: 'low',
    });
  });

  it("is the agent's default, at no level, when its small model is not listed", () => {
    expect(advisorOn('codex', [CODEX_MODELS[0] as AgentModel], {})).toEqual({});
    const noLevels = CLAUDE_MODELS.filter((m) => m.id === 'claude-haiku-4-5-20251001');
    expect(advisorOn('claude', noLevels, { model: 'claude-haiku-4-5-20251001' })).toEqual({
      model: noLevels[0],
    });
  });

  it("takes the project's level on the agent's default model when its default model takes it", () => {
    const astra = [CODEX_MODELS[0] as AgentModel];
    const levels = { levels: ['low', 'medium', 'high'] };
    expect(advisorOn('codex', astra, { effort: 'high' }, levels)).toEqual({ effort: 'high' });
    // Not Symbiote's low: that is its small model's, and the agent's own model runs here.
    expect(advisorOn('codex', astra, {}, levels)).toEqual({});
    expect(advisorOn('codex', astra, { effort: 'ultra' }, levels)).toEqual({});
    expect(advisorOn('codex', astra, { effort: 'high' })).toEqual({});
  });
});

describe('the advisor in Settings', () => {
  const CLAUDE_LEVELS = { levels: ['low', 'medium', 'high', 'xhigh', 'max'] };

  it("names the small model and low as Symbiote's defaults, the levels the small model's", () => {
    expect(advisorChoices('claude', { models: CLAUDE_MODELS }, CLAUDE_LEVELS, {})).toEqual({
      kind: 'claude',
      models: CLAUDE_MODELS,
      defaultModel: { id: 'haiku', by: 'symbiote' },
      efforts: {
        levels: ['low', 'medium', 'high', 'xhigh', 'max'],
        default: 'low',
        by: 'symbiote',
      },
    });
    expect(
      advisorChoices('codex', { models: CODEX_MODELS, default: 'gpt-6-astra' }, null, {}),
    ).toEqual({
      kind: 'codex',
      models: CODEX_MODELS,
      defaultModel: { id: 'gpt-6-luna', by: 'symbiote' },
      efforts: {
        levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        default: 'low',
        by: 'symbiote',
      },
    });
  });

  it('gives the levels of the model picked, low its default only when that model takes it', () => {
    const opus46 = { levels: ['low', 'medium', 'high', 'max'], default: 'low', by: 'symbiote' };
    expect(
      advisorChoices('claude', { models: CLAUDE_MODELS }, CLAUDE_LEVELS, {
        model: 'claude-opus-4-6',
      }).efforts,
    ).toEqual(opus46);
    // Haiku 4.5 takes none: no levels to pick.
    expect(
      advisorChoices('claude', { models: CLAUDE_MODELS }, CLAUDE_LEVELS, {
        model: 'claude-haiku-4-5-20251001',
      }).efforts,
    ).toBeUndefined();
    // A model the agent does not list: the advisor runs on its small model, and so do the levels.
    expect(
      advisorChoices('claude', { models: CLAUDE_MODELS }, CLAUDE_LEVELS, { model: 'gpt-6-luna' })
        .efforts,
    ).toEqual({ ...CLAUDE_LEVELS, default: 'low', by: 'symbiote' });
  });

  it("is the agent's own default when its small model is not listed, at the agent's levels", () => {
    const astra = [CODEX_MODELS[0] as AgentModel];
    const codexLevels = { levels: ['low', 'medium', 'high'], default: 'medium' };
    expect(
      advisorChoices('codex', { models: astra, default: 'gpt-6-astra' }, codexLevels, {}),
    ).toEqual({
      kind: 'codex',
      models: astra,
      defaultModel: { id: 'gpt-6-astra', by: 'agent' },
      efforts: codexLevels,
    });
    // Models Symbiote cannot read: no model to pick, the agent's levels.
    expect(advisorChoices('claude', null, CLAUDE_LEVELS, {})).toEqual({
      kind: 'claude',
      efforts: CLAUDE_LEVELS,
    });
  });
});

describe("the agents' arguments", () => {
  it('runs Claude Code once, on the model, with the prompt in place of its own, and no tools', () => {
    const schema = adviceSchema(CLAUDE_MODELS);
    expect(
      claudeAdviceArgs({ model: 'haiku', effort: 'low', instructions: 'You suggest…', schema }),
    ).toEqual([
      '-p',
      '--model',
      'haiku',
      '--effort',
      'low',
      '--system-prompt',
      'You suggest…',
      '--json-schema',
      JSON.stringify(schema),
      '--output-format',
      'json',
      '--safe-mode',
      '--strict-mcp-config',
      '--tools',
      '',
      '--no-session-persistence',
    ]);
    expect(claudeAdviceArgs({ instructions: 'x', schema })).not.toContain('--model');
  });

  it('runs Codex read-only with its instructions replaced, the task after --', () => {
    expect(
      codexAdviceArgs({
        model: 'gpt-6-luna',
        effort: 'low',
        instructionsFile: '/c/advisor/run/instructions.md',
        schemaFile: '/c/advisor/run/schema.json',
        answerFile: '/c/advisor/run/answer.json',
        task: '-<task>',
      }),
    ).toEqual([
      'exec',
      '-m',
      'gpt-6-luna',
      '-c',
      'model_reasoning_effort="low"',
      '-c',
      'model_instructions_file="/c/advisor/run/instructions.md"',
      '-s',
      'read-only',
      '--ephemeral',
      '--skip-git-repo-check',
      '--output-schema',
      '/c/advisor/run/schema.json',
      '-o',
      '/c/advisor/run/answer.json',
      '--',
      '-<task>',
    ]);
  });
});

describe('the answer', () => {
  it("reads Claude Code's structured_output, and says when it declined", () => {
    expect(parseClaudeAdvice(CLAUDE_ANSWER)).toEqual({
      answer: {
        model: 'haiku',
        effort: 'low',
        planFirst: false,
        why: 'A single version bump in the root package.json plus a mechanical reformat is small and mechanical, so the small model at low effort is enough.',
      },
    });
    expect(
      parseClaudeAdvice(JSON.stringify({ type: 'result', stop_reason: 'refusal', result: '' })),
    ).toEqual({ declined: true });
    expect(parseClaudeAdvice('not json')).toBeNull();
    expect(parseClaudeAdvice(JSON.stringify({ type: 'result', result: '{}' }))).toBeNull();
  });

  it("is held to the agent's list: a listed model, a level that model takes", () => {
    const answer = { model: 'opus', effort: 'high', planFirst: true, why: ' Large: a migration. ' };
    expect(adviceOf(answer, CLAUDE_MODELS)).toEqual({
      model: 'opus',
      effort: 'high',
      planFirst: true,
      why: 'Large: a migration.',
    });
    // "default" is no pick; enum casing is not guaranteed (Anthropic's structured outputs).
    expect(adviceOf({ ...answer, model: 'default', effort: 'Default' }, CLAUDE_MODELS)).toEqual({
      planFirst: true,
      why: 'Large: a migration.',
    });
    expect(adviceOf({ ...answer, model: 'Opus' }, CLAUDE_MODELS)?.model).toBe('opus');
    // A level the model does not take is dropped: its default applies.
    expect(
      adviceOf({ ...answer, model: 'claude-opus-4-6', effort: 'xhigh' }, CLAUDE_MODELS),
    ).toEqual({ model: 'claude-opus-4-6', planFirst: true, why: 'Large: a migration.' });
  });

  it('is no answer when it names an unlisted model, or lacks a field', () => {
    expect(
      adviceOf({ model: 'gpt-5', effort: 'low', planFirst: false, why: 'x' }, CLAUDE_MODELS),
    ).toBeNull();
    expect(adviceOf({ model: 'haiku', effort: 'low', why: 'x' }, CLAUDE_MODELS)).toBeNull();
    expect(
      adviceOf({ model: 'haiku', effort: 'low', planFirst: false, why: ' ' }, CLAUDE_MODELS),
    ).toBeNull();
    expect(adviceOf('haiku', CLAUDE_MODELS)).toBeNull();
  });
});

describe('advise', () => {
  const cacheDir = () => {
    const dir = tempDir();
    dirs.push(dir);
    return dir;
  };

  it('asks Claude Code with the task on stdin, and proposes what it answered, by whom', async () => {
    const calls: { command: string; args: string[]; cwd: string; input: string }[] = [];
    const suggestion = await advise({
      agent: { kind: 'claude', command: '/bin/claude', name: 'Claude Code' },
      models: CLAUDE_MODELS,
      prompt: DEFAULT_PROMPTS.advisor,
      request: CHORE,
      config: {},
      cacheDir: cacheDir(),
      runInput: (command, args, { cwd, input }) => {
        calls.push({ command, args, cwd, input });
        return Promise.resolve({ code: 0, stdout: CLAUDE_ANSWER, stderr: '' });
      },
    });
    expect(suggestion).toEqual({
      agent: 'claude',
      model: 'haiku',
      effort: 'low',
      planFirst: false,
      why: 'A single version bump in the root package.json plus a mechanical reformat is small and mechanical, so the small model at low effort is enough.',
      by: { model: 'haiku', name: 'Haiku 5.5', effort: 'low' },
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.command).toBe('/bin/claude');
    expect(call?.input).toBe(adviceTask(CHORE));
    expect(call?.args.slice(0, 5)).toEqual(['-p', '--model', 'haiku', '--effort', 'low']);
    expect(call?.args[6]).toContain('- opus "Opus 5.5"');
    // Run in a folder of its own, removed after: no project's CLAUDE.md, nothing left behind.
    expect(call?.cwd).toContain(join('advisor', ''));
    expect(existsSync(call?.cwd ?? '')).toBe(false);
  });

  it('asks Codex with the prompt as its instructions file, and reads the answer file', async () => {
    let instructions = '';
    let args: string[] = [];
    const suggestion = await advise({
      agent: { kind: 'codex', command: '/bin/codex', name: 'Codex' },
      models: CODEX_MODELS,
      prompt: DEFAULT_PROMPTS.advisor,
      request: CHORE,
      config: {},
      cacheDir: cacheDir(),
      run: (_command, given) => {
        args = given;
        const at = (flag: string) => given[given.indexOf(flag) + 1] as string;
        instructions = readFileSync(
          (given.find((a) => a.startsWith('model_instructions_file=')) ?? '')
            .replace('model_instructions_file=', '')
            .replace(/^"|"$/g, ''),
          'utf8',
        );
        expect(JSON.parse(readFileSync(at('--output-schema'), 'utf8'))).toEqual(
          adviceSchema(CODEX_MODELS),
        );
        writeFileSync(
          at('-o'),
          '{"model":"gpt-6-luna","effort":"low","planFirst":false,"why":"Updates one dependency version and reformats: a small, mechanical change."}',
        );
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    });
    expect(suggestion).toEqual({
      agent: 'codex',
      model: 'gpt-6-luna',
      effort: 'low',
      planFirst: false,
      why: 'Updates one dependency version and reformats: a small, mechanical change.',
      by: { model: 'gpt-6-luna', name: 'GPT-6 Luna', effort: 'low' },
    });
    expect(instructions).toContain('The agent is Codex.');
    expect(instructions).toContain('- gpt-6-astra "GPT-6 Astra": The most capable model.');
    expect(args.at(-1)).toBe(adviceTask(CHORE));
  });

  it('refuses with words the page shows: declined, no answer in time, an answer it cannot use', async () => {
    const base = {
      agent: { kind: 'claude' as const, command: '/bin/claude', name: 'Claude Code' },
      models: CLAUDE_MODELS,
      prompt: DEFAULT_PROMPTS.advisor,
      request: CHORE,
      config: {},
    };
    const refusal = (stdout: string, code: number | null = 0, elapsed = 3_000) => {
      let clock = 0;
      return advise({
        ...base,
        cacheDir: cacheDir(),
        now: () => clock,
        runInput: () => {
          clock += elapsed;
          return Promise.resolve({ code, stdout, stderr: '' });
        },
      }).then(
        () => null,
        (error: unknown) => error,
      );
    };
    const declined = await refusal(JSON.stringify({ type: 'result', stop_reason: 'refusal' }));
    expect(declined).toBeInstanceOf(WorkspaceRefused);
    expect(declined).toMatchObject({ message: 'Claude Code declined the request', status: 502 });
    expect(await refusal('', null, ADVISOR_TIMEOUT_MS)).toMatchObject({
      message: 'Claude Code gave no answer within 20 s',
      status: 502,
    });
    expect(await refusal('', 1)).toMatchObject({
      message: 'Claude Code ended with exit code 1 and no answer',
      status: 502,
    });
    expect(
      await refusal(
        JSON.stringify({
          type: 'result',
          structured_output: { model: 'gpt-5', effort: 'low', planFirst: true, why: 'x' },
        }),
      ),
    ).toMatchObject({ message: 'the answer was not one Symbiote can use', status: 502 });
  });
});

describe("the advisor's settings and the request", () => {
  it("reads each agent's model and level from the project config: advisor.claude, advisor.codex", () => {
    const root = tempDir();
    dirs.push(root);
    writeFileSync(
      join(root, 'symbiote.config.json'),
      '{"advisor":{"claude":{"model":"sonnet","effort":"medium"},"codex":{"effort":"high"}}}',
    );
    expect(readWorkspaceConfig(root).advisor).toEqual({
      claude: { model: 'sonnet', effort: 'medium' },
      codex: { effort: 'high' },
    });
    // No ID or level, or one model for both agents (V75a's keys): none read.
    writeFileSync(
      join(root, 'symbiote.config.json'),
      '{"advisor":{"model":"sonnet","effort":"low","claude":{"model":"-x y","effort":"Low!"},"hermes":{"model":"x"}}}',
    );
    expect(readWorkspaceConfig(root).advisor).toBeUndefined();
  });

  it("parses the Start page's brief, its agent and its documents' names", () => {
    expect(
      parseSuggestRequest(
        JSON.stringify({ ...CHORE, agent: 'codex', documents: ['spec.pdf'], branch: 'x' }),
      ),
    ).toEqual({ ...CHORE, agent: 'codex', documents: ['spec.pdf'] });
    expect(parseSuggestRequest(JSON.stringify({ kind: 'spike' }))).toEqual({
      kind: 'spike',
      title: '',
      parts: {},
    });
    expect(() => parseSuggestRequest(JSON.stringify({ kind: 'epic' }))).toThrow(
      'kind: feature, fix, refactor, chore or spike',
    );
    expect(() => parseSuggestRequest(JSON.stringify({ kind: 'fix', documents: [1] }))).toThrow(
      "documents: each a file's name",
    );
    // An agent Symbiote does not start is refused, not read as Codex (MC2).
    for (const agent of [7, 'nope', 'Claude']) {
      expect(() => parseSuggestRequest(JSON.stringify({ kind: 'fix', agent }))).toThrow(
        'agent: claude, codex or hermes',
      );
    }
    for (const agent of ['claude', 'codex', 'hermes']) {
      expect(parseSuggestRequest(JSON.stringify({ kind: 'fix', agent })).agent).toBe(agent);
    }
  });
});
