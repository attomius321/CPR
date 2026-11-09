// A workspace opened (V18b, V21, V43, V45): its worktree and a file's diff in VS Code, a terminal
// on its agent, its shells.
import { existsSync } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';
import { fileChangedSince, listRefs, resolveCommit } from '@symbiote/core';
import type { FolderAt } from './editor.js';
import { newestSession } from './claude-code.js';
import { onServer } from './workspace-codex.js';
import { emptyFile, isFile, keptFile } from './revision-copies.js';
import { readRecord, WorkspaceRefused } from './workspace-record.js';
import { shellOf, TerminalRefused } from './terminal.js';
import { real } from './thread.js';
import type { WorkspacesContext, Workspaces } from './workspace-context.js';
import type { WorkspaceTrunk } from './workspace-trunk.js';
import type { WorkspaceAgent } from './workspace-agent.js';

/** Most shells a workspace has open at once (V45): 9 MB each, measured. */
export const MAX_SHELLS = 8;

/** A workspace's worktree, diffs, terminal and shells opened. */
export function workspaceOpen(
  {
    attached,
    cacheDir,
    env,
    openFolder,
    place,
    repo,
    shellsByBranch,
    terminals,
    viaCodex,
  }: Pick<
    WorkspacesContext,
    | 'attached'
    | 'cacheDir'
    | 'env'
    | 'openFolder'
    | 'place'
    | 'repo'
    | 'shellsByBranch'
    | 'terminals'
    | 'viaCodex'
  >,
  {
    changesBase,
    endedAt,
    agentOf,
    settingsFile,
  }: Pick<WorkspaceTrunk, 'changesBase' | 'endedAt'> &
    Pick<WorkspaceAgent, 'agentOf' | 'settingsFile'>,
) {
  /** Commits' files as VS Code's diffs are given them (V43, decision 288), by commit and path. */
  const revisions = join(cacheDir, 'state', repo.id, 'revisions');

  /** A workspace's shells still open, by number: one that exited or was closed is forgotten. */
  const openShells = (branch: string) => {
    const open = (shellsByBranch.get(branch) ?? []).filter(
      (shell) => terminals?.running(shell.id) !== undefined,
    );
    if (open.length > 0) shellsByBranch.set(branch, open);
    else shellsByBranch.delete(branch);
    return open;
  };

  const ops: Pick<Workspaces, 'openWorktree' | 'openDiff' | 'terminal' | 'shell' | 'shells'> = {
    async openWorktree(branch) {
      const workspace = await readRecord(await place(), branch);
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      if (!openFolder) throw new WorkspaceRefused('no editor to open it in', 409);
      const result = await openFolder(workspace.worktree);
      if (!result.opened) throw new WorkspaceRefused(result.message, 502);
    },

    async openDiff(branch, file) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      const before = file.previousPath ?? file.path;
      for (const path of [file.path, before]) {
        const normal = posix.normalize(path);
        if (path === '' || isAbsolute(path) || normal.startsWith('../') || normal === '..') {
          throw new WorkspaceRefused(`not a path in its worktree: ${path}`, 400);
        }
      }
      // A finished workspace's worktree went with Clean up: another may have its folder now.
      const worktree =
        !workspace.finished && existsSync(workspace.worktree)
          ? { ...repo, root: workspace.worktree }
          : null;
      const own = join(workspace.worktree, ...file.path.split('/'));
      let left: string | null;
      let right: string | null;
      if (file.uncommitted) {
        if (!worktree) {
          throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
        }
        left = await keptFile(revisions, worktree, await resolveCommit(worktree, 'HEAD'), before);
        right = (await isFile(own)) ? own : null;
      } else {
        const refs = await listRefs(repo);
        // Finished: where it ended (V77), its branch perhaps gone.
        const tip = workspace.finished
          ? (await endedAt(where, workspace, refs, null)).end
          : refs.branches.find((b) => b.name === workspace.branch)?.sha;
        if (!tip) throw new WorkspaceRefused(`its branch ${workspace.branch} is gone`, 409);
        const { base } = await changesBase(workspace, refs, tip);
        left = await keptFile(revisions, worktree ?? repo, base, before);
        right = await keptFile(revisions, worktree ?? repo, tip, file.path);
        // The worktree's own file when it is the tip's (decision 287): editable, with VS Code's
        // language features.
        if (
          right &&
          worktree &&
          (await isFile(own)) &&
          !(await fileChangedSince(worktree, tip, file.path))
        )
          right = own;
      }
      if (!left && !right) throw new WorkspaceRefused(`${file.path} is in neither side`, 409);
      if (!openFolder) throw new WorkspaceRefused('no editor to open it in', 409);
      // A new file has nothing to compare with: it opens alone, as it is. A deleted one is shown
      // against an empty side, which says it is gone.
      const at: FolderAt = left
        ? { left, right: right ?? (await emptyFile(revisions, file.path)) }
        : { path: right as string };
      const result = await openFolder(worktree ? workspace.worktree : repo.root, at);
      if (!result.opened) throw new WorkspaceRefused(result.message, 502);
    },

    async terminal({ branch, cols, rows }) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      if (workspace.agent?.kind === 'codex' && !onServer(workspace)) {
        throw new WorkspaceRefused(
          'Codex has no terminal in Symbiote without its app server: Talk copies `codex resume`, to run in yours',
          409,
        );
      }
      if (!terminals) throw new WorkspaceRefused('no terminals here', 409);
      const can = await terminals.available();
      if (!can.available) throw new WorkspaceRefused(can.reason, 409);
      if (onServer(workspace)) return viaCodex.terminal(workspace, terminals, cols, rows);
      const agent = await agentOf(workspace);
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      // A session that wakes reads its settings file again, and does not start without it.
      if (workspace.agent?.hooks) await settingsFile(where);
      // `attach` to an ID Claude Code does not know exits 0, saying "No job matching…".
      const session = newestSession(workspace, await agent.sessions(), real);
      if (!session?.id) {
        throw new WorkspaceRefused('its agent has no session to open: start the agent again', 409);
      }
      try {
        const id = await terminals.open({
          command: agent.command,
          args: ['attach', session.id],
          cwd: workspace.worktree,
          cols,
          rows,
          env,
        });
        attached.set(session.id, (attached.get(session.id) ?? new Set()).add(id));
        return { id };
      } catch (error) {
        if (error instanceof TerminalRefused) throw new WorkspaceRefused(error.message, 409);
        throw error;
      }
    },

    async shell({ branch, cols, rows }) {
      const workspace = await readRecord(await place(), branch);
      if (!terminals) throw new WorkspaceRefused('no terminals here', 409);
      const can = await terminals.available();
      if (!can.available) throw new WorkspaceRefused(can.reason, 409);
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      if (openShells(branch).length >= MAX_SHELLS) {
        throw new WorkspaceRefused(
          `${MAX_SHELLS} shells are open in ${branch}: close one first`,
          409,
        );
      }
      let id: string;
      try {
        id = await terminals.open({
          command: shellOf(env),
          args: [],
          cwd: workspace.worktree,
          cols,
          rows,
          env,
          kept: true,
        });
      } catch (error) {
        if (error instanceof TerminalRefused) throw new WorkspaceRefused(error.message, 409);
        throw error;
      }
      // Numbered once it is open, with no wait between: two opened at once get two numbers.
      const open = openShells(branch);
      let number = 1;
      while (open.some((shell) => shell.number === number)) number += 1;
      shellsByBranch.set(
        branch,
        [...open, { id, number }].sort((a, b) => a.number - b.number),
      );
      return { id, number };
    },

    async shells(branch) {
      await readRecord(await place(), branch);
      return {
        shells: openShells(branch).map(({ id, number }) => {
          const running = terminals?.running(id);
          return { id, number, ...(running ? { running } : {}) };
        }),
      };
    },
  };
  return { openShells, ops };
}

export type WorkspaceOpen = ReturnType<typeof workspaceOpen>;
