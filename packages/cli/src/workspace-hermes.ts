// Hermes as a workspace's agent (V58): run in a kept terminal of `symbiote view` in its worktree
// (decision 415), continued with `--resume`, stopped by hanging it up; its session read through
// Hermes's own CLI (decision 416). The service (`workspaces.ts`) reads its state, thread and tools
// through `read` and `state`.
import { existsSync } from 'node:fs';
import type { WorkspaceAgentState, WorkspaceTerminalOpened } from '@symbiote/core';
import { hermesArgs, hermesState, type Hermes, type HermesSession } from './hermes.js';
import { TerminalRefused, type Terminals } from './terminal.js';
import { real } from './thread.js';
import {
  WorkspaceRefused,
  type StartedAs,
  type WorkspaceAgentRecord,
  type WorkspaceFile,
} from './workspace-record.js';

/** The size Hermes starts at, before a page fits it to its box. */
const START_SIZE = { cols: 120, rows: 40 };

/**
 * How long before the record's start a session may begin and still be this start's: Hermes
 * stores it 0.5 s after (V58 spike); a session older than that is an earlier start's.
 */
const START_SLACK_S = 5;

/** Hermes on workspaces (V58): found with `hermes` when a call needs it. */
export function workspaceHermes({
  hermes,
  terminals,
  env,
  now,
}: {
  hermes: () => Promise<Hermes | null>;
  terminals: Terminals | undefined;
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
}) {
  /** Per branch: the terminal Symbiote ran Hermes in, and whether Stop hung it up. */
  const runs = new Map<string, { terminal: string; stopped?: true }>();
  /** Per branch: its session's ID once found, read by ID after that. */
  const sessions = new Map<string, string>();

  /** Whether Hermes runs in Symbiote's terminal for `branch`. */
  const running = (branch: string) => {
    const run = runs.get(branch);
    return run !== undefined && terminals?.running(run.terminal) !== undefined;
  };

  /** Symbiote's terminals, where Hermes runs; else why it cannot run here. */
  async function usable(): Promise<Terminals | string> {
    if (!terminals) return 'Hermes runs in a terminal in Symbiote, and there is none here';
    const can = await terminals.available();
    return can.available ? terminals : `Hermes runs in a terminal in Symbiote: ${can.reason}`;
  }

  /** Hangs up the Hermes Symbiote runs for `branch`, if it does; whether it did. */
  function hangUp(branch: string): boolean {
    const run = runs.get(branch);
    if (!run || !running(branch)) return false;
    terminals?.close(run.terminal);
    runs.set(branch, { ...run, stopped: true });
    return true;
  }

  /**
   * Starts Hermes on a workspace (decision 415): `hermes chat --query=<prompt>` in a kept terminal
   * in its worktree, an earlier Hermes of the branch hung up first. Not started, with why, where
   * terminals cannot run.
   */
  async function launch(
    workspace: WorkspaceFile,
    agent: Hermes,
    prompt: string,
    how: StartedAs,
  ): Promise<WorkspaceAgentRecord> {
    const these = await usable();
    if (typeof these === 'string') return { kind: 'hermes', error: these };
    hangUp(workspace.branch);
    sessions.delete(workspace.branch);
    try {
      const terminal = await these.open({
        command: agent.command,
        args: hermesArgs({ prompt, ...(how.effort ? { effort: how.effort } : {}) }),
        cwd: workspace.worktree,
        ...START_SIZE,
        env,
        kept: true,
      });
      runs.set(workspace.branch, { terminal });
      return { kind: 'hermes', started: now().toISOString() };
    } catch (error) {
      if (error instanceof TerminalRefused) return { kind: 'hermes', error: error.message };
      throw error;
    }
  }

  /**
   * The workspace's session (decision 416): the one found before while it is still current, else
   * the newest Hermes lists whose folder is the worktree and which began with this start (not an
   * earlier one's). Null when there is none yet; an Error when Hermes cannot be asked.
   */
  async function read(workspace: WorkspaceFile): Promise<HermesSession | null | Error> {
    const agent = await hermes();
    if (!agent) return new Error('Hermes is not installed (hermes on PATH, or SYMBIOTE_HERMES)');
    const { branch } = workspace;
    try {
      const known = sessions.get(branch);
      if (known) {
        const session = await agent.read(known);
        // Ended while Hermes runs: its `/new`, or a compression that went on in a new session.
        if (session && !(session.endedAt !== undefined && running(branch))) return session;
        sessions.delete(branch);
      }
      const folder = real(workspace.worktree);
      const started = workspace.agent?.started
        ? Date.parse(workspace.agent.started) / 1000 - START_SLACK_S
        : -Infinity;
      for (const id of await agent.sessions(workspace.worktree)) {
        const session = await agent.read(id);
        if (!session?.cwd || real(session.cwd) !== folder || session.startedAt < started) continue;
        sessions.set(branch, session.id);
        return session;
      }
      return null;
    } catch (error) {
      return error as Error;
    }
  }

  /** Its state from its session (decision 417), as `read` gave it. */
  function state(
    workspace: WorkspaceFile,
    session: HermesSession | null | Error,
    ahead: number,
  ): WorkspaceAgentState {
    const run = runs.get(workspace.branch);
    const live = running(workspace.branch);
    return hermesState(workspace, session, {
      running: live,
      ended: run !== undefined && !live && !run.stopped,
      ahead,
    });
  }

  /**
   * Its terminal: the Hermes that runs, fitted to the page; else its session continued in a kept
   * terminal (`hermes --resume`), at the level it was started at. A kept terminal: leaving the tab
   * does not hang Hermes up.
   */
  async function terminal(
    workspace: WorkspaceFile,
    cols: number,
    rows: number,
  ): Promise<WorkspaceTerminalOpened> {
    const these = await usable();
    if (typeof these === 'string') throw new WorkspaceRefused(these, 409);
    const run = runs.get(workspace.branch);
    if (run && running(workspace.branch)) {
      these.resize(run.terminal, cols, rows);
      return { id: run.terminal, kept: true };
    }
    if (!existsSync(workspace.worktree)) {
      throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
    }
    const agent = await hermes();
    if (!agent) {
      throw new WorkspaceRefused(
        'No agent to open: install Hermes (hermes on PATH), or set SYMBIOTE_HERMES',
        409,
      );
    }
    const session = await read(workspace);
    if (session instanceof Error) {
      throw new WorkspaceRefused(`Hermes could not read its session: ${session.message}`, 502);
    }
    if (!session) {
      throw new WorkspaceRefused('its agent has no session to open: start the agent again', 409);
    }
    const effort = workspace.agent?.effort;
    try {
      const id = await these.open({
        command: agent.command,
        args: hermesArgs({ session: session.id, ...(effort ? { effort } : {}) }),
        cwd: workspace.worktree,
        cols,
        rows,
        env,
        kept: true,
      });
      runs.set(workspace.branch, { terminal: id });
      return { id, kept: true };
    } catch (error) {
      if (error instanceof TerminalRefused) throw new WorkspaceRefused(error.message, 409);
      throw error;
    }
  }

  return {
    /** Whether Hermes can run here (in Symbiote's terminals). */
    available: async () => typeof (await usable()) !== 'string',
    launch,
    read,
    state,
    terminal,
    running,
    /** Stops it (decision 418): its terminal hung up; its session stays. Whether it ran. */
    stop: hangUp,
    /** Forgets a workspace cleaned up, its Hermes hung up (decision 420). */
    forget(branch: string) {
      hangUp(branch);
      runs.delete(branch);
      sessions.delete(branch);
    },
  };
}
