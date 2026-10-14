import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import {
  commitsBetween,
  defaultBranch,
  forkPoint,
  isCommit,
  listRefs,
  trackedFiles,
  userEmail,
  type BranchReviewInfo,
  type BranchReviewList,
  type BranchReviewRef,
  type BranchReviewSummary,
  type GitRepo,
  type RefList,
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
        reviews.push({
          branch,
          base: review.base,
          head: review.head,
          updated: review.updated,
          marks: Object.keys(review.marks).length,
          refs: summaryRefs,
          added: [...added].slice(0, 100),
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
      if (!main)
        throw new ReviewRefused('no default branch (origin/HEAD, main or master) to start from');
      if (branch === main) {
        throw new ReviewRefused(
          `${main} is the default branch: there is no fork point to review from`,
        );
      }
      const base = await forkPoint(repo, tip, main, refs);
      if (!base) throw new ReviewRefused(`${branch} has no commit in common with ${main}`);
      if (base === tip)
        throw new ReviewRefused(`${branch} is merged into ${main}: nothing to review`);

      const where = await place();
      const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
      const reviewed = review?.head || null;
      const after = review && reviewed ? await since(review, tip) : null;
      return {
        info: {
          branch,
          ref: local ? local.name : (remote?.name ?? ref),
          base,
          head: tip,
          reviewed,
          since: after ? after.count : null,
          ...(where.note ? { note: where.note } : {}),
        },
        pair: { base, head: tip },
      };
    },

    state(info) {
      const file = place().then((where) => ({
        where,
        path: reviewPath(where.dir, info.branch, where.reviewer),
      }));
      return {
        async read(name: StateName) {
          const { path } = await file;
          const review = await readReview(path);
          if (!review) return null;
          return name === 'review' ? review.marks : { drafts: review.drafts, body: review.summary };
        },
        async write(name: StateName, value: unknown) {
          const { where, path } = await file;
          await serially(path, async () => {
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
            };
            if (name === 'review') next.marks = asMarks(value);
            else {
              const draft = (value ?? {}) as { drafts?: unknown; body?: unknown };
              next.drafts = Array.isArray(draft.drafts) ? (draft.drafts as unknown[]) : [];
              next.summary = typeof draft.body === 'string' ? draft.body : '';
            }
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
          });
        },
      };
    },
  };
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
