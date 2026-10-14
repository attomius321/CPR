import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import {
  commitsBetween,
  defaultBranch,
  forkPoint,
  isCommit,
  listRefs,
  listRemotes,
  mergeBase,
  pushCommit,
  PushRefused,
  setUpstream,
  trackedFiles,
  upstreamOf,
  userEmail,
  type BranchReviewInfo,
  type BranchReviewList,
  type BranchReviewRef,
  type BranchReviewSummary,
  type FinishResult,
  type GitRepo,
  type LocalReview,
  type PushOutcome,
  type RefList,
  type Verdict,
  type VerdictComment,
} from '@cpr/core';
import type { Pair } from './diffs.js';
import type { StateName, StateStore } from './server.js';

/** A branch review on disk: `cpr/reviews/<branch>/<reviewer>.json` (V15). */
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

/** Written once into `cpr/`: reviews stay out of git until it is deleted. */
export const GITIGNORE =
  '# Written by CPR: reviews stay on this machine. Delete this file to commit and share them.\n' +
  '*\n!config.json\n';

/** Where reviews are kept, and as whom. */
export interface ReviewPlace {
  /** The folder holding `<branch>/<reviewer>.json`. */
  dir: string;
  reviewer: string;
  place: 'repository' | 'cache';
  /** Why the cache, not `cpr/reviews/`. */
  note?: string;
  /** `cpr/.gitignore`, written before the first review when absent. */
  gitignore?: string;
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
   * `read`, at the side's commit), clears the drafts, and on Approve pushes the reviewed tip.
   */
  finish(
    info: BranchReviewInfo,
    review: LocalReview,
    read: (side: 'base' | 'head', path: string) => Promise<string>,
  ): Promise<FinishResult>;
  /** Pushes the last approval's tip again (after git refused it). */
  pushAgain(info: BranchReviewInfo): Promise<FinishResult>;
}

/**
 * `cpr/reviews/` at the repository's root as the git user (`user.email`). The cache instead,
 * saying why, without a git user, or when `cpr/` holds files of the project itself (a `*` in
 * its `.gitignore` would hide that project's new files).
 */
export async function reviewPlace(repo: GitRepo, cacheDir: string): Promise<ReviewPlace> {
  const email = await userEmail(repo);
  const cache = (note: string): ReviewPlace => ({
    dir: join(cacheDir, 'state', repo.id, 'reviews'),
    reviewer: email ?? 'local',
    place: 'cache',
    note,
  });
  if (!email) {
    return cache("Kept in CPR's cache: set git config user.email to keep reviews in cpr/reviews/.");
  }
  const folder = join(repo.root, 'cpr');
  const foreign =
    (await stat(folder).then(
      (s) => !s.isDirectory(),
      () => false,
    )) ||
    (await trackedFiles(repo, 'cpr')).some(
      (path) =>
        path !== 'cpr/config.json' && path !== 'cpr/.gitignore' && !path.startsWith('cpr/reviews/'),
    );
  if (foreign) return cache("Kept in CPR's cache: cpr/ holds files of this project.");
  return {
    dir: join(folder, 'reviews'),
    reviewer: email,
    place: 'repository',
    gitignore: join(folder, '.gitignore'),
  };
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

/** Sorted keys, two-space indent, a final newline: git merges and diffs it line by line. */
export function serializeReview(review: BranchReviewFile): string {
  return `${JSON.stringify(sortKeys(review), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
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

  /** The commits on a ref since a review's head (else its fork point, gone after a rebase). */
  async function since(review: BranchReviewFile, tip: string) {
    for (const from of [review.head, review.base]) {
      if (from && (await isCommit(repo, from))) return commitsBetween(repo, from, tip);
    }
    return null;
  }

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
      // Out of git before anything is in the folder; an existing one is the project's.
      if (where.gitignore) {
        await mkdir(dirname(where.gitignore), { recursive: true });
        await writeFile(where.gitignore, GITIGNORE, { flag: 'wx' }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') throw error;
          },
        );
      }
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, serializeReview(next));
      await rename(temp, path);
      return next;
    });
  }

  /**
   * Where Approve pushes a review's tip (V16): the local branch's upstream; else the remote
   * branch reviewed; else `origin` and the same name. Null without a remote.
   */
  async function pushTarget(
    info: Pick<BranchReviewInfo, 'branch' | 'ref' | 'base' | 'head'>,
    refs: RefList,
  ): Promise<{ remote: string; branch: string; sha: string | null } | null> {
    const local = refs.branches.find((b) => b.name === info.branch);
    const upstream = local ? await upstreamOf(repo, local.name) : null;
    if (upstream) return upstream;
    const reviewed = refs.remotes.find((r) => r.name === info.ref);
    if (reviewed) return { remote: reviewed.remote, branch: reviewed.branch, sha: reviewed.sha };
    if (!(await listRemotes(repo)).includes('origin')) return null;
    const there = refs.remotes.find((r) => r.name === `origin/${info.branch}`);
    return { remote: 'origin', branch: info.branch, sha: there?.sha ?? null };
  }

  /** Pushes the reviewed tip, by SHA; the newer commits of the local branch stay local. */
  async function push(info: BranchReviewInfo): Promise<{ push: PushOutcome; unpushed: number }> {
    const refs = await listRefs(repo);
    const local = refs.branches.find((b) => b.name === info.branch);
    const unpushed =
      local && local.sha !== info.head
        ? (await commitsBetween(repo, info.head, local.sha, 0)).count
        : 0;
    const target = await pushTarget(info, refs);
    if (!target) return { push: { none: 'no remote to push to' }, unpushed };
    try {
      if (target.sha !== info.head) await pushCommit(repo, info.head, target.remote, target.branch);
      if (local && !(await upstreamOf(repo, local.name))) {
        await setUpstream(repo, local.name, target.remote, target.branch);
      }
      return { push: { remote: target.remote, branch: target.branch, sha: info.head }, unpushed };
    } catch (error) {
      if (error instanceof PushRefused) return { push: { error: error.message }, unpushed };
      throw error;
    }
  }

  return {
    async list() {
      const [where, refs] = await Promise.all([place(), listRefs(repo)]);
      const reviews: BranchReviewSummary[] = [];
      for (const branch of await reviewedBranches(where)) {
        const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
        if (!review) continue;
        const summaryRefs: BranchReviewRef[] = [];
        const added = new Set<string>();
        for (const ref of refsOf(refs, branch)) {
          const after = await since(review, ref.sha);
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
                  pushed: !!verdict.push && 'sha' in verdict.push,
                },
              }
            : {}),
        });
      }
      return {
        defaultBranch: await defaultBranch(repo, refs),
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
      let base: string | null;
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
        base = await forkPoint(repo, tip, main, refs);
        if (!base) throw new ReviewRefused(`${branch} has no commit in common with ${main}`);
        if (base === tip) {
          throw new ReviewRefused(`${branch} is merged into ${main}: nothing to review`);
        }
      }

      const where = await place();
      const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
      const reviewed = review?.head || null;
      const after = review && reviewed ? await since(review, tip) : null;
      const refName = local ? local.name : (remote?.name ?? ref);
      const target = await pushTarget({ branch, ref: refName, base, head: tip }, refs);
      const commits = target ? (await commitsBetween(repo, target.sha ?? base, tip, 0)).count : 0;
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
          ...(target ? { push: { remote: target.remote, branch: target.branch, commits } } : {}),
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
            symbol,
            body: body.trim(),
            ...(placed ?? {}),
            ...(code === undefined ? {} : { code }),
          };
        }),
      );
      const pushed = review.event === 'approve' ? await push(info) : null;
      const verdict: Verdict = {
        at: now().toISOString(),
        comments,
        event: review.event,
        head: info.head,
        summary: review.body.trim(),
        ...(pushed ? { push: pushed.push } : {}),
      };
      // The drafts are in the verdict now: the next round starts empty.
      const file = await update(info, (next) => {
        next.verdicts = [...next.verdicts, verdict];
        next.drafts = [];
        next.summary = '';
      });
      return {
        verdict,
        text: verdictText(info, file.reviewer, verdict),
        unpushed: pushed?.unpushed ?? 0,
      };
    },

    async pushAgain(info) {
      const where = await place();
      const review = await readReview(reviewPath(where.dir, info.branch, where.reviewer));
      const last = review?.verdicts.at(-1);
      if (!last || last.event !== 'approve') throw new ReviewRefused('nothing approved to push');
      const pushed = await push({ ...info, head: last.head });
      const verdict: Verdict = { ...last, push: pushed.push };
      const file = await update(info, (next) => {
        next.verdicts = [...next.verdicts.slice(0, -1), verdict];
      });
      return {
        verdict,
        text: verdictText(info, file.reviewer, verdict),
        unpushed: pushed.unpushed,
      };
    },
  };
}

/**
 * A verdict as text for an agent's chat (V16): what was decided at which commit, the summary,
 * then each comment with its file and line, symbol and code.
 */
export function verdictText(
  info: Pick<BranchReviewInfo, 'branch' | 'base'>,
  reviewer: string,
  verdict: Verdict,
): string {
  const at = verdict.head.slice(0, 7);
  if (verdict.event === 'approve') return `Approved the branch ${info.branch} at ${at}.\n`;
  const what = verdict.event === 'request-changes' ? 'changes requested' : 'comments';
  const name = (symbol: string) => symbol.slice(symbol.indexOf('#') + 1);
  const lines = [
    `Address this review of the branch ${info.branch} (${reviewer}, at ${at}): ${what}.`,
  ];
  if (verdict.summary) lines.push('', verdict.summary);
  for (const c of verdict.comments) {
    lines.push('');
    if (c.path && c.line) {
      const removed = c.side === 'base' ? ` (a removed line, at ${info.base.slice(0, 7)})` : '';
      lines.push(`${c.path}:${c.line} · ${name(c.symbol)}${removed}`);
      if (c.code !== undefined) lines.push(`    ${c.code}`);
    } else lines.push(`About ${name(c.symbol)}:`);
    lines.push(c.body);
  }
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
