import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import {
  checkMerge,
  commitsBetween,
  defaultBranch,
  forkPoint,
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

/**
 * Written once into `cpr/`: reviews stay out of git until it is deleted; the project's settings
 * (`config.json`) and the merger's rules (`merge.md`, V26c) are the project's to commit.
 */
export const GITIGNORE =
  '# Written by CPR: reviews stay on this machine. Delete this file to commit and share them.\n' +
  '*\n!config.json\n!merge.md\n';

/** What earlier CPRs wrote as `cpr/.gitignore`: replaced by `GITIGNORE`, being CPR's own. */
const EARLIER_GITIGNORES = new Set([
  // V15 to V26c: it hid cpr/merge.md.
  '# Written by CPR: reviews stay on this machine. Delete this file to commit and share them.\n' +
    '*\n!config.json\n',
]);

/** Every review file's first key (V17): where an agent that opens it learns what to do. */
export const REVIEW_ABOUT =
  'A CPR review. Agents: read AGENTS.md beside the reviews folder (cpr/AGENTS.md) before acting on it.';

/**
 * What an agent does with a review (V17), written beside the reviews in any repository and
 * rewritten when CPR's text changes. Claude Code loads a folder's AGENTS.md when it reads a file
 * there, `cpr/` git-ignored or not (checked with 2.1.296); other agents follow `about`.
 */
export const AGENTS = `# CPR reviews

Written by CPR, which rewrites this file when it changes: put your project's own rules in its
own CLAUDE.md or AGENTS.md.

A person reviews your branch with CPR and records a verdict in
\`cpr/reviews/<branch>/<reviewer>.json\` (the branch's slashes are folders). Act on it when the
person asks you to (for example "check my review"), not because you came across it.

## Read only the last verdict

- Act on the last entry of \`verdicts\`. \`drafts\`, \`marks\` and the top-level \`summary\` are a
  review in progress, not feedback. No verdicts: there is nothing to act on yet; say so.
- \`head\` is the commit the person reviewed. Commits after it (\`git log <head>..<branch>\`) were
  not part of the review.

## What each verdict asks

- \`request-changes\`: fix each comment in new commits on the branch. Then say, one line per
  comment, what you changed (with the commit) or why you did not.
- \`comment\`: answer each comment; change code only where a comment asks for it.
- \`approve\` with \`into\`: the approved commit \`head\` is to be merged into \`into\`, and CPR
  merges it (its merger: Merge in CPR, or \`cpr merge <branch>\`). Do not merge it yourself
  unless the person asks you to; there is nothing to do.
- \`approve\` without \`into\` (a review of the default branch's unpushed commits): those commits,
  up to \`head\`, may be pushed.
- Push only when and what the project's own instructions say.

## A merge conflict

When CPR says the branch conflicts with \`into\` (before the review, or when it merged):

1. On the branch, merge \`into\` in (\`git merge <into>\`), resolve the conflicts there and
   commit. Never resolve them on \`into\`: the resolution would be code nobody reviewed.
2. Tell the person the branch needs another review.

## Workspaces

A workspace started in CPR is a branch with a worktree of its own and a record in
\`cpr/workspaces/<branch>.json\`: the person's \`brief\`, the \`base\` it started from, and
\`planFirst\`. If you were started on one:

- Work only in its worktree, on its branch.
- With \`planFirst\`, write the plan (what you will change and how you will check it), then stop
  and wait for the person's OK before changing anything.
- Commit on the branch as you go; say when it is ready for review.

## Comments

Each has \`body\` (what to do) and \`symbol\` (\`<path>#<name>\`); on a line, also \`path\`,
\`line\`, \`side\` and \`code\` (that line's text). Without \`line\` it is about the whole symbol.

- \`side: "head"\`: \`line\` is in the reviewed commit \`head\`, not your working copy. If the
  branch moved since, find the place by \`code\` and \`symbol\`.
- \`side: "base"\`: a line the branch removed, at the file's top-level \`base\` (where the review
  starts: \`git show <base>:<path>\`). Usually the question is whether removing it was right.

## Never

- Rewrite commits the person reviewed (amend, rebase, squash): their review is of those commits.
- Edit, move or commit anything in \`cpr/\`: the reviews are the person's.
`;

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
  /** Whether the branch merges cleanly into the default branch (V17); null on the default branch. */
  merge(info: BranchReviewInfo): Promise<BranchMerge | null>;
}

/**
 * `cpr/reviews/` at the repository's root as the git user (`user.email`): the main checkout's,
 * which its linked worktrees share (V18), so a workspace's worktree sees the same reviews. The
 * cache instead, saying why, without a git user, or when `cpr/` holds files of the project
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
    return cache("Kept in CPR's cache: set git config user.email to keep reviews in cpr/reviews/.");
  }
  const main = mainWorktree(repo);
  const folder = join(main, 'cpr');
  const foreign =
    (await stat(folder).then(
      (s) => !s.isDirectory(),
      () => false,
    )) ||
    (await trackedFiles({ ...repo, root: main }, 'cpr')).some(
      (path) => !CPR_FILES.has(path) && !path.startsWith('cpr/reviews/'),
    );
  if (foreign) return cache("Kept in CPR's cache: cpr/ holds files of this project.");
  return {
    dir: join(folder, 'reviews'),
    reviewer: email,
    place: 'repository',
    gitignore: join(folder, '.gitignore'),
    agents: join(folder, 'AGENTS.md'),
  };
}

/** What CPR itself keeps in `cpr/`, beside the reviews: a project may commit them. */
const CPR_FILES = new Set(['cpr/config.json', 'cpr/.gitignore', 'cpr/AGENTS.md', 'cpr/merge.md']);

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
 * Before CPR writes into `cpr/`: its `.gitignore`, unless one exists (then it is the project's,
 * unless an earlier CPR wrote it), and, when `agents`, the agents' instructions beside it (V17),
 * rewritten when CPR's text differs.
 */
export async function prepareCprFolder(
  where: ReviewPlace,
  { agents = true }: { agents?: boolean } = {},
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
  const current = await readFile(where.agents, 'utf8').catch(() => null);
  if (current === AGENTS) return;
  await mkdir(dirname(where.agents), { recursive: true });
  await writeFile(where.agents, AGENTS);
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
  /** The agents' instructions checked this run, by path: rewritten at most once. */
  const instructed = new Set<string>();
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

  /** The default branch's tips (local and remotes'), unless `branch` is the default branch. */
  const otherThan = (refs: RefList, main: string | null, branch: string) =>
    main && main !== branch ? refsOf(refs, main).map((r) => r.sha) : [];

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
      // Out of git before anything is in the folder; the agents' instructions once a run.
      await prepareCprFolder(where, { agents: !instructed.has(where.agents) });
      instructed.add(where.agents);
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, serializeReview(next));
      await rename(temp, path);
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
        const not = otherThan(refs, main, branch);
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
      const after =
        review && reviewed ? await since(review, tip, otherThan(refs, main, branch)) : null;
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
          ...(branch === main ? {} : { into: main }),
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
      const verdict: Verdict = {
        at: now().toISOString(),
        comments,
        event: review.event,
        head: info.head,
        ...(review.event === 'approve' && info.into ? { into: info.into } : {}),
        summary: review.body.trim(),
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
        text: verdictText(info, file.reviewer, verdict, {
          review: shown(reviewPath(where.dir, info.branch, where.reviewer)),
          agents: shown(where.agents),
        }),
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
 * approval, the merge CPR makes (V26) —, the summary, each comment with its file and line,
 * symbol and code, then where the review and the agents' instructions are.
 */
export function verdictText(
  info: Pick<BranchReviewInfo, 'branch' | 'base'>,
  reviewer: string,
  verdict: Verdict,
  where?: { review: string; agents: string },
): string {
  const at = verdict.head.slice(0, 7);
  const name = (symbol: string) => symbol.slice(symbol.indexOf('#') + 1);
  const lines: string[] = [];
  if (verdict.event === 'approve') {
    lines.push(
      verdict.into
        ? `Approved the branch ${info.branch} at ${at}: CPR merges ${at} into ${verdict.into}; do not merge it yourself.`
        : `Approved the unpushed commits of ${info.branch} up to ${at}: they may be pushed.`,
    );
  } else {
    const what = verdict.event === 'request-changes' ? 'changes requested' : 'comments';
    lines.push(
      `Address this review of the branch ${info.branch} (${reviewer}, at ${at}): ${what}.`,
    );
  }
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
  if (where) {
    lines.push('', `The review: ${where.review}; how to act on it: ${where.agents}.`);
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
