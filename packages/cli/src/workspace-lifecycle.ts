// A workspace's life (V18): started with its branch, worktree and agent; its agent started again,
// stopped and sent a message; its prompt; cleaned up (V77).
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import {
  addWorktree,
  AGENT_KINDS,
  branchNameProblem,
  commitsBetween,
  deleteMergedBranch,
  isAncestor,
  isCommit,
  listRefs,
  PERMISSION_MODES,
  removeWorktree,
  uncommittedFiles,
  userEmail,
  WorktreeRefused,
  type RefList,
} from '@symbiote/core';
import { readPrompts } from './prompts.js';
import { firstRecord, hiveEvent, writeHive } from './hive-record.js';
import { codexState, serverState } from './codex.js';
import { AGENT_NAMES } from './agent-levels.js';
import { agentState, newestSession } from './claude-code.js';
import { pauseEvent } from './hive-pacing.js';
import { MAX_BRIEF } from './workspace-brief.js';
import { onServer } from './workspace-codex.js';
import { documentsDir, placeDocuments, removeDocuments, uploadsOf } from './workspace-documents.js';
import {
  readRecord,
  startedAs,
  symbioteFolder,
  WorkspaceRefused,
  writeRecord,
  type WorkspaceFile,
} from './workspace-record.js';
import { startPoint, workOf, worktreeFolder } from './workspace-start.js';
import { prepareSymbioteFolder, type ReviewPlace } from './reviews.js';
import { appendSent, readThreadEnd, real } from './thread.js';
import type { WorkspacesContext, Workspaces } from './workspace-context.js';
import type { WorkspaceTrunk } from './workspace-trunk.js';
import type { WorkspaceAgent } from './workspace-agent.js';
import type { WorkspaceSummaries } from './workspace-summary.js';
import type { WorkspaceOpen } from './workspace-open.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A workspace started, its agent driven, and cleaned up. */
export function workspaceLifecycle(
  {
    claude,
    codex,
    config,
    hiveOn,
    hivePacing,
    mainRoot,
    now,
    place,
    repo,
    root,
    shellsByBranch,
    stopWaitMs,
    terminals,
    uploads,
    viaCodex,
  }: Pick<
    WorkspacesContext,
    | 'claude'
    | 'codex'
    | 'config'
    | 'hiveOn'
    | 'hivePacing'
    | 'mainRoot'
    | 'now'
    | 'place'
    | 'repo'
    | 'root'
    | 'shellsByBranch'
    | 'stopWaitMs'
    | 'terminals'
    | 'uploads'
    | 'viaCodex'
  >,
  {
    trunkOf,
    agentOf,
    defaultAgent,
    effortFor,
    found,
    launch,
    modelFor,
    processEnded,
    promptOf,
    settingsFile,
    summary,
    openShells,
  }: Pick<WorkspaceTrunk, 'trunkOf'> &
    Pick<
      WorkspaceAgent,
      | 'agentOf'
      | 'defaultAgent'
      | 'effortFor'
      | 'found'
      | 'launch'
      | 'modelFor'
      | 'processEnded'
      | 'promptOf'
      | 'settingsFile'
    > &
    Pick<WorkspaceSummaries, 'summary'> &
    Pick<WorkspaceOpen, 'openShells'>,
) {
  async function started(where: ReviewPlace, workspace: WorkspaceFile, prompt: string) {
    const refs = await listRefs(repo);
    const agent = workspace.agent?.kind === 'claude' ? await claude() : null;
    const sessions = agent ? await agent.sessions() : [];
    return {
      workspace: await summary(where, workspace, refs, await trunkOf(refs), sessions),
      prompt,
    };
  }

  /** Whether a workspace's commits are all in the default branch. */
  async function isMerged(workspace: WorkspaceFile, refs: RefList): Promise<boolean> {
    const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha;
    if (!tip || !(await isCommit(repo, workspace.base))) return false;
    if ((await commitsBetween(repo, workspace.base, tip, 1)).count === 0) return false;
    for (const end of await trunkOf(refs)) if (await isAncestor(repo, tip, end)) return true;
    return false;
  }

  const ops: Pick<
    Workspaces,
    'start' | 'startAgent' | 'stopAgent' | 'reply' | 'noteSent' | 'prompt' | 'clean'
  > = {
    async start(request) {
      const work = workOf(request);
      if (request.agent !== undefined && !AGENT_KINDS.includes(request.agent)) {
        throw new WorkspaceRefused(`unknown agent: ${String(request.agent)}`, 400);
      }
      // Hive drives Claude Code only (HV2, decision 658): every start while it is on is Hive's.
      const hiving = await hiveOn();
      if (hiving && request.agent !== undefined && request.agent !== 'claude') {
        throw new WorkspaceRefused(
          'Hive drives Claude Code only: pick Claude Code, or turn Hive off',
          409,
        );
      }
      const asked = request.permissionMode ?? config().permissionMode;
      if (!PERMISSION_MODES.includes(asked)) {
        throw new WorkspaceRefused(`unknown permission mode: ${String(asked)}`, 400);
      }
      // A Hive writer runs in Claude Code's auto mode (HV4, decision 773): no permission waits.
      const permissionMode = hiving ? 'auto' : asked;
      const agent = hiving
        ? await found('claude')
        : request.agent
          ? await found(request.agent)
          : await defaultAgent();
      if (hiving && !agent) {
        throw new WorkspaceRefused(
          'Hive drives Claude Code, which is not installed: claude on PATH, or set SYMBIOTE_CLAUDE',
          409,
        );
      }
      if (request.agent && !agent) {
        throw new WorkspaceRefused(`${AGENT_NAMES[request.agent]} is not installed`, 409);
      }
      if (agent?.kind === 'codex' && request.permissionMode !== undefined) {
        throw new WorkspaceRefused(
          "a permission mode is Claude Code's: Codex runs in its sandbox",
          400,
        );
      }
      const model = await modelFor(agent, request.model);
      const effort = await effortFor(agent, request.effort, model);
      const documents = await uploadsOf(uploads, request.documents);
      const refs = await listRefs(repo);
      const problem = await branchNameProblem(repo, request.branch, refs);
      if (problem) {
        const taken =
          refs.branches.some((b) => b.name === request.branch) ||
          refs.remotes.some((r) => r.branch === request.branch);
        throw new WorkspaceRefused(problem, taken ? 409 : 400);
      }
      const base = await startPoint(repo, refs, request);
      const where = await place();
      const folder = worktreeFolder(mainRoot(where), request.branch, config().worktrees);
      if (existsSync(folder)) throw new WorkspaceRefused(`${folder} exists`, 409);
      const papers = documentsDir(where, request.branch);
      if (documents.length > 0 && (await readdir(papers).catch(() => [])).length > 0) {
        throw new WorkspaceRefused(
          `${papers} holds files of an earlier workspace: move or remove them first`,
          409,
        );
      }
      try {
        await addWorktree(repo, { folder, branch: request.branch, base: base.sha });
      } catch (error) {
        if (error instanceof WorktreeRefused) throw new WorkspaceRefused(error.message, 409);
        throw error;
      }
      const by = await userEmail(repo);
      const workspace: WorkspaceFile = {
        agent: null,
        base: base.sha,
        branch: request.branch,
        ...work,
        ...(by ? { by } : {}),
        created: now().toISOString(),
        ...(base.from ? { from: base.from } : {}),
        planFirst: request.planFirst,
        ...(request.via ? { via: request.via } : {}),
        ...(hiving ? { hive: true as const } : {}),
        worktree: folder,
      };
      await prepareSymbioteFolder(where, { text: readPrompts(root).text.reviews });
      // HV5: a Hive writer starts through Hive's gate; held, Hive's runner starts it later.
      const pause = hiving ? await hivePacing?.usage() : null;
      // Hive's record before its writer starts (decision 652): its first turn from now on.
      if (hiving) {
        const first = firstRecord(workspace.branch, workspace.created);
        await writeHive(where, pause ? { ...first, paused: pause, unstarted: true } : first);
        await hiveEvent(where, workspace.branch, workspace.created, 'started');
        if (pause) {
          await hiveEvent(where, workspace.branch, workspace.created, 'paused', pauseEvent(pause));
        }
      }
      // After the folder's .gitignore: the documents are never seen by git (V40).
      if (documents.length > 0) workspace.documents = await placeDocuments(papers, documents);
      if (pause) {
        // Claude Code in auto at the model and level asked, not started (`startAgent` starts it).
        workspace.agent = { kind: 'claude', permissionMode, ...startedAs({ effort, model }) };
        await writeRecord(where, workspace);
        return started(where, workspace, await promptOf(where, workspace));
      }
      const prompt = await launch(where, workspace, agent, permissionMode, { effort, model });
      return started(where, workspace, prompt);
    },

    async startAgent(branch) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      // The agent it was started with; a workspace made without one gets the default.
      const kind = workspace.agent?.kind;
      const agent = kind ? await found(kind) : await defaultAgent();
      if (!agent) {
        throw new WorkspaceRefused(
          kind
            ? `No agent to start: ${AGENT_NAMES[kind]} is not installed`
            : 'No agent to start: install Claude Code (claude on PATH, or SYMBIOTE_CLAUDE) or Codex (codex on PATH, or SYMBIOTE_CODEX)',
          409,
        );
      }
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      const mode = workspace.agent?.permissionMode ?? config().permissionMode;
      // The level and the model it was started on: the person chose them for this work (V30b, V47).
      const prompt = await launch(where, workspace, agent, mode, startedAs(workspace.agent ?? {}));
      return started(where, workspace, prompt);
    },

    async prompt(branch) {
      const where = await place();
      return promptOf(where, await readRecord(where, branch));
    },

    async stopAgent(branch) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      if (onServer(workspace)) {
        const server = await viaCodex.serverOf();
        const { read } = await viaCodex.readServer(workspace, { turns: 1, items: 'summary' });
        const live = serverState(workspace, read, 0, null).state;
        if (!server || !['working', 'needs-you'].includes(live)) {
          throw new WorkspaceRefused('its agent is not running', 409);
        }
        try {
          await server.interrupt(workspace.agent?.thread ?? '');
        } catch (error) {
          throw new WorkspaceRefused(`Codex's app server: ${(error as Error).message}`, 502);
        }
        return started(where, workspace, await promptOf(where, workspace));
      }
      if (workspace.agent?.kind === 'codex') {
        const agent = await codex();
        const thread = await readThreadEnd(symbioteFolder(where), branch);
        const live = codexState(workspace, thread, await viaCodex.alive(workspace), 0);
        if (!agent || live.state !== 'working') {
          throw new WorkspaceRefused('its agent is not running', 409);
        }
        await viaCodex.stopRun(where, workspace, agent);
        return started(where, workspace, await promptOf(where, workspace));
      }
      const agent = workspace.agent ? await claude() : null;
      const sessions = agent ? await agent.sessions() : null;
      const live = agentState(workspace, sessions, 0, real);
      if (!agent || !live.id || !['working', 'needs-you'].includes(live.state)) {
        throw new WorkspaceRefused('its agent is not running', 409);
      }
      const stopped = await agent.stop(live.id);
      if (!stopped.ok) throw new WorkspaceRefused(stopped.error, 409);
      return started(where, workspace, await promptOf(where, workspace));
    },

    async reply({ branch, text, stop, by, key }) {
      if (text.trim() === '') throw new WorkspaceRefused('a message cannot be empty', 400);
      if (text.length > MAX_BRIEF) {
        throw new WorkspaceRefused('a message is at most 20,000 characters', 400);
      }
      const where = await place();
      const workspace = await readRecord(where, branch);
      /** Symbiote's own message noted before it goes (AR2, decision 741): its prompt reads as
       * the sender's. A note whose send then fails matches nothing. */
      const note = (session: string) =>
        by
          ? appendSent(symbioteFolder(where), branch, {
              at: new Date().toISOString(),
              session,
              by,
              ...(key ? { key } : {}),
              text,
            })
          : Promise.resolve();
      if (workspace.agent?.kind === 'codex') {
        await note('');
        await viaCodex.reply(where, workspace, text, stop === true);
        const refs = await listRefs(repo);
        return { workspace: await summary(where, workspace, refs, await trunkOf(refs), []) };
      }
      const agent = await agentOf(workspace);
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      // A session that wakes reads its settings file again, and does not start without it.
      if (workspace.agent?.hooks) await settingsFile(where);
      const session = newestSession(workspace, await agent.sessions(), real);
      if (!session?.sessionId || !session.id) {
        throw new WorkspaceRefused(
          'its agent has no session to continue: start the agent again',
          409,
        );
      }
      // A live process is stopped first: a resume of a running session makes a copy.
      const alive = session.status !== undefined;
      const midTurn = alive && (session.status !== 'idle' || session.waitingFor !== undefined);
      if (midTurn && !stop) {
        const doing = session.waitingFor ? `waiting on a ${session.waitingFor}` : 'working';
        throw new WorkspaceRefused(`its agent is ${doing}: sending stops its turn`, 409);
      }
      if (alive) {
        const stopped = await agent.stop(session.id);
        if (!stopped.ok) throw new WorkspaceRefused(stopped.error, 409);
        // Its process ends a moment after `claude stop` answers, and a resume before that starts a
        // copy without the hooks (decision 720; the honeycomb workspace's 337836a3).
        if (!(await processEnded(agent, session.id))) {
          throw new WorkspaceRefused(
            `its agent did not stop within ${Math.round(stopWaitMs / 1000)} s: try again`,
            409,
          );
        }
      }
      await note(session.sessionId);
      const resumed = await agent.resume({
        sessionId: session.sessionId,
        cwd: workspace.worktree,
        text,
      });
      if (!resumed.ok) throw new WorkspaceRefused(resumed.error, 502);
      const refs = await listRefs(repo);
      const sessions = await agent.sessions();
      const newest = newestSession(workspace, sessions, real);
      const copy = newest && newest.sessionId !== session.sessionId ? newest.id : undefined;
      return {
        workspace: await summary(where, workspace, refs, await trunkOf(refs), sessions),
        ...(copy ? { copy } : {}),
      };
    },

    async noteSent({ branch, by, text }) {
      const where = await place();
      await readRecord(where, branch);
      // The session is not asked for: a note is matched by its text, whichever session takes it.
      await appendSent(symbioteFolder(where), branch, {
        at: new Date().toISOString(),
        session: '',
        by,
        text,
      });
    },

    async clean({ branch, unmerged }) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      const refs = await listRefs(repo);
      const merged = await isMerged(workspace, refs);
      const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha;
      if (!merged && !unmerged) {
        throw new WorkspaceRefused(
          `${branch} is not merged into the default branch: clean up anyway to remove its worktree and keep the branch`,
          409,
        );
      }
      const exists = existsSync(workspace.worktree);
      const changed = exists ? await uncommittedFiles(workspace.worktree) : 0;
      if (changed > 0) {
        throw new WorkspaceRefused(
          `${plural(changed, 'file')} not committed in ${workspace.worktree}: commit or remove ${changed === 1 ? 'it' : 'them'} first`,
          409,
        );
      }
      const agent = workspace.agent?.kind === 'claude' ? await claude() : null;
      const codexAgent = workspace.agent?.kind === 'codex' ? await codex() : null;
      if (codexAgent) {
        await viaCodex.archive(where, workspace, codexAgent);
      }
      if (agent) {
        const folder = real(workspace.worktree);
        for (const session of (await agent.sessions()) ?? []) {
          if (real(session.cwd) !== folder || !session.id) continue;
          if (session.status !== undefined) await agent.stop(session.id);
          const removed = await agent.remove(session.id);
          if (!removed.ok) throw new WorkspaceRefused(removed.error, 409);
        }
      }
      // Its shells run in the worktree that goes (V45).
      for (const shell of openShells(branch)) terminals?.close(shell.id);
      shellsByBranch.delete(branch);
      try {
        if (exists) await removeWorktree(repo, workspace.worktree);
        if (merged) await deleteMergedBranch(repo, workspace.branch);
      } catch (error) {
        if (error instanceof WorktreeRefused) throw new WorkspaceRefused(error.message, 409);
        throw error;
      }
      // Its documents go with its worktree; the record keeps their names (V40).
      if (workspace.documents) await removeDocuments(where, workspace.branch);
      workspace.finished = now().toISOString();
      // Where its branch ended (V77, decision 566): History reads it once the branch is gone.
      if (tip) workspace.tip = tip;
      if (merged) workspace.merged = true;
      await writeRecord(where, workspace);
      return { finished: workspace.finished };
    },
  };
  return { ops };
}
