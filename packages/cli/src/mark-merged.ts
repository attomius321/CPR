// Merged work marked in the docs (MC3, decision 990): the repository's `merged` commands
// (`symbiote/config.json`, this repository's `scripts/plan/mark-merged.mjs --write` and
// `consolidate.mjs --write`) run at the target's tip in a worktree of Symbiote's cache, never the
// person's checkout; their changes one commit ("Docs: merged", the commands' output its body),
// landed as the merger lands (merger.md, "How the target branch moves") and pushed as `merge.push`
// says. Symbiote's merger leaves the docs as they were: V99–V106 stayed "ready for review".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fastForwardBranch,
  git,
  listRefs,
  listWorktrees,
  MergeStepRefused,
  pushCommit,
  resetMergeWorktree,
  upstreamOf,
  defaultBranch,
  type GitRepo,
} from '@symbiote/core';
import { readMergeConfig } from './merge-config.js';
import { runShell, type RunCheck } from './programs.js';

/** `merged` in `symbiote/config.json`: the commands that mark merged work, and the subject. */
export interface MarkedConfig {
  commands: string[];
  message: string;
}

/** The commit's subject unless `merged.message` names another (CLAUDE.md's workflow). */
const MESSAGE = 'Docs: merged';

/** Most of the commands' output a commit's body keeps, in lines. */
const MAX_BODY_LINES = 200;

/** `merged` as the repository sets it; null when it names no command, or cannot be read. */
export function readMarkedConfig(root: string): MarkedConfig | null {
  let v: { commands?: unknown; message?: unknown } | undefined;
  try {
    const all = JSON.parse(readFileSync(join(root, 'symbiote', 'config.json'), 'utf8')) as {
      merged?: unknown;
    } | null;
    v = all?.merged && typeof all.merged === 'object' ? all.merged : undefined;
  } catch {
    return null;
  }
  if (!v) return null;
  const listed =
    typeof v.commands === 'string' ? [v.commands] : Array.isArray(v.commands) ? v.commands : [];
  const commands = listed.filter((c): c is string => typeof c === 'string' && c.trim() !== '');
  if (commands.length === 0) return null;
  const message =
    typeof v.message === 'string' && v.message.trim() !== '' ? v.message.trim() : MESSAGE;
  return { commands, message };
}

/** What the commands change at `into`'s tip: its files, and what they wrote. */
export interface MarkPreview {
  into: string;
  tip: string;
  files: string[];
  output: string;
}

/** A preview, and whether the commit would be pushed (`merge.push`). */
export interface MarkPlan extends MarkPreview {
  push: boolean;
}

/** What marking did: the commit, whether it landed (and why not), whether it was pushed. */
export interface MarkDone extends MarkPreview {
  commit?: string;
  landed: boolean;
  why?: string;
  pushed?: { ok: true; remote: string } | { ok: false; remote: string; error: string };
}

export interface MarkMerged {
  /** Whether the repository sets `merged` (read at each call). */
  configured(): boolean;
  /** The commands run at `into`'s tip (the default branch's) in the cache's worktree. */
  preview(into?: string): Promise<MarkPlan>;
  /** As `preview`, then their changes one commit, landed on `into`, pushed as `merge.push` says. */
  mark(into?: string): Promise<MarkDone>;
}

/** Why marking could not run: a setting, a branch or a command; its words. */
export class MarkRefused extends Error {
  override name = 'MarkRefused';
}

/** Marking merged work in `repo`, in `<cacheDir>/worktrees/<repo>/marks`. */
export function markMerged(
  repo: GitRepo,
  cacheDir: string,
  { run = runShell }: { run?: RunCheck } = {},
): MarkMerged {
  const folder = join(cacheDir, 'worktrees', repo.id, 'marks');

  /** The commands at `into`'s tip in the worktree; what they changed and wrote. */
  async function changes(asked?: string): Promise<MarkPreview & { message: string }> {
    const config = readMarkedConfig(repo.root);
    if (!config) throw new MarkRefused('symbiote/config.json names no `merged` commands');
    const refs = await listRefs(repo);
    const into = asked ?? (await defaultBranch(repo, refs));
    const tip = refs.branches.find((b) => b.name === into)?.sha;
    if (!into || !tip) throw new MarkRefused(`no branch ${asked ?? 'to mark merged work on'}`);
    await resetMergeWorktree(repo, folder, tip);
    const said: string[] = [];
    for (const command of config.commands) {
      const { code, output } = await run(command, folder);
      if (code !== 0) {
        const end = output.trim().split('\n').slice(-5).join('\n');
        throw new MarkRefused(`${command} failed (exit ${code ?? 'none'})${end ? `: ${end}` : ''}`);
      }
      if (output.trim()) said.push(output.trim());
    }
    const status = await git(folder, ['status', '--porcelain', '--untracked-files=all']);
    const files = status
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^.* -> /, ''));
    return { into, tip, files, output: said.join('\n'), message: config.message };
  }

  /** Where `branch` is pushed: its upstream, else `origin`, else the first remote. */
  async function remoteOf(branch: string): Promise<{ remote: string; branch: string } | null> {
    const upstream = await upstreamOf(repo, branch);
    if (upstream) return { remote: upstream.remote, branch: upstream.branch };
    const refs = await listRefs(repo);
    const remote = refs.remotes.some((r) => r.remote === 'origin')
      ? 'origin'
      : refs.remotes[0]?.remote;
    return remote ? { remote, branch } : null;
  }

  return {
    configured: () => readMarkedConfig(repo.root) !== null,

    async preview(into) {
      const { into: on, tip, files, output } = await changes(into);
      return { into: on, tip, files, output, push: readMergeConfig(repo.root).push };
    },

    async mark(asked) {
      const { message, ...done } = await changes(asked);
      const { into, tip, files, output } = done;
      if (files.length === 0) return { ...done, landed: false, why: 'nothing to mark' };
      const body = output.split('\n').slice(0, MAX_BODY_LINES).join('\n');
      await git(folder, ['add', '--all']);
      await git(folder, [
        'commit',
        '--quiet',
        '--message',
        message,
        ...(body ? ['--message', body] : []),
      ]);
      const commit = (await git(folder, ['rev-parse', 'HEAD'])).trim();
      // Read before landing: the landing brings the commit's config into the checkout.
      const pushing = readMergeConfig(repo.root).push;
      const holder = (await listWorktrees(repo)).find((w) => w.branch === into && !w.prunable);
      try {
        await fastForwardBranch(repo, {
          branch: into,
          to: commit,
          from: tip,
          ...(holder ? { checkedOut: holder.path } : {}),
        });
      } catch (error) {
        if (!(error instanceof MergeStepRefused)) throw error;
        const where = holder ? ` in ${holder.path}` : '';
        return {
          ...done,
          commit,
          landed: false,
          why: `${into} was not moved${where}: ${error.message}; the commit is ${commit.slice(0, 7)}`,
        };
      }
      const landed: MarkDone = { into, tip, files, output, commit, landed: true };
      if (!pushing) return landed;
      const to = await remoteOf(into);
      if (!to)
        return { ...landed, pushed: { ok: false, remote: '', error: 'no remote to push to' } };
      const pushed = await pushCommit(repo, { remote: to.remote, sha: commit, branch: to.branch });
      return {
        ...landed,
        pushed: pushed.ok
          ? { ok: true, remote: to.remote }
          : { ok: false, remote: to.remote, error: pushed.error },
      };
    },
  };
}
