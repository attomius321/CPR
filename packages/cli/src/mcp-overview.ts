// Symbiote's MCP: the tools over everything (MC1): the overview, usage, the code map, a wait.
import type { McpContext, McpRead, McpAsking } from './mcp-context.js';
import { sleep, type McpLookup } from './mcp-lookup.js';
import { MAX_WAIT, words, count } from './mcp-tools.js';

/** Workspace states that wait on the person, and merge states. */
const WORKSPACE_NEEDS = new Set(['plan-ready', 'needs-you', 'ready', 'failed', 'not-started']);

const MERGE_NEEDS = new Set(['needs-you', 'ready', 'failed']);

/** The overview tools: those that run at once, and those that ask. */
export function mcpOverview(
  {
    services,
    held,
    minuteMs,
    pollMs,
  }: Pick<McpContext, 'services' | 'held' | 'minuteMs' | 'pollMs'>,
  { service, states }: Pick<McpLookup, 'service' | 'states'>,
) {
  const reads: Record<string, McpRead> = {
    async overview() {
      const [status, list, queue] = await Promise.all([
        services.status(),
        services.workspaces?.list(),
        services.merges?.list(),
      ]);
      const workspaces = list?.workspaces ?? [];
      const merges = (queue?.merges ?? []).filter((e) => e.state !== 'landed');
      const counts: Record<string, number> = {};
      for (const w of workspaces) counts[w.agent.state] = (counts[w.agent.state] ?? 0) + 1;
      const open = [...held.values()].map((h) => h.ask.words);
      return {
        ...(services.name ? { repository: services.name } : {}),
        checkout: {
          branch: status.branch,
          head: status.head,
          changed: status.changed,
          ...(status.operation ? { operation: status.operation } : {}),
        },
        needsYou: [
          ...workspaces
            .filter((w) => WORKSPACE_NEEDS.has(w.agent.state))
            .map((w) => ({
              workspace: w.branch,
              state: w.agent.state,
              ...(w.agent.waitingFor ? { waitingFor: w.agent.waitingFor } : {}),
              ...(w.agent.error ? { error: w.agent.error } : {}),
            })),
          ...merges
            .filter((e) => MERGE_NEEDS.has(e.state))
            .map((e) => ({
              merge: e.id,
              branch: e.branch,
              state: e.state,
              ...(e.message ? { message: e.message } : {}),
            })),
        ],
        workspaces: counts,
        merges: merges.map((e) => ({ id: e.id, branch: e.branch, into: e.into, state: e.state })),
        ...(open.length > 0 ? { asks: open } : {}),
      };
    },

    async usage() {
      return service('usage').report();
    },

    async code_map(args) {
      const folder =
        args.folder === undefined ? '' : words(args, 'folder', 'a repo-relative folder', 1000);
      const prefix = folder.replace(/^\.?\/+|\/+$/g, '');
      const map = await service('monitor').map();
      const groups = new Map<
        string,
        { folder: string; files: number; code: number; lines: number }
      >();
      for (const file of map.files) {
        if (file.kind === 'aside') continue;
        if (prefix && !file.path.startsWith(`${prefix}/`)) continue;
        const rest = prefix ? file.path.slice(prefix.length + 1) : file.path;
        const name = rest.split('/')[0] ?? rest;
        const key = prefix ? `${prefix}/${name}` : name;
        const group = groups.get(key) ?? { folder: key, files: 0, code: 0, lines: 0 };
        group.files += 1;
        group.code += file.code;
        group.lines += file.lines;
        groups.set(key, group);
      }
      return {
        commit: map.commit,
        ...(map.branch ? { branch: map.branch } : {}),
        folders: [...groups.values()].sort((a, b) => b.code - a.code).slice(0, 30),
      };
    },

    async wait(args, _caller, signal) {
      const minutes = count(args, 'minutes', MAX_WAIT, MAX_WAIT, `from 1 to ${MAX_WAIT}`);
      const before = await states();
      const until = Date.now() + minutes * minuteMs;
      while (Date.now() < until && !signal.aborted) {
        await sleep(Math.min(pollMs, Math.max(0, until - Date.now())), signal);
        if (signal.aborted) break;
        const after = await states();
        const changed: Record<string, unknown>[] = [];
        for (const [branch, state] of after.workspaces) {
          const was = before.workspaces.get(branch) ?? null;
          if (was !== state) changed.push({ workspace: branch, was, now: state });
        }
        for (const [branch, was] of before.workspaces) {
          if (!after.workspaces.has(branch)) changed.push({ workspace: branch, was, now: null });
        }
        for (const [id, entry] of after.merges) {
          const was = before.merges.get(id)?.state ?? null;
          if (was !== entry.state) {
            changed.push({ merge: id, branch: entry.branch, was, now: entry.state });
          }
        }
        for (const [id, entry] of before.merges) {
          if (!after.merges.has(id)) {
            changed.push({ merge: id, branch: entry.branch, was: entry.state, now: null });
          }
        }
        if (changed.length > 0) return { changed };
      }
      return { changed: [], waited: minutes };
    },
  };
  const asking: Record<string, McpAsking> = {};
  return { reads, asking };
}
