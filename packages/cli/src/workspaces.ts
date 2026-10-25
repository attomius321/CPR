import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addWorktree,
  AGENT_KINDS,
  branchNameProblem,
  checkMerge,
  commitsBetween,
  defaultBranch,
  deleteMergedBranch,
  fileChangedSince,
  forkPoint,
  isAncestor,
  isCommit,
  listRefs,
  EFFORT_LEVEL,
  MODEL_ID,
  PERMISSION_MODES,
  removeWorktree,
  resolveCommit,
  uncommittedFiles,
  userEmail,
  WorktreeRefused,
  WORK_KINDS,
  type AgentEfforts,
  type AgentKind,
  type AgentModels,
  type AgentOption,
  type BranchMerge,
  type CheckGuess,
  type ActivityEntry,
  type WorkspaceActivity,
  type WorkspaceAgentState,
  type WorkspaceChanges,
  type WorkspaceDocument,
  type WorkspaceList,
  type WorkspaceOptions,
  type WorkspaceReplied,
  type WorkspaceReply,
  type WorkspaceRequest,
  type WorkspaceShell,
  type WorkspaceShells,
  type WorkspaceStart,
  type WorkspaceSummary,
  type WorkspaceTerminalOpened,
  type WorkspaceTerminalRequest,
  type WorkspaceThread,
  type ThreadEntry,
  type GitRepo,
  type PermissionMode,
  type RefList,
  type WorkKind,
} from '@symbiote/core';
import { guessCheck, treeAt } from './check.js';
import { readPrompts } from './prompts.js';
import {
  codexState,
  serverEntries,
  serverLastAction,
  serverState,
  serverTools,
  type Codex,
} from './codex.js';
import type { FolderAt, OpenFolder } from './editor.js';
import {
  AGENT_NAMES,
  effortOnProblem,
  effortWordProblem,
  levelsOn,
  modelProblem,
  modelWordProblem,
} from './agent-levels.js';
import {
  agentSettings,
  agentState,
  isBlocked,
  newestSession,
  type AgentSession,
  type ClaudeCode,
} from './claude-code.js';
import type { CodexThread } from './app-server.js';
import { activityOf, serverActivity } from './workspace-activity.js';
import { MAX_BRIEF, workKinds } from './workspace-brief.js';
import { onServer, workspaceCodex } from './workspace-codex.js';
import {
  emptyFile,
  isFile,
  keptFile,
  readBranchChanges,
  worktreeChanges,
} from './workspace-changes.js';
import {
  documentsDir,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS,
  MAX_DOCUMENTS_BYTES,
  placeDocuments,
  removeDocuments,
  saveUpload,
  uploadsOf,
} from './workspace-documents.js';
import {
  readRecord,
  readRecords,
  startedAs,
  workspacePath,
  symbioteFolder,
  workspacesDir,
  WorkspaceRefused,
  writeRecord,
  type StartedAs,
  type WorkspaceFile,
} from './workspace-record.js';
import {
  FULL_SHA,
  startBranches,
  startPoint,
  workOf,
  workspaceBase,
  workspacePrompt,
  worktreeFolder,
} from './workspace-start.js';
import { shellOf, TerminalRefused, type Terminals } from './terminal.js';
import { CONFIG_FILES } from './plugins.js';
import {
  prepareSymbioteFolder,
  readReview,
  reviewPath,
  reviewPlace,
  verdictText,
  type ReviewPlace,
} from './reviews.js';
import {
  lastAction,
  readActivityEnd,
  readThread,
  readThreadEnd,
  THREAD_LIMIT,
  real,
  turnEnded,
  workspacesFolder,
} from './thread.js';

/** What `symbiote/config.json` says of workspaces and their agent; anything unknown is ignored. */
export interface WorkspaceConfig {
  branchPrefixes: Record<WorkKind, string>;
  worktrees?: string;
  /** The agent offered first (`agent.kind`, V20a). */
  agent?: AgentKind;
  /** Claude Code's permission mode and model. */
  permissionMode: PermissionMode;
  model?: string;
  /** Scout's and Scribe's levels (`scout.effort`, `scribe.effort`): words; absent, the agent's. */
  scoutEffort?: string;
  scribeEffort?: string;
  /** Scout's and Scribe's models (`scout.model`, `scribe.model`, V47): IDs; absent, the default. */
  scoutModel?: string;
  scribeModel?: string;
}

/**
 * `features.branchPrefixes` sets a kind's prefix (V24), each kind its own by default (`fix/`);
 * `features.branchPrefix`, from before V24, sets the Feature's unless `branchPrefixes` does.
 * `agent.kind` names the agent offered first (V20a); `agent.permissionMode` and `agent.model`
 * are Claude Code's. `scout.effort` and `scribe.effort` are the levels Scout's and Scribe's
 * conversations start at; `scout.model` and `scribe.model` the models they start on (V47).
 */
export function readWorkspaceConfig(root: string): WorkspaceConfig {
  const branchPrefixes = Object.fromEntries(WORK_KINDS.map((k) => [k, `${k}/`])) as Record<
    WorkKind,
    string
  >;
  const config: WorkspaceConfig = { branchPrefixes, permissionMode: 'default' };
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return config;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return config;
  }
  type Section = { branchPrefix?: unknown; branchPrefixes?: unknown; worktrees?: unknown };
  const v = (value && typeof value === 'object' ? value : {}) as {
    workspaces?: Section;
    /** The section's name before V25, still read when `workspaces` is not there. */
    features?: Section;
    agent?: unknown;
    scout?: { effort?: unknown; model?: unknown } | null;
    scribe?: { effort?: unknown; model?: unknown } | null;
  };
  const section = v.workspaces ?? v.features;
  if (typeof section?.branchPrefix === 'string') {
    branchPrefixes.feature = section.branchPrefix;
  }
  const prefixes = section?.branchPrefixes;
  if (prefixes && typeof prefixes === 'object') {
    for (const kind of WORK_KINDS) {
      const prefix = (prefixes as Record<string, unknown>)[kind];
      if (typeof prefix === 'string') branchPrefixes[kind] = prefix;
    }
  }
  if (typeof section?.worktrees === 'string' && section.worktrees !== '') {
    config.worktrees = section.worktrees;
  }
  const agent = (v.agent && typeof v.agent === 'object' ? v.agent : {}) as {
    kind?: unknown;
    permissionMode?: unknown;
    model?: unknown;
  };
  const kind = AGENT_KINDS.find((k) => k === agent.kind);
  if (kind) config.agent = kind;
  const mode = PERMISSION_MODES.find((m) => m === agent.permissionMode);
  if (mode) config.permissionMode = mode;
  if (typeof agent.model === 'string' && agent.model !== '') config.model = agent.model;
  const level = (value: unknown) =>
    typeof value === 'string' && EFFORT_LEVEL.test(value) ? value : undefined;
  const scoutEffort = level(v.scout?.effort);
  if (scoutEffort) config.scoutEffort = scoutEffort;
  const scribeEffort = level(v.scribe?.effort);
  if (scribeEffort) config.scribeEffort = scribeEffort;
  const id = (value: unknown) =>
    typeof value === 'string' && MODEL_ID.test(value) ? value : undefined;
  const scoutModel = id(v.scout?.model);
  if (scoutModel) config.scoutModel = scoutModel;
  const scribeModel = id(v.scribe?.model);
  if (scribeModel) config.scribeModel = scribeModel;
  return config;
}

/** An agent found for a workspace: Claude Code or Codex (V20a). */
type FoundAgent = { kind: 'claude'; claude: ClaudeCode } | { kind: 'codex'; codex: Codex };

/** The levels `agent` takes (V30b); null when Symbiote cannot read them. */
async function effortsOf(agent: FoundAgent): Promise<AgentEfforts | null> {
  if (agent.kind === 'codex') return agent.codex.efforts();
  const levels = await agent.claude.efforts();
  return levels ? { levels } : null;
}

/** The models `agent` lists (V47); null when Symbiote cannot read them. */
async function modelsOf(agent: FoundAgent): Promise<AgentModels | null> {
  if (agent.kind === 'codex') return agent.codex.models();
  const models = await agent.claude.models();
  return models ? { models } : null;
}

/** What the server needs of workspaces. */
export interface Workspaces {
  options(): Promise<WorkspaceOptions>;
  list(): Promise<WorkspaceList>;
  /** Makes the branch, its worktree and record, then starts the agent. Rejects with
   * `FeatureRefused`. */
  start(request: WorkspaceRequest): Promise<WorkspaceStart>;
  /** Starts a workspace's agent again (after a failed start, or once it ended). */
  startAgent(branch: string): Promise<WorkspaceStart>;
  /** The prompt its agent was given, to copy. */
  prompt(branch: string): Promise<string>;
  /**
   * The check command guessed from the root files of the commit a workspace would start from
   * (V24b), for the start page's Done when; null when none is found.
   */
  check(at: string): Promise<CheckGuess | null>;
  /**
   * The start page's draft (V24c, decision 128): kept in Symbiote's cache for the repository, so a
   * new `symbiote view` (another port, other browser storage) has it; `{}` when none.
   */
  draft(): Promise<Record<string, unknown>>;
  saveDraft(value: Record<string, unknown>): Promise<void>;
  /**
   * Keeps a file for a workspace about to start (V40), in Symbiote's cache until a start moves it
   * beside the record: its ID, the name it will have, its size. Rejects one over 20 MB (413).
   */
  saveDocument(name: string, bytes: Uint8Array): Promise<WorkspaceDocument>;
  /** Stops its agent while it works or waits. */
  stopAgent(branch: string): Promise<WorkspaceStart>;
  /** Opens its worktree's folder in the editor (V12's VS Code). */
  openWorktree(branch: string): Promise<void>;
  /**
   * Opens a file its changes list as a diff in the editor (V43), exactly what the row counts: one
   * of the branch's from the fork point to the tip, one not committed (`uncommitted`) from its
   * worktree's HEAD to the worktree; a new file alone, as it is. `previousPath`: where a renamed
   * file was.
   */
  openDiff(
    branch: string,
    file: { path: string; previousPath?: string; uncommitted?: true },
  ): Promise<void>;
  /**
   * Its branch's commits and files since the fork point (what Review will show), and its
   * worktree's files not committed (V29d).
   */
  changes(branch: string): Promise<WorkspaceChanges>;
  /** Whether its branch merges cleanly into the default branch (V17's check), once per pair. */
  merge(branch: string): Promise<BranchMerge>;
  /** Its thread (V18c): what its agent was given and reported, and its review's last verdict. */
  thread(branch: string): Promise<WorkspaceThread>;
  /** Sends a message to its agent: continues its session with the text (V18c). */
  reply(request: WorkspaceReply): Promise<WorkspaceReplied>;
  /**
   * Opens its agent's newest session in a terminal (V21): `claude attach <id>` in its worktree,
   * where a stopped session continues, with no turn; for Codex on its app server, `codex resume
   * <thread> --remote <address> -C <worktree>` (V27b). The terminal's ID.
   */
  terminal(request: WorkspaceTerminalRequest): Promise<WorkspaceTerminalOpened>;
  /**
   * Opens a shell in its worktree (V45): the person's shell in a kept terminal, `Shell <n>` by the
   * lowest number free; at most `MAX_SHELLS`. Its ID and number.
   */
  shell(request: WorkspaceTerminalRequest): Promise<Omit<WorkspaceShell, 'running'>>;
  /** Its shells still open (V45), by number, each with what runs in it. */
  shells(branch: string): Promise<WorkspaceShells>;
  /**
   * Cleans it up (V18c): its agent's sessions, its worktree and, once merged, its branch; the
   * record stays, `finished`. Unmerged only when asked (`unmerged`); never with work not
   * committed.
   */
  clean(request: { branch: string; unmerged?: boolean }): Promise<{ finished: string }>;
}

/** Most shells a workspace has open at once (V45): 9 MB each, measured. */
export const MAX_SHELLS = 8;

/** Turns a thread panel reads from the server: about 200 entries' worth. */
const PANEL_TURNS = 50;

/** How much of the recorded tools the Activity tab reads (V48c): ~1,000 lines. */
const TIMELINE_TOOLS = 256 * 1024;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Workspaces of `repo`, kept beside its reviews (`symbiote/workspaces/`, else Symbiote's cache).
 * */
export function workspaces(
  repo: GitRepo,
  cacheDir: string,
  {
    claude,
    codex = () => Promise.resolve(null),
    now = () => new Date(),
    env = process.env,
    root = repo.root,
    openFolder,
    hook = fileURLToPath(new URL('./agent-hook.js', import.meta.url)),
    node = process.execPath,
    terminals,
  }: {
    /** Finds Claude Code (once a start or a list needs it); null when it is not installed. */
    claude: () => Promise<ClaudeCode | null>;
    /** Finds Codex (V20a), the same way; none by default. */
    codex?: () => Promise<Codex | null>;
    now?: () => Date;
    env?: Readonly<Record<string, string | undefined>>;
    /** Where `symbiote/config.json` is read. */
    root?: string;
    openFolder?: OpenFolder;
    /** Symbiote's hook (`dist/agent-hook.js`) and the Node that runs it. */
    hook?: string;
    node?: string;
    /** Terminals on agents' sessions (V21); without them, none. */
    terminals?: Terminals;
  },
): Workspaces {
  /** Where reviews and workspaces are kept; `symbiote/features/` moved first (V25), or noted when
   * left. */
  const place = async (): Promise<ReviewPlace> => {
    const where = await reviewPlace(repo, cacheDir);
    if (!(await workspacesFolder(dirname(where.dir))).left) return where;
    const left =
      'symbiote/features/, where workspaces were kept before, is still here: Symbiote reads symbiote/workspaces/.';
    return { ...where, note: where.note ? `${where.note} ${left}` : left };
  };
  const config = () => readWorkspaceConfig(root);
  const viaCodex = workspaceCodex({ codex, now, env });

  /** `workspaces.worktrees` is relative to the checkout that holds `symbiote/`. */
  const mainRoot = (where: ReviewPlace) =>
    where.place === 'repository' ? dirname(symbioteFolder(where)) : repo.root;

  /** Files uploaded for a workspace about to start (V40), each by its ID. */
  const uploads = join(cacheDir, 'state', repo.id, 'uploads');
  /** Commits' files as VS Code's diffs are given them (V43, decision 288), by commit and path. */
  const revisions = join(cacheDir, 'state', repo.id, 'revisions');

  /**
   * Symbiote's settings file, written when its text differs (Symbiote moved) or it is gone: a
   * session that wakes reads it again, and does not start without it (V18c spike). Its path.
   */
  async function settingsFile(where: ReviewPlace): Promise<string> {
    const path = join(symbioteFolder(where), 'claude-settings.json');
    const text = agentSettings({ node, hook, symbiote: symbioteFolder(where) });
    if ((await readFile(path, 'utf8').catch(() => null)) !== text) {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, text);
      await rename(temp, path);
    }
    return path;
  }

  async function summary(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    refs: RefList,
    trunk: string[],
    sessions: AgentSession[] | null,
  ): Promise<WorkspaceSummary> {
    const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha ?? null;
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
    const exists = existsSync(workspace.worktree);
    const changed = exists ? await uncommittedFiles(workspace.worktree).catch(() => null) : null;
    let agent: WorkspaceAgentState;
    let acted: string | undefined;
    let activity: WorkspaceActivity | undefined;
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
      }
    } else {
      const thread = workspace.agent
        ? await readThreadEnd(symbioteFolder(where), workspace.branch)
        : [];
      // Blocked with nothing named: its thread tells a finished turn from a question (V18c).
      const session = newestSession(workspace, sessions, real);
      const ended =
        session && isBlocked(session) && !session.waitingFor ? turnEnded(thread) : false;
      acted = workspace.agent ? (lastAction(thread) ?? workspace.agent.started) : undefined;
      agent =
        workspace.agent?.kind === 'codex'
          ? codexState(workspace, thread, await viaCodex.alive(workspace), ahead)
          : agentState(workspace, sessions, ahead, real, ended);
      // Its tools (V48f), read only while it works and when they are recorded.
      const tools =
        agent.state === 'working' && workspace.agent?.activity
          ? await readActivityEnd(symbioteFolder(where), workspace.branch)
          : null;
      activity = activityOf(thread, agent, tools);
    }
    if (workspace.agent?.effort) agent = { ...agent, effort: workspace.agent.effort };
    if (workspace.agent?.model) agent = { ...agent, model: workspace.agent.model };
    return {
      branch: workspace.branch,
      ...(workspace.kind ? { kind: workspace.kind } : {}),
      ...(workspace.title ? { title: workspace.title } : {}),
      base: workspace.base,
      ...(workspace.from ? { from: workspace.from } : {}),
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
    };
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

  /**
   * The default branch for one read of the refs: looked up once (a git run per remote) for all
   * the workspaces of a list.
   */
  const mains = new WeakMap<RefList, Promise<string | null>>();
  function mainOf(refs: RefList): Promise<string | null> {
    let main = mains.get(refs);
    if (!main) {
      main = defaultBranch(repo, refs);
      mains.set(refs, main);
    }
    return main;
  }

  /** The default branch's tips, local and remotes'. */
  async function trunkOf(refs: RefList): Promise<string[]> {
    const name = await mainOf(refs);
    if (!name) return [];
    return [
      ...refs.branches.filter((b) => b.name === name).map((b) => b.sha),
      ...refs.remotes.filter((r) => r.branch === name).map((r) => r.sha),
    ];
  }

  /** The prompt a workspace's agent is given. */
  async function promptOf(where: ReviewPlace, workspace: WorkspaceFile): Promise<string> {
    return workspacePrompt(
      workspace,
      {
        record: workspacePath(workspacesDir(where), workspace.branch),
        reviews: join(where.dir, ...workspace.branch.split('/')),
        agents: where.agents,
        into: await defaultBranch(repo, await listRefs(repo)),
        documents: documentsDir(where, workspace.branch),
      },
      readPrompts(root).text,
    );
  }

  const draftFile = join(cacheDir, 'state', repo.id, 'start-draft.json');

  /** Each workspace's shells (V45), by branch: they live as long as `symbiote view`. */
  const shellsByBranch = new Map<string, { id: string; number: number }[]>();
  /** A workspace's shells still open, by number: one that exited or was closed is forgotten. */
  const openShells = (branch: string) => {
    const open = (shellsByBranch.get(branch) ?? []).filter(
      (shell) => terminals?.running(shell.id) !== undefined,
    );
    if (open.length > 0) shellsByBranch.set(branch, open);
    else shellsByBranch.delete(branch);
    return open;
  };

  /** Merge checks by the default branch's tip and the workspace's: they take seconds on some. */
  const merges = new Map<string, Promise<BranchMerge>>();
  /** Check commands by commit: a commit's files never change. */
  const checks = new Map<string, Promise<CheckGuess | null>>();
  /** Each branch's commits and files, for the base and tip they were read at (V29d). */
  const branchChanges = new Map<
    string,
    { key: string; read: Promise<Pick<WorkspaceChanges, 'commits' | 'files'>> }
  >();

  /**
   * Where a workspace's commits start (decision 187): the fork point with the default branch, as
   * Review computes it; the commit it started at once merged (the fork point is then its tip,
   * which a branch without commits yet also is) or without a default branch. `since` names the
   * default branch when it is the fork point.
   */
  async function changesBase(
    workspace: WorkspaceFile,
    refs: RefList,
    tip: string,
  ): Promise<{ base: string; since?: string }> {
    const main = await mainOf(refs);
    const fork = main && main !== workspace.branch ? await forkPoint(repo, tip, main, refs) : null;
    if (fork && main && (fork !== tip || fork === workspace.base))
      return { base: fork, since: main };
    return { base: workspace.base };
  }

  /** The agent of `kind`, when it is installed. */
  async function found(kind: AgentKind): Promise<FoundAgent | null> {
    if (kind === 'claude') {
      const agent = await claude();
      return agent ? { kind, claude: agent } : null;
    }
    const agent = await codex();
    return agent ? { kind, codex: agent } : null;
  }

  /** The agent a workspace gets unless one is picked: `agent.kind`, else Claude Code, else Codex.
   * */
  async function defaultAgent(): Promise<FoundAgent | null> {
    const first = config().agent;
    for (const kind of first ? [first, ...AGENT_KINDS.filter((k) => k !== first)] : AGENT_KINDS) {
      const agent = await found(kind);
      if (agent) return agent;
    }
    return null;
  }

  /** A model asked for a start (V47), checked against what `agent` lists; undefined for none. */
  async function modelFor(agent: FoundAgent | null, model: unknown): Promise<string | undefined> {
    if (model === undefined) return undefined;
    if (typeof model !== 'string' || !MODEL_ID.test(model)) {
      throw new WorkspaceRefused(modelWordProblem(model), 400);
    }
    if (!agent) throw new WorkspaceRefused('a model needs an agent to start', 400);
    const problem = modelProblem(model, AGENT_NAMES[agent.kind], (await modelsOf(agent))?.models);
    if (problem) throw new WorkspaceRefused(problem, 400);
    return model;
  }

  /**
   * A level asked for a start (V30b), checked against what `agent` lists on the model it starts
   * on (V47): the one picked, else the project's for Claude Code; undefined for none.
   */
  async function effortFor(
    agent: FoundAgent | null,
    effort: unknown,
    model: string | undefined,
  ): Promise<string | undefined> {
    if (effort === undefined) return undefined;
    if (typeof effort !== 'string' || !EFFORT_LEVEL.test(effort)) {
      throw new WorkspaceRefused(effortWordProblem(effort), 400);
    }
    if (!agent) throw new WorkspaceRefused('an effort level needs an agent to start', 400);
    const on = model ?? (agent.kind === 'claude' ? config().model : undefined);
    const problem = effortOnProblem(
      effort,
      AGENT_NAMES[agent.kind],
      on ? (await modelsOf(agent))?.models : undefined,
      on,
      await effortsOf(agent),
    );
    if (problem) throw new WorkspaceRefused(problem, 400);
    return effort;
  }

  /** Starts the workspace's agent and records how that went; the prompt it was given. */
  async function launch(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    agent: FoundAgent | null,
    permissionMode: PermissionMode,
    how: StartedAs,
  ): Promise<string> {
    const prompt = await promptOf(where, workspace);
    const level = startedAs(how);
    if (!agent) {
      workspace.agent = null;
    } else if (agent.kind === 'codex') {
      workspace.agent = {
        ...(await viaCodex.launch(where, workspace, agent.codex, prompt, level)),
        ...level,
      };
      await writeRecord(where, workspace);
      await viaCodex.firstEntry(where, workspace);
    } else {
      // The session's first hooks run while `--bg` starts it: they look for this record.
      await writeRecord(where, workspace);
      const result = await agent.claude.start({
        cwd: workspace.worktree,
        name: workspace.branch,
        prompt,
        permissionMode,
        addDir: symbioteFolder(where),
        settings: await settingsFile(where),
        ...level,
      });
      workspace.agent = result.ok
        ? {
            kind: 'claude',
            permissionMode,
            ...level,
            started: now().toISOString(),
            hooks: true,
            activity: true,
          }
        : { kind: 'claude', permissionMode, ...level, error: result.error };
    }
    await writeRecord(where, workspace);
    return prompt;
  }

  async function started(where: ReviewPlace, workspace: WorkspaceFile, prompt: string) {
    const refs = await listRefs(repo);
    const agent = workspace.agent?.kind === 'claude' ? await claude() : null;
    const sessions = agent ? await agent.sessions() : [];
    return {
      workspace: await summary(where, workspace, refs, await trunkOf(refs), sessions),
      prompt,
    };
  }

  /** A workspace's agent, found; a refusal the page can show when there is none. */
  async function agentOf(workspace: WorkspaceFile): Promise<ClaudeCode> {
    const agent = workspace.agent ? await claude() : null;
    if (!agent) {
      throw new WorkspaceRefused(
        'No agent to talk to: install Claude Code (claude on PATH), or set SYMBIOTE_CLAUDE',
        409,
      );
    }
    return agent;
  }

  /** Whether a workspace's commits are all in the default branch. */
  async function isMerged(workspace: WorkspaceFile, refs: RefList): Promise<boolean> {
    const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha;
    if (!tip || !(await isCommit(repo, workspace.base))) return false;
    if ((await commitsBetween(repo, workspace.base, tip, 1)).count === 0) return false;
    for (const end of await trunkOf(refs)) if (await isAncestor(repo, tip, end)) return true;
    return false;
  }

  return {
    async options() {
      const [refs, claudeCode, codexAgent] = await Promise.all([listRefs(repo), claude(), codex()]);
      const where = await place();
      const {
        branchPrefixes,
        worktrees,
        permissionMode,
        agent: first,
        model: projectModel,
      } = config();
      const apiKey = Boolean(env.ANTHROPIC_API_KEY);
      const agents: AgentOption[] = [];
      if (claudeCode) {
        const [account, levels, models] = await Promise.all([
          claudeCode.account(),
          effortsOf({ kind: 'claude', claude: claudeCode }),
          claudeCode.models(),
        ]);
        // Its levels on the model it starts on without a pick: the project's, else its own.
        const efforts = levelsOn(models, projectModel, levels);
        agents.push({
          kind: 'claude',
          command: claudeCode.command,
          ...(account ? { account } : {}),
          ...(apiKey ? { apiKey } : {}),
          permissionMode,
          ...(efforts ? { efforts } : {}),
          ...(models ? { models } : {}),
          ...(projectModel ? { defaultModel: { id: projectModel, by: 'project' as const } } : {}),
        });
      }
      if (codexAgent) {
        const [account, efforts, listed] = await Promise.all([
          codexAgent.account(),
          effortsOf({ kind: 'codex', codex: codexAgent }),
          codexAgent.models(),
        ]);
        agents.push({
          kind: 'codex',
          command: codexAgent.command,
          ...(account ? { account } : {}),
          ...(efforts ? { efforts } : {}),
          ...(listed ? { models: listed.models } : {}),
          ...(listed?.default
            ? { defaultModel: { id: listed.default, by: 'agent' as const } }
            : {}),
        });
      }
      // The default first: `agent.kind`, else Claude Code, else Codex (decision 132).
      agents.sort((a, b) => Number(b.kind === first) - Number(a.kind === first));
      return {
        base: await workspaceBase(repo, refs),
        branches: await startBranches(repo, refs),
        branchPrefixes,
        kinds: workKinds(),
        worktrees: join(dirname(worktreeFolder(mainRoot(where), 'x', worktrees)), '<branch>'),
        agents,
        maxBrief: MAX_BRIEF,
        documents: {
          folder: join(symbioteFolder(where), 'documents', '<branch>'),
          maxFiles: MAX_DOCUMENTS,
          maxBytes: MAX_DOCUMENT_BYTES,
          maxTotal: MAX_DOCUMENTS_BYTES,
        },
      };
    },

    async list() {
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
        summaries.push(await summary(where, workspace, refs, trunk, sessions));
      }
      const terminal = await terminals?.available();
      return { workspaces: summaries, ...head, ...(terminal ? { terminal } : {}) };
    },

    async start(request) {
      const work = workOf(request);
      if (request.agent !== undefined && !AGENT_KINDS.includes(request.agent)) {
        throw new WorkspaceRefused(`unknown agent: ${String(request.agent)}`, 400);
      }
      const permissionMode = request.permissionMode ?? config().permissionMode;
      if (!PERMISSION_MODES.includes(permissionMode)) {
        throw new WorkspaceRefused(`unknown permission mode: ${String(permissionMode)}`, 400);
      }
      const agent = request.agent ? await found(request.agent) : await defaultAgent();
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
        worktree: folder,
      };
      await prepareSymbioteFolder(where, { text: readPrompts(root).text.reviews });
      // After the folder's .gitignore: the documents are never seen by git (V40).
      if (documents.length > 0) workspace.documents = await placeDocuments(papers, documents);
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

    async draft() {
      try {
        const value = JSON.parse(await readFile(draftFile, 'utf8')) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
      } catch {
        // none yet, or not JSON
      }
      return {};
    },

    async saveDraft(value) {
      await mkdir(dirname(draftFile), { recursive: true });
      const temp = `${draftFile}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(value)}\n`);
      await rename(temp, draftFile);
    },

    saveDocument(name, bytes) {
      return saveUpload(uploads, name, bytes, now);
    },

    async check(at) {
      if (!FULL_SHA.test(at))
        throw new WorkspaceRefused(`the commit must be a full SHA: ${at}`, 400);
      if (!(await isCommit(repo, at))) throw new WorkspaceRefused(`not a commit: ${at}`, 400);
      let guess = checks.get(at);
      if (!guess) {
        guess = treeAt(repo, at).then(guessCheck);
        checks.set(at, guess);
      }
      return guess;
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
      const workspace = await readRecord(await place(), branch);
      const before = file.previousPath ?? file.path;
      for (const path of [file.path, before]) {
        const normal = posix.normalize(path);
        if (path === '' || isAbsolute(path) || normal.startsWith('../') || normal === '..') {
          throw new WorkspaceRefused(`not a path in its worktree: ${path}`, 400);
        }
      }
      const worktree = existsSync(workspace.worktree)
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
        const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha;
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

    async changes(branch) {
      const workspace = await readRecord(await place(), branch);
      const refs = await listRefs(repo);
      const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha ?? null;
      const uncommitted = existsSync(workspace.worktree)
        ? await worktreeChanges(repo, workspace.worktree)
        : null;
      const none = {
        commits: { count: 0, listed: [] },
        files: { count: 0, added: 0, removed: 0, listed: [] },
      };
      if (!tip || !(await isCommit(repo, workspace.base))) {
        return { branch, base: workspace.base, tip, ...none, uncommitted };
      }
      const where = await changesBase(workspace, refs, tip);
      const key = `${where.base}:${tip}`;
      let kept = branchChanges.get(branch);
      if (kept?.key !== key) {
        kept = { key, read: readBranchChanges(repo, where.base, tip) };
        branchChanges.set(branch, kept);
        kept.read.catch(() => branchChanges.delete(branch));
      }
      return { branch, ...where, tip, ...(await kept.read), uncommitted };
    },

    async merge(branch) {
      const workspace = await readRecord(await place(), branch);
      const refs = await listRefs(repo);
      const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha;
      if (!tip) throw new WorkspaceRefused(`its branch ${workspace.branch} is gone`, 409);
      const into = await defaultBranch(repo, refs);
      if (!into) return { into: '', error: 'no default branch to merge into' };
      // The local default branch, where the merge is made; else a remote's.
      const target =
        refs.branches.find((b) => b.name === into) ?? refs.remotes.find((r) => r.branch === into);
      if (!target) return { into, error: `no branch ${into}` };
      const key = `${target.sha}:${tip}`;
      let check = merges.get(key);
      if (!check) {
        check = checkMerge(repo, target.sha, tip).then((result) => ({ into, ...result }));
        merges.set(key, check);
      }
      return check;
    },

    async thread(branch) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      let entries: ThreadEntry[];
      let tools: ActivityEntry[] | null = null;
      if (onServer(workspace)) {
        // From the server (decision 155); none when it cannot be read: the state says why.
        const { read } = await viaCodex.readServer(workspace, {
          turns: PANEL_TURNS,
          items: 'full',
        });
        entries =
          read instanceof Error
            ? []
            : serverEntries(read, { first: read.turns.length < PANEL_TURNS }).slice(-THREAD_LIMIT);
        // Its turns' items, read in full already (V48c).
        if (!(read instanceof Error)) {
          tools = read.turns.flatMap((turn) => serverTools(turn, read.id, workspace.worktree));
        }
      } else {
        entries = await readThread(symbioteFolder(where), branch);
        if (workspace.agent?.activity) {
          tools = await readActivityEnd(symbioteFolder(where), branch, TIMELINE_TOOLS);
        }
      }
      const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
      const verdict = review?.verdicts.at(-1);
      const shown = (path: string) =>
        where.place === 'repository' ? relative(repo.root, path).split(sep).join('/') : path;
      return {
        entries,
        // Claude Code's hooks record it (V18c); Symbiote's runner records Codex's (V20a), or
        // Codex's app server keeps it (V27a).
        recorded: workspace.agent?.hooks === true || workspace.agent?.kind === 'codex',
        ...(tools ? { tools } : {}),
        ...(review && verdict
          ? {
              verdict: {
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
              },
            }
          : {}),
      };
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

    async reply({ branch, text, stop }) {
      if (text.trim() === '') throw new WorkspaceRefused('a message cannot be empty', 400);
      if (text.length > MAX_BRIEF) {
        throw new WorkspaceRefused('a message is at most 20,000 characters', 400);
      }
      const where = await place();
      const workspace = await readRecord(where, branch);
      if (workspace.agent?.kind === 'codex') {
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
      }
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

    async clean({ branch, unmerged }) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      const merged = await isMerged(workspace, await listRefs(repo));
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
      await writeRecord(where, workspace);
      return { finished: workspace.finished };
    },
  };
}
