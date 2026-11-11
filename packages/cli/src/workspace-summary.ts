// What a workspace's card and tabs read (V18, V77): its summary in the list, its thread, its
// tools, its activity taken out; the finished workspaces of History.
import { existsSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';
import {
  commitsBetween,
  isAncestor,
  isCommit,
  listRefs,
  mainWorktree,
  uncommittedFiles,
  type AgentRunsOn,
  type WorkspaceActivity,
  type WorkspaceAgentState,
  type WorkspaceSummary,
  type WorkspaceThread,
  type ThreadEntry,
  type ActivityEntry,
  type RefList,
} from '@symbiote/core';
import { readPrompts } from './prompts.js';
import { hiveSummary, readHive, readHives } from './hive-record.js';
import { hiveLive } from './hive-live.js';
import { codexState, serverEntries, serverLastAction, serverState, serverTools } from './codex.js';
import { agentState, isBlocked, newestSession, type AgentSession } from './claude-code.js';
import type { CodexThread } from './app-server.js';
import { activityOf, serverActivity } from './workspace-activity.js';
import { codexRunsOn, transcriptOf, transcriptReader } from './workspace-running.js';
import { onServer } from './workspace-codex.js';
import { documentsDir } from './workspace-documents.js';
import {
  readRecord,
  readRecords,
  symbioteFolder,
  WorkspaceRefused,
  type WorkspaceFile,
} from './workspace-record.js';
import { readReview, reviewPath, verdictText, type ReviewPlace } from './reviews.js';
import {
  lastAction,
  readActivityEnd,
  readActivityWindow,
  readThread,
  readThreadEnd,
  THREAD_LIMIT,
  real,
  turnEnded,
} from './thread.js';
import { exportActivity } from './activity-export.js';
import { secretsOf } from './nucleus-record.js';
import {
  byFinished,
  eachLimited,
  finishedEntry,
  type FinishedRecord,
  type WorkspaceEnd,
} from './workspace-history.js';
import type { WorkspacesContext, Workspaces } from './workspace-context.js';
import type { WorkspaceTrunk } from './workspace-trunk.js';
import type { WorkspaceAgent } from './workspace-agent.js';

/**
 * Whether its agent's messages are kept: Claude Code's hooks record them (V18c), Symbiote's
 * runner records Codex's (V20a) or Codex's app server keeps them (V27a).
 */
const recordedThread = (workspace: WorkspaceFile) =>
  workspace.agent?.hooks === true || workspace.agent?.kind === 'codex';

/** Turns a thread panel reads from the server: about 200 entries' worth. */
const PANEL_TURNS = 50;

/**
 * How much of the recorded tools the Activity tab reads (V73): about 700 calls with their
 * commands and outputs' ends; the person's longest workspace had 350.
 */
const TIMELINE_TOOLS = 1024 * 1024;

/** The workspaces' summaries and reads. */
export function workspaceSummary(
  {
    claude,
    env,
    hiveOn,
    launches,
    now,
    place,
    repo,
    root,
    terminals,
    viaCodex,
  }: Pick<
    WorkspacesContext,
    | 'claude'
    | 'env'
    | 'hiveOn'
    | 'launches'
    | 'now'
    | 'place'
    | 'repo'
    | 'root'
    | 'terminals'
    | 'viaCodex'
  >,
  {
    changesBase,
    endedAt,
    hasCommit,
    mainOf,
    trunkOf,
    trunkSince,
    settingsFile,
  }: Pick<
    WorkspaceTrunk,
    'changesBase' | 'endedAt' | 'hasCommit' | 'mainOf' | 'trunkOf' | 'trunkSince'
  > &
    Pick<WorkspaceAgent, 'settingsFile'>,
  service: Pick<Workspaces, 'changes'>,
) {
  /** What Claude Code's transcripts say their agents run on (V83), read again when they grow. */
  const transcripts = transcriptReader();

  /** Its review's last verdict, with its text for the agent (V16's "Copy for the agent"). */
  async function verdictOf(
    where: ReviewPlace,
    branch: string,
  ): Promise<WorkspaceThread['verdict'] | undefined> {
    const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
    const verdict = review?.verdicts.at(-1);
    if (!review || !verdict) return undefined;
    const shown = (path: string) =>
      where.place === 'repository' ? relative(repo.root, path).split(sep).join('/') : path;
    return {
      at: verdict.at,
      event: verdict.event,
      head: verdict.head,
      text: verdictText(
        review,
        review.reviewer,
        verdict,
        {
          review: shown(reviewPath(where.dir, branch, where.reviewer)),
          agents: shown(where.agents),
        },
        readPrompts(root).text,
      ),
    };
  }

  /** Each workspace's commits as last counted, under a key of what they were counted from. */
  const commitsCounted = new Map<string, { key: string; ahead: number; merged: boolean }>();

  /** Every ref's tip in one string, once a list: any ref moved, every count is counted again. */
  const refsKeys = new WeakMap<RefList, string>();

  const refsKey = (refs: RefList) => {
    let key = refsKeys.get(refs);
    if (key === undefined) {
      key = [...refs.branches, ...refs.remotes].map((r) => `${r.name} ${r.sha}`).join('\n');
      refsKeys.set(refs, key);
    }
    return key;
  };

  async function summary(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    refs: RefList,
    trunk: string[],
    sessions: AgentSession[] | null,
    /** Where the read began (`launches.mark()`): a launch that ended after it may be half seen. */
    from?: number,
  ): Promise<WorkspaceSummary> {
    const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha ?? null;
    // Its commits, counted again only when what they are counted from moved (V94d): a hook's
    // write reads the list again, and ran 4–5 git commands a workspace for an unchanged answer.
    const key = JSON.stringify([
      workspace.base,
      workspace.from,
      workspace.against,
      tip,
      refsKey(refs),
    ]);
    let counted = commitsCounted.get(workspace.branch);
    if (counted?.key !== key) {
      let ahead = 0;
      let merged = false;
      if (tip && (await isCommit(repo, workspace.base))) {
        // From where its changes and Review start: main's commits taken in by a rebase or a merge
        // are not the workspace's.
        const { base } = await changesBase(workspace, refs, tip);
        ahead = (await commitsBetween(repo, base, tip, 1)).count;
        for (const end of trunk) {
          if (ahead > 0 && !merged) merged = await isAncestor(repo, tip, end);
        }
      }
      counted = { key, ahead, merged };
      commitsCounted.set(workspace.branch, counted);
    }
    const { ahead, merged } = counted;
    const exists = existsSync(workspace.worktree);
    const changed = exists ? await uncommittedFiles(workspace.worktree).catch(() => null) : null;
    let agent: WorkspaceAgentState;
    let acted: string | undefined;
    let activity: WorkspaceActivity | undefined;
    let runsOn: AgentRunsOn | null = null;
    if (onServer(workspace)) {
      // Its last two turns: the one that runs, and the answer before it.
      const { read, address } = await viaCodex.readServer(workspace, {
        turns: 2,
        items: 'summary',
      });
      agent = serverState(workspace, read, ahead, address);
      acted =
        (read instanceof Error ? undefined : serverLastAction(read)) ?? workspace.agent?.started;
      if (!(read instanceof Error)) {
        activity = serverActivity(await runningTurn(workspace, read), agent, workspace.worktree);
        runsOn = codexRunsOn(read);
      }
    } else {
      const thread = workspace.agent
        ? await readThreadEnd(symbioteFolder(where), workspace.branch)
        : [];
      // Idle with nothing named: its thread tells a finished turn from a question (V18c) or from
      // an Esc. Claude Code can list a reported turn `working` with its process idle until the
      // next turn ends (decision 810: chore/readme-remake, 819 s); its report is the evidence.
      const session = newestSession(workspace, sessions, real);
      const idle = session && (isBlocked(session) || session.status === 'idle');
      const ended = idle && !session.waitingFor ? turnEnded(thread) : false;
      acted = workspace.agent ? (lastAction(thread) ?? workspace.agent.started) : undefined;
      // What Claude Code's transcript says: what it runs on (V83), and an Esc it recorded (MC3).
      const transcript = workspace.agent?.kind === 'codex' ? undefined : transcriptOf(thread);
      const said = transcript ? await transcripts.read(transcript) : null;
      agent =
        workspace.agent?.kind === 'codex'
          ? codexState(workspace, thread, await viaCodex.alive(workspace), ahead)
          : agentState(workspace, sessions, ahead, real, ended, said?.interrupted ?? false);
      // Its record written, its session not listed yet: being started (fix/e2e-flakes).
      if (
        (agent.state === 'no-agent' || agent.state === 'not-running') &&
        launches.since(workspace.branch, from)
      ) {
        agent = { state: 'working', kind: 'claude' };
      }
      // Its tools (V48f), read only while it works and when they are recorded.
      const tools =
        agent.state === 'working' && workspace.agent?.activity
          ? await readActivityEnd(symbioteFolder(where), workspace.branch)
          : null;
      activity = activityOf(thread, agent, tools);
      // What it runs on (V83): Claude Code's newest answer, in the transcript its hooks named.
      if (said) runsOn = said.runsOn;
    }
    if (workspace.agent?.effort) agent = { ...agent, effort: workspace.agent.effort };
    if (workspace.agent?.model) agent = { ...agent, model: workspace.agent.model };
    if (runsOn) agent = { ...agent, runsOn };
    return {
      branch: workspace.branch,
      ...(workspace.kind ? { kind: workspace.kind } : {}),
      ...(workspace.title ? { title: workspace.title } : {}),
      base: workspace.base,
      ...(workspace.from ? { from: workspace.from } : {}),
      ...(workspace.against ? { against: workspace.against } : {}),
      created: workspace.created,
      planFirst: workspace.planFirst,
      brief: workspace.brief,
      worktree: { path: workspace.worktree, exists, ...(changed === null ? {} : { changed }) },
      tip,
      ahead,
      merged,
      agent,
      ...(workspace.documents
        ? {
            documents: {
              folder: documentsDir(where, workspace.branch),
              files: workspace.documents,
            },
          }
        : {}),
      ...(acted ? { lastAction: acted } : {}),
      ...(workspace.via ? { via: workspace.via } : {}),
      ...(activity ? { activity } : {}),
      ...(workspace.hive ? await hiveOf(where, workspace.branch) : {}),
    };
  }

  /** Where Hive is with a workspace it drives (HV2), as its card reads it; none without a record. */
  async function hiveOf(where: ReviewPlace, branch: string) {
    const record = await readHive(where, branch);
    if (!record) return {};
    const on = await hiveOn();
    // What runs now (decision 697), read only while Hive is on.
    const live = on ? await hiveLive(where, record, () => readHives(where)) : undefined;
    return { hive: hiveSummary(record, on, live) };
  }

  /**
   * A thread whose turn runs (V48): its last turn read again in full — what it runs and what it
   * said as it began to wait are items a `summary` read leaves out; as read, when not active or
   * when the second read fails.
   */
  async function runningTurn(workspace: WorkspaceFile, read: CodexThread): Promise<CodexThread> {
    const last = read.turns.at(-1);
    if (read.status !== 'active' || !last) return read;
    const { read: full } = await viaCodex.readServer(workspace, { turns: 1, items: 'full' });
    const turn = full instanceof Error ? undefined : full.turns.at(-1);
    return turn?.id === last.id ? { ...read, turns: [...read.turns.slice(0, -1), turn] } : read;
  }

  /** A workspace's record, which Clean up finished; 404 otherwise (V77). */
  async function finishedRecord(where: ReviewPlace, branch: string): Promise<FinishedRecord> {
    const workspace = await readRecord(where, branch);
    if (!workspace.finished) throw new WorkspaceRefused(`no finished workspace ${branch}`, 404);
    return workspace as FinishedRecord;
  }

  const ops: Pick<
    Workspaces,
    'list' | 'history' | 'finished' | 'summaryOf' | 'thread' | 'tools' | 'exportActivity'
  > = {
    async list() {
      const from = launches.mark();
      const where = await place();
      const list = (await readRecords(where)).filter((f) => !f.finished);
      const head = { place: where.place, ...(where.note ? { note: where.note } : {}) };
      if (list.length === 0) return { workspaces: [], ...head };
      // Agents may wake from agent view or `claude attach`: their settings file must be there.
      if (list.some((f) => f.agent?.hooks)) await settingsFile(where);
      const refs = await listRefs(repo);
      const trunk = await trunkOf(refs);
      const agent = list.some((f) => f.agent?.kind === 'claude') ? await claude() : null;
      const sessions = agent ? await agent.sessions() : null;
      const summaries: WorkspaceSummary[] = [];
      for (const workspace of list) {
        summaries.push(await summary(where, workspace, refs, trunk, sessions, from));
      }
      const terminal = await terminals?.available();
      return { workspaces: summaries, ...head, ...(terminal ? { terminal } : {}) };
    },

    async history() {
      const where = await place();
      const list = (await readRecords(where)).filter((w): w is FinishedRecord => !!w.finished);
      const head = { place: where.place, ...(where.note ? { note: where.note } : {}) };
      if (list.length === 0) return { workspaces: [], ...head };
      const refs = await listRefs(repo);
      const into = await mainOf(refs);
      // A workspace's commits are made after it started (a rebase's too): from a day before the
      // oldest, so a clock a little off is no matter.
      const oldest = Math.min(...list.map((w) => Date.parse(w.created) || Date.now()));
      const recent = await trunkSince(refs, new Date(oldest - 86_400_000).toISOString());
      const ended = await eachLimited(list, 8, (w) => endedAt(where, w, refs, into, recent));
      const rows = list.map((w, i) => finishedEntry(w, ended[i] as WorkspaceEnd));
      return { workspaces: rows.sort(byFinished), ...head };
    },

    async finished(branch) {
      const where = await place();
      const workspace = await finishedRecord(where, branch);
      const refs = await listRefs(repo);
      const ended = await endedAt(where, workspace, refs, await mainOf(refs));
      const tip = ended.end ?? null;
      let ahead = 0;
      if (tip && (await hasCommit(workspace.base))) {
        const { base } = await changesBase(workspace, refs, tip);
        ahead = (await commitsBetween(repo, base, tip, 1)).count;
      }
      const started = workspace.agent;
      const agent: WorkspaceAgentState = started
        ? {
            state: 'not-running',
            kind: started.kind,
            ...(started.effort ? { effort: started.effort } : {}),
            ...(started.model ? { model: started.model } : {}),
          }
        : { state: 'no-agent' };
      return {
        branch: workspace.branch,
        ...(workspace.kind ? { kind: workspace.kind } : {}),
        ...(workspace.title ? { title: workspace.title } : {}),
        base: workspace.base,
        ...(workspace.from ? { from: workspace.from } : {}),
        ...(workspace.against ? { against: workspace.against } : {}),
        created: workspace.created,
        planFirst: workspace.planFirst,
        brief: workspace.brief,
        // Clean up removed it: nothing is offered in it.
        worktree: { path: workspace.worktree, exists: false },
        tip,
        ahead,
        merged: ended.outcome === 'merged',
        agent,
        ...(workspace.documents
          ? {
              documents: {
                folder: documentsDir(where, workspace.branch),
                files: workspace.documents,
              },
            }
          : {}),
        ...(workspace.via ? { via: workspace.via } : {}),
        finished: workspace.finished,
      };
    },

    async thread(branch) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      // Finished (V77): what Symbiote kept, never its agent asked (decision 564).
      const kept = !workspace.finished || !onServer(workspace);
      let entries: ThreadEntry[];
      if (!kept) {
        entries = [];
      } else if (onServer(workspace)) {
        // From the server (decision 155); none when it cannot be read: the state says why.
        const { read } = await viaCodex.readServer(workspace, {
          turns: PANEL_TURNS,
          items: 'full',
        });
        entries =
          read instanceof Error
            ? []
            : serverEntries(read, { first: read.turns.length < PANEL_TURNS }).slice(-THREAD_LIMIT);
      } else {
        entries = await readThread(symbioteFolder(where), branch);
      }
      const verdict = await verdictOf(where, branch);
      return {
        entries,
        recorded: kept && recordedThread(workspace),
        ...(verdict ? { verdict } : {}),
      };
    },

    async tools(branch) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      // Finished (V77): the app server's are its own, and are not asked.
      if (workspace.finished && onServer(workspace)) return {};
      if (onServer(workspace)) {
        // Its turns read in full, as the thread's read reads them (V48c).
        const { read } = await viaCodex.readServer(workspace, {
          turns: PANEL_TURNS,
          items: 'full',
        });
        if (read instanceof Error) return {};
        return {
          tools: read.turns.flatMap((turn) => serverTools(turn, read.id, workspace.worktree)),
        };
      }
      if (!workspace.agent?.activity) return {};
      const { tools, cut } = await readActivityWindow(
        symbioteFolder(where),
        branch,
        TIMELINE_TOOLS,
      );
      return { tools, ...(cut ? { cut: true as const } : {}) };
    },

    async exportActivity(branch, format, { maxBytes } = {}) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      const missing: string[] = [];
      let entries: ThreadEntry[] = [];
      let tools: ActivityEntry[] = [];
      const store = onServer(workspace) ? "Codex's app server" : null;
      if (!workspace.agent) {
        missing.push('Its agent: none was started for it');
      } else if (workspace.finished && store) {
        // Finished (V77, decision 564): what Symbiote kept, never its agent asked.
        missing.push(
          `Its agent's messages and calls: ${store} kept them, and a finished workspace's agent is not asked`,
        );
      } else if (onServer(workspace)) {
        // Its newest turns in full, as its Activity tab reads them (V48c).
        const { read } = await viaCodex.readServer(workspace, {
          turns: PANEL_TURNS,
          items: 'full',
        });
        if (read instanceof Error) {
          missing.push(
            `Its agent's messages and calls: Codex's app server could not be read (${read.message})`,
          );
        } else {
          entries = serverEntries(read, { first: read.turns.length < PANEL_TURNS });
          tools = read.turns.flatMap((turn) => serverTools(turn, read.id, workspace.worktree));
          if (read.turns.length >= PANEL_TURNS) {
            missing.push(
              `Its turns before the newest ${String(PANEL_TURNS)}: Codex's app server is read for those`,
            );
          }
        }
      } else {
        // The whole thread and tools: its Activity tab reads only the newest of them.
        const folder = symbioteFolder(where);
        entries = await readThread(folder, branch, Number.POSITIVE_INFINITY);
        if (!recordedThread(workspace)) {
          missing.push("Its agent's messages: it started before Symbiote recorded them");
        }
        if (workspace.agent.activity) {
          tools = (await readActivityWindow(folder, branch, Number.MAX_SAFE_INTEGER)).tools;
        } else if (recordedThread(workspace)) {
          missing.push('Its calls: its agent started before Symbiote recorded them');
        }
      }
      const changes = await service.changes(branch);
      const { count, listed } = changes.commits;
      if (count > listed.length) {
        missing.push(
          `Its ${String(count - listed.length)} oldest commits: Symbiote lists the newest ${String(listed.length)}`,
        );
      }
      const verdict = await verdictOf(where, branch);
      return exportActivity(
        {
          of: 'workspace',
          repository: basename(mainWorktree(repo)),
          record: workspace,
          entries,
          tools,
          commits: listed,
          ...(verdict ? { verdict } : {}),
          missing,
        },
        format,
        { now: now(), secrets: secretsOf(env), ...(maxBytes ? { maxBytes } : {}) },
      );
    },

    async summaryOf(branch) {
      const from = launches.mark();
      const where = await place();
      const workspace = await readRecord(where, branch).catch(() => null);
      if (!workspace || workspace.finished) return null;
      const refs = await listRefs(repo);
      const agent = workspace.agent?.kind === 'claude' ? await claude() : null;
      const sessions = agent ? await agent.sessions() : null;
      return summary(where, workspace, refs, await trunkOf(refs), sessions, from);
    },
  };
  return { summary, ops };
}

export type WorkspaceSummaries = ReturnType<typeof workspaceSummary>;
