// Symbiote's MCP: the merger's tools (MC1): the queue and a log; a merge queued, landed, resolved,
// retried, rechecked or removed once asked.
import { MERGE_STRATEGIES, type MergeEntry, type MergeStrategy } from '@symbiote/core';
import type { McpRead, McpAsking } from './mcp-context.js';
import type { McpLookup } from './mcp-lookup.js';
import { ToolProblem, short, plural, words, branchOf, idOf, count } from './mcp-tools.js';

/** A queue entry without its resolution's text or the check's whole output. */
function mergeRow(e: MergeEntry) {
  return {
    id: e.id,
    branch: e.branch,
    head: e.head,
    into: e.into,
    state: e.state,
    title: e.title,
    updated: e.updated,
    ...(e.strategy ? { strategy: e.strategy } : {}),
    ...(e.behind ? { behind: e.behind } : {}),
    ...(e.merge ? { merge: e.merge } : {}),
    ...(e.message ? { message: e.message } : {}),
    ...(e.conflicts ? { conflicts: e.conflicts } : {}),
    ...(e.check
      ? {
          check: {
            commands: e.check.commands,
            ...(e.check.ok !== undefined ? { ok: e.check.ok } : {}),
            ...(e.check.failed ? { failed: e.check.failed } : {}),
            ...(e.check.ok === false && e.check.output
              ? { output: e.check.output.split('\n').slice(-20).join('\n') }
              : {}),
          },
        }
      : {}),
    ...(e.resolution
      ? {
          resolution: {
            agent: e.resolution.agent,
            regions: e.resolution.regions.map((r) => ({
              path: r.path,
              line: r.line,
              ...(r.note ? { note: r.note } : {}),
            })),
            ...(e.resolution.needsYou ? { needsYou: e.resolution.needsYou } : {}),
          },
        }
      : {}),
    ...(e.landed ? { landed: e.landed } : {}),
    ...(e.pushed ? { pushed: e.pushed } : {}),
  };
}

/** The merges tools: those that run at once, and those that ask. */
export function mcpMerges({ service, entryOf }: Pick<McpLookup, 'service' | 'entryOf'>) {
  const reads: Record<string, McpRead> = {
    async merges(args) {
      const merger = service('merges');
      const branch = args.branch === undefined ? undefined : branchOf(args);
      const [{ merges }, targets] = await Promise.all([
        merger.list(),
        branch ? merger.targets(branch) : Promise.resolve(undefined),
      ]);
      return {
        merges: merges.map(mergeRow),
        ...(targets
          ? {
              targets: {
                branches: targets.branches,
                into: targets.into,
                ...(targets.head ? { head: targets.head } : {}),
                strategy: targets.strategy,
                ...(targets.fastForward ? { fastForward: targets.fastForward } : {}),
                ...(targets.blocked ? { blocked: targets.blocked } : {}),
              },
            }
          : {}),
      };
    },

    async merge_log(args) {
      const id = idOf(args);
      const last = count(args, 'last', 60, 400, 'a count from 1 to 400');
      const read = await service('merges').log(id, 0);
      if (!read) throw new ToolProblem(`no merge ${id}`);
      return { lines: read.lines.slice(-last), of: read.lines.length };
    },
  };
  const asking: Record<string, McpAsking> = {
    async queue_merge(args) {
      const branch = branchOf(args);
      const into =
        args.into === undefined ? undefined : words(args, 'into', 'a branch to merge into', 255);
      const { strategy } = args;
      if (strategy !== undefined && !MERGE_STRATEGIES.includes(strategy as MergeStrategy)) {
        throw new ToolProblem(`strategy: ${MERGE_STRATEGIES.join(' or ')}`);
      }
      const merger = service('merges');
      const targets = await merger.targets(branch);
      // A fast-forward its target can no longer take, merged with a merge commit instead (V67).
      const waiting = targets.entry?.behind ? targets.entry : undefined;
      if (waiting && strategy === 'merge') {
        return {
          words: `Merge ${branch} into ${waiting.into} with a merge commit: it cannot fast-forward`,
          act: () => merger.mergeCommit(waiting.id).then(mergeRow),
        };
      }
      if (targets.blocked) throw new ToolProblem(targets.blocked);
      const target = into ?? targets.into;
      if (!target) throw new ToolProblem('into: the branch to merge into');
      if (!targets.branches.includes(target)) {
        throw new ToolProblem(`into: one of ${targets.branches.join(', ')}`);
      }
      const head = targets.head;
      if (!head) throw new ToolProblem(`${branch} has no approval to merge`);
      const fastForward =
        ((strategy as MergeStrategy | undefined) ?? targets.strategy) === 'fast-forward';
      if (fastForward && !targets.fastForward?.includes(target)) {
        throw new ToolProblem(
          `${target} has commits ${branch} does not: it cannot fast-forward (strategy merge: a merge commit)`,
        );
      }
      return {
        words: fastForward
          ? `Fast-forward ${target} to ${branch} at ${short(head)}: no merge commit`
          : `Merge ${branch} at ${short(head)} into ${target}`,
        act: () =>
          merger
            .enqueue({
              branch,
              into: target,
              ...(strategy ? { strategy: strategy as MergeStrategy } : {}),
            })
            .then(mergeRow),
      };
    },

    async land_merge(args) {
      const e = await entryOf(idOf(args));
      if (e.state !== 'ready') {
        throw new ToolProblem(
          `${e.branch}'s merge into ${e.into} is ${e.state}, not ready to land`,
        );
      }
      return {
        words: `Land the merge of ${e.branch} into ${e.into}${e.merge ? ` (${short(e.merge)})` : ''}`,
        act: () => service('merges').land(e.id).then(mergeRow),
      };
    },

    async merge_resolution(args) {
      const e = await entryOf(idOf(args));
      const approve = args.approve;
      if (typeof approve !== 'boolean') throw new ToolProblem('approve: true or false');
      const comments = approve ? '' : words(args, 'comments', 'what the merger should do instead');
      if (e.state !== 'needs-you' || !e.resolution) {
        throw new ToolProblem(`${e.branch}'s merge has no resolution to answer (it is ${e.state})`);
      }
      const regions = plural(e.resolution.regions.length, 'region');
      return approve
        ? {
            words: `Accept the merger's resolution of ${e.branch} into ${e.into} (${regions}), and land it`,
            act: () => service('merges').approve(e.id).then(mergeRow),
          }
        : {
            words: `Ask the merger again on ${e.branch} into ${e.into}: "${comments.slice(0, 120)}"`,
            act: () => service('merges').requestChanges(e.id, comments).then(mergeRow),
          };
    },

    async retry_merge(args) {
      const e = await entryOf(idOf(args));
      return {
        words: `Merge ${e.branch} into ${e.into} again`,
        act: () => service('merges').retry(e.id).then(mergeRow),
      };
    },

    async recheck_merge(args) {
      const e = await entryOf(idOf(args));
      return {
        words: `Run the check of ${e.branch}'s merge into ${e.into} again`,
        act: () => service('merges').recheck(e.id).then(mergeRow),
      };
    },

    async remove_merge(args) {
      const e = await entryOf(idOf(args));
      return {
        words: `Take ${e.branch}'s merge into ${e.into} out of the queue, with its log`,
        act: () =>
          service('merges')
            .remove(e.id)
            .then(() => ({ removed: e.id })),
      };
    },
  };
  return { reads, asking };
}
