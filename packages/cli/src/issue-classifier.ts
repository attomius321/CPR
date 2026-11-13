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
  EFFORT_LEVEL,
  MODEL_ID,
  SymbioteError,
  userEmail,
  type AgentModel,
  type GitRepo,
} from '@symbiote/core';
import type { Env, Forge } from '@symbiote/forge';
import type { ClaudeCode } from './claude-code.js';
import { originForge } from './hive-request.js';
import { foundCheck, readMergeConfig } from './merge-config.js';
import { prepareSymbioteFolder, reviewPlace } from './reviews.js';
import { classifyIssue, projectCard, type PersonalMarker } from './issue-classify.js';
import { readIssueRecord, writeIssueRecord, type IssueRecord } from './issue-record.js';
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

/** `POST /api/issues/<n>/classify` and `GET /api/issues/<n>/classification`. */
export interface IssueClassifier {
  classify(number: number): Promise<IssueRecord>;
  /** The issue's record on origin's forge; null without one, or without a forge. */
  record(number: number): Promise<IssueRecord | null>;
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

  async function classify(number: number): Promise<IssueRecord> {
    if (!(await ctx.hive())) {
      throw new IssueRefused('Hive mode is off: the classifier runs only while it is on', 409);
    }
    const config = readClassifierConfig(ctx.root);
    if (!config.about) {
      throw new IssueRefused(
        'Write what the project is and what Hive may take on first: hive.issues.about in symbiote/config.json',
        409,
      );
    }
    const forge = await forgeOf();
    const claude = await ctx.claude();
    if (!claude) throw new IssueRefused('Claude Code is not found: the classifier runs on it', 409);
    let issue;
    try {
      issue = await forge.getIssue(number);
    } catch (error) {
      if (error instanceof SymbioteError) throw new IssueRefused(error.message, 409);
      throw error;
    }
    const card = projectCard({
      forge: { kind: forge.kind, host: forge.host, project: forge.project },
      checks: await ctx.checks(),
      about: config.about,
    });
    const classified = await classifyIssue({
      issue,
      card,
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
      forge: { kind: forge.kind, host: forge.host, project: forge.project },
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
      const { kind, host, project } = found.forge;
      return readIssueRecord(await ctx.folder(), number, { kind, host, project });
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
