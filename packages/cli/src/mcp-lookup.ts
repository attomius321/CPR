// What Symbiote's MCP's tools look up: a service, a workspace, a merge, a branch's analysis, every
// state now.
import type { BranchReviewInfo, Graph, MergeEntry, WorkspaceSummary } from '@symbiote/core';
import type { DiffStatus, Pair } from './diffs.js';
import type { McpServices, McpContext } from './mcp-context.js';
import { ToolProblem, type Need } from './mcp-tools.js';

/** Resolves after `ms`, or when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}

/** The lookups of the tools over `services`. */
export function mcpLookup({
  services,
  analysisMs,
  pollMs,
}: Pick<McpContext, 'services' | 'analysisMs' | 'pollMs'>) {
  function service<K extends Need>(need: K): NonNullable<McpServices[K]> {
    const found = services[need];
    if (!found) throw new ToolProblem(`Symbiote has no ${need} here`);
    return found;
  }

  async function workspaceOf(branch: string): Promise<WorkspaceSummary> {
    const { workspaces } = await service('workspaces').list();
    const found = workspaces.find((w) => w.branch === branch);
    if (!found) throw new ToolProblem(`no workspace ${branch}`);
    return found;
  }

  async function entryOf(id: string): Promise<MergeEntry> {
    const { merges } = await service('merges').list();
    const found = merges.find((e) => e.id === id);
    if (!found) throw new ToolProblem(`no merge ${id}`);
    return found;
  }

  /** A branch's review and its graph once analyzed, or how far the analysis is. */
  async function analyzed(
    branch: string,
    signal: AbortSignal,
  ): Promise<{ info: BranchReviewInfo; pair: Pair; graph?: Graph; pending?: DiffStatus }> {
    const { info, pair } = await service('reviews').resolve(branch);
    services.diffs.start(pair);
    const until = Date.now() + analysisMs;
    for (;;) {
      const status = services.diffs.status(pair);
      if (status?.status === 'done') return { info, pair, graph: status.graph };
      if (status?.status === 'failed') {
        throw new ToolProblem(`the analysis of ${branch} failed: ${status.error}`);
      }
      if (Date.now() >= until || signal.aborted)
        return { info, pair, ...(status ? { pending: status } : {}) };
      await sleep(pollMs, signal);
    }
  }

  /** What every state is now, for `wait`. */
  async function states(): Promise<{
    workspaces: Map<string, string>;
    merges: Map<string, { branch: string; state: string }>;
  }> {
    const [list, queue] = await Promise.all([services.workspaces?.list(), services.merges?.list()]);
    return {
      workspaces: new Map((list?.workspaces ?? []).map((w) => [w.branch, w.agent.state])),
      merges: new Map(
        (queue?.merges ?? []).map((e) => [e.id, { branch: e.branch, state: e.state }]),
      ),
    };
  }

  return { service, workspaceOf, entryOf, analyzed, states };
}

export type McpLookup = ReturnType<typeof mcpLookup>;
