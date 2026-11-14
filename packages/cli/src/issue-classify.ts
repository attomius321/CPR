// The classifier (HV9b): one turn of Claude Code that reads a forge's issue and answers take, ask
// or refuse, with the brief a writer would get (HV9's plan). It runs as the advisor runs (decision
// 1002): no tools, no MCP servers, no hooks, no saved session, an empty folder, nothing of the
// repository but its card (1038). Symbiote's rules in code hold around its answer: lengths, the
// refusing flags (1005), the hold (1034), and what of the person it may not carry (1037, 1042).
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CLASSIFIER_FLAGS,
  CLASSIFIER_REFUSALS,
  WORK_KINDS,
  type AgentModel,
  type ClassifierAnswer,
  type ClassifierFlag,
  type ClassifierHold,
  type ClassifierIdentity,
  type ClassifierPersonal,
  type ClassifierRefusal,
  type Issue,
  type IssueClassification,
  type IssueSnapshot,
  type IssueSnapshotFlag,
  type WorkKind,
} from '@symbiote/core';
import { issueSnapshot, withoutOwnTags } from './issue-snapshot.js';
import { runWithInput, type RunWithInput } from './programs.js';
import { claudeAdviceArgs } from './workspace-advice.js';
import { BRIEF_PARTS, KINDS, MAX_BRIEF, MAX_TITLE, briefOf } from './workspace-brief.js';

/** The classifier's model and level unless the project names others (decision 1036). */
export const CLASSIFIER_MODEL = 'opus';
export const CLASSIFIER_EFFORT = 'high';

/** How long one try may take: Opus at high took 20 s at the 90th percentile (HV9a). */
export const CLASSIFIER_TIMEOUT_MS = 180_000;

/**
 * The version of Symbiote's rules around the answer: part of the classifier's identity (1041),
 * so a change to the rules starts each repository's count again (1040).
 */
export const CLASSIFIER_RULES = 1;

/** Flags that refuse an answer as unsafe, whatever the model decided (decision 1005). */
const REFUSING: readonly ClassifierFlag[] = ['agent-instructions', 'secrets', 'outside-actions'];
/** The model's flags and Symbiote's own that hold a take for a click (decision 1034). */
const HOLDING: readonly string[] = ['new-dependency', 'weakens-checks', 'hidden-text', 'cut'];

/** What of the person must not leave through an answer: the email, the folders. */
export interface PersonalMarker {
  name: string;
  value: string;
}

/** The decision after Symbiote's rules. */
export interface Ruling {
  decision: ClassifierAnswer['decision'];
  refusal?: ClassifierRefusal;
  refusedBy?: ClassifierFlag[];
  held?: ClassifierHold[];
}

/**
 * The answer's shape (`--json-schema`): HV9's fields, the writer's models and levels as Claude
 * Code lists them (as `adviceSchema`), every field required and no other. Lengths are checked in
 * code (`answerMisfit`): HV9a found them asked more reliably there.
 */
export function classifierSchema(models: readonly AgentModel[]): Record<string, unknown> {
  const levels = [...new Set(models.flatMap((m) => m.efforts?.levels ?? []))];
  return {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['take', 'ask', 'refuse'] },
      reasons: { type: 'array', items: { type: 'string' } },
      refusal: { type: 'string', enum: [...CLASSIFIER_REFUSALS] },
      question: { type: 'string' },
      kind: { type: 'string', enum: [...WORK_KINDS] },
      title: { type: 'string' },
      parts: {
        type: 'object',
        properties: Object.fromEntries(BRIEF_PARTS.map((p) => [p, { type: 'string' }])),
        required: BRIEF_PARTS,
        additionalProperties: false,
      },
      size: { type: 'string', enum: ['small', 'medium', 'large'] },
      model: { type: 'string', enum: ['default', ...models.map((m) => m.id)] },
      effort: { type: 'string', enum: ['default', ...levels] },
      flags: { type: 'array', items: { type: 'string', enum: [...CLASSIFIER_FLAGS] } },
    },
    required: [
      'decision',
      'reasons',
      'refusal',
      'question',
      'kind',
      'title',
      'parts',
      'size',
      'model',
      'effort',
      'flags',
    ],
    additionalProperties: false,
  };
}

/**
 * The model and level the classifier runs on: the project's (`hive.classifier.model`, `.effort`)
 * when Claude Code lists the model and it takes the level, else Opus at high (decision 1036).
 */
export function classifierOn(
  models: readonly AgentModel[],
  config: { model?: string | undefined; effort?: string | undefined },
): { model?: string; effort?: string } {
  const listed = (id: string | undefined) => models.find((m) => m.id === id);
  const model = listed(config.model) ?? listed(CLASSIFIER_MODEL);
  if (!model) return {};
  const levels = model.efforts?.levels ?? [];
  const effort = [config.effort, CLASSIFIER_EFFORT].find(
    (level) => level !== undefined && levels.includes(level),
  );
  return effort ? { model: model.id, effort } : { model: model.id };
}

const FORGE_NAMES = { github: 'GitHub', gitlab: 'GitLab' } as const;

/**
 * The project's card (decision 1038): all of it the repository's own, none of it a file of it:
 * its forge's project, the kinds of work, the check's commands and the person's text
 * (`hive.issues.about`).
 */
export function projectCard(card: {
  forge: { kind: 'github' | 'gitlab'; host: string; project: string };
  checks: readonly string[] | null;
  about: string;
}): string {
  const check = card.checks?.length ? `${card.checks.join(', then ')}.` : 'not known.';
  return [
    `Repository: ${card.forge.project} on ${FORGE_NAMES[card.forge.kind]} (${card.forge.host}).`,
    `Kinds of work: ${WORK_KINDS.join(', ')}.`,
    `Check: ${check}`,
    'About, and what Hive may take on:',
    withoutOwnTags(card.about.trim()),
  ].join('\n');
}

/** The classifier's message, on stdin: the card, then the issue, each between its tags. */
export function classifierMessage(card: string, snapshot: IssueSnapshot): string {
  return `<project>\n${card}\n</project>\n\n<issue>\n${snapshot.text}\n</issue>`;
}

/** Room kept in a brief for its first line, the issue's link and time. */
const ORIGIN_ROOM = 600;

/** Why an answer does not fit HV9's table, checked in code; null when it fits. */
export function answerMisfit(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'no answer';
  const a = value as Partial<ClassifierAnswer>;
  if (a.decision !== 'take' && a.decision !== 'ask' && a.decision !== 'refuse') return 'decision';
  if (!Array.isArray(a.reasons) || a.reasons.length < 1 || a.reasons.length > 3) return 'reasons';
  if (a.reasons.some((r) => typeof r !== 'string' || !r.trim() || r.length > 300)) return 'reason';
  if (!CLASSIFIER_REFUSALS.includes(a.refusal as never)) return 'refusal';
  if ((a.decision === 'refuse') !== (a.refusal !== 'none')) return 'refusal';
  if (typeof a.question !== 'string') return 'question';
  if (a.decision === 'ask' && (!a.question.trim() || a.question.length > 500)) return 'question';
  if (!WORK_KINDS.includes(a.kind as WorkKind)) return 'kind';
  if (typeof a.title !== 'string') return 'title';
  if (!a.parts || typeof a.parts !== 'object') return 'parts';
  if (Object.values(a.parts).some((p) => typeof p !== 'string')) return 'parts';
  if (!Array.isArray(a.flags) || a.flags.some((f) => !CLASSIFIER_FLAGS.includes(f))) return 'flags';
  if (a.decision === 'take') {
    if (!a.title.trim() || a.title.length > MAX_TITLE) return 'title';
    const kind = a.kind as WorkKind;
    if (!a.parts[KINDS[kind].required]?.trim()) return 'required part';
    if (briefOf(kind, a.title, a.parts).length > MAX_BRIEF - ORIGIN_ROOM) return 'brief';
  }
  return null;
}

/**
 * The decision after Symbiote's rules: a refusing flag refuses as unsafe (1005); a take with a
 * holding flag, the model's or Symbiote's, or with a brief that names the person, is held (1034,
 * 1042). A question that names the person stays an ask: HV11 does not post it (1037).
 */
export function ruling(
  answer: ClassifierAnswer,
  symbioteFlags: readonly IssueSnapshotFlag[],
  personal: ClassifierPersonal,
): Ruling {
  const refusedBy = answer.flags.filter((f) => REFUSING.includes(f));
  if (refusedBy.length > 0) return { decision: 'refuse', refusal: 'unsafe', refusedBy };
  if (answer.decision === 'refuse') {
    return { decision: 'refuse', refusal: answer.refusal as ClassifierRefusal };
  }
  if (answer.decision === 'ask') return { decision: 'ask' };
  const flags: string[] = [...answer.flags, ...symbioteFlags];
  const held = [
    ...new Set([
      ...(flags.filter((f) => HOLDING.includes(f)) as ClassifierHold[]),
      ...(personal.brief?.length ? (['personal'] as const) : []),
    ]),
  ];
  return held.length > 0 ? { decision: 'take', held } : { decision: 'take' };
}

/** The names of the markers `text` holds, in the markers' order, any case. */
export function personalIn(text: string, markers: readonly PersonalMarker[]): string[] {
  const lower = text.toLowerCase();
  const found = markers.filter((m) => m.value && lower.includes(m.value.toLowerCase()));
  return [...new Set(found.map((m) => m.name))];
}

/**
 * The brief a writer gets for a take (decision 1004): where it came from, then V24's headings
 * from the classifier's parts. Never the issue's own text.
 */
export function issueBrief(
  issue: Pick<Issue, 'number' | 'url'>,
  at: string,
  answer: ClassifierAnswer,
): string {
  const origin = `From issue #${issue.number} (${issue.url}), classified at ${at}.`;
  return `${origin}\n\n${briefOf(answer.kind, answer.title, answer.parts)}`;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const dollars = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Who classifies (decision 1041): Claude Code's version, the model and effort it runs on, the
 * hashes of the prompt and the card, Symbiote's rules; `identity` is them but the version. One
 * function for a classification and for a repository's standing (1040, HV9c).
 */
export function classifierIdentity({
  prompt,
  card,
  on,
  version,
}: {
  prompt: string;
  card: string;
  on: { model?: string; effort?: string };
  version?: string | undefined;
}): ClassifierIdentity {
  const promptHash = sha256(prompt);
  const cardHash = sha256(card);
  return {
    agent: 'claude',
    ...(version ? { version } : {}),
    model: on.model ?? 'default',
    ...(on.effort ? { effort: on.effort } : {}),
    prompt: promptHash,
    card: cardHash,
    rules: CLASSIFIER_RULES,
    identity: sha256(
      JSON.stringify([
        promptHash,
        on.model ?? 'default',
        on.effort ?? 'default',
        cardHash,
        CLASSIFIER_RULES,
      ]),
    ),
  };
}

/** One try's result: Claude Code's answer, or why there is none. */
interface Try {
  ms: number;
  cost: number;
  usage?: IssueClassification['run']['usage'];
  answer?: ClassifierAnswer;
  misfit: string | null;
}

/** Claude Code's `--output-format json` result, read as a try. */
function readTry(code: number | null, stdout: string, ms: number): Try {
  let out: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(stdout);
    if (value && typeof value === 'object') out = value as Record<string, unknown>;
  } catch {
    // not JSON: no answer
  }
  const usage = out?.usage as Record<string, number> | undefined;
  const structured = out?.structured_output;
  const answer =
    structured && typeof structured === 'object' ? (structured as ClassifierAnswer) : undefined;
  const misfit =
    out?.stop_reason === 'refusal'
      ? 'declined'
      : answer
        ? answerMisfit(answer)
        : code !== null && code !== 0
          ? `exit ${code}`
          : 'no answer';
  return {
    ms,
    cost: typeof out?.total_cost_usd === 'number' ? out.total_cost_usd : 0,
    ...(usage
      ? {
          usage: {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
            cacheRead: usage.cache_read_input_tokens ?? 0,
            cacheWrite: usage.cache_creation_input_tokens ?? 0,
          },
        }
      : {}),
    ...(answer ? { answer } : {}),
    misfit,
  };
}

/**
 * Classifies `issue`: its snapshot, then Claude Code once, in a folder of its own in Symbiote's
 * cache removed after, and once more when the answer does not fit; then Symbiote's rules. A
 * classification that failed starts nothing.
 */
export async function classifyIssue({
  issue,
  card,
  prompt,
  models,
  config,
  command,
  version,
  cacheDir,
  markers,
  runInput = runWithInput,
  now = Date.now,
  timeoutMs = CLASSIFIER_TIMEOUT_MS,
}: {
  issue: Issue;
  card: string;
  /** The prompt `hive.classify` in use: the project's, else Symbiote's. */
  prompt: string;
  /** Claude Code's models, for the schema and the model it runs on. */
  models: readonly AgentModel[];
  /** `hive.classifier.model` and `.effort`. */
  config: { model?: string | undefined; effort?: string | undefined };
  command: string;
  version?: string | undefined;
  cacheDir: string;
  markers: readonly PersonalMarker[];
  runInput?: RunWithInput;
  now?: () => number;
  timeoutMs?: number;
}): Promise<IssueClassification> {
  const at = new Date(now()).toISOString();
  const snapshot = issueSnapshot(issue, at);
  const on = classifierOn(models, config);
  const schema = classifierSchema(models);
  const input = classifierMessage(card, snapshot);
  const classifier = classifierIdentity({ prompt, card, on, version });
  const args = claudeAdviceArgs({ ...on, instructions: prompt, schema });
  const tries: Try[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await mkdir(join(cacheDir, 'classifier'), { recursive: true });
    const folder = await mkdtemp(join(cacheDir, 'classifier', 'run-'));
    const started = now();
    try {
      const result = await runInput(command, args, { cwd: folder, input, timeoutMs });
      tries.push(readTry(result.code, result.stdout, now() - started));
    } finally {
      await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
    const misfit = tries.at(-1)?.misfit;
    if (!misfit || misfit === 'declined') break;
  }
  const last = tries.at(-1) as Try;
  const run: IssueClassification['run'] = {
    at,
    ms: tries.reduce((sum, t) => sum + t.ms, 0),
    cost: dollars(tries.reduce((sum, t) => sum + t.cost, 0)),
    tries: tries.length,
    ...(tries.length > 1 && tries[0]?.misfit ? { retried: tries[0].misfit } : {}),
    ...(last.usage ? { usage: last.usage } : {}),
  };
  const answer = last.answer;
  if (last.misfit || !answer) {
    return {
      snapshot,
      decision: 'failed',
      failed: last.misfit ?? 'no answer',
      ...(answer ? { answer } : {}),
      classifier,
      run,
    };
  }
  const brief = answer.decision === 'take' ? issueBrief(issue, at, answer) : undefined;
  const personal: ClassifierPersonal = {
    ...(answer.decision === 'ask' && personalIn(answer.question, markers).length
      ? { question: personalIn(answer.question, markers) }
      : {}),
    ...(brief && personalIn(brief, markers).length ? { brief: personalIn(brief, markers) } : {}),
  };
  const ruled = ruling(answer, snapshot.flags, personal);
  return {
    snapshot,
    ...ruled,
    answer,
    ...(Object.keys(personal).length ? { personal } : {}),
    ...(ruled.decision === 'take' && brief ? { brief } : {}),
    classifier,
    run,
  };
}
