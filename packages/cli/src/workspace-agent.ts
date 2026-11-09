// A workspace's agent (V18, V20a): found, its model and level checked, its prompt, launched with
// Symbiote's hooks and settings; whether a stopped session has ended.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_KINDS,
  defaultBranch,
  listRefs,
  EFFORT_LEVEL,
  MODEL_ID,
  type AgentEfforts,
  type AgentKind,
  type AgentModels,
  type PermissionMode,
} from '@symbiote/core';
import { copyHook } from './agent-hook-copy.js';
import { readPrompts } from './prompts.js';
import { fillPrompt } from './prompt-text.js';
import { HIVE_ROUNDS } from './hive-record.js';
import { projectCheck } from './merge-config.js';
import type { Codex } from './codex.js';
import {
  AGENT_NAMES,
  effortOnProblem,
  effortWordProblem,
  modelProblem,
  modelWordProblem,
} from './agent-levels.js';
import { agentSettings, type ClaudeCode } from './claude-code.js';
import { documentsDir } from './workspace-documents.js';
import {
  startedAs,
  workspacePath,
  symbioteFolder,
  workspacesDir,
  WorkspaceRefused,
  writeRecord,
  type StartedAs,
  type WorkspaceFile,
} from './workspace-record.js';
import { workspacePrompt } from './workspace-start.js';
import type { ReviewPlace } from './reviews.js';
import { writeFileWhole } from './file-write.js';
import type { WorkspacesContext } from './workspace-context.js';

/** An agent found for a workspace: Claude Code or Codex (V20a). */
export type FoundAgent = { kind: 'claude'; claude: ClaudeCode } | { kind: 'codex'; codex: Codex };

/** The levels `agent` takes (V30b); null when Symbiote cannot read them. */
export async function effortsOf(agent: FoundAgent): Promise<AgentEfforts | null> {
  if (agent.kind === 'codex') return agent.codex.efforts();
  const levels = await agent.claude.efforts();
  return levels ? { levels } : null;
}

/** The models `agent` lists (V47); null when Symbiote cannot read them. */
export async function modelsOf(agent: FoundAgent): Promise<AgentModels | null> {
  if (agent.kind === 'codex') return agent.codex.models();
  const models = await agent.claude.models();
  return models ? { models } : null;
}

/** How a workspace's agent is found, checked and launched. */
export function workspaceAgent({
  attached,
  cacheDir,
  claude,
  codex,
  config,
  hook,
  node,
  now,
  repo,
  root,
  stopWaitMs,
  terminals,
  viaCodex,
}: Pick<
  WorkspacesContext,
  | 'attached'
  | 'cacheDir'
  | 'claude'
  | 'codex'
  | 'config'
  | 'hook'
  | 'node'
  | 'now'
  | 'repo'
  | 'root'
  | 'stopWaitMs'
  | 'terminals'
  | 'viaCodex'
>) {
  /** This process's copy of its hook in the cache (decision 721), made at the first need. */
  let copied: Promise<string> | null = null;

  /**
   * The hook the settings name: the one given, else this build's copy in the cache, which no
   * deleted worktree takes with it. A copy that fails names the build's own, as before, and is
   * tried again at the next need.
   */
  function hookPath(): Promise<string> {
    if (hook) return Promise.resolve(hook);
    const dist = fileURLToPath(new URL('.', import.meta.url));
    copied ??= copyHook(dist, cacheDir);
    return copied.catch(() => {
      copied = null;
      return join(dist, 'agent-hook.js');
    });
  }

  /**
   * Symbiote's settings file, written when its text differs (Symbiote moved) or it is gone: a
   * session that wakes reads it again, and does not start without it (V18c spike). Its path.
   */
  async function settingsFile(where: ReviewPlace): Promise<string> {
    const path = join(symbioteFolder(where), 'claude-settings.json');
    const text = agentSettings({
      node,
      hook: await hookPath(),
      symbiote: symbioteFolder(where),
      cache: cacheDir,
    });
    if ((await readFile(path, 'utf8').catch(() => null)) !== text) {
      await writeFileWhole(path, text);
    }
    return path;
  }

  /**
   * What `{hive}` becomes for a workspace Hive drives (HV2): Hive's start text with the check it
   * will run, from the commit the workspace started at.
   */
  async function hiveText(workspace: WorkspaceFile): Promise<string | undefined> {
    if (!workspace.hive) return undefined;
    const check = await projectCheck(repo, root, workspace.base).catch(() => null);
    return fillPrompt(readPrompts(root).text['hive.start'], {
      check: check
        ? check.commands.map((command) => `\`${command}\``).join(', then ')
        : 'none is set or found, so the person checks it',
      rounds: String(HIVE_ROUNDS),
    });
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
        ...(workspace.hive ? { hive: await hiveText(workspace) } : {}),
      },
      readPrompts(root).text,
    );
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

  /**
   * The agent a workspace gets unless one is picked: `agent.kind`, else Claude Code, else Codex.
   */
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

  /**
   * Whether a stopped session has ended, within `stopWaitMs`, read again every 200 ms: Claude Code
   * lists no process for it (no `status`), and every terminal of this view attached to it has
   * ended. A `claude attach` client outlives the stop by about a second, and a resume meanwhile
   * starts a copy as for a running session (measured, fix/hive-runner-flaws). A list Claude Code
   * cannot give is no answer: taken as ended.
   */
  async function processEnded(agent: ClaudeCode, id: string): Promise<boolean> {
    const until = Date.now() + stopWaitMs;
    const clients = attached.get(id) ?? new Set<string>();
    for (;;) {
      const listed = await agent.sessions({ fresh: true });
      const session = listed?.find((s) => s.id === id);
      for (const client of clients)
        if (terminals?.running(client) === undefined) clients.delete(client);
      if (clients.size === 0) attached.delete(id);
      if ((!listed || session?.status === undefined) && clients.size === 0) return true;
      if (Date.now() >= until) return false;
      await new Promise((done) => setTimeout(done, 200));
    }
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

  return {
    settingsFile,
    found,
    defaultAgent,
    modelFor,
    effortFor,
    promptOf,
    launch,
    processEnded,
    agentOf,
  };
}

export type WorkspaceAgent = ReturnType<typeof workspaceAgent>;
