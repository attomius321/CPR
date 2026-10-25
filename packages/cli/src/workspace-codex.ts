// Codex as a workspace's agent (V20a, V27): started on its app server, else through Symbiote's
// runner; a message sent, a run stopped, its own terminal, its threads archived at Clean up. The
// service (`workspaces.ts`) reads its state and thread through `readServer` and `alive`.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { commitFolders, type WorkspaceTerminalOpened } from '@symbiote/core';
import {
  AppServerStartFailed,
  AppServerUnreachable,
  type CodexServer,
  type CodexThread,
} from './app-server.js';
import { asksTrust, codexState, processAlive, serverState, type Codex } from './codex.js';
import type { ReviewPlace } from './reviews.js';
import { TerminalRefused, type Terminals } from './terminal.js';
import {
  activityPath,
  appendThread,
  readThread,
  readThreadEnd,
  real,
  threadPath,
} from './thread.js';
import {
  startedAs,
  symbioteFolder,
  WorkspaceRefused,
  writeRecord,
  type StartedAs,
  type WorkspaceAgentRecord,
  type WorkspaceFile,
} from './workspace-record.js';

/** Whether a Codex workspace runs on the app server (V27a), not through Symbiote's runner. */
export const onServer = (workspace: WorkspaceFile) =>
  workspace.agent?.kind === 'codex' && workspace.agent.thread !== undefined;

/** Codex on workspaces: found with `codex` when a call needs it (V20a); `now` for its runs' times. */
export function workspaceCodex({
  codex,
  now,
  env,
}: {
  codex: () => Promise<Codex | null>;
  now: () => Date;
  env: Readonly<Record<string, string | undefined>>;
}) {
  /**
   * Starts Codex on a workspace: a thread on its app server (V27a), else `codex exec` through
   * Symbiote's runner, which records its thread (V20a); its sandbox may also write what a commit on
   * the branch writes (decision 130). Threads it had on the server are kept, for Clean up.
   */
  async function launch(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    agent: Codex,
    prompt: string,
    how: StartedAs,
  ): Promise<WorkspaceAgentRecord> {
    const level = startedAs(how);
    const earlier = [
      ...(workspace.agent?.threads ?? []),
      ...(workspace.agent?.thread ? [workspace.agent.thread] : []),
    ];
    const head = { kind: 'codex' as const, ...(earlier.length > 0 ? { threads: earlier } : {}) };
    // Not logged in, `exec` retries for about 25 s and fails with a 401 (V20a spike).
    if ((await agent.account()) === 'not logged in') {
      return { ...head, error: 'Codex is not logged in: run `codex login`, then start the agent.' };
    }
    const started = now().toISOString();
    const writable = await commitFolders(workspace.worktree, workspace.branch);
    const server = await agent.server();
    if (server) {
      try {
        const thread = await server.start({
          cwd: workspace.worktree,
          writable,
          name: workspace.branch,
          prompt,
          ...level,
        });
        return { ...head, started, thread };
      } catch (error) {
        // A server that cannot be reached: `exec`, as without one. One that answered: its words,
        // and the thread it made, if it did, kept for Clean up.
        if (!(error instanceof AppServerUnreachable)) {
          const made = error instanceof AppServerStartFailed ? [error.thread] : [];
          const threads = [...earlier, ...made];
          return {
            kind: 'codex',
            ...(threads.length > 0 ? { threads } : {}),
            error: `Codex's app server: ${(error as Error).message}`,
          };
        }
      }
    }
    const run = randomUUID();
    const result = await agent.start({
      cwd: workspace.worktree,
      thread: threadPath(symbioteFolder(where), workspace.branch),
      activity: activityPath(symbioteFolder(where), workspace.branch),
      run,
      writable,
      prompt,
      ...level,
    });
    return result.ok
      ? { ...head, started, run, pid: result.pid, activity: true }
      : { ...head, error: result.error };
  }

  /** Codex's app server, when Codex is installed and has one. */
  async function serverOf(): Promise<CodexServer | null> {
    const agent = await codex();
    return agent ? agent.server() : null;
  }

  /** A server workspace's thread, or why it cannot be read; and the server's address. */
  async function readServer(
    workspace: WorkspaceFile,
    view: Parameters<CodexServer['read']>[1],
  ): Promise<{ read: CodexThread | Error; address: string | null }> {
    const thread = workspace.agent?.thread ?? '';
    const agent = await codex();
    const server = agent ? await agent.server() : null;
    if (!server) {
      const why = agent
        ? 'none runs, and `codex app-server daemon start` started none'
        : 'Codex is not installed';
      return { read: new Error(why), address: null };
    }
    try {
      return { read: await server.read(thread, view), address: server.address };
    } catch (error) {
      return { read: error as Error, address: server.address };
    }
  }

  /**
   * Waits for a Codex run's first thread entry, 3 s at most, unless its runner is gone: a start or
   * a reply then answers with its thread's ID and the message in its thread, as Claude Code's
   * hooks have them before `--bg` returns (measured with a real Codex: 5.3 s to the page's next
   * read without it; its thread starts 150 ms after the run, V20a spike).
   */
  async function firstEntry(where: ReviewPlace, workspace: WorkspaceFile): Promise<void> {
    const run = workspace.agent?.run;
    if (!run) return;
    for (let waited = 0; waited < 3_000; waited += 50) {
      const entries = await readThreadEnd(symbioteFolder(where), workspace.branch);
      if (entries.some((e) => e.run === run) || !(await alive(workspace))) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Whether a Codex workspace's last run still runs (its runner's process). */
  async function alive(workspace: WorkspaceFile): Promise<boolean> {
    const pid = workspace.agent?.pid;
    if (!pid) return false;
    return (await codex())?.alive(pid) ?? processAlive(pid);
  }

  /** Stops a Codex workspace's run; ends it in the thread when its runner could not. */
  async function stopRun(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    agent: Codex,
  ): Promise<void> {
    if (workspace.agent?.pid) await agent.stop(workspace.agent.pid);
    const run = workspace.agent?.run;
    const entries = await readThreadEnd(symbioteFolder(where), workspace.branch);
    if (entries.some((e) => e.run === run && e.kind === 'end')) return;
    const session = entries.findLast((e) => e.kind === 'start')?.session ?? '';
    await appendThread(symbioteFolder(where), workspace.branch, {
      at: now().toISOString(),
      session,
      ...(run ? { run } : {}),
      kind: 'end',
      reason: 'stopped',
    });
  }

  /**
   * A message to Codex (V20a): its thread continued with the text (`exec resume`), its sandbox as
   * at the start; a run that lives is stopped first, only when asked (it loses its turn).
   */
  async function reply(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    text: string,
    stop: boolean,
  ): Promise<void> {
    const agent = await codex();
    if (!agent) {
      throw new WorkspaceRefused(
        'No agent to talk to: install Codex (codex on PATH), or set SYMBIOTE_CODEX',
        409,
      );
    }
    if (!existsSync(workspace.worktree)) {
      throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
    }
    if (onServer(workspace)) return replyOnServer(where, workspace, text, stop);
    const thread = await readThreadEnd(symbioteFolder(where), workspace.branch);
    const state = codexState(workspace, thread, await alive(workspace), 0);
    if (!state.id) {
      throw new WorkspaceRefused(
        'its agent has no session to continue: start the agent again',
        409,
      );
    }
    if (state.state === 'working') {
      if (!stop) throw new WorkspaceRefused('its agent is working: sending stops its turn', 409);
      await stopRun(where, workspace, agent);
    }
    const run = randomUUID();
    const startedAt = now().toISOString();
    const level = startedAs(workspace.agent ?? {});
    const resumed = await agent.resume({
      cwd: workspace.worktree,
      thread: threadPath(symbioteFolder(where), workspace.branch),
      activity: activityPath(symbioteFolder(where), workspace.branch),
      run,
      writable: await commitFolders(workspace.worktree, workspace.branch),
      sessionId: state.id,
      text,
      // Given again: `exec resume` keeps none of the start's options (V30 spike).
      ...level,
    });
    if (!resumed.ok) throw new WorkspaceRefused(resumed.error, 502);
    workspace.agent = {
      kind: 'codex',
      ...level,
      started: startedAt,
      run,
      pid: resumed.pid,
      activity: true,
    };
    await writeRecord(where, workspace);
    await firstEntry(where, workspace);
  }

  /**
   * A message to Codex on its app server (V27a): a new turn, or joined to the one that runs (no
   * stop, no lost turn); a turn that waits on the person is interrupted first, only when asked.
   */
  async function replyOnServer(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    text: string,
    stop: boolean,
  ): Promise<void> {
    const thread = workspace.agent?.thread ?? '';
    const server = await serverOf();
    const { read } = await readServer(workspace, { turns: 1, items: 'summary' });
    if (!server || read instanceof Error) {
      throw new WorkspaceRefused(`Codex's app server: ${(read as Error).message}`, 502);
    }
    const state = serverState(workspace, read, 0, server.address);
    if (state.state === 'needs-you' && !stop) {
      const what = state.waitingFor ?? 'you';
      throw new WorkspaceRefused(
        `its agent is waiting on ${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what}: sending stops its turn`,
        409,
      );
    }
    try {
      if (state.state === 'needs-you') await server.interrupt(thread);
      await server.send({ thread, text });
    } catch (error) {
      throw new WorkspaceRefused(`Codex's app server: ${(error as Error).message}`, 502);
    }
  }

  /**
   * Codex's own terminal on a workspace's thread (V27b): its TUI joined to the app server, in the
   * worktree. Codex asks to trust each worktree the first time and saves the answer in the
   * person's configuration: said when it will ask (decision 160), never answered by Symbiote.
   */
  async function terminal(
    workspace: WorkspaceFile,
    terminals: Terminals,
    cols: number,
    rows: number,
  ): Promise<WorkspaceTerminalOpened> {
    const agent = await codex();
    const server = agent ? await agent.server() : null;
    if (!agent || !server) {
      throw new WorkspaceRefused(
        agent ? "Codex's app server cannot be started" : 'Codex is not installed',
        409,
      );
    }
    if (!existsSync(workspace.worktree)) {
      throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
    }
    const asks = await server.trust(workspace.worktree).then(
      (entries) => asksTrust(entries, [workspace.worktree, real(workspace.worktree)]),
      // Unknown: nothing said rather than something wrong.
      () => false,
    );
    try {
      const id = await terminals.open({
        command: agent.command,
        args: [
          'resume',
          workspace.agent?.thread ?? '',
          '--remote',
          server.address,
          '-C',
          workspace.worktree,
        ],
        cwd: workspace.worktree,
        cols,
        rows,
        env,
      });
      return { id, ...(asks ? { trusted: false as const } : {}) };
    } catch (error) {
      if (error instanceof TerminalRefused) throw new WorkspaceRefused(error.message, 409);
      throw error;
    }
  }

  /**
   * At Clean up (V18c): a live run stopped, its threads archived on the app server (V27a), else by
   * `codex archive`, and every thread its runner recorded.
   */
  async function archive(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    codexAgent: Codex,
  ): Promise<void> {
    if (await alive(workspace)) await stopRun(where, workspace, codexAgent);
    const { thread: current, threads: earlier = [] } = workspace.agent ?? {};
    if (current || earlier.length > 0) {
      // On the app server (V27a): its turn stopped, its threads archived there, else by
      // `codex archive` (the server unreachable).
      const server = await codexAgent.server();
      if (server && current) await server.interrupt(current).catch(() => false);
      for (const each of current ? [...earlier, current] : earlier) {
        const archived = server
          ? await server.archive(each).then(
              () => true,
              () => false,
            )
          : false;
        if (!archived) await codexAgent.archive(each).catch(() => undefined);
      }
    }
    // Out of Codex's lists, not deleted (decision 134): an archived one fails the same way.
    const entries = await readThread(symbioteFolder(where), workspace.branch, Infinity);
    const threads = new Set(entries.filter((e) => e.kind === 'start').map((e) => e.session));
    for (const thread of threads) {
      if (thread !== '') await codexAgent.archive(thread).catch(() => undefined);
    }
  }

  return { launch, serverOf, readServer, alive, firstEntry, stopRun, reply, terminal, archive };
}
