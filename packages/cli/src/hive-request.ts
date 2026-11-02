// Hive lands through a pull or merge request (HV8, decisions 788–793): the repository's setting
// (`hive.lands` in `symbiote/config.json`), the forge `origin` names and its token, the request's
// description, Symbiote's graph review posted on it, and the start branch brought up to the forge's
// once the person merged it there. The runner (`hive-runner.ts`) opens and watches the request.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fastForwardBranch,
  fetchBranch,
  git,
  isAncestor,
  listChangedLines,
  listWorktrees,
  MergeStepRefused,
  type GitRepo,
  type Graph,
  type HiveLandingSetting,
  type HiveLandsBy,
} from '@symbiote/core';
import {
  detectForge,
  type ChangeRequest,
  type Env,
  type Forge,
  type ForgeKind,
} from '@symbiote/forge';
import type { HiveFile } from './hive-record.js';
import { CONFIG_FILES } from './plugins.js';
import { postGraphFindings, type PostedFindings } from './post-findings.js';
import { PromptRefused, writeConfig } from './prompts.js';

/** The forge's names, for the words a person reads: "pull request #12 on GitHub". */
export const FORGE_WORDS: Record<ForgeKind, { name: string; request: string; sign: string }> = {
  github: { name: 'GitHub', request: 'pull request', sign: '#' },
  gitlab: { name: 'GitLab', request: 'merge request', sign: '!' },
};

/** The most of a request's description sent: GitHub takes 65,536 characters. */
const MAX_BODY = 60_000;

/** `hive.lands` in the project's config: `request`, else the merge queue (the default, HV4). */
export function readLandsBy(root: string): HiveLandsBy {
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return 'queue';
  try {
    const value = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
      hive?: { lands?: unknown };
    } | null;
    return value?.hive?.lands === 'request' ? 'request' : 'queue';
  } catch {
    return 'queue';
  }
}

/** Sets `hive.lands` (Settings); the default, the queue, is written as no key. */
export async function setLandsBy(root: string, by: unknown): Promise<void> {
  if (by !== 'queue' && by !== 'request') {
    throw new PromptRefused(`Hive lands by "queue" or "request", not ${JSON.stringify(by)}`, 400);
  }
  await writeConfig(root, ['hive', 'lands'], by === 'request' ? 'request' : undefined);
}

/**
 * The forge `origin` names, with a token for its API, or why there is none (decision 792): no
 * `origin`, a host that is neither GitHub nor GitLab, no token. No network call: the forge is told
 * by the remote's address and the token by the environment (or `gh`'s, for GitHub).
 */
export async function originForge(
  repo: GitRepo,
  env: Env,
  make: (url: string, env: Env) => Forge = (url, e) => detectForge(url, e),
): Promise<{ forge: Forge } | { why: string; forge?: Forge }> {
  const url = (await git(repo.root, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
  if (!url.trim()) return { why: 'the repository has no remote named origin' };
  let forge: Forge;
  try {
    forge = make(url.trim(), env);
  } catch (error) {
    return { why: `origin is not a GitHub or GitLab repository: ${(error as Error).message}` };
  }
  if (!forge.token) {
    const set =
      forge.kind === 'github'
        ? 'set GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login'
        : 'set GITLAB_TOKEN (a personal or project access token with api scope)';
    return { why: `no ${FORGE_WORDS[forge.kind].name} token for ${forge.host}: ${set}`, forge };
  }
  return { forge };
}

/** The setting as Settings shows it (decision 793): how Hive lands, the forge, the token. */
export async function landingSetting(
  repo: GitRepo,
  root: string,
  env: Env,
  make?: (url: string, env: Env) => Forge,
): Promise<HiveLandingSetting> {
  const found = await originForge(repo, env, make);
  const forge = found.forge
    ? { kind: found.forge.kind, host: found.forge.host, project: found.forge.project }
    : undefined;
  return {
    by: readLandsBy(root),
    ...(forge ? { forge } : {}),
    token: 'why' in found ? false : true,
    ...('why' in found ? { why: found.why } : {}),
  };
}

/** Settings' "Hive lands by" (decision 793): read, and set. */
export interface HiveLandingService {
  read(): Promise<HiveLandingSetting>;
  set(by: HiveLandsBy): Promise<HiveLandingSetting>;
}

/** The setting of the project at `root`, `origin` read in `repo`. */
export function hiveLandingService(repo: GitRepo, root: string, env: Env): HiveLandingService {
  const read = () => landingSetting(repo, root, env);
  return {
    read,
    async set(by) {
      await setLandsBy(root, by);
      return read();
    },
  };
}

/** What the runner asks of the forge (HV8): the setting, `origin`'s forge, the graph review. */
export interface HiveRequests {
  /** How Hive lands now: read at each landing. */
  by(): HiveLandsBy;
  /** `origin`'s forge with a token, or why not. */
  forge(): Promise<{ forge: Forge } | { why: string }>;
  /** Symbiote's graph review of `base..head`, its new findings posted on `request` (790). */
  review(forge: Forge, request: ChangeRequest, base: string, head: string): Promise<PostedFindings>;
}

/** The runner's requests in `repo`, the config read at `root`, the graph made by `graphOf`. */
export function hiveRequests(
  repo: GitRepo,
  {
    root = repo.root,
    env,
    graphOf,
    make,
  }: {
    root?: string;
    env: Env;
    /** The graph of two commits: the view server's analysis, in a child process. */
    graphOf: (pair: { base: string; head: string }) => Promise<Graph>;
    make?: (url: string, env: Env) => Forge;
  },
): HiveRequests {
  return {
    by: () => readLandsBy(root),
    forge: () => originForge(repo, env, make),
    async review(forge, request, base, head) {
      const graph = await graphOf({ base, head });
      const lines = await listChangedLines(repo, base, head);
      // Comments are anchored to the commit analyzed.
      const reviewed = { ...request, head: { ...request.head, sha: head } };
      return postGraphFindings(forge, reviewed, graph, lines, 'warning');
    },
  };
}

const short = (sha: string) => sha.slice(0, 7);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The request's description (decision 790): the brief, then what Hive ran, round by round, and its
 * approval; how the person lands or stops it.
 */
export function requestBody(
  record: Pick<HiveFile, 'checks' | 'reviews'>,
  { brief, approval, kind }: { brief: string; approval: string; kind: ForgeKind },
): string {
  const ran: string[] = [];
  for (const check of record.checks) {
    const commands = check.commands?.length
      ? `: ${check.commands.map((c) => `\`${c}\``).join(', ')}`
      : '';
    ran.push(
      `- Round ${check.round}, \`${short(check.at)}\`: the check ${check.ok ? 'passed' : `failed${check.failed ? ` on \`${check.failed}\`` : ''}`} (${plural(check.commands?.length ?? 1, 'command')}${commands})`,
    );
  }
  for (const review of record.reviews) {
    const kept = review.findings.filter((f) => f.kept).length;
    const verdict =
      review.verdict === 'approved'
        ? 'approved'
        : review.verdict === 'changes'
          ? `${plural(kept, 'defect')} proven by failing tests, sent to the writer`
          : review.verdict === 'failed'
            ? 'no answer'
            : 'not run';
    ran.push(`- Round ${review.round}, \`${short(review.at)}\`: the running review ${verdict}`);
  }
  const { request } = FORGE_WORDS[kind];
  const text = [
    brief.trim(),
    '---',
    '**What Hive ran**',
    ran.length > 0 ? ran.join('\n') : '- Nothing: no check is set or found, and no review ran',
    `**${approval}**`,
    `Opened by Symbiote's Hive. Merge this ${request} to land it; close it to stop the workspace. The forge's CI is not waited on.`,
  ].join('\n\n');
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 2)}\n…` : text;
}

/** How bringing a branch up to `origin`'s went. */
export type BroughtUp =
  { ok: true; moved: boolean } | { ok: false; error: string; refused?: true; diverged?: true };

/**
 * The local `branch` brought up to `origin`'s after a merge on the forge (decision 789, as 770):
 * fetched, and fast-forwarded when it is behind, `--ff-only` in the checkout that has it. Never a
 * force: refused (the person's changes in the way) or diverged, it says why.
 */
export async function bringUp(repo: GitRepo, branch: string): Promise<BroughtUp> {
  let theirs: string | null;
  try {
    theirs = await fetchBranch(repo, 'origin', branch);
  } catch (error) {
    return { ok: false, error: `not fetched from origin: ${(error as Error).message}` };
  }
  if (!theirs) return { ok: false, error: `origin has no ${branch}` };
  const local = (
    await git(repo.root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]).catch(() => '')
  ).trim();
  if (!local) return { ok: false, error: `there is no local ${branch}` };
  if (theirs === local || (await isAncestor(repo, theirs, local)))
    return { ok: true, moved: false };
  if (!(await isAncestor(repo, local, theirs))) {
    return {
      ok: false,
      diverged: true,
      error: `${branch} and origin/${branch} have diverged: Hive never forces or rebases`,
    };
  }
  const holder = (await listWorktrees(repo)).find((w) => w.branch === branch && !w.prunable);
  try {
    await fastForwardBranch(repo, {
      branch,
      to: theirs,
      from: local,
      ...(holder ? { checkedOut: holder.path } : {}),
    });
    return { ok: true, moved: true };
  } catch (error) {
    if (!(error instanceof MergeStepRefused)) throw error;
    return { ok: false, refused: true, error: error.message };
  }
}

/**
 * The files a merge of `tip` into `into` conflicts in, by git's own merge without a worktree
 * (`git merge-tree`, git 2.38+); none when it cannot tell.
 */
export function conflictFiles(repo: GitRepo, into: string, tip: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['merge-tree', '--write-tree', '--name-only', '--no-messages', into, tip],
      { cwd: repo.root, encoding: 'utf8', timeout: 30_000 },
      (error, stdout) => {
        const code = (error as (Error & { code?: unknown }) | null)?.code;
        if (!error || code !== 1) return resolve([]);
        resolve([...new Set(stdout.split('\n').slice(1).filter(Boolean))]);
      },
    );
  });
}
