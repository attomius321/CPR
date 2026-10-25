// What starting a workspace takes: the commit it starts from (V33), where its worktree goes, its
// brief checked (V24), and what its agent is told (V28).
import { basename, dirname, join, resolve } from 'node:path';
import {
  defaultBranch,
  isAncestor,
  isCommit,
  WORK_KINDS,
  type BriefPart,
  type BriefParts,
  type GitRepo,
  type PromptKey,
  type RefList,
  type StartBranch,
  type WorkKind,
  type WorkspaceRequest,
} from '@symbiote/core';
import { DEFAULT_PROMPTS, fillPrompt } from './prompts.js';
import { briefOf, HEADINGS, KINDS, MAX_BRIEF, MAX_TITLE, partsOf } from './workspace-brief.js';
import { WorkspaceRefused, type WorkspaceFile } from './workspace-record.js';

/**
 * Where a workspace's worktree goes: beside the checkout, `../<checkout>.worktrees/<branch>`, the
 * branch's slashes as dashes; `pattern` (`workspaces.worktrees` in `symbiote/config.json`, relative
 * to the checkout, `{repo}` for its folder name) moves the folder that holds them.
 */
export function worktreeFolder(main: string, branch: string, pattern?: string): string {
  const name = basename(main);
  const holder = pattern
    ? resolve(main, pattern.replaceAll('{repo}', name))
    : join(dirname(main), `${name}.worktrees`);
  return join(holder, branch.replaceAll('/', '-'));
}

/** A full SHA: 40 hex digits, or 64 in a SHA-256 repository. */
export const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * Where a start request starts (V33): the newest tip of the branch it names (`from`), the commit
 * it names (`base`, a full SHA), else the default branch's newest tip; refused when there is none.
 */
export async function startPoint(
  repo: GitRepo,
  refs: RefList,
  request: Pick<WorkspaceRequest, 'base' | 'from'>,
): Promise<{ from?: string; sha: string }> {
  let base: { from?: string; sha: string };
  if (request.base !== undefined && request.from !== undefined) {
    throw new WorkspaceRefused('start from a branch or a commit, not both', 400);
  }
  if (request.from !== undefined) {
    const sha = typeof request.from === 'string' ? await newestTip(repo, refs, request.from) : null;
    if (!sha) throw new WorkspaceRefused(`no branch ${String(request.from)}`, 400);
    base = { from: request.from, sha };
  } else if (request.base !== undefined) {
    if (!FULL_SHA.test(request.base)) {
      throw new WorkspaceRefused(`the base must be a full SHA: ${request.base}`, 400);
    }
    if (!(await isCommit(repo, request.base))) {
      throw new WorkspaceRefused(`not a commit: ${request.base}`, 400);
    }
    base = { sha: request.base };
  } else {
    const found = await workspaceBase(repo, refs);
    if (!found) {
      throw new WorkspaceRefused('no default branch to start from: pick a commit', 400);
    }
    base = found;
  }
  return base;
}

/**
 * Where a workspace starts by default: the default branch's newest tip — of the local branch and
 * the remotes', the one that holds the others; the local one when they diverged.
 */
export async function workspaceBase(
  repo: GitRepo,
  refs: RefList,
): Promise<{ from: string; sha: string } | null> {
  const name = await defaultBranch(repo, refs);
  if (!name) return null;
  const sha = await newestTip(repo, refs, name);
  return sha ? { from: name, sha } : null;
}

/**
 * The branches a workspace can start from (V33, decision 230): every name of a local branch or a
 * remote's, the default first, then the local ones, then those only on a remote, each at its
 * newest tip.
 */
export async function startBranches(repo: GitRepo, refs: RefList): Promise<StartBranch[]> {
  const first = await defaultBranch(repo, refs);
  const local = new Set(refs.branches.map((b) => b.name));
  const byName = (a: string, b: string) =>
    Number(b === first) - Number(a === first) || compare(a, b);
  const names = [
    ...[...local].sort(byName),
    ...[...new Set(refs.remotes.map((r) => r.branch))].filter((n) => !local.has(n)).sort(byName),
  ];
  const branches: StartBranch[] = [];
  for (const name of names) {
    const sha = await newestTip(repo, refs, name);
    if (sha) branches.push({ name, sha, ...(local.has(name) ? {} : { remote: true as const }) });
  }
  return branches;
}

/** Code-point order, as git lists refs. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A branch name's newest tip (decision 231): of the local branch and the remotes' (origin's
 * first), the one that holds the others; the local one when they diverged. Git is asked only
 * where the tips differ.
 */
async function newestTip(repo: GitRepo, refs: RefList, name: string): Promise<string | null> {
  const local = refs.branches.find((b) => b.name === name)?.sha;
  const remotes = refs.remotes
    .filter((r) => r.branch === name)
    .sort((a, b) => Number(b.remote === 'origin') - Number(a.remote === 'origin'))
    .map((r) => r.sha);
  const tips = [...new Set([...(local ? [local] : []), ...remotes])];
  for (const tip of tips) {
    let holdsAll = true;
    for (const other of tips) {
      if (other !== tip && !(await isAncestor(repo, other, tip))) holdsAll = false;
    }
    if (holdsAll) return tip;
  }
  return local ?? tips[0] ?? null;
}

/**
 * What the agent is told: its kind's start prompt (V28; Symbiote's unless the project has its own),
 * filled with the brief, its branch and worktree, where its record and reviews are. A record
 * from before V24 is a feature.
 */
export function workspacePrompt(
  workspace: WorkspaceFile,
  where: {
    record: string;
    reviews: string;
    agents: string;
    into: string | null;
    /** Where its documents are (V40). */
    documents?: string;
  },
  prompts: Readonly<Record<PromptKey, string>> = DEFAULT_PROMPTS,
): string {
  const kind = workspace.kind ?? 'feature';
  const files = workspace.documents ?? [];
  // The files the person gave (V40): `{documents}`, else after a prompt that leaves it out. With
  // none, the line holding `{documents}` goes with the blank line after it.
  const documents =
    files.length > 0 && where.documents
      ? fillPrompt(prompts.documents, {
          folder: where.documents,
          files: files.map((name) => `- ${name}`).join('\n'),
        }).trimEnd()
      : '';
  const start = prompts[`start.${kind}`];
  const template = documents ? start : start.replace(/^\{documents\}(?:\n\n?|$)/m, '');
  const filled = fillPrompt(template, {
    documents,
    branch: workspace.branch,
    start: workspace.from
      ? `${workspace.from} at ${workspace.base.slice(0, 7)}`
      : `the commit ${workspace.base.slice(0, 7)}`,
    brief: workspace.brief.trim(),
    plan: prompts[workspace.planFirst ? 'plan.first' : 'plan.direct'],
    // Decision 171: since V26 the person picks the target at Merge into ▾.
    into: where.into ?? 'the branch the person picks',
    record: where.record,
    reviews: where.reviews,
    agents: where.agents,
    symbiote: dirname(where.agents),
  });
  const text =
    documents && !template.includes('{documents}') ? `${filled.trimEnd()}\n\n${documents}` : filled;
  return `${text.trimEnd()}\n`;
}

/**
 * A start request's brief, checked: made from its kind, title and parts (V24), empty parts left
 * out; or, from a request made before V24, its brief as given.
 */
export function workOf(
  request: WorkspaceRequest,
): Pick<WorkspaceFile, 'brief' | 'kind' | 'title' | 'parts'> {
  const { kind, title, parts } = request;
  if (kind === undefined && title === undefined && parts === undefined) {
    const brief = request.brief ?? '';
    if (brief.trim() === '') {
      throw new WorkspaceRefused('a workspace needs a brief: what to build', 400);
    }
    if (brief.length > MAX_BRIEF) {
      throw new WorkspaceRefused('a brief is at most 20,000 characters', 400);
    }
    return { brief };
  }
  if (request.brief !== undefined) {
    throw new WorkspaceRefused('a workspace takes a brief or a kind of work, not both', 400);
  }
  if (!WORK_KINDS.includes(kind as WorkKind)) {
    throw new WorkspaceRefused(`unknown kind: ${String(kind)}`, 400);
  }
  const of = kind as WorkKind;
  const name = (title ?? '').trim();
  if (name === '') throw new WorkspaceRefused('a workspace needs a title', 400);
  if (/[\r\n]/.test(name)) throw new WorkspaceRefused('a title is one line', 400);
  if (name.length > MAX_TITLE) {
    throw new WorkspaceRefused(`a title is at most ${MAX_TITLE} characters`, 400);
  }
  const own = partsOf(of);
  const kept: BriefParts = {};
  for (const [part, text] of Object.entries(parts ?? {})) {
    if (!own.includes(part as BriefPart)) {
      const heading = Object.hasOwn(HEADINGS, part) ? HEADINGS[part as BriefPart] : part;
      throw new WorkspaceRefused(`a ${of} has no "${heading}"`, 400);
    }
    if (typeof text === 'string' && text.trim() !== '') kept[part as BriefPart] = text;
  }
  const required = KINDS[of].required;
  if (!kept[required]) {
    throw new WorkspaceRefused(`a ${of} needs "${HEADINGS[required]}"`, 400);
  }
  const brief = briefOf(of, name, kept);
  if (brief.length > MAX_BRIEF) {
    throw new WorkspaceRefused('a brief is at most 20,000 characters, its parts together', 400);
  }
  return { brief, kind: of, title: name, parts: kept };
}
