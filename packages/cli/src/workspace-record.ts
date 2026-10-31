// A workspace's record on disk (V18): `symbiote/workspaces/<branch>.json`, how it is written and
// read back, and the refusal every workspace request answers with.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import {
  AGENT_KINDS,
  EFFORT_LEVEL,
  MODEL_ID,
  PERMISSION_MODES,
  WORK_KINDS,
  type AgentKind,
  type BriefParts,
  type McpVia,
  type PermissionMode,
  type WorkKind,
} from '@symbiote/core';
import { sortKeys, type ReviewPlace } from './reviews.js';
import { BRIEF_PARTS } from './workspace-brief.js';
import { writeFileWhole } from './file-write.js';

/**
 * What a record says it was made through (MC1, decision 362): `nucleus` or `mcp`; `scout`, Nucleus's
 * name before NU1, read as `nucleus` and never rewritten (decision 590).
 */
export function viaOf(value: unknown): { via?: McpVia } {
  if (value === 'nucleus' || value === 'scout') return { via: 'nucleus' };
  return value === 'mcp' ? { via: 'mcp' } : {};
}

/** A workspace on disk: `symbiote/workspaces/<branch>.json` (V18; `symbiote/features/` before V25),
 * one per branch. */
export interface WorkspaceFile {
  /** The agent started for it; null when none was found. */
  agent: WorkspaceAgentRecord | null;
  /**
   * The branch picked to review it against (V65): its Review, changes and merge start at the fork
   * point with it; absent: where it started.
   */
  against?: string;
  /** The commit the branch started at (full SHA). */
  base: string;
  branch: string;
  brief: string;
  /** Who started it (`user.email`). */
  by?: string;
  created: string;
  /** The branch `base` was the tip of; absent when a row was picked. */
  from?: string;
  /** When it was cleaned up (V18c): no longer listed, but in History (V77). */
  finished?: string;
  /**
   * Where its branch ended when it was cleaned up (V77, decision 566): its tip then, and whether
   * that was merged into the default branch. Absent on records cleaned up before V77.
   */
  tip?: string;
  merged?: true;
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
  /** Started through Symbiote's tools (MC1, decision 362): by Nucleus, or through `symbiote mcp`. */
  via?: McpVia;
  /**
   * Started while Hive was on (HV2, decision 652): Hive's runner drives it, its state in
   * `symbiote/hive/<branch>.json`.
   */
  hive?: true;
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
  /**
   * Hermes (V58): when Symbiote's Stop hung it up. Hermes then closes the turn it was in with a
   * message of its own, which is no answer: it reads stopped until it is continued or started
   * again, which clears this.
   */
  stopped?: string;
  /** Why the last start failed, in the agent's words. */
  error?: string;
  /** Started with Symbiote's hooks (V18c): its thread is recorded. */
  hooks?: boolean;
  /**
   * Started with its tools recorded (V48f): Claude Code's tools' hooks, or Symbiote's Codex runner
   * writing its items, in `symbiote/activity/<branch>.jsonl`.
   */
  activity?: boolean;
}

/** Every workspace file's first key: where an agent that opens it finds its instructions. */
export const WORKSPACE_ABOUT =
  'A workspace started in Symbiote. Agents: read symbiote/AGENTS.md before acting on it.';

/** A commit's full name: SHA-1's 40 hex digits, or SHA-256's 64. */
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

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
    ...(text(v.against) ? { against: text(v.against) } : {}),
    base: text(v.base),
    branch: text(v.branch),
    brief: text(v.brief),
    ...(text(v.by) ? { by: text(v.by) } : {}),
    created: text(v.created),
    ...documentsRead(v.documents),
    ...(text(v.from) ? { from: text(v.from) } : {}),
    ...(text(v.finished) ? { finished: text(v.finished) } : {}),
    ...(SHA.test(text(v.tip)) ? { tip: text(v.tip) } : {}),
    ...(v.merged === true ? { merged: true as const } : {}),
    ...kindOf(v.kind),
    ...partsRead(v.parts),
    planFirst: v.planFirst === true,
    ...(text(v.title) ? { title: text(v.title) } : {}),
    ...viaOf(v.via),
    ...(v.hive === true ? { hive: true as const } : {}),
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
  for (const part of BRIEF_PARTS) {
    const text = v[part];
    if (typeof text === 'string' && text.trim() !== '') parts[part] = text;
  }
  return Object.keys(parts).length > 0 ? { parts } : {};
}

/** How an agent was started (V30b, V47): its level and its model, each absent for its own. */
export type StartedAs = Pick<WorkspaceAgentRecord, 'effort' | 'model'>;

/** `how` with only the fields it has: what a start passes and a record keeps. */
export const startedAs = ({ effort, model }: StartedAs): StartedAs => ({
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
    ...(kind === 'hermes' && typeof v.stopped === 'string' ? { stopped: v.stopped } : {}),
    ...(typeof v.error === 'string' ? { error: v.error } : {}),
    ...(v.hooks === true ? { hooks: true } : {}),
    ...(v.activity === true ? { activity: true } : {}),
  };
}

/** The folder holding `symbiote/` (or its stand-in in the cache): the agent may read it. */
export const symbioteFolder = (where: ReviewPlace) => dirname(where.dir);

/** Where the records are: `workspaces/` beside the reviews. */
export const workspacesDir = (where: ReviewPlace) => join(symbioteFolder(where), 'workspaces');

/** Writes a workspace's record whole (`writeFileWhole`). */
export async function writeRecord(where: ReviewPlace, workspace: WorkspaceFile): Promise<void> {
  const path = workspacePath(workspacesDir(where), workspace.branch);
  await writeFileWhole(path, serializeWorkspace(workspace));
}

/** Every workspace's record in `where`, oldest first; a file not its branch's is left out. */
export async function readRecords(where: ReviewPlace): Promise<WorkspaceFile[]> {
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

/** A workspace's record; 404 without one. */
export async function readRecord(where: ReviewPlace, branch: string): Promise<WorkspaceFile> {
  const workspace = await readWorkspace(workspacePath(workspacesDir(where), branch));
  if (!workspace) throw new WorkspaceRefused(`no workspace ${branch}`, 404);
  return workspace;
}
