import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants as fsConstants, existsSync, readFileSync, realpathSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addWorktree,
  AGENT_KINDS,
  branchNameProblem,
  checkMerge,
  commitFolders,
  commitDetails,
  commitsBetween,
  defaultBranch,
  deleteMergedBranch,
  fileChangedSince,
  fileForCheckout,
  forkPoint,
  isAncestor,
  isCommit,
  listChangedFiles,
  listLineCounts,
  listRefs,
  EFFORT_LEVEL,
  MODEL_ID,
  PERMISSION_MODES,
  removeWorktree,
  resolveCommit,
  uncommittedFiles,
  userEmail,
  worktreeStatus,
  WorktreeRefused,
  WORK_KINDS,
  type AgentEfforts,
  type AgentKind,
  type AgentModel,
  type AgentModels,
  type AgentOption,
  type BranchMerge,
  type BriefPart,
  type BriefParts,
  type CheckGuess,
  type AgentStateName,
  type WorkspaceAgentState,
  type WorkspaceChanges,
  type WorkspaceDocument,
  type WorkspaceFileChange,
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
  type PromptKey,
  type RefList,
  type StartBranch,
  type WorkKind,
  type WorkKindSpec,
} from '@symbiote/core';
import { guessCheck, treeAt } from './check.js';
import { DEFAULT_PROMPTS, fillPrompt, readPrompts } from './prompts.js';
import {
  AppServerStartFailed,
  AppServerUnreachable,
  type CodexServer,
  type CodexThread,
} from './app-server.js';
import {
  asksTrust,
  codexState,
  processAlive,
  serverEntries,
  serverLastAction,
  serverState,
  type Codex,
} from './codex.js';
import { localHost, onPath, type FolderAt } from './editor.js';
import { runWithInput, type RunWithInput } from './merge-agent.js';
import { shellOf, TerminalRefused, type Terminals } from './terminal.js';
import { CONFIG_FILES } from './plugins.js';
import {
  prepareSymbioteFolder,
  readReview,
  reviewPath,
  reviewPlace,
  sortKeys,
  verdictText,
  type ReviewPlace,
} from './reviews.js';
import {
  appendThread,
  lastAction,
  readThread,
  readThreadEnd,
  THREAD_LIMIT,
  threadPath,
  turnEnded,
  workspacesFolder,
} from './thread.js';

/** A workspace on disk: `symbiote/workspaces/<branch>.json` (V18; `symbiote/features/` before V25),
 * one per branch. */
export interface WorkspaceFile {
  /** The agent started for it; null when none was found. */
  agent: WorkspaceAgentRecord | null;
  /** The commit the branch started at (full SHA). */
  base: string;
  branch: string;
  brief: string;
  /** Who started it (`user.email`). */
  by?: string;
  created: string;
  /** The branch `base` was the tip of; absent when a row was picked. */
  from?: string;
  /** When it was cleaned up (V18c): no longer listed. */
  finished?: string;
  /**
   * The files the person gave with the brief (V40), by name, in `symbiote/documents/<branch>/`;
   * removed at Clean up, their names kept here.
   */
  documents?: string[];
  /** What it is for, its name, and the parts `brief` was made of (V24); absent before V24. */
  kind?: WorkKind;
  parts?: BriefParts;
  planFirst: boolean;
  title?: string;
  /** The workspace's worktree folder. */
  worktree: string;
}

export interface WorkspaceAgentRecord {
  kind: AgentKind;
  /** Claude Code's permission mode. */
  permissionMode?: PermissionMode;
  /** The effort level it was started at (V30b), given again when it starts again; its own if
   * absent. */
  effort?: string;
  /** The model it was started on (V47), given again when it starts again; its default if absent. */
  model?: string;
  /** When it last started: for Codex, its last run (V20a). */
  started?: string;
  /** Codex: its last run's ID, on the thread entries it wrote, and its runner's process (V20a). */
  run?: string;
  pid?: number;
  /**
   * Codex on its app server (V27a): its thread there, read from the server (no runner, no run);
   * `threads`, those it had before (started again), archived at Clean up.
   */
  thread?: string;
  threads?: string[];
  /** Why the last start failed, in the agent's words. */
  error?: string;
  /** Started with Symbiote's hooks (V18c): its thread is recorded. */
  hooks?: boolean;
}

/** Every workspace file's first key: where an agent that opens it finds its instructions. */
export const WORKSPACE_ABOUT =
  'A workspace started in Symbiote. Agents: read symbiote/AGENTS.md before acting on it.';

/** Longest brief: it goes on the agent's command line (Windows takes 32,767 characters). */
export const MAX_BRIEF = 20_000;

/** Longest title: a workspace's name in lists and the start of its branch's (V24). */
export const MAX_TITLE = 200;

/** Most files given with a brief (V40), the most one may weigh (V36's image limit), and all. */
export const MAX_DOCUMENTS = 20;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENTS_BYTES = 100 * 1024 * 1024;
/** Uploads not started with within a week are removed when the next one is saved (V40). */
const UPLOADS_KEPT_MS = 7 * 24 * 3600 * 1000;
/** The names Symbiote gives the uploads it keeps: only those are ever removed. */
const UPLOAD = /^[0-9a-f]{32}$/;
/** Longest name a document is given, its extension kept. */
const MAX_DOCUMENT_NAME = 120;

/**
 * A file's name as Symbiote keeps it beside a workspace's record (V40): the last part of a path;
 * control characters and those Windows refuses as dashes; no leading or trailing dots and spaces
 * (no hidden file, no `.gitignore`); at most 120 characters, the extension kept; `document` when
 * nothing is left.
 */
export function documentName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const safe = last.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '');
  if (safe === '') return 'document';
  if (safe.length <= MAX_DOCUMENT_NAME) return safe;
  const ext = extname(safe).length <= 20 ? extname(safe) : '';
  return `${safe.slice(0, MAX_DOCUMENT_NAME - ext.length)}${ext}`;
}

/** `name`, or `name (2).ext`, `name (3).ext`… : the first not in `taken`, which then holds it. */
function freeName(name: string, taken: Set<string>): string {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let free = name;
  for (let n = 2; taken.has(free); n++) free = `${stem} (${n})${ext}`;
  taken.add(free);
  return free;
}

/** Each part's heading in the brief, in the brief's order (V24). */
const HEADINGS: Record<BriefPart, string> = {
  goal: 'Goal',
  happens: 'What happens',
  restructure: 'What to restructure',
  change: 'What to change',
  question: 'Question',
  reproduce: 'How to reproduce',
  known: 'What is known',
  where: 'Where to look',
  outOfScope: 'Out of scope',
  notes: 'Notes',
  doneWhen: 'Done when',
};
const ORDER = Object.keys(HEADINGS) as BriefPart[];

/**
 * The kinds of work (V24, decision 122): the one part each needs, its others, and Done when's
 * text until the person changes it. What each kind's agent is told is its start prompt (V28).
 */
const KINDS: Record<
  WorkKind,
  { name: string; required: BriefPart; optional: BriefPart[]; doneWhen?: string }
> = {
  feature: { name: 'Feature', required: 'goal', optional: ['where', 'outOfScope', 'notes'] },
  fix: {
    name: 'Fix',
    required: 'happens',
    optional: ['reproduce', 'where', 'notes'],
    doneWhen: 'A test that fails today passes, and {checks pass}.',
  },
  refactor: {
    name: 'Refactor',
    required: 'restructure',
    optional: ['where', 'outOfScope', 'notes'],
    doneWhen:
      'Behaviour is unchanged: existing tests pass without changing what they assert, and ' +
      '{checks pass}.',
  },
  chore: {
    name: 'Chore',
    required: 'change',
    optional: ['where', 'outOfScope', 'notes'],
    doneWhen: 'Nothing else changes, and {checks pass}.',
  },
  spike: {
    name: 'Spike',
    required: 'question',
    optional: ['known', 'where', 'notes'],
    doneWhen: 'A written answer: what was tried, what was measured, and a recommendation.',
  },
};

/** A kind's parts in the brief's order, Done when last. */
const partsOf = (kind: WorkKind): BriefPart[] => {
  const { required, optional } = KINDS[kind];
  return ORDER.filter(
    (part) => part === required || part === 'doneWhen' || optional.includes(part),
  );
};

/** The kinds as the start page offers them. */
export function workKinds(): WorkKindSpec[] {
  return WORK_KINDS.map((kind) => {
    const { name, required, doneWhen } = KINDS[kind];
    return {
      kind,
      name,
      parts: partsOf(kind).map((part) => ({
        part,
        heading: HEADINGS[part],
        ...(part === required ? { required: true as const } : {}),
      })),
      ...(doneWhen ? { doneWhen } : {}),
    };
  });
}

/** A part's text as written, without the blank lines and spaces around it. */
const written = (text: string | undefined) => (text ?? '').replace(/^\s*\n/, '').trimEnd();

/**
 * The brief Symbiote gives the agent (V24, decisions 123–124): `# <Kind>: <title>`, then each part
 * with text under its heading in the brief's order, Done when last; the person's text as written.
 */
export function briefOf(kind: WorkKind, title: string, parts: BriefParts): string {
  const sections = [`# ${KINDS[kind].name}: ${title.trim()}`];
  for (const part of partsOf(kind)) {
    const text = written(parts[part]);
    if (text.trim() !== '') sections.push(`## ${HEADINGS[part]}\n${text}`);
  }
  return `${sections.join('\n\n')}\n`;
}

const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** A request the server answers with `status` and the message. */
export class WorkspaceRefused extends Error {
  override name = 'FeatureRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 | 502,
  ) {
    super(message);
  }
}

/** A workspace's file: the branch's slashes as folders. */
export function workspacePath(dir: string, branch: string): string {
  const parts = branch.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new WorkspaceRefused(`not a branch name: ${branch}`, 400);
  }
  const last = parts.pop() as string;
  return join(dir, ...parts, `${last}.json`);
}

/** Sorted keys, two-space indent, a final newline; `about` first. */
export function serializeWorkspace(workspace: WorkspaceFile): string {
  return `${JSON.stringify(sortKeys({ ...workspace, about: WORKSPACE_ABOUT }), null, 2)}\n`;
}

/** A workspace file, or null when it is missing or not one. */
export async function readWorkspace(path: string): Promise<WorkspaceFile | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<Record<keyof WorkspaceFile, unknown>>;
  const text = (x: unknown) => (typeof x === 'string' ? x : '');
  if (!text(v.branch) || !text(v.base) || !text(v.worktree)) return null;
  return {
    agent: asAgent(v.agent),
    base: text(v.base),
    branch: text(v.branch),
    brief: text(v.brief),
    ...(text(v.by) ? { by: text(v.by) } : {}),
    created: text(v.created),
    ...documentsRead(v.documents),
    ...(text(v.from) ? { from: text(v.from) } : {}),
    ...(text(v.finished) ? { finished: text(v.finished) } : {}),
    ...kindOf(v.kind),
    ...partsRead(v.parts),
    planFirst: v.planFirst === true,
    ...(text(v.title) ? { title: text(v.title) } : {}),
    worktree: text(v.worktree),
  };
}

/** The documents' names that are names Symbiote would give (V40); none when there are none. */
function documentsRead(value: unknown): { documents?: string[] } {
  if (!Array.isArray(value)) return {};
  const names = value.filter(
    (name): name is string =>
      typeof name === 'string' && name !== '' && documentName(name) === name,
  );
  return names.length > 0 ? { documents: names } : {};
}

function kindOf(value: unknown): { kind?: WorkKind } {
  const kind = WORK_KINDS.find((k) => k === value);
  return kind ? { kind } : {};
}

/** The parts Symbiote knows, each with text. */
function partsRead(value: unknown): { parts?: BriefParts } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const parts: BriefParts = {};
  for (const part of ORDER) {
    const text = v[part];
    if (typeof text === 'string' && text.trim() !== '') parts[part] = text;
  }
  return Object.keys(parts).length > 0 ? { parts } : {};
}

/** How an agent was started (V30b, V47): its level and its model, each absent for its own. */
type StartedAs = Pick<WorkspaceAgentRecord, 'effort' | 'model'>;

/** `how` with only the fields it has: what a start passes and a record keeps. */
const startedAs = ({ effort, model }: StartedAs): StartedAs => ({
  ...(effort ? { effort } : {}),
  ...(model ? { model } : {}),
});

function asAgent(value: unknown): WorkspaceAgentRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<Record<keyof WorkspaceAgentRecord, unknown>>;
  const kind = AGENT_KINDS.find((k) => k === v.kind);
  if (!kind) return null;
  const mode = PERMISSION_MODES.find((m) => m === v.permissionMode) ?? 'default';
  return {
    kind,
    ...(kind === 'claude' ? { permissionMode: mode } : {}),
    ...(typeof v.effort === 'string' && EFFORT_LEVEL.test(v.effort) ? { effort: v.effort } : {}),
    ...(typeof v.model === 'string' && MODEL_ID.test(v.model) ? { model: v.model } : {}),
    ...(typeof v.started === 'string' ? { started: v.started } : {}),
    ...(typeof v.run === 'string' && v.run !== '' ? { run: v.run } : {}),
    ...(typeof v.pid === 'number' && Number.isInteger(v.pid) && v.pid > 0 ? { pid: v.pid } : {}),
    ...(kind === 'codex' && typeof v.thread === 'string' && v.thread !== ''
      ? { thread: v.thread }
      : {}),
    ...(kind === 'codex' && Array.isArray(v.threads)
      ? (() => {
          const threads = (v.threads as unknown[]).filter(
            (t): t is string => typeof t === 'string' && t !== '',
          );
          return threads.length > 0 ? { threads } : {};
        })()
      : {}),
    ...(typeof v.error === 'string' ? { error: v.error } : {}),
    ...(v.hooks === true ? { hooks: true } : {}),
  };
}

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

/** A Claude Code session, as `claude agents --json --all` lists it. */
export interface AgentSession {
  cwd: string;
  /** `background` or `interactive`. */
  kind: string;
  startedAt: number;
  /** Background sessions: `working`, `blocked`, `done`, `failed` or `stopped`. */
  state?: string;
  /** While its process lives: `busy`, `waiting` or `idle`. */
  status?: string;
  waitingFor?: string;
  /** The short ID `claude attach` takes. */
  id?: string;
  name?: string;
  sessionId?: string;
}

/** Claude Code's sessions from `claude agents --json`; anything not one is left out. */
export function parseSessions(text: string): AgentSession[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const sessions: AgentSession[] = [];
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    if (typeof v.cwd !== 'string' || typeof v.kind !== 'string') continue;
    const text = (key: string) => {
      const value = v[key];
      return typeof value === 'string' ? { [key]: value } : {};
    };
    sessions.push({
      cwd: v.cwd,
      kind: v.kind,
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : 0,
      ...text('state'),
      ...text('status'),
      ...text('waitingFor'),
      ...text('id'),
      ...text('name'),
      ...text('sessionId'),
    });
  }
  return sessions;
}

/** Why `effort` is not an effort level at all: a word, never an option or a sentence (V30b). */
export const effortWordProblem = (effort: unknown): string =>
  `an effort level is a word, such as high: ${JSON.stringify(effort)}`;

/**
 * Why the agent `name` cannot start at `effort` (V30b), or null: it must be one of the `levels` it
 * lists, and those must be readable (an unknown level, Claude Code ignores without failing).
 */
export function effortProblem(
  effort: string,
  name: string,
  levels: readonly string[] | undefined,
): string | null {
  if (!levels) return `Symbiote cannot read ${name}'s effort levels: start it at its default`;
  if (levels.includes(effort)) return null;
  const listed =
    levels.length > 1 ? `${levels.slice(0, -1).join(', ')} or ${levels.at(-1)}` : levels[0];
  return `${name} takes ${listed}: ${effort}`;
}

/** Why `model` is not a model's ID at all: never an option or a sentence (V47). */
export const modelWordProblem = (model: unknown): string =>
  `a model is its ID, such as sonnet: ${JSON.stringify(model)}`;

/**
 * Why the agent `name` cannot start on `model` (V47), or null: it must be one of the `models` it
 * lists, and those must be readable.
 */
export function modelProblem(
  model: string,
  name: string,
  models: readonly AgentModel[] | null | undefined,
): string | null {
  if (!models) return `Symbiote cannot read ${name}'s models: start it on its default`;
  if (models.some((m) => m.id === model)) return null;
  return `${name} lists no model ${model}: pick one it lists`;
}

/**
 * The levels an agent takes on `model` (V47): the model's own when the agent lists it (none for a
 * model that takes none), else `fallback`, its default model's (Claude Code's `--help`).
 */
export function levelsOn(
  models: readonly AgentModel[] | null | undefined,
  model: string | undefined,
  fallback: AgentEfforts | null,
): AgentEfforts | null {
  const listed = model ? models?.find((m) => m.id === model) : undefined;
  if (!listed) return fallback;
  return listed.efforts ?? null;
}

/**
 * The levels `claude --help` lists for `--effort` (V30b), in its order: the parenthesis in that
 * option's description, which runs until the next option. Null when there is no such option, or
 * its list holds anything but lowercase words: no level then rather than a wrong one, since Claude
 * Code ignores one it does not know without failing (V30 spike).
 */
export function parseEffortLevels(help: string): string[] | null {
  const lines = help.split('\n');
  const at = lines.findIndex((line) => /^\s*--effort\b/.test(line));
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  const next = rest.findIndex((line) => /^\s*-/.test(line));
  const description = [lines[at], ...(next < 0 ? rest : rest.slice(0, next))].join(' ');
  const list = /\(([^)]*)\)/.exec(description)?.[1];
  if (!list) return null;
  const levels = list.split(',').map((level) => level.trim());
  return levels.every((level) => EFFORT_LEVEL.test(level)) ? levels : null;
}

/**
 * Claude Code's models from its answer to `initialize` (V47): the `models` of its
 * `control_response`, as its SDK's `supportedModels()` reads them — each one's `value` (what
 * `--model` takes), `displayName`, `description` and `supportedEffortLevels`. Its own "default"
 * entry is left out: it is the account's recommended model, not the person's setting (V47 spike,
 * decision 337). Null when there is no such answer or no model in it; IDs that are not `MODEL_ID`s
 * and levels that are not words are left out.
 */
export function parseClaudeModels(stdout: string): AgentModel[] | null {
  for (const line of stdout.split('\n')) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const v = (value ?? {}) as { type?: unknown; response?: { response?: { models?: unknown } } };
    if (v.type !== 'control_response') continue;
    const listed = v.response?.response?.models;
    if (!Array.isArray(listed)) return null;
    const models = (listed as Record<string, unknown>[])
      .map((m): AgentModel | null => {
        const id = typeof m?.value === 'string' ? m.value : '';
        if (id === 'default' || !MODEL_ID.test(id)) return null;
        const name = typeof m.displayName === 'string' && m.displayName !== '' ? m.displayName : id;
        const description =
          typeof m.description === 'string' && m.description !== '' ? m.description : undefined;
        const levels = (
          Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels : []
        ).filter((level): level is string => typeof level === 'string' && EFFORT_LEVEL.test(level));
        return {
          id,
          name,
          ...(description ? { description } : {}),
          ...(levels.length > 0 ? { efforts: { levels } } : {}),
        };
      })
      .filter((m): m is AgentModel => m !== null);
    return models.length > 0 ? models : null;
  }
  return null;
}

/** How Claude Code is asked for its models (V47): its SDK's handshake, with no turn after it. */
const MODEL_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  // Nothing written: no transcript for a session that never takes a turn.
  '--no-session-persistence',
  // Without the person's hooks, plugins and MCP servers; settings, login and models as ever.
  '--safe-mode',
  '--strict-mcp-config',
  '--tools',
  '',
];
const INITIALIZE = `${JSON.stringify({
  type: 'control_request',
  request_id: 'symbiote-models',
  request: { subtype: 'initialize' },
})}\n`;

/** A list of models kept this long is read again, in the background (decision 340: a day). */
export const MODELS_KEPT_MS = 24 * 60 * 60_000;

/** Where Claude Code at `command` keeps its models in Symbiote's cache (V47), for every view. */
export const claudeModelsFile = (cacheDir: string, command: string): string =>
  join(
    cacheDir,
    'agents',
    `claude-models-${createHash('sha256').update(command).digest('hex').slice(0, 12)}.json`,
  );

/** Models kept in `file` and when they were read; null when there are none it can trust. */
function readKeptModels(file: string): { at: number; models: AgentModel[] } | null {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as { read?: unknown; models?: unknown };
    const at = typeof v.read === 'string' ? Date.parse(v.read) : NaN;
    // Read back as Claude Code's own answer would be: what it could not pass stays out.
    const models = parseClaudeModels(
      JSON.stringify({
        type: 'control_response',
        response: {
          response: {
            models: (Array.isArray(v.models) ? (v.models as Partial<AgentModel>[]) : []).map(
              (m) => ({
                value: m?.id,
                displayName: m?.name,
                description: m?.description,
                supportedEffortLevels: m?.efforts?.levels,
              }),
            ),
          },
        },
      }),
    );
    return Number.isFinite(at) && models ? { at, models } : null;
  } catch {
    return null;
  }
}

/**
 * Whose account Claude Code runs on, from `claude auth status`; undefined when unknown. A
 * subscription's plan is `plan`, its profile's (`readClaudeProfile`), when known: the status
 * says its token's, kept from login.
 */
export function parseAccount(text: string, plan?: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown };
  if (v.loggedIn === false) return 'not logged in';
  if (v.authMethod === 'claude.ai') {
    const kept = typeof v.subscriptionType === 'string' ? v.subscriptionType : '';
    const name = plan ?? (kept ? `${kept.charAt(0).toUpperCase()}${kept.slice(1)}` : '');
    return name ? `your ${name} subscription` : 'your Claude subscription';
  }
  if (v.authMethod === 'api_key' || v.authMethod === 'api_key_helper') return 'an API key';
  if (v.authMethod === 'oauth_token') return 'a long-lived token';
  if (v.authMethod === 'third_party') return 'a cloud provider';
  return undefined;
}

/** The newest session in a workspace's worktree, matched by real path. */
export function newestSession(
  workspace: WorkspaceFile,
  sessions: AgentSession[] | null,
  real: (path: string) => string,
): AgentSession | undefined {
  const folder = real(workspace.worktree);
  return (sessions ?? [])
    .filter((s) => real(s.cwd) === folder)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

/** Claude Code's word for a session waiting on the person, or for one whose turn ended there. */
const isBlocked = (session: AgentSession) =>
  ['blocked', 'waiting'].includes(session.state ?? session.status ?? '');

/**
 * What the page says of a workspace's agent: the newest session working in its worktree (matched
 * by real path), else why there is none. `ahead` (commits since the fork point) tells a finished
 * plan from finished work. `ended`: the thread says its last turn ended (V18c) — Claude Code reads
 * a finished plan as `blocked` with nothing named it waits for, so that is a finished turn. A
 * turn interrupted with Esc fires no hook and reads `idle` with `working` until the next one ends.
 */
export function agentState(
  workspace: WorkspaceFile,
  sessions: AgentSession[] | null,
  ahead: number,
  real: (path: string) => string,
  ended = false,
): WorkspaceAgentState {
  const { agent } = workspace;
  if (!agent) return { state: 'no-agent' };
  const kind = agent.kind;
  const session = newestSession(workspace, sessions, real);
  if (!session) {
    if (agent.error) return { state: 'not-started', kind, error: agent.error };
    if (sessions === null) {
      return { state: 'unknown', kind, error: 'Claude Code could not list its sessions' };
    }
    return { state: 'not-running', kind };
  }
  const id = session.id ? { id: session.id } : {};
  const finished = (): AgentStateName =>
    ahead > 0 ? 'ready' : workspace.planFirst ? 'plan-ready' : 'done';
  const waiting = session.waitingFor ? { waitingFor: session.waitingFor } : {};
  switch (session.state ?? session.status) {
    case 'working':
      if (session.status !== 'idle') return { state: 'working', kind, ...id };
      if (ended) return { state: finished(), kind, ...id };
      return { state: 'needs-you', kind, ...id, ...waiting, interrupted: true };
    case 'busy':
      return { state: 'working', kind, ...id };
    case 'blocked':
    case 'waiting':
      if (ended && !session.waitingFor) return { state: finished(), kind, ...id };
      return { state: 'needs-you', kind, ...id, ...waiting };
    case 'failed':
      return { state: 'failed', kind, ...id };
    case 'stopped':
      return { state: 'stopped', kind, ...id };
    default:
      return { state: finished(), kind, ...id };
  }
}

/** A program's run: its exit code (null when it could not start) and what it wrote. */
export type Run = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/** How long a program's output may close after it exits, at most: a service it starts may hold it.
 * */
const OUTPUT_AFTER_EXIT_MS = 1_000;

/**
 * Runs a program without a shell; resolves once its output has closed, with all it wrote — its
 * exit can come first: under load, Codex's `app-server daemon start` had answered 0 of its 252
 * bytes when its exit was taken. A background service the program starts may keep its output
 * open: then it resolves `OUTPUT_AFTER_EXIT_MS` after the exit, with what it wrote by then.
 */
export const runProgram: Run = (command, args, { cwd, timeoutMs }) =>
  new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let answered = false;
    let afterExit: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const answer = (result: { code: number | null; stdout: string; stderr: string }) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      clearTimeout(afterExit);
      done(result);
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => answer({ code: null, stdout, stderr: error.message }));
    child.on('close', (code) => answer({ code, stdout, stderr }));
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (answered) return;
      // Held by a service it started: its pipes stay open (closed, its next write would kill it).
      afterExit = setTimeout(() => answer({ code, stdout, stderr }), OUTPUT_AFTER_EXIT_MS);
    });
  });

/** What Symbiote asks of Claude Code (V18); tests pass a fake. */
export interface ClaudeCode {
  /** The program, as found. */
  command: string;
  /** Starts a background session in `cwd` (`claude --bg`); its words when it does not start. */
  start(request: {
    cwd: string;
    name: string;
    prompt: string;
    permissionMode: PermissionMode;
    addDir: string;
    /** Symbiote's settings file (V18c): the hooks that record the thread. */
    settings?: string;
    /** Its effort level (V30b, `--effort`): the session keeps it, through a resume too. */
    effort?: string;
    /** Its model (V47, `--model`), over the project's: the session keeps it, as its level. */
    model?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Starts a page's agent as a background session in `cwd`: Scout (V35, decision 236), read tools
   * and Bash, nothing asked (`dontAsk`); Scribe (V41, decision 275), Write and Edit too, in
   * `default`, where Claude Code asks before a write into `.claude`. Every tool through the gate in
   * `settings`, no MCP server. A wake keeps all of it (V35 spike). Its words when it does not start.
   */
  startPageAgent(request: {
    cwd: string;
    name: string;
    prompt: string;
    settings: string;
    tools: readonly string[];
    permissionMode: 'dontAsk' | 'default';
    /** Its effort level (`--effort`), kept as a workspace's is. */
    effort?: string;
    /** Its model (V47, `--model`), over the project's. */
    model?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Its sessions, finished ones included; null when it cannot list them. */
  sessions(): Promise<AgentSession[] | null>;
  /** Stops a background session (`claude stop <id>`); its words when it cannot. */
  stop(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Continues a session that is not running with `text` (`claude --bg --resume <session>
   * "<text>"`), with no other flag: any flag, or a running session, makes a copy without the
   * hooks (V18c spike).
   */
  resume(request: {
    sessionId: string;
    cwd: string;
    text: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Removes a background session (`claude rm <id>`); a worktree Symbiote made stays. */
  remove(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Whose account it runs on. */
  account(): Promise<string | undefined>;
  /** The effort levels its `--help` lists (V30b); null when it lists none Symbiote can read. */
  efforts(): Promise<string[] | null>;
  /**
   * The models it lists (V47), in its order, from its answer to `initialize`; null when Symbiote
   * has none and cannot read them.
   */
  models(): Promise<AgentModel[] | null>;
}

/**
 * Claude Code at `command`. Sessions are asked for at most every 2 s (`claude agents --json`
 * takes 150 ms), the account every minute, with `plan`, its profile's, when given; its effort
 * levels once (`--help`, 70–90 ms). Its models (1.2 s to read, V47 spike) are kept in
 * `modelsFile` for every view on the machine, and read again in the background once a day
 * (decision 340); a use waits for the read only when none is kept.
 */
export function claudeCode(
  command: string,
  {
    run = runProgram,
    runInput = runWithInput,
    cwd,
    model,
    plan,
    modelsFile,
    now = Date.now,
  }: {
    run?: Run;
    runInput?: RunWithInput;
    cwd: string;
    /** The project's model (`agent.model`), for a start that picks none. */
    model?: string;
    plan?: () => Promise<string | undefined>;
    modelsFile?: string;
    now?: () => number;
  },
): ClaudeCode {
  let sessions: { at: number; list: Promise<AgentSession[] | null> } | null = null;
  let account: { at: number; text: Promise<string | undefined> } | null = null;
  let efforts: Promise<string[] | null> | null = null;
  let kept: { at: number; models: AgentModel[] } | null = null;
  let reading: Promise<AgentModel[] | null> | null = null;
  /** Asks Claude Code, one read at a time; keeps what it answers. A failure keeps the old list. */
  const readModels = () => {
    reading ??= runInput(command, MODEL_ARGS, { cwd, input: INITIALIZE, timeoutMs: 20_000 })
      .then((result) => parseClaudeModels(result.stdout))
      .catch(() => null)
      .then(async (models) => {
        if (models) {
          kept = { at: now(), models };
          if (modelsFile) {
            const text = JSON.stringify(
              {
                about: `Claude Code's models (${command}), as it lists them: Symbiote reads them again once a day (V47).`,
                read: new Date(kept.at).toISOString(),
                models,
              },
              null,
              2,
            );
            await mkdir(dirname(modelsFile), { recursive: true })
              .then(() => writeFile(`${modelsFile}.${process.pid}.tmp`, `${text}\n`))
              .then(() => rename(`${modelsFile}.${process.pid}.tmp`, modelsFile))
              .catch(() => undefined);
          }
        }
        reading = null;
        return models ?? kept?.models ?? null;
      });
    return reading;
  };
  const fresh = (list: typeof kept) => list !== null && now() - list.at < MODELS_KEPT_MS;
  const choose = (...args: (string | undefined)[]) => {
    const picked = args.find((value) => value !== undefined);
    return picked ? ['--model', picked] : [];
  };
  return {
    command,
    efforts() {
      efforts ??= run(command, ['--help'], { cwd, timeoutMs: 20_000 })
        .then((result) => (result.code === 0 ? parseEffortLevels(result.stdout) : null))
        .catch(() => null);
      return efforts;
    },
    models() {
      // Another view may have read them since: the file first, when the list in hand is old.
      if (!fresh(kept) && modelsFile) {
        const onDisk = readKeptModels(modelsFile);
        if (onDisk && (!kept || onDisk.at > kept.at)) kept = onDisk;
      }
      if (!kept) return readModels();
      if (!fresh(kept)) void readModels();
      return Promise.resolve(kept.models);
    },
    async start(request) {
      const args = [
        '--bg',
        '--name',
        request.name,
        '--add-dir',
        request.addDir,
        ...(request.settings ? ['--settings', request.settings] : []),
        ...(request.permissionMode === 'default'
          ? []
          : ['--permission-mode', request.permissionMode]),
        ...choose(request.model, model),
        ...(request.effort ? ['--effort', request.effort] : []),
        request.prompt,
      ];
      const result = await run(command, args, { cwd: request.cwd, timeoutMs: 60_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      return {
        ok: false,
        error: wordsOf(result) || `${basename(command)} exited with code ${result.code ?? 'none'}`,
      };
    },
    async startPageAgent(request) {
      const args = [
        '--bg',
        '--name',
        request.name,
        '--tools',
        request.tools.join(','),
        '--permission-mode',
        request.permissionMode,
        '--strict-mcp-config',
        '--settings',
        request.settings,
        ...choose(request.model, model),
        ...(request.effort ? ['--effort', request.effort] : []),
        request.prompt,
      ];
      const result = await run(command, args, { cwd: request.cwd, timeoutMs: 60_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      return {
        ok: false,
        error: wordsOf(result) || `${basename(command)} exited with code ${result.code ?? 'none'}`,
      };
    },
    async stop(id) {
      const result = await run(command, ['stop', id], { cwd, timeoutMs: 20_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      return { ok: false, error: wordsOf(result) || `could not stop ${id}` };
    },
    async resume(request) {
      const args = ['--bg', '--resume', request.sessionId, request.text];
      const result = await run(command, args, { cwd: request.cwd, timeoutMs: 60_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      return { ok: false, error: wordsOf(result) || `could not continue ${request.sessionId}` };
    },
    async remove(id) {
      const result = await run(command, ['rm', id], { cwd, timeoutMs: 20_000 });
      sessions = null;
      if (result.code === 0) return { ok: true };
      return { ok: false, error: wordsOf(result) || `could not remove ${id}` };
    },
    sessions() {
      if (!sessions || Date.now() - sessions.at > 2_000) {
        const list = run(command, ['agents', '--json', '--all'], { cwd, timeoutMs: 20_000 }).then(
          (result) => (result.code === 0 ? parseSessions(result.stdout) : null),
        );
        sessions = { at: Date.now(), list };
      }
      return sessions.list;
    },
    account() {
      if (!account || Date.now() - account.at > 60_000) {
        const text = Promise.all([
          run(command, ['auth', 'status'], { cwd, timeoutMs: 20_000 }),
          plan?.(),
        ]).then(([result, name]) => parseAccount(result.stdout, name));
        account = { at: Date.now(), text };
      }
      return account.text;
    },
  };
}

/** The last lines a program wrote, its error output first. */
function wordsOf(result: { stdout: string; stderr: string }): string {
  return (result.stderr.trim() || result.stdout.trim()).split('\n').slice(-3).join('\n');
}

/** Claude Code's program: `SYMBIOTE_CLAUDE` (a path or a command on PATH), else `claude` on PATH.
 * */
export async function findClaude(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const host = localHost(env);
  const custom = env.SYMBIOTE_CLAUDE?.trim();
  if (custom) {
    if (/[\\/]/.test(custom)) return (await host.isFile(custom)) ? custom : null;
    return onPath(host, custom);
  }
  return onPath(host, 'claude');
}

/** What `symbiote/config.json` says of workspaces and their agent; anything unknown is ignored. */
export interface WorkspaceConfig {
  branchPrefixes: Record<WorkKind, string>;
  worktrees?: string;
  /** The agent offered first (`agent.kind`, V20a). */
  agent?: AgentKind;
  /** Claude Code's permission mode and model. */
  permissionMode: PermissionMode;
  model?: string;
  /** Scout's effort level (`scout.effort`): a word; absent, each agent's own. */
  scoutEffort?: string;
}

/**
 * `features.branchPrefixes` sets a kind's prefix (V24), each kind its own by default (`fix/`);
 * `features.branchPrefix`, from before V24, sets the Feature's unless `branchPrefixes` does.
 * `agent.kind` names the agent offered first (V20a); `agent.permissionMode` and `agent.model`
 * are Claude Code's. `scout.effort` is the level Scout's conversations start at.
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
    scout?: { effort?: unknown } | null;
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
  const effort = v.scout?.effort;
  if (typeof effort === 'string' && EFFORT_LEVEL.test(effort)) config.scoutEffort = effort;
  return config;
}

/**
 * A start request's brief, checked: made from its kind, title and parts (V24), empty parts left
 * out; or, from a request made before V24, its brief as given.
 */
function workOf(
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

/** An agent found for a workspace: Claude Code or Codex (V20a). */
type FoundAgent = { kind: 'claude'; claude: ClaudeCode } | { kind: 'codex'; codex: Codex };

/** Each agent's name, as messages say it. */
const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' };

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
   * worktree's HEAD to the worktree. `previousPath`: where a renamed file was.
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

/** The hooks Symbiote passes to every workspace's agent (V18c): each event, recorded by
 * `agent-hook.js`. */
const HOOKED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'PreToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
] as const;

/** A path as one word of a hook's command line (Claude Code runs it in a shell). */
export function shellWord(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `"${path}"` : `'${path.replaceAll("'", "'\\''")}'`;
}

/**
 * Symbiote's settings file for its agents (V18c), `<symbiote>/claude-settings.json`: every event
 * runs
 * `agent-hook.js` with the `symbiote/` folder; `PreToolUse` only for questions. It decides nothing.
 */
export function agentSettings(
  where: { node: string; hook: string; symbiote: string },
  platform: NodeJS.Platform = process.platform,
): string {
  const command = [where.node, where.hook, where.symbiote]
    .map((p) => shellWord(p, platform))
    .join(' ');
  const hooks = Object.fromEntries(
    HOOKED_EVENTS.map((event) => [
      event,
      [
        {
          ...(event === 'PreToolUse' ? { matcher: 'AskUserQuestion' } : {}),
          hooks: [{ type: 'command', command, timeout: 30 }],
        },
      ],
    ]),
  );
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Opens a folder in the editor, or a file in it at a line (V29d) and column (V38); why not when it
 * cannot.
 */
export type OpenFolder = (
  folder: string,
  at?: FolderAt,
) => Promise<{ opened: true } | { opened: false; message: string }>;

/** How many commits, and files, a workspace's changes list (V29d). */
const MAX_LISTED_COMMITS = 100;
const MAX_LISTED_FILES = 300;

/** A file's lines as the changes list them: none for a binary file. */
const linesOf = (count: { added: number | null; removed: number | null } | undefined) =>
  count === undefined
    ? {}
    : count.added === null || count.removed === null
      ? { binary: true as const }
      : { added: count.added, removed: count.removed };

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
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  /** The folder holding `symbiote/` (or its stand-in in the cache): the agent may read it. */
  const symbioteFolder = (where: ReviewPlace) => dirname(where.dir);
  const workspacesDir = (where: ReviewPlace) => join(symbioteFolder(where), 'workspaces');
  /** `workspaces.worktrees` is relative to the checkout that holds `symbiote/`. */
  const mainRoot = (where: ReviewPlace) =>
    where.place === 'repository' ? dirname(symbioteFolder(where)) : repo.root;
  /** Where a workspace's documents go (V40): beside its record, the branch's slashes as folders. */
  const documentsDir = (where: ReviewPlace, branch: string) =>
    join(symbioteFolder(where), 'documents', ...branch.split('/'));
  /** Files uploaded for a workspace about to start (V40), each by its ID. */
  const uploads = join(cacheDir, 'state', repo.id, 'uploads');
  /** Commits' files as VS Code's diffs are given them (V43, decision 288), by commit and path. */
  const revisions = join(cacheDir, 'state', repo.id, 'revisions');

  /**
   * A commit's file kept for a diff (V43): written the first time, as a checkout in `checkout`
   * writes it, and read-only; null when the commit has no file there.
   */
  async function keptFile(checkout: GitRepo, sha: string, path: string): Promise<string | null> {
    const file = join(revisions, sha, ...path.split('/'));
    if (existsSync(file)) return file;
    const bytes = await fileForCheckout(checkout, sha, path);
    return bytes && keep(file, bytes);
  }

  const isFile = (path: string) =>
    stat(path).then(
      (s) => s.isFile(),
      () => false,
    );

  /** An empty file by that name: the side of a diff with no file. */
  const emptyFile = (path: string) =>
    keep(join(revisions, 'empty', ...path.split('/')), new Uint8Array());

  /** Writes a read-only file once: to a name of its own, then renamed (two clicks at once). */
  async function keep(file: string, bytes: Uint8Array): Promise<string> {
    if (existsSync(file)) return file;
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${randomBytes(4).toString('hex')}`;
    await writeFile(temporary, bytes, { mode: 0o444 });
    try {
      await rename(temporary, file);
    } catch (error) {
      // Windows does not rename onto a file: the other click's copy is the same.
      await rm(temporary, { force: true });
      if (!existsSync(file)) throw error;
    }
    return file;
  }

  /** Removes the uploads older than a week; only files Symbiote named. */
  async function sweepUploads(): Promise<void> {
    const oldest = now().getTime() - UPLOADS_KEPT_MS;
    for (const name of await readdir(uploads).catch(() => [] as string[])) {
      if (!UPLOAD.test(name)) continue;
      const file = join(uploads, name);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs < oldest) await rm(file, { force: true });
    }
  }

  /**
   * A start's documents, checked before anything is made (V40): every upload still kept, none
   * twice, at most 20 and 100 MB in all; each with the name it will have.
   */
  async function uploadsOf(
    asked: WorkspaceRequest['documents'],
  ): Promise<{ from: string; name: string }[]> {
    if (!asked || asked.length === 0) return [];
    if (asked.length > MAX_DOCUMENTS) {
      throw new WorkspaceRefused(`at most ${MAX_DOCUMENTS} files with a brief`, 400);
    }
    const seen = new Set<string>();
    const kept: { from: string; name: string }[] = [];
    let total = 0;
    for (const { id, name } of asked) {
      if (!UPLOAD.test(id)) throw new WorkspaceRefused(`not a document: ${id}`, 400);
      const named = documentName(name);
      if (seen.has(id)) throw new WorkspaceRefused(`${named} is given twice`, 400);
      seen.add(id);
      const from = join(uploads, id);
      const info = await stat(from).catch(() => null);
      if (!info?.isFile()) {
        throw new WorkspaceRefused(`${named} is no longer kept: add it again`, 400);
      }
      total += info.size;
      kept.push({ from, name: named });
    }
    if (total > MAX_DOCUMENTS_BYTES) {
      throw new WorkspaceRefused(
        `at most ${MAX_DOCUMENTS_BYTES / 2 ** 20} MB of files with a brief`,
        400,
      );
    }
    return kept;
  }

  /** Moves a start's uploads into `folder` under their names, a taken one numbered; the names. */
  async function placeDocuments(
    folder: string,
    files: { from: string; name: string }[],
  ): Promise<string[]> {
    await mkdir(folder, { recursive: true });
    const taken = new Set<string>();
    const names: string[] = [];
    for (const { from, name } of files) {
      const to = join(folder, freeName(name, taken));
      try {
        await rename(from, to);
      } catch (error) {
        // The cache on another file system than the repository.
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await copyFile(from, to, fsConstants.COPYFILE_EXCL);
        await rm(from, { force: true });
      }
      names.push(basename(to));
    }
    return names;
  }

  /** Removes a workspace's documents, and the folders left empty above them up to `documents/`. */
  async function removeDocuments(where: ReviewPlace, branch: string): Promise<void> {
    const top = join(symbioteFolder(where), 'documents');
    let folder = documentsDir(where, branch);
    await rm(folder, { recursive: true, force: true });
    while (folder !== top && folder.startsWith(top)) {
      folder = dirname(folder);
      const removed = await rmdir(folder).then(
        () => true,
        () => false,
      );
      if (!removed) break;
    }
  }

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

  async function save(where: ReviewPlace, workspace: WorkspaceFile): Promise<void> {
    const path = workspacePath(workspacesDir(where), workspace.branch);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, serializeWorkspace(workspace));
    await rename(temp, path);
  }

  async function records(where: ReviewPlace): Promise<WorkspaceFile[]> {
    const dir = workspacesDir(where);
    const files = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
    const list: WorkspaceFile[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const workspace = await readWorkspace(join(dir, file));
      // The file must be the branch's: a copied or renamed file is not that workspace.
      if (workspace && relative(dir, workspacePath(dir, workspace.branch)) === file) {
        list.push(workspace);
      }
    }
    return list.sort(
      (a, b) => a.created.localeCompare(b.created) || a.branch.localeCompare(b.branch),
    );
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
    if (onServer(workspace)) {
      // Its last two turns: the one that runs, and the answer before it.
      const { read, address } = await readServer(workspace, { turns: 2, items: 'summary' });
      agent = serverState(workspace, read, ahead, address);
      acted =
        (read instanceof Error ? undefined : serverLastAction(read)) ?? workspace.agent?.started;
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
          ? codexState(workspace, thread, await codexAlive(workspace), ahead)
          : agentState(workspace, sessions, ahead, real, ended);
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
    };
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

  /** A workspace's record; 404 without one. */
  async function recorded(where: ReviewPlace, branch: string): Promise<WorkspaceFile> {
    const workspace = await readWorkspace(workspacePath(workspacesDir(where), branch));
    if (!workspace) throw new WorkspaceRefused(`no workspace ${branch}`, 404);
    return workspace;
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

  /** A branch's commits from `base` to `tip`, and the files they change with their lines. */
  async function readBranchChanges(
    base: string,
    tip: string,
  ): Promise<Pick<WorkspaceChanges, 'commits' | 'files'>> {
    const [between, changed, counts] = await Promise.all([
      commitsBetween(repo, base, tip, MAX_LISTED_COMMITS),
      listChangedFiles(repo, base, tip),
      listLineCounts(repo, base, tip),
    ]);
    const commits = await commitDetails(repo, between.shas);
    const lines = new Map(counts.map((count) => [count.path, count]));
    let added = 0;
    let removed = 0;
    for (const count of counts) {
      added += count.added ?? 0;
      removed += count.removed ?? 0;
    }
    return {
      commits: {
        count: between.count,
        listed: commits.map(({ sha, subject, author, date }) => ({ sha, subject, author, date })),
      },
      files: {
        count: changed.length,
        added,
        removed,
        listed: changed
          .slice(0, MAX_LISTED_FILES)
          .map(({ status, path, previousPath }): WorkspaceFileChange => ({
            status,
            path,
            ...(previousPath ? { previousPath } : {}),
            ...linesOf(lines.get(path)),
          })),
      },
    };
  }

  /** The files a worktree has not committed, with the lines of those git tracks. */
  async function worktreeChanges(folder: string): Promise<WorkspaceChanges['uncommitted']> {
    const worktree = { ...repo, root: folder };
    const [files, counts] = await Promise.all([
      worktreeStatus(folder),
      listLineCounts(worktree, 'HEAD').catch(() => []),
    ]);
    const lines = new Map(counts.map((count) => [count.path, count]));
    return {
      count: files.length,
      listed: files.slice(0, MAX_LISTED_FILES).map(({ status, path, previousPath }) => ({
        status,
        path,
        ...(previousPath ? { previousPath } : {}),
        ...(status === 'untracked' ? {} : linesOf(lines.get(path))),
      })),
    };
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
    const listed = on ? (await modelsOf(agent))?.models.find((m) => m.id === on) : undefined;
    if (listed && !listed.efforts) {
      throw new WorkspaceRefused(
        `${listed.name} takes no effort level: start it at its default`,
        400,
      );
    }
    const levels = listed?.efforts?.levels ?? (await effortsOf(agent))?.levels;
    const problem = effortProblem(effort, listed?.name ?? AGENT_NAMES[agent.kind], levels);
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
        ...(await launchCodex(where, workspace, agent.codex, prompt, level)),
        ...level,
      };
      await save(where, workspace);
      await firstEntry(where, workspace);
    } else {
      // The session's first hooks run while `--bg` starts it: they look for this record.
      await save(where, workspace);
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
        ? { kind: 'claude', permissionMode, ...level, started: now().toISOString(), hooks: true }
        : { kind: 'claude', permissionMode, ...level, error: result.error };
    }
    await save(where, workspace);
    return prompt;
  }

  /**
   * Starts Codex on a workspace: a thread on its app server (V27a), else `codex exec` through
   * Symbiote's runner, which records its thread (V20a); its sandbox may also write what a commit on
   * the branch writes (decision 130). Threads it had on the server are kept, for Clean up.
   */
  async function launchCodex(
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
      run,
      writable,
      prompt,
      ...level,
    });
    return result.ok
      ? { ...head, started, run, pid: result.pid }
      : { ...head, error: result.error };
  }

  /** Whether a Codex workspace runs on the app server (V27a), not through Symbiote's runner. */
  const onServer = (workspace: WorkspaceFile) =>
    workspace.agent?.kind === 'codex' && workspace.agent.thread !== undefined;

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

  /** Turns a thread panel reads from the server: about 200 entries' worth. */
  const PANEL_TURNS = 50;

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
      if (entries.some((e) => e.run === run) || !(await codexAlive(workspace))) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Whether a Codex workspace's last run still runs (its runner's process). */
  async function codexAlive(workspace: WorkspaceFile): Promise<boolean> {
    const pid = workspace.agent?.pid;
    if (!pid) return false;
    return (await codex())?.alive(pid) ?? processAlive(pid);
  }

  /** Stops a Codex workspace's run; ends it in the thread when its runner could not. */
  async function stopCodex(
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

  /**
   * A message to Codex (V20a): its thread continued with the text (`exec resume`), its sandbox as
   * at the start; a run that lives is stopped first, only when asked (it loses its turn).
   */
  async function replyCodex(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    text: string,
    stop: boolean,
  ): Promise<WorkspaceReplied> {
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
    if (onServer(workspace)) return replyServer(where, workspace, text, stop);
    const thread = await readThreadEnd(symbioteFolder(where), workspace.branch);
    const state = codexState(workspace, thread, await codexAlive(workspace), 0);
    if (!state.id) {
      throw new WorkspaceRefused(
        'its agent has no session to continue: start the agent again',
        409,
      );
    }
    if (state.state === 'working') {
      if (!stop) throw new WorkspaceRefused('its agent is working: sending stops its turn', 409);
      await stopCodex(where, workspace, agent);
    }
    const run = randomUUID();
    const startedAt = now().toISOString();
    const level = startedAs(workspace.agent ?? {});
    const resumed = await agent.resume({
      cwd: workspace.worktree,
      thread: threadPath(symbioteFolder(where), workspace.branch),
      run,
      writable: await commitFolders(workspace.worktree, workspace.branch),
      sessionId: state.id,
      text,
      // Given again: `exec resume` keeps none of the start's options (V30 spike).
      ...level,
    });
    if (!resumed.ok) throw new WorkspaceRefused(resumed.error, 502);
    workspace.agent = { kind: 'codex', ...level, started: startedAt, run, pid: resumed.pid };
    await save(where, workspace);
    await firstEntry(where, workspace);
    const refs = await listRefs(repo);
    return { workspace: await summary(where, workspace, refs, await trunkOf(refs), []) };
  }

  /**
   * A message to Codex on its app server (V27a): a new turn, or joined to the one that runs (no
   * stop, no lost turn); a turn that waits on the person is interrupted first, only when asked.
   */
  async function replyServer(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    text: string,
    stop: boolean,
  ): Promise<WorkspaceReplied> {
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
    const refs = await listRefs(repo);
    return { workspace: await summary(where, workspace, refs, await trunkOf(refs), []) };
  }

  /**
   * Codex's own terminal on a workspace's thread (V27b): its TUI joined to the app server, in the
   * worktree. Codex asks to trust each worktree the first time and saves the answer in the
   * person's configuration: said when it will ask (decision 160), never answered by Symbiote.
   */
  async function codexTerminal(
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
      const list = (await records(where)).filter((f) => !f.finished);
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
      const documents = await uploadsOf(request.documents);
      const refs = await listRefs(repo);
      const problem = await branchNameProblem(repo, request.branch, refs);
      if (problem) {
        const taken =
          refs.branches.some((b) => b.name === request.branch) ||
          refs.remotes.some((r) => r.branch === request.branch);
        throw new WorkspaceRefused(problem, taken ? 409 : 400);
      }
      let base: { from?: string; sha: string };
      if (request.base !== undefined && request.from !== undefined) {
        throw new WorkspaceRefused('start from a branch or a commit, not both', 400);
      }
      if (request.from !== undefined) {
        const sha =
          typeof request.from === 'string' ? await newestTip(repo, refs, request.from) : null;
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
      const workspace = await recorded(where, branch);
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
      return promptOf(where, await recorded(where, branch));
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

    async saveDocument(name, bytes) {
      if (bytes.length > MAX_DOCUMENT_BYTES) {
        throw new WorkspaceRefused(`a document of at most ${MAX_DOCUMENT_BYTES / 2 ** 20} MB`, 413);
      }
      await mkdir(uploads, { recursive: true, mode: 0o700 });
      await sweepUploads();
      const id = randomBytes(16).toString('hex');
      await writeFile(join(uploads, id), bytes, { mode: 0o600, flag: 'wx' });
      return { id, name: documentName(name), size: bytes.length };
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
      const workspace = await recorded(where, branch);
      if (onServer(workspace)) {
        const server = await serverOf();
        const { read } = await readServer(workspace, { turns: 1, items: 'summary' });
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
        const live = codexState(workspace, thread, await codexAlive(workspace), 0);
        if (!agent || live.state !== 'working') {
          throw new WorkspaceRefused('its agent is not running', 409);
        }
        await stopCodex(where, workspace, agent);
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
      const workspace = await recorded(await place(), branch);
      if (!existsSync(workspace.worktree)) {
        throw new WorkspaceRefused(`its worktree is gone: ${workspace.worktree}`, 409);
      }
      if (!openFolder) throw new WorkspaceRefused('no editor to open it in', 409);
      const result = await openFolder(workspace.worktree);
      if (!result.opened) throw new WorkspaceRefused(result.message, 502);
    },

    async openDiff(branch, file) {
      const workspace = await recorded(await place(), branch);
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
        left = await keptFile(worktree, await resolveCommit(worktree, 'HEAD'), before);
        right = (await isFile(own)) ? own : null;
      } else {
        const refs = await listRefs(repo);
        const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha;
        if (!tip) throw new WorkspaceRefused(`its branch ${workspace.branch} is gone`, 409);
        const { base } = await changesBase(workspace, refs, tip);
        left = await keptFile(worktree ?? repo, base, before);
        right = await keptFile(worktree ?? repo, tip, file.path);
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
      const result = await openFolder(worktree ? workspace.worktree : repo.root, {
        left: left ?? (await emptyFile(before)),
        right: right ?? (await emptyFile(file.path)),
      });
      if (!result.opened) throw new WorkspaceRefused(result.message, 502);
    },

    async changes(branch) {
      const workspace = await recorded(await place(), branch);
      const refs = await listRefs(repo);
      const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha ?? null;
      const uncommitted = existsSync(workspace.worktree)
        ? await worktreeChanges(workspace.worktree)
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
        kept = { key, read: readBranchChanges(where.base, tip) };
        branchChanges.set(branch, kept);
        kept.read.catch(() => branchChanges.delete(branch));
      }
      return { branch, ...where, tip, ...(await kept.read), uncommitted };
    },

    async merge(branch) {
      const workspace = await recorded(await place(), branch);
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
      const workspace = await recorded(where, branch);
      let entries: ThreadEntry[];
      if (onServer(workspace)) {
        // From the server (decision 155); none when it cannot be read: the state says why.
        const { read } = await readServer(workspace, { turns: PANEL_TURNS, items: 'full' });
        entries =
          read instanceof Error
            ? []
            : serverEntries(read, { first: read.turns.length < PANEL_TURNS }).slice(-THREAD_LIMIT);
      } else entries = await readThread(symbioteFolder(where), branch);
      const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
      const verdict = review?.verdicts.at(-1);
      const shown = (path: string) =>
        where.place === 'repository' ? relative(repo.root, path).split(sep).join('/') : path;
      return {
        entries,
        // Claude Code's hooks record it (V18c); Symbiote's runner records Codex's (V20a), or
        // Codex's app server keeps it (V27a).
        recorded: workspace.agent?.hooks === true || workspace.agent?.kind === 'codex',
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
      const workspace = await recorded(where, branch);
      if (workspace.agent?.kind === 'codex' && !onServer(workspace)) {
        throw new WorkspaceRefused(
          'Codex has no terminal in Symbiote without its app server: Talk copies `codex resume`, to run in yours',
          409,
        );
      }
      if (!terminals) throw new WorkspaceRefused('no terminals here', 409);
      const can = await terminals.available();
      if (!can.available) throw new WorkspaceRefused(can.reason, 409);
      if (onServer(workspace)) return codexTerminal(workspace, terminals, cols, rows);
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
      const workspace = await recorded(await place(), branch);
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
      await recorded(await place(), branch);
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
      const workspace = await recorded(where, branch);
      if (workspace.agent?.kind === 'codex')
        return replyCodex(where, workspace, text, stop === true);
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
      const workspace = await recorded(where, branch);
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
        if (await codexAlive(workspace)) await stopCodex(where, workspace, codexAgent);
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
      await save(where, workspace);
      return { finished: workspace.finished };
    },
  };
}
