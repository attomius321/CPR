// Symbiote's MCP: the workspaces' tools (MC1): the list, one workspace, its thread and activity,
// the start's options and advice, a message, a stop; a start, a restart and a clean-up asked.
import {
  AGENT_KINDS,
  WORK_KINDS,
  type AgentKind,
  type McpCaller,
  type SuggestRequest,
  type WorkspaceRequest,
  type WorkspaceSummary,
} from '@symbiote/core';
import { AGENT_NAMES } from './agent-levels.js';
import { parseSuggestRequest, parseWorkspaceRequest } from './server-requests.js';
import type { McpContext, McpRead, McpAsking } from './mcp-context.js';
import type { McpLookup } from './mcp-lookup.js';
import {
  via,
  ToolProblem,
  words,
  branchOf,
  flag,
  count,
  plural,
  MAX_STARTS,
  MAX_CLEANS,
  START_FIELDS,
  type Args,
} from './mcp-tools.js';

/**
 * Most of an activity `activity` gives (V84, decision 672): ~15K tokens, under Claude Code's
 * limit on a tool's answer (25K).
 */
const MAX_ACTIVITY = 60 * 1024;

/** A workspace as a list gives it: no brief, no paths. */
function row(w: WorkspaceSummary) {
  const { state, kind, waitingFor, interrupted, error } = w.agent;
  return {
    branch: w.branch,
    ...(w.kind ? { kind: w.kind } : {}),
    ...(w.title ? { title: w.title } : {}),
    agent: {
      state,
      ...(kind ? { kind } : {}),
      ...(waitingFor ? { waitingFor } : {}),
      ...(interrupted ? { interrupted } : {}),
      ...(error ? { error } : {}),
    },
    planFirst: w.planFirst,
    ahead: w.ahead,
    merged: w.merged,
    created: w.created,
    ...(w.lastAction ? { lastAction: w.lastAction } : {}),
    ...(w.worktree.exists ? {} : { worktree: 'gone' }),
    ...(w.worktree.changed ? { uncommitted: w.worktree.changed } : {}),
    ...(w.via ? { via: w.via } : {}),
  };
}

/** The workspaces tools: those that run at once, and those that ask. */
export function mcpWorkspaces(
  { services, exclusive }: Pick<McpContext, 'services' | 'exclusive'>,
  { service, workspaceOf }: Pick<McpLookup, 'service' | 'workspaceOf'>,
) {
  const reads: Record<string, McpRead> = {
    async workspaces() {
      const { workspaces } = await service('workspaces').list();
      return { workspaces: workspaces.map(row) };
    },

    async workspace(args) {
      const branch = branchOf(args);
      const w = await workspaceOf(branch);
      const ws = service('workspaces');
      const [changes, merge, reviews] = await Promise.all([
        ws.changes(branch),
        ws.merge(branch).catch((error: Error) => ({ error: error.message })),
        services.reviews?.list().catch(() => null),
      ]);
      const review = reviews?.reviews.find((r) => r.branch === branch);
      return {
        ...row(w),
        // Where Nucleus reads its files and uncommitted changes (V80).
        ...(w.worktree.exists ? { worktree: w.worktree.path } : {}),
        ...(w.from ? { from: w.from } : {}),
        base: w.base,
        tip: w.tip,
        brief: w.brief,
        ...(w.documents ? { documents: w.documents.files } : {}),
        commits: changes.commits,
        files: { ...changes.files, listed: changes.files.listed.slice(0, 100) },
        ...(changes.uncommitted ? { uncommitted: changes.uncommitted } : {}),
        merge,
        ...(review
          ? {
              review: {
                marks: review.marks,
                ...(review.verdict ? { verdict: review.verdict } : {}),
              },
            }
          : {}),
      };
    },

    async thread(args) {
      const branch = branchOf(args);
      const last = count(args, 'last', 20, 100, 'a count from 1 to 100');
      const thread = await service('workspaces').thread(branch);
      const cut = (text: string) => (text.length > 4000 ? `${text.slice(0, 4000)} […]` : text);
      return {
        recorded: thread.recorded,
        entries: thread.entries
          .slice(-last)
          .map((e) => ('text' in e ? { ...e, text: cut(e.text) } : e)),
        ...(thread.verdict ? { verdict: thread.verdict } : {}),
      };
    },

    async activity(args) {
      const nucleus = flag(args, 'nucleus');
      const named = args.branch !== undefined;
      if (nucleus === named)
        throw new ToolProblem("branch: a workspace's branch, or nucleus: true");
      const within = { maxBytes: MAX_ACTIVITY };
      if (!nucleus) {
        return (await service('workspaces').exportActivity(branchOf(args), 'markdown', within))
          .text;
      }
      const own = services.nucleus?.exportActivity;
      if (!own) throw new ToolProblem('nucleus: none in this Symbiote');
      return (await own('markdown', within)).text;
    },

    async start_options() {
      const o = await service('workspaces').options();
      return {
        base: o.base,
        branches: o.branches.slice(0, 50),
        branchPrefixes: o.branchPrefixes,
        kinds: o.kinds,
        agents: o.agents,
        maxBrief: o.maxBrief,
      };
    },

    // Not asked (decision 582): a proposal, which starts nothing; the start that follows asks.
    async suggest_settings(args) {
      const picked = Object.fromEntries(
        ['kind', 'title', 'parts', 'agent', 'documents']
          .filter((k) => args[k] !== undefined)
          .map((k) => [k, args[k]]),
      );
      let request: SuggestRequest;
      try {
        request = parseSuggestRequest(JSON.stringify(picked));
      } catch (error) {
        throw new ToolProblem((error as Error).message);
      }
      return service('workspaces').suggest(request);
    },

    async reply(args) {
      const branch = branchOf(args);
      const text = words(args, 'text', 'the message for the agent');
      const stop = flag(args, 'stop');
      const replied = await exclusive('a message is being sent', () =>
        service('workspaces').reply({
          branch,
          text,
          by: 'nucleus',
          ...(stop ? { stop: true } : {}),
        }),
      );
      return { workspace: row(replied.workspace), ...(replied.copy ? { copy: replied.copy } : {}) };
    },

    async stop_agent(args) {
      const branch = branchOf(args);
      const stopped = await service('workspaces').stopAgent(branch);
      return { workspace: row(stopped.workspace) };
    },
  };
  const ws = () => service('workspaces');

  /** One start's fields, checked as `/api/workspaces` checks them; its words but for the branch. */
  async function startOf(fields: Args, agents: () => Promise<AgentKind | undefined>) {
    const picked = Object.fromEntries(
      START_FIELDS.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]]),
    );
    let request: WorkspaceRequest;
    try {
      request = parseWorkspaceRequest(JSON.stringify(picked));
    } catch (error) {
      throw new ToolProblem((error as Error).message);
    }
    if (!request.kind || !WORK_KINDS.includes(request.kind)) {
      throw new ToolProblem(`kind: ${WORK_KINDS.join(', ')}`);
    }
    if (request.agent !== undefined && !AGENT_KINDS.includes(request.agent)) {
      throw new ToolProblem(`agent: ${AGENT_KINDS.join(' or ')}`);
    }
    const agent: AgentKind | undefined = request.agent ?? (await agents());
    // The settings it starts with, so the person confirms them too (decision 584).
    const by = `${agent ? `with ${AGENT_NAMES[agent]}` : 'with no agent installed'}${
      request.model ? ` on ${request.model}` : ''
    }${request.effort ? ` at ${request.effort}` : ''}`;
    const rest = `${by}${request.planFirst ? ', plan first' : ''}${
      request.from ? `, from ${request.from}` : ''
    }`;
    return { request, rest };
  }

  /** A start, once confirmed: one at a time, as the page's (the server's one-at-a-time rule). */
  const startNow = (request: WorkspaceRequest, caller: McpCaller) =>
    exclusive('a workspace is being started', () =>
      ws().start({ ...request, via: via(caller) }),
    ).then((started) => ({ workspace: row(started.workspace) }));

  const asking: Record<string, McpAsking> = {
    async start_workspace(args, caller) {
      const firstAgent = async () => (await ws().options()).agents[0]?.kind;
      if (args.workspaces === undefined) {
        const { request, rest } = await startOf(args, firstAgent);
        const title = request.title ? `, "${request.title}"` : '';
        return {
          words: `Start ${request.branch}${title}, ${rest}`,
          act: () => startNow(request, caller),
        };
      }
      // Several in one Confirm (MC3, decision 987).
      if (START_FIELDS.some((k) => args[k] !== undefined)) {
        throw new ToolProblem("workspaces: a list of starts, or one start's fields, not both");
      }
      const listed = args.workspaces;
      if (!Array.isArray(listed) || listed.length < 1 || listed.length > MAX_STARTS) {
        throw new ToolProblem(`workspaces: 1 to ${MAX_STARTS} starts`);
      }
      const [options, { workspaces }] = await Promise.all([ws().options(), ws().list()]);
      const agent = () => Promise.resolve(options.agents[0]?.kind);
      const starts: Awaited<ReturnType<typeof startOf>>[] = [];
      for (const [i, one] of listed.entries()) {
        if (!one || typeof one !== 'object' || Array.isArray(one)) {
          throw new ToolProblem(`workspaces[${i + 1}]: a start's fields`);
        }
        try {
          starts.push(await startOf(one as Args, agent));
        } catch (error) {
          throw new ToolProblem(`workspaces[${i + 1}]: ${(error as Error).message}`);
        }
      }
      const twice = starts.find((s, i) =>
        starts.some((t, j) => j < i && t.request.branch === s.request.branch),
      );
      if (twice) throw new ToolProblem(`workspaces: ${twice.request.branch} twice`);
      const items = starts.map(({ request, rest }) => {
        const branch = request.branch;
        // Checked before asking: what the start would refuse (MC3).
        const cant = workspaces.some((w) => w.branch === branch)
          ? `a workspace ${branch} exists already`
          : options.branches.some((b) => b.name === branch && !b.remote)
            ? `a branch ${branch} exists already`
            : undefined;
        return {
          name: branch,
          words: `${request.title ? `“${request.title}”, ` : ''}${rest}`,
          ...(cant ? { cant } : {}),
          act: () => startNow(request, caller),
        };
      });
      if (items.every((item) => item.cant)) {
        throw new ToolProblem(items.map((item) => `${item.name}: ${item.cant}`).join('; '));
      }
      return { words: `Start ${plural(items.length, 'workspace')}`, items, did: 'started' };
    },

    async restart_agent(args) {
      const branch = branchOf(args);
      const w = await workspaceOf(branch);
      const kind = w.agent.kind;
      return {
        words: `Start ${branch}'s agent again${kind ? ` (${AGENT_NAMES[kind]})` : ''}`,
        act: () =>
          exclusive('a workspace is being started', () =>
            service('workspaces').startAgent(branch),
          ).then((started) => ({ workspace: row(started.workspace) })),
      };
    },

    async clean_workspace(args) {
      const unmerged = flag(args, 'unmerged');
      if (args.branches === undefined) {
        const branch = branchOf(args);
        await workspaceOf(branch);
        return {
          words: unmerged
            ? `Clean up ${branch}: its agent's sessions and its worktree; its branch stays, not merged`
            : `Clean up ${branch}: its agent's sessions and its worktree, and its branch once merged`,
          act: () => ws().clean({ branch, ...(unmerged ? { unmerged: true } : {}) }),
        };
      }
      // Several in one Confirm (MC3, decision 987).
      if (args.branch !== undefined) {
        throw new ToolProblem("branches: a list of workspaces' branches, or branch, not both");
      }
      const listed = args.branches;
      if (
        !Array.isArray(listed) ||
        listed.length < 1 ||
        listed.length > MAX_CLEANS ||
        !listed.every((b) => typeof b === 'string' && b.trim() !== '' && b.length <= 255)
      ) {
        throw new ToolProblem(`branches: 1 to ${MAX_CLEANS} workspaces' branches`);
      }
      const branches = listed as string[];
      const twice = branches.find((b, i) => branches.indexOf(b) !== i);
      if (twice) throw new ToolProblem(`branches: ${twice} twice`);
      const { workspaces } = await ws().list();
      const items = branches.map((branch) => {
        const w = workspaces.find((one) => one.branch === branch);
        if (!w) throw new ToolProblem(`no workspace ${branch}`);
        const changed = w.worktree.changed ?? 0;
        // Checked before asking: what the clean-up would refuse (MC3).
        const cant =
          !w.merged && !unmerged
            ? 'not merged: unmerged: true cleans it up and keeps its branch'
            : changed > 0
              ? `${plural(changed, 'file')} not committed in its worktree: commit or remove ${
                  changed === 1 ? 'it' : 'them'
                } first`
              : undefined;
        return {
          name: branch,
          words: w.merged ? 'merged' : unmerged ? 'not merged: its branch stays' : 'not merged',
          ...(cant ? { cant } : {}),
          act: () =>
            ws()
              .clean({ branch, ...(unmerged ? { unmerged: true } : {}) })
              .then(() => ({})),
        };
      });
      if (items.every((item) => item.cant)) {
        throw new ToolProblem(items.map((item) => `${item.name}: ${item.cant}`).join('; '));
      }
      return {
        words: `Clean up ${plural(items.length, 'workspace')}: each one's worktree and agent sessions, and its branch once merged`,
        items,
        did: 'cleaned',
      };
    },
  };
  return { reads, asking };
}
