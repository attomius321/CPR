import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AGENT_KINDS,
  EFFORT_LEVEL,
  MODEL_ID,
  PERMISSION_MODES,
  WORK_KINDS,
  type GitRepo,
  type WorkKind,
} from '@symbiote/core';
import { ADVISING_AGENTS } from './workspace-advice.js';
import { workspaceCodex } from './workspace-codex.js';
import { workspaceLaunches } from './workspace-launches.js';
import { symbioteFolder } from './workspace-record.js';
import { CONFIG_FILES } from './plugins.js';
import { reviewPlace, type ReviewPlace } from './reviews.js';
import { workspacesFolder } from './thread.js';
import type {
  WorkspaceConfig,
  Workspaces,
  WorkspacesOptions,
  WorkspacesContext,
} from './workspace-context.js';
import { workspaceTrunk } from './workspace-trunk.js';
import { workspaceAgent } from './workspace-agent.js';
import { workspaceSummary } from './workspace-summary.js';
import { workspaceLifecycle } from './workspace-lifecycle.js';
import { workspaceAdvisor } from './workspace-advisor.js';
import { workspaceOptions } from './workspace-options.js';
import { workspaceOpen } from './workspace-open.js';
import { workspaceChanges } from './workspace-changes.js';

/**
 * `features.branchPrefixes` sets a kind's prefix (V24), each kind its own by default (`fix/`);
 * `features.branchPrefix`, from before V24, sets the Feature's unless `branchPrefixes` does.
 * `agent.kind` names the agent offered first (V20a); `agent.permissionMode` and `agent.model`
 * are Claude Code's. `nucleus.effort` and `scribe.effort` are the levels Nucleus's and Scribe's
 * conversations start at; `nucleus.model` and `scribe.model` the models they start on (V47);
 * `scout.effort` and `scout.model`, Nucleus's before NU1, while it has none of its own (decision
 * 590); `nucleus.web: false` takes the web from its next conversations (NU1);
 * `advisor.<agent>.model` and `.effort` what the advisor runs on with that agent (V75c).
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
    nucleus?: { effort?: unknown; model?: unknown; web?: unknown } | null;
    /** Nucleus's section before NU1, still read for what `nucleus` does not say. */
    scout?: { effort?: unknown; model?: unknown } | null;
    scribe?: { effort?: unknown; model?: unknown } | null;
    advisor?: Partial<Record<string, { effort?: unknown; model?: unknown } | null>> | null;
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
  const nucleusEffort = level(v.nucleus?.effort ?? v.scout?.effort);
  if (nucleusEffort) config.nucleusEffort = nucleusEffort;
  const scribeEffort = level(v.scribe?.effort);
  if (scribeEffort) config.scribeEffort = scribeEffort;
  const id = (value: unknown) =>
    typeof value === 'string' && MODEL_ID.test(value) ? value : undefined;
  const nucleusModel = id(v.nucleus?.model ?? v.scout?.model);
  if (nucleusModel) config.nucleusModel = nucleusModel;
  if (v.nucleus?.web === false) config.nucleusWeb = false;
  const scribeModel = id(v.scribe?.model);
  if (scribeModel) config.scribeModel = scribeModel;
  for (const kind of ADVISING_AGENTS) {
    const model = id(v.advisor?.[kind]?.model);
    const effort = level(v.advisor?.[kind]?.effort);
    if (!model && !effort) continue;
    const pick = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
    config.advisor = { ...config.advisor, [kind]: pick };
  }
  return config;
}

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
    hook,
    node = process.execPath,
    terminals,
    advisor,
    hive,
    stopWaitMs = 10_000,
    hivePacing,
  }: WorkspacesOptions,
): Workspaces {
  const hiveOn = async () => (await hive?.().catch(() => false)) ?? false;
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

  /** Each workspace's shells (V45), by branch: they live as long as `symbiote view`. */
  const shellsByBranch = new Map<string, { id: string; number: number }[]>();

  /** This view's terminals on each Claude Code session (`claude attach`), by the session's ID. */
  const attached = new Map<string, Set<string>>();

  const ctx: WorkspacesContext = {
    repo,
    cacheDir,
    claude,
    codex,
    now,
    env,
    root,
    openFolder,
    hook,
    node,
    terminals,
    advisor,
    hive,
    stopWaitMs,
    hivePacing,
    hiveOn,
    place,
    config,
    mainRoot,
    viaCodex,
    uploads,
    attached,
    shellsByBranch,
    launches: workspaceLaunches(),
  };
  const trunk = workspaceTrunk(ctx);
  const agent = workspaceAgent(ctx);
  // `exportActivity` reads a workspace's changes as the service answers them.
  const summaries = workspaceSummary(
    ctx,
    { ...trunk, ...agent },
    {
      changes: (branch) => service.changes(branch),
    },
  );
  const open = workspaceOpen(ctx, { ...trunk, ...agent });
  const service: Workspaces = {
    ...workspaceOptions(ctx).ops,
    ...summaries.ops,
    ...workspaceAdvisor(ctx, agent).ops,
    ...workspaceLifecycle(ctx, { ...trunk, ...agent, ...summaries, ...open }).ops,
    ...open.ops,
    ...workspaceChanges(ctx, trunk).ops,
  };
  return service;
}
