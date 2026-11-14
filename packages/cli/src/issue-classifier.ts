// The classifier as `symbiote view` runs it (HV9b): `POST /api/issues/<n>/classify` and the
// record read back. It serves Hive (decision 1008): with Hive off it is refused, as it is with no
// forge, for a pull request's number, without the person's text of what the project is
// (`hive.issues.about`, decision 1038), without Claude Code, and while the issue is being
// classified already. Every refusal is words the page shows.
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CLASSIFIER_BAR,
  EFFORT_LEVEL,
  MODEL_ID,
  SymbioteError,
  userEmail,
  type AgentLevels,
  type AgentModel,
  type ClassifierSettings,
  type ClassifierStanding,
  type GitRepo,
  type IssueDecision,
  type IssueDecisions,
  type IssueForge,
  type IssueRecord,
} from '@symbiote/core';
import type { Env, Forge } from '@symbiote/forge';
import type { ClaudeCode } from './claude-code.js';
import { originForge } from './hive-request.js';
import { foundCheck, readMergeConfig } from './merge-config.js';
import { prepareSymbioteFolder, reviewPlace } from './reviews.js';
import {
  AGENT_NAMES,
  effortOnProblem,
  effortWordProblem,
  levelsOn,
  modelProblem,
  modelWordProblem,
} from './agent-levels.js';
import { writeConfig } from './config-write.js';
import {
  CLASSIFIER_EFFORT,
  CLASSIFIER_MODEL,
  classifierIdentity,
  classifierOn,
  classifyIssue,
  projectCard,
  type PersonalMarker,
} from './issue-classify.js';
import {
  readIssueEvents,
  readIssueRecord,
  readIssueRecords,
  writeIssueRecord,
} from './issue-record.js';
import { CONFIG_FILES } from './plugins.js';
import { runProgram, type Run, type RunWithInput } from './programs.js';
import { readPrompts } from './prompts.js';

/** A classification Symbiote refuses, with its status and the words the page shows. */
export class IssueRefused extends Error {
  override name = 'IssueRefused';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * `POST /api/issues/<n>/classify`, `GET /api/issues/<n>/classification`; since HV9c the rows'
 * decisions (`GET /api/issues/classifications`) and Settings' Issues group (`/api/hive/classifier`).
 */
export interface IssueClassifier {
  classify(number: number): Promise<IssueRecord>;
  /** The issue's record on origin's forge; null without one, or without a forge. */
  record(number: number): Promise<IssueRecord | null>;
  /** Each record's decision, whether `hive.issues.about` is set, the classifier's identity now. */
  decisions(): Promise<IssueDecisions>;
  /** The project's text, the classifier's model and effort, the standing (decision 1059). */
  settings(): Promise<ClassifierSettings>;
  /** `hive.issues.about`: at most `MAX_ABOUT` characters (1060); null or blank removes it. */
  setAbout(about: string | null): Promise<ClassifierSettings>;
  /** `hive.classifier.model`: one Claude Code lists; null for Opus. */
  setModel(model: string | null): Promise<ClassifierSettings>;
  /** `hive.classifier.effort`: one the model takes; null for high. */
  setEffort(effort: string | null): Promise<ClassifierSettings>;
}

/** The longest `hive.issues.about`: the card's text, on the classifier's every run. */
export const MAX_ABOUT = 4_000;

/** `hive.issues.about` and `hive.classifier.model`, `.effort` in the project's config. */
export function readClassifierConfig(root: string): {
  about?: string;
  model?: string;
  effort?: string;
} {
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return {};
  }
  const object = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const hive = object(object(value).hive);
  const about = object(hive.issues).about;
  const { model, effort } = object(hive.classifier);
  return {
    ...(typeof about === 'string' && about.trim() ? { about: about.slice(0, MAX_ABOUT) } : {}),
    ...(typeof model === 'string' && MODEL_ID.test(model) ? { model } : {}),
    ...(typeof effort === 'string' && EFFORT_LEVEL.test(effort) ? { effort } : {}),
  };
}

type Found = { forge: Forge } | { why: string; forge?: Forge };

const NO_ABOUT =
  'Write what the project is and what Hive may take on first: hive.issues.about in symbiote/config.json';
const NO_CLAUDE = 'Claude Code is not found: the classifier runs on it';

/** The classifier as it would run now: its card and identity, or why it cannot. */
type Current =
  | {
      forge: Forge;
      card: string;
      prompt: string;
      claude: { command: string; models: AgentModel[]; version?: string };
      config: ReturnType<typeof readClassifierConfig>;
      identity: string;
    }
  | { why: string; forge?: Forge };

const forgeOfRecord = (forge: Forge): IssueForge => ({
  kind: forge.kind,
  host: forge.host,
  project: forge.project,
});

/** A record as a row shows it (decision 1055). */
const rowOf = (record: IssueRecord): IssueDecision => ({
  number: record.number,
  decision: record.decision,
  ...(record.held?.length ? { held: record.held } : {}),
  ...(record.refusal ? { refusal: record.refusal } : {}),
  at: record.run?.at ?? record.snapshot?.at ?? '',
});

/** The classifier of the repository at `root`, its records in `folder()` (a `symbiote/`). */
export function issueClassifier(ctx: {
  root: string;
  /** The `symbiote/` the records are kept in, ready to write into. */
  folder: () => Promise<string>;
  cacheDir: string;
  hive: () => Promise<boolean>;
  forge: () => Promise<Found>;
  claude: () => Promise<{ command: string; models: AgentModel[]; version?: string } | null>;
  /** The check's commands: `merge.checks`, or the one Symbiote finds; null when none. */
  checks: () => Promise<readonly string[] | null>;
  /** The account's email, git's, the home folder and the cache (decision 1037). */
  markers: () => Promise<PersonalMarker[]>;
  runInput?: RunWithInput;
  now?: () => number;
}): IssueClassifier {
  const running = new Set<number>();

  async function forgeOf(): Promise<Forge> {
    const found = await ctx.forge();
    if (found.forge) return found.forge;
    throw new IssueRefused(`No forge to read issues from: ${'why' in found ? found.why : ''}`, 409);
  }

  /** The project's card (1038): its forge's project, the check's commands, the person's text. */
  const cardOf = async (forge: Forge, about: string) =>
    projectCard({ forge: forgeOfRecord(forge), checks: await ctx.checks(), about });

  /**
   * The classifier as it would run now, in classify's order of refusals: the text, the forge,
   * Claude Code; its identity is the one a classification would record (1041).
   */
  async function current(): Promise<Current> {
    const config = readClassifierConfig(ctx.root);
    if (!config.about) return { why: NO_ABOUT };
    const found = await ctx.forge();
    if (!found.forge) {
      return { why: `No forge to read issues from: ${'why' in found ? found.why : ''}` };
    }
    const forge = found.forge;
    const claude = await ctx.claude();
    if (!claude) return { why: NO_CLAUDE, forge };
    const card = await cardOf(forge, config.about);
    const prompt = readPrompts(ctx.root).text['hive.classify'];
    const on = classifierOn(claude.models, config);
    const { identity } = classifierIdentity({ prompt, card, on });
    return { forge, card, prompt, claude, config, identity };
  }

  async function classify(number: number): Promise<IssueRecord> {
    if (!(await ctx.hive())) {
      throw new IssueRefused('Hive mode is off: the classifier runs only while it is on', 409);
    }
    const config = readClassifierConfig(ctx.root);
    if (!config.about) throw new IssueRefused(NO_ABOUT, 409);
    const forge = await forgeOf();
    const claude = await ctx.claude();
    if (!claude) throw new IssueRefused(NO_CLAUDE, 409);
    let issue;
    try {
      issue = await forge.getIssue(number);
    } catch (error) {
      if (error instanceof SymbioteError) throw new IssueRefused(error.message, 409);
      throw error;
    }
    const classified = await classifyIssue({
      issue,
      card: await cardOf(forge, config.about),
      prompt: readPrompts(ctx.root).text['hive.classify'],
      models: claude.models,
      config,
      command: claude.command,
      version: claude.version,
      cacheDir: ctx.cacheDir,
      markers: await ctx.markers(),
      ...(ctx.runInput ? { runInput: ctx.runInput } : {}),
      ...(ctx.now ? { now: ctx.now } : {}),
    });
    const record: IssueRecord = {
      forge: forgeOfRecord(forge),
      number,
      url: issue.url,
      title: issue.title,
      state: issue.state,
      ...classified,
    };
    const folder = await ctx.folder();
    await writeIssueRecord(folder, record);
    return (await readIssueRecord(folder, number, record.forge)) ?? record;
  }

  /**
   * The standing against 1040's bar under `identity`: the records it classified, the takes it
   * made that were judged (`judged` events carry the identity that took them), the bar. HV9a's
   * hostile sets have not run with a repository's card: null until HV13 runs them.
   */
  async function standing(forge: Forge, identity: string): Promise<ClassifierStanding> {
    const folder = await ctx.folder();
    const records = await readIssueRecords(folder, forgeOfRecord(forge));
    const classified = { take: 0, held: 0, ask: 0, refuse: 0, failed: 0 };
    let since: string | undefined;
    for (const record of records) {
      if (record.classifier?.identity !== identity) continue;
      classified[record.decision] += 1;
      if (record.decision === 'take' && record.held?.length) classified.held += 1;
      const at = record.run?.at;
      if (at && (!since || at < since)) since = at;
    }
    const judged = { right: 0, wrong: 0 };
    for (const record of records) {
      for (const event of await readIssueEvents(folder, record.number)) {
        if (event.event !== 'judged' || event.identity !== identity) continue;
        judged[event.right ? 'right' : 'wrong'] += 1;
      }
    }
    const hostile = null as ClassifierStanding['hostile'];
    const total = judged.right + judged.wrong;
    const meets =
      total >= CLASSIFIER_BAR.takes &&
      judged.right / total >= CLASSIFIER_BAR.right &&
      hostile !== null &&
      hostile.taken === 0;
    return {
      identity,
      ...(since ? { since } : {}),
      classified,
      judged,
      bar: CLASSIFIER_BAR,
      hostile,
      meets,
    };
  }

  /** Claude Code's models and the levels on the classifier's model, as the reviewer's (V92). */
  async function levels(): Promise<AgentLevels> {
    const config = readClassifierConfig(ctx.root);
    const about = {
      ...(config.effort ? { effort: config.effort } : {}),
      ...(config.model ? { model: config.model } : {}),
      file: readPrompts(ctx.root).file,
    };
    const claude = await ctx.claude();
    if (!claude) return { agents: [], ...about };
    const models = claude.models.length > 0 ? claude.models : null;
    const on = levelsOn(models, config.model ?? CLASSIFIER_MODEL, null);
    return {
      agents: [
        {
          kind: 'claude',
          ...(on
            ? { efforts: { ...on, default: CLASSIFIER_EFFORT, by: 'symbiote' as const } }
            : {}),
          ...(models
            ? { models, defaultModel: { id: CLASSIFIER_MODEL, by: 'symbiote' as const } }
            : {}),
        },
      ],
      ...about,
    };
  }

  async function settings(): Promise<ClassifierSettings> {
    const config = readClassifierConfig(ctx.root);
    const [now, read] = await Promise.all([current(), levels()]);
    return {
      about: config.about ?? null,
      maxAbout: MAX_ABOUT,
      levels: read,
      ...('why' in now
        ? { standing: null, why: now.why }
        : { standing: await standing(now.forge, now.identity) }),
    };
  }

  /** Claude Code, for a model or level to be checked against its list; refused without it. */
  async function claudeModels(): Promise<AgentModel[] | null> {
    const claude = await ctx.claude();
    if (!claude) throw new IssueRefused(NO_CLAUDE, 409);
    return claude.models.length > 0 ? claude.models : null;
  }

  return {
    async classify(number) {
      if (running.has(number)) throw new IssueRefused(`Issue #${number} is being classified`, 409);
      running.add(number);
      try {
        return await classify(number);
      } finally {
        running.delete(number);
      }
    },
    async record(number) {
      const found = await ctx.forge();
      if (!found.forge) return null;
      return readIssueRecord(await ctx.folder(), number, forgeOfRecord(found.forge));
    },
    async decisions() {
      const config = readClassifierConfig(ctx.root);
      const now = await current();
      const forge = now.forge ?? (await ctx.forge()).forge;
      const records = forge ? await readIssueRecords(await ctx.folder(), forgeOfRecord(forge)) : [];
      return {
        decisions: records.map(rowOf),
        about: config.about !== undefined,
        ...('identity' in now ? { identity: now.identity } : {}),
      };
    },
    settings,
    async setAbout(about) {
      const text = about?.trim() ?? '';
      if (text.length > MAX_ABOUT) {
        throw new IssueRefused(
          `At most ${MAX_ABOUT.toLocaleString('en-US')} characters: this text has ${text.length.toLocaleString('en-US')}`,
          400,
        );
      }
      await writeConfig(ctx.root, ['hive', 'issues', 'about'], text || undefined);
      return settings();
    },
    async setModel(model) {
      if (model !== null) {
        if (!MODEL_ID.test(model)) throw new IssueRefused(modelWordProblem(model), 400);
        const problem = modelProblem(model, AGENT_NAMES.claude, await claudeModels());
        if (problem) throw new IssueRefused(problem, 400);
      }
      await writeConfig(ctx.root, ['hive', 'classifier', 'model'], model ?? undefined);
      return settings();
    },
    async setEffort(effort) {
      if (effort !== null) {
        if (!EFFORT_LEVEL.test(effort)) throw new IssueRefused(effortWordProblem(effort), 400);
        const models = await claudeModels();
        const model = readClassifierConfig(ctx.root).model ?? CLASSIFIER_MODEL;
        const problem = effortOnProblem(effort, AGENT_NAMES.claude, models, model, null);
        if (problem) throw new IssueRefused(problem, 400);
      }
      await writeConfig(ctx.root, ['hive', 'classifier', 'effort'], effort ?? undefined);
      return settings();
    },
  };
}

/**
 * What of the person an answer must not carry (decisions 1037, 1042): Claude Code's account
 * email (its `.claude.json`, beside CLAUDE_CONFIG_DIR's folder when set), git's `user.email`, the
 * home folder and Symbiote's cache. Read for each classification, kept in no record.
 */
export async function personalMarkers({
  repo,
  env,
  home,
  cacheDir,
}: {
  repo: GitRepo;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  cacheDir: string;
}): Promise<PersonalMarker[]> {
  const config = join(env.CLAUDE_CONFIG_DIR?.trim() || home, '.claude.json');
  let account: unknown;
  try {
    const value = JSON.parse(await readFile(config, 'utf8')) as {
      oauthAccount?: { emailAddress?: unknown };
    };
    account = value.oauthAccount?.emailAddress;
  } catch {
    account = undefined;
  }
  const git = await userEmail(repo).catch(() => null);
  return [
    ...(typeof account === 'string' && account.includes('@')
      ? [{ name: 'email', value: account }]
      : []),
    ...(git ? [{ name: 'git email', value: git }] : []),
    { name: 'home folder', value: home },
    { name: 'cache folder', value: cacheDir },
  ];
}

/**
 * The classifier of `symbiote view` on `repo` (HV9b): its records beside Hive's switch, origin's
 * forge, Claude Code's models and version, the project's check.
 */
export function viewIssueClassifier(
  repo: GitRepo,
  cacheDir: string,
  {
    env,
    hive,
    claude,
    run = runProgram,
  }: {
    env: Env;
    hive: () => Promise<boolean>;
    claude: () => Promise<ClaudeCode | null>;
    run?: Run;
  },
): IssueClassifier {
  let version: Promise<string | undefined> | undefined;
  const versionOf = (command: string) =>
    (version ??= run(command, ['--version'], { cwd: cacheDir, timeoutMs: 20_000 }).then(
      (result) => /^\s*(\d+\.\d+\.\d+\S*)/.exec(result.stdout)?.[1],
      () => undefined,
    ));
  return issueClassifier({
    root: repo.root,
    cacheDir,
    async folder() {
      const where = await reviewPlace(repo, cacheDir);
      await prepareSymbioteFolder(where, { agents: false });
      return dirname(where.dir);
    },
    hive,
    forge: () => originForge(repo, env),
    async claude() {
      const found = await claude();
      if (!found) return null;
      const [models, at] = await Promise.all([found.models(), versionOf(found.command)]);
      return { command: found.command, models: models ?? [], ...(at ? { version: at } : {}) };
    },
    async checks() {
      const { checks } = readMergeConfig(repo.root);
      if (checks?.length) return checks;
      return (await foundCheck(repo, 'HEAD').catch(() => null))?.commands ?? null;
    },
    markers: () => personalMarkers({ repo, env, home: homedir(), cacheDir }),
  });
}
