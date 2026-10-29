import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import {
  checkMerge,
  commitsBetween,
  defaultBranch,
  isAncestor,
  isCommit,
  listRefs,
  mainWorktree,
  mergeBase,
  trackedFiles,
  upstreamOf,
  userEmail,
  type BranchMerge,
  type BranchReviewInfo,
  type BranchReviewList,
  type BranchReviewRef,
  type BranchReviewSummary,
  type FinishResult,
  type GitRepo,
  type LocalReview,
  type PromptKey,
  type RefList,
  type Verdict,
  type VerdictComment,
} from '@symbiote/core';
import type { Pair } from './diffs.js';
import { FORMER_NAME, moveInto } from './former-name.js';
import { DEFAULT_PROMPTS, fillPrompt, readPrompts } from './prompts.js';
import { reviewBase, reviewedAgainst } from './review-base.js';
import { readWorkspace, viaOf, workspacePath, workspacesDir } from './workspace-record.js';
import type { StateName, StateStore } from './state.js';
import { writeFileWhole } from './file-write.js';

/** A branch review on disk: `symbiote/reviews/<branch>/<reviewer>.json` (V15). */
export interface BranchReviewFile {
  /** The fork point and the tip last reviewed. */
  base: string;
  branch: string;
  /** The viewer's draft comments, as it saves them. */
  drafts: unknown[];
  head: string;
  /** Symbol ID → its fingerprint when marked reviewed (I1). */
  marks: Record<string, string>;
  reviewer: string;
  summary: string;
  updated: string;
  /** Each finished review (V16): the verdict at a tip, its summary and comments. */
  verdicts: Verdict[];
}

/**
 * Written once into `symbiote/`: reviews stay out of git until it is deleted; the project's
 * settings (`config.json`) and the merger's rules (`merge.md`, V26c) are the project's to commit.
 */
export const GITIGNORE =
  '# Written by Symbiote: reviews stay on this machine. Delete this file to commit and share them.\n' +
  '*\n!config.json\n!merge.md\n';

/** What earlier Symbiotes wrote as `symbiote/.gitignore`: replaced by `GITIGNORE`, being Symbiote's
 * own. */
const EARLIER_GITIGNORES = new Set([
  // V15 to V26c: it hid symbiote/merge.md.
  '# Written by Symbiote: reviews stay on this machine. Delete this file to commit and share them.\n' +
    '*\n!config.json\n',
]);

/** Every review file's first key (V17): where an agent that opens it learns what to do. */
export const REVIEW_ABOUT =
  'A Symbiote review. Agents: read AGENTS.md beside the reviews folder (symbiote/AGENTS.md) before acting on it.';

/**
 * What an agent does with a review (V17): the text in use for `symbiote/AGENTS.md` (V28), as the
 * file holds it. Claude Code loads a folder's AGENTS.md when it reads a file there, `symbiote/`
 * git-ignored or not (checked with 2.1.296); other agents follow `about`.
 */
export const agentsFile = (text: string) => `${text.trimEnd()}\n`;

/** Symbiote's `symbiote/AGENTS.md`, until a project has its own (`prompts.reviews`). */
export const AGENTS = agentsFile(DEFAULT_PROMPTS.reviews);

/** Where reviews are kept, and as whom. */
export interface ReviewPlace {
  /** The folder holding `<branch>/<reviewer>.json`. */
  dir: string;
  reviewer: string;
  place: 'repository' | 'cache';
  /** Why the cache, not `symbiote/reviews/`. */
  note?: string;
  /** `symbiote/.gitignore`, written before the first review when absent. */
  gitignore?: string;
  /** The agents' instructions (V17), beside the reviews folder. */
  agents: string;
}

/** A branch that cannot be reviewed, and why (the server answers 400). */
export class ReviewRefused extends Error {
  override name = 'ReviewRefused';
}

/** What the server needs of branch reviews. */
export interface BranchReviews {
  /** The reviewer's reviews, for the commits page. */
  list(): Promise<BranchReviewList>;
  /**
   * A branch's review: from its fork point to its tip. `ref` is a branch, a remote branch
   * (`origin/topic`), or a branch name that only a remote has. Rejects with `ReviewRefused`.
   */
  resolve(ref: string): Promise<{ info: BranchReviewInfo; pair: Pair }>;
  /** Where the review's marks and drafts are read and written. */
  state(info: BranchReviewInfo): StateStore;
  /**
   * Finishes the review (V16): appends the verdict with its comments (their code read with
   * `read`, at the side's commit) and clears the drafts. An approval is metadata (V17): it names
   * the branch to merge into, and nothing is pushed.
   */
  finish(
    info: BranchReviewInfo,
    review: LocalReview,
    read: (side: 'base' | 'head', path: string) => Promise<string>,
  ): Promise<FinishResult>;
  /** Whether the branch merges cleanly into the default branch (V17); null on the default branch.
   * */
  merge(info: BranchReviewInfo): Promise<BranchMerge | null>;
}

/**
 * `symbiote/reviews/` at the repository's root as the git user (`user.email`): the main checkout's,
 * which its linked worktrees share (V18), so a workspace's worktree sees the same reviews. The
 * cache instead, saying why, without a git user, or when `symbiote/` holds files of the project
 * itself (a `*` in its `.gitignore` would hide that project's new files).
 */
export async function reviewPlace(repo: GitRepo, cacheDir: string): Promise<ReviewPlace> {
  const email = await userEmail(repo);
  const cache = (note: string): ReviewPlace => ({
    dir: join(cacheDir, 'state', repo.id, 'reviews'),
    reviewer: email ?? 'local',
    place: 'cache',
    note,
    agents: join(cacheDir, 'state', repo.id, 'AGENTS.md'),
  });
  if (!email) {
    return cache(
      "Kept in Symbiote's cache: set git config user.email to keep reviews in symbiote/reviews/.",
    );
  }
  const main = mainWorktree(repo);
  const folder = join(main, 'symbiote');
  // The folder under Symbiote's former name moves here, unless it is the project's own. Asked
  // only when it is there: this runs on each refresh of the workspaces.
  const former = join(main, FORMER_NAME);
  if (existsSync(former) && !(await holdsProjectFiles(repo, main, FORMER_NAME))) {
    moveInto(former, folder, { drop: REWRITTEN });
  }
  const foreign =
    (await stat(folder).then(
      (s) => !s.isDirectory(),
      () => false,
    )) || (await holdsProjectFiles(repo, main, 'symbiote'));
  if (foreign) return cache("Kept in Symbiote's cache: symbiote/ holds files of this project.");
  return {
    dir: join(folder, 'reviews'),
    reviewer: email,
    place: 'repository',
    gitignore: join(folder, '.gitignore'),
    agents: join(folder, 'AGENTS.md'),
  };
}

/** What Symbiote itself keeps in `symbiote/`, beside the reviews: a project may commit them. */
const SYMBIOTE_FILES = new Set(['config.json', '.gitignore', 'AGENTS.md', 'merge.md']);

/** What Symbiote writes again itself: copies under the former name are dropped, not moved. */
const REWRITTEN = ['.gitignore', 'AGENTS.md', 'claude-settings.json'];

/** Whether git tracks files in `<main>/<name>/` that are not Symbiote's. */
async function holdsProjectFiles(repo: GitRepo, main: string, name: string): Promise<boolean> {
  return (await trackedFiles({ ...repo, root: main }, name)).some((path) => {
    const inside = path.slice(name.length + 1);
    return !SYMBIOTE_FILES.has(inside) && !inside.startsWith('reviews/');
  });
}

/** A review's file: the branch's slashes as folders, the reviewer as its name. */
export function reviewPath(dir: string, branch: string, reviewer: string): string {
  const parts = branch.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new ReviewRefused(`not a branch name: ${branch}`);
  }
  return join(dir, ...parts, `${fileName(reviewer)}.json`);
}

const fileName = (reviewer: string) => reviewer.replace(/[^\w.@+-]/g, '_');

/**
 * Sorted keys, two-space indent, a final newline: git merges and diffs it line by line. The
 * first key, `about`, tells an agent where its instructions are (V17).
 */
export function serializeReview(review: BranchReviewFile): string {
  return `${JSON.stringify(sortKeys({ ...review, about: REVIEW_ABOUT }), null, 2)}\n`;
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

/** A review file, or null when it is missing or not one. */
export async function readReview(path: string): Promise<BranchReviewFile | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<Record<keyof BranchReviewFile, unknown>>;
  const text = (x: unknown) => (typeof x === 'string' ? x : '');
  return {
    base: text(v.base),
    branch: text(v.branch),
    drafts: Array.isArray(v.drafts) ? (v.drafts as unknown[]) : [],
    head: text(v.head),
    marks: asMarks(v.marks),
    reviewer: text(v.reviewer),
    summary: text(v.summary),
    updated: text(v.updated),
    verdicts: Array.isArray(v.verdicts) ? (v.verdicts as Verdict[]) : [],
  };
}

function asMarks(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * Before Symbiote writes into `symbiote/`: its `.gitignore`, unless one exists (then it is the
 * project's, unless an earlier Symbiote wrote it), and, when `agents`, the agents' instructions
 * beside it (V17), rewritten when they differ from `text` (Symbiote's unless the project has its
 * own, V28).
 */
export async function prepareSymbioteFolder(
  where: ReviewPlace,
  { agents = true, text = DEFAULT_PROMPTS.reviews }: { agents?: boolean; text?: string } = {},
): Promise<void> {
  if (where.gitignore) {
    await mkdir(dirname(where.gitignore), { recursive: true });
    const existing = await readFile(where.gitignore, 'utf8').catch(() => null);
    if (existing === null) {
      await writeFile(where.gitignore, GITIGNORE, { flag: 'wx' }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        },
      );
    } else if (EARLIER_GITIGNORES.has(existing)) {
      await writeFile(where.gitignore, GITIGNORE);
    }
  }
  if (!agents) return;
  const file = agentsFile(text);
  const current = await readFile(where.agents, 'utf8').catch(() => null);
  if (current === file) return;
  await mkdir(dirname(where.agents), { recursive: true });
  await writeFile(where.agents, file);
}

/** One write at a time per file: marks and drafts are read, changed and written back. */
const writing = new Map<string, Promise<unknown>>();
function serially<T>(path: string, task: () => Promise<T>): Promise<T> {
  const next = (writing.get(path) ?? Promise.resolve()).then(task, task);
  writing.set(
    path,
    next.catch(() => undefined),
  );
  return next;
}

/** Branch reviews of `repo`, kept where `reviewPlace` says. */
export function branchReviews(
  repo: GitRepo,
  cacheDir: string,
  { now = () => new Date() }: { now?: () => Date } = {},
): BranchReviews {
  const place = () => reviewPlace(repo, cacheDir);
  /** The agents' instructions checked this run, by path, and the text: checked again when it
   * changes. */
  const instructed = new Map<string, string>();
  /** Merge checks by default branch and tip: they take seconds on long-lived branches. */
  const merges = new Map<string, Promise<BranchMerge>>();

  /**
   * The commits on a ref since a review's head (else its fork point, gone after a rebase): the
   * branch's own, not the default branch's merged into it (`not`, its refs' tips; V17).
   */
  async function since(review: BranchReviewFile, tip: string, not: readonly string[]) {
    for (const from of [review.head, review.base]) {
      if (from && (await isCommit(repo, from))) return commitsBetween(repo, from, tip, 100, not);
    }
    return null;
  }

  /**
   * The tips (local and remotes') of the branch `branch` merges into: the default branch, or the
   * one its workspace is reviewed against (V65); none on that branch itself.
   */
  const otherThan = (refs: RefList, into: string | null | undefined, branch: string) =>
    into && into !== branch ? refsOf(refs, into).map((r) => r.sha) : [];

  /** The branch's workspace record (V65), beside the reviews; null for a branch with none. */
  const workspaceOf = (where: ReviewPlace, branch: string) =>
    readWorkspace(workspacePath(workspacesDir(where), branch));

  /** The review's file, created out of git (V15); one change at a time, read and written back. */
  async function update(
    info: BranchReviewInfo,
    change: (next: BranchReviewFile, current: BranchReviewFile | null) => void,
  ): Promise<BranchReviewFile> {
    const where = await place();
    const path = reviewPath(where.dir, info.branch, where.reviewer);
    return serially(path, async () => {
      const current = await readReview(path);
      const next: BranchReviewFile = {
        base: info.base,
        branch: info.branch,
        drafts: current?.drafts ?? [],
        head: info.head,
        marks: current?.marks ?? {},
        reviewer: where.reviewer,
        summary: current?.summary ?? '',
        updated: now().toISOString(),
        verdicts: current?.verdicts ?? [],
      };
      change(next, current);
      // Out of git before anything is in the folder; the agents' instructions once a run, and
      // again after the project's change (V28).
      const text = readPrompts(repo.root).text.reviews;
      await prepareSymbioteFolder(where, { agents: instructed.get(where.agents) !== text, text });
      instructed.set(where.agents, text);
      await writeFileWhole(path, serializeReview(next));
      return next;
    });
  }

  return {
    async list() {
      const [where, refs] = await Promise.all([place(), listRefs(repo)]);
      const main = await defaultBranch(repo, refs);
      const reviews: BranchReviewSummary[] = [];
      for (const branch of await reviewedBranches(where)) {
        const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
        if (!review) continue;
        const summaryRefs: BranchReviewRef[] = [];
        const added = new Set<string>();
        const against = reviewedAgainst(refs, branch, main, await workspaceOf(where, branch));
        const not = otherThan(refs, against.into, branch);
        for (const ref of refsOf(refs, branch)) {
          const after = await since(review, ref.sha, not);
          if (!after) continue;
          summaryRefs.push({ name: ref.name, tip: ref.sha, since: after.count });
          for (const sha of after.shas) added.add(sha);
        }
        const verdict = review.verdicts.at(-1);
        reviews.push({
          branch,
          base: review.base,
          head: review.head,
          updated: review.updated,
          marks: Object.keys(review.marks).length,
          refs: summaryRefs,
          added: [...added].slice(0, 100),
          ...(verdict
            ? {
                verdict: {
                  event: verdict.event,
                  head: verdict.head,
                  at: verdict.at,
                  comments: verdict.comments.length,
                  ...(verdict.into ? { into: verdict.into } : {}),
                  merged: await mergedInto(refs, verdict),
                  ...viaOf(verdict.via),
                },
              }
            : {}),
        });
      }
      return {
        defaultBranch: main,
        reviewer: where.reviewer,
        place: where.place,
        ...(where.note ? { note: where.note } : {}),
        reviews,
      };
    },

    async resolve(ref) {
      const refs = await listRefs(repo);
      const local = refs.branches.find((b) => b.name === ref);
      // A branch name only remotes have (a review's address): origin's first.
      const remote =
        refs.remotes.find((r) => r.name === ref) ??
        (local
          ? undefined
          : refs.remotes
              .filter((r) => r.branch === ref)
              .sort((a, b) => Number(b.remote === 'origin') - Number(a.remote === 'origin'))[0]);
      const branch = local ? local.name : remote?.branch;
      const tip = local?.sha ?? remote?.sha;
      if (!branch || !tip) throw new ReviewRefused(`no branch ${ref}`);
      const main = await defaultBranch(repo, refs);
      if (!main) {
        throw new ReviewRefused('no default branch (origin/HEAD, main or master) to start from');
      }
      const where = await place();
      let base: string | null;
      let into: string | undefined;
      if (branch === main) {
        // The default branch: the agent's commits since it was last pushed (V16).
        if (!local) {
          throw new ReviewRefused(
            `${ref} is the default branch as pushed: review ${main} for its unpushed commits`,
          );
        }
        const upstream = await upstreamOf(repo, main);
        if (!upstream?.sha) {
          throw new ReviewRefused(
            `${main} is the default branch and has no upstream: nothing to compare it with`,
          );
        }
        base = await mergeBase(repo, tip, upstream.sha);
        if (base === tip) throw new ReviewRefused(`${main} has no unpushed commits`);
        if (!base) throw new ReviewRefused(`${main} has no commit in common with its upstream`);
      } else {
        // From where its workspace started, or the branch picked to review it against (V65).
        const workspace = await workspaceOf(where, branch);
        const found = await reviewBase(repo, refs, branch, tip, main, workspace);
        const against = workspace?.against ?? main;
        if (!found) throw new ReviewRefused(`${branch} has no commit in common with ${against}`);
        ({ base, into } = found);
        if (base === tip) {
          throw new ReviewRefused(
            found.since
              ? `${branch} is merged into ${found.since}: nothing to review`
              : `${branch} has no commits since it started at ${base.slice(0, 7)}`,
          );
        }
      }

      const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
      const reviewed = review?.head || null;
      const after =
        review && reviewed ? await since(review, tip, otherThan(refs, into, branch)) : null;
      const refName = local ? local.name : (remote?.name ?? ref);
      const verdict = review?.verdicts.at(-1);
      return {
        info: {
          branch,
          ref: refName,
          base,
          head: tip,
          reviewed,
          since: after ? after.count : null,
          ...(where.note ? { note: where.note } : {}),
          ...(into ? { into } : {}),
          ...(verdict
            ? { verdict: { event: verdict.event, head: verdict.head, at: verdict.at } }
            : {}),
        },
        pair: { base, head: tip },
      };
    },

    state(info) {
      return {
        async read(name: StateName) {
          const where = await place();
          const review = await readReview(reviewPath(where.dir, info.branch, where.reviewer));
          if (!review) return null;
          return name === 'review' ? review.marks : { drafts: review.drafts, body: review.summary };
        },
        async write(name: StateName, value: unknown) {
          await update(info, (next) => {
            if (name === 'review') next.marks = asMarks(value);
            else {
              const draft = (value ?? {}) as { drafts?: unknown; body?: unknown };
              next.drafts = Array.isArray(draft.drafts) ? (draft.drafts as unknown[]) : [];
              next.summary = typeof draft.body === 'string' ? draft.body : '';
            }
          });
        },
      };
    },

    async finish(info, review, read) {
      const comments: VerdictComment[] = await Promise.all(
        review.comments.map(async ({ id, symbol, body, side, path, line }) => {
          const placed = side && path && line ? { side, path, line } : null;
          const code = placed
            ? await read(placed.side, placed.path).then(
                (text) => text.split('\n')[placed.line - 1],
                () => undefined,
              )
            : undefined;
          return {
            id,
            ...(symbol ? { symbol } : {}),
            body: body.trim(),
            ...(placed ?? {}),
            ...(code === undefined ? {} : { code }),
          };
        }),
      );
      const verdict: Verdict = {
        at: now().toISOString(),
        comments,
        event: review.event,
        head: info.head,
        ...(review.event === 'approve' && info.into ? { into: info.into } : {}),
        summary: review.body.trim(),
        ...(review.via ? { via: review.via } : {}),
      };
      // The drafts are in the verdict now: the next round starts empty.
      const file = await update(info, (next) => {
        next.verdicts = [...next.verdicts, verdict];
        next.drafts = [];
        next.summary = '';
      });
      const where = await place();
      const shown = (path: string) =>
        where.place === 'repository' ? relative(repo.root, path).split(sep).join('/') : path;
      return {
        verdict,
        text: verdictText(
          info,
          file.reviewer,
          verdict,
          {
            review: shown(reviewPath(where.dir, info.branch, where.reviewer)),
            agents: shown(where.agents),
          },
          readPrompts(repo.root).text,
        ),
      };
    },

    merge(info) {
      const { into } = info;
      if (!into) return Promise.resolve(null);
      return listRefs(repo).then((refs) => {
        // The local default branch, where the agent merges; else the remote's.
        const target = refs.branches.find((b) => b.name === into) ?? refsOf(refs, into)[0];
        if (!target) return { into, error: `no branch ${into}` };
        const key = `${target.sha}:${info.head}`;
        let check = merges.get(key);
        if (!check) {
          check = checkMerge(repo, target.sha, info.head).then((result) => ({ into, ...result }));
          merges.set(key, check);
        }
        return check;
      });
    },
  };

  /** Whether an approval's commit is in the branch it was to merge into (V17). */
  async function mergedInto(refs: RefList, verdict: Verdict): Promise<boolean> {
    if (verdict.event !== 'approve' || !verdict.into) return false;
    if (!(await isCommit(repo, verdict.head))) return false;
    for (const ref of refsOf(refs, verdict.into)) {
      if (await isAncestor(repo, verdict.head, ref.sha)) return true;
    }
    return false;
  }
}

/**
 * A verdict as text for an agent's chat (V16): what was decided at which commit — for an
 * approval, the merge Symbiote makes (V26) —, the summary, each comment with its file and line,
 * symbol and code, then where the review and the agents' instructions are. Its own sentences
 * are `prompts`' (V28).
 */
export function verdictText(
  info: Pick<BranchReviewInfo, 'branch' | 'base'>,
  reviewer: string,
  verdict: Verdict,
  where?: { review: string; agents: string },
  prompts: Readonly<Record<PromptKey, string>> = DEFAULT_PROMPTS,
): string {
  const at = verdict.head.slice(0, 7);
  const { branch } = info;
  const name = (symbol: string) => symbol.slice(symbol.indexOf('#') + 1);
  const lines: string[] = [];
  if (verdict.event === 'approve') {
    lines.push(
      verdict.into
        ? fillPrompt(prompts['verdict.approve'], { branch, at, into: verdict.into })
        : fillPrompt(prompts['verdict.push'], { branch, at }),
    );
  } else {
    const what = verdict.event === 'request-changes' ? 'changes requested' : 'comments';
    lines.push(fillPrompt(prompts['verdict.address'], { branch, reviewer, at, what }));
  }
  if (verdict.summary) lines.push('', verdict.summary);
  for (const c of verdict.comments) {
    lines.push('');
    if (c.path && c.line) {
      const removed = c.side === 'base' ? ` (a removed line, at ${info.base.slice(0, 7)})` : '';
      lines.push(`${c.path}:${c.line}${c.symbol ? ` · ${name(c.symbol)}` : ''}${removed}`);
      if (c.code !== undefined) lines.push(`    ${c.code}`);
    } else lines.push(`About ${c.symbol ? name(c.symbol) : (c.path ?? 'the change')}:`);
    lines.push(c.body);
  }
  if (where) lines.push('', fillPrompt(prompts['verdict.where'], where));
  return `${lines.join('\n')}\n`;
}

/** A branch's refs: the local branch and the remotes' branches of that name. */
function refsOf(refs: RefList, branch: string): { name: string; sha: string }[] {
  return [
    ...refs.branches.filter((b) => b.name === branch),
    ...refs.remotes.filter((r) => r.branch === branch),
  ].map(({ name, sha }) => ({ name, sha }));
}

/** Branches with a review by `where.reviewer`: the folders holding their file. */
async function reviewedBranches(where: ReviewPlace): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(where.dir, { recursive: true });
  } catch {
    return [];
  }
  const name = `${fileName(where.reviewer)}.json`;
  return files
    .filter((file) => file.split(sep).at(-1) === name && file.includes(sep))
    .map((file) =>
      relative(where.dir, dirname(join(where.dir, file)))
        .split(sep)
        .join('/'),
    )
    .sort();
}
