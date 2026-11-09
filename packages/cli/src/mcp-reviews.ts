// Symbiote's MCP: a branch's review (MC1): its graph read, a verdict recorded once asked.
import type { Graph } from '@symbiote/core';
import { parseLocalReview, sourceFiles } from './server-requests.js';
import type { McpContext, McpRead, McpAsking } from './mcp-context.js';
import type { McpLookup } from './mcp-lookup.js';
import { via, ToolProblem, short, plural, branchOf } from './mcp-tools.js';

/** A branch's graph as `review` answers it (decision 363): no lines, the decisions. */
function reviewOf(graph: Graph) {
  const users = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    const set = users.get(edge.to) ?? new Set<string>();
    set.add(edge.from);
    users.set(edge.to, set);
  }
  const changed = graph.nodes
    .filter((n) => n.status !== 'unchanged')
    .map((n) => {
      const side = n.head ?? n.base;
      const delta = n.delta
        ? (['signature', 'body', 'moved'] as const).filter((k) => n.delta?.[k])
        : [];
      return {
        id: n.id,
        kind: n.kind,
        status: n.status,
        ...(delta.length > 0 ? { delta } : {}),
        ...(n.exported ? { exported: true } : {}),
        users: users.get(n.id)?.size ?? 0,
        ...(side ? { at: `${side.file}:${side.range.start.line}` } : {}),
      };
    })
    .sort((a, b) => b.users - a.users || a.id.localeCompare(b.id));
  const findings = graph.findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    rule: f.rule,
    symbol: f.symbol,
    message: f.message,
    related: f.related.length,
  }));
  return {
    stats: graph.stats,
    findings: findings.slice(0, 50),
    ...(findings.length > 50 ? { moreFindings: findings.length - 50 } : {}),
    changed: changed.slice(0, 30),
    ...(changed.length > 30 ? { moreChanged: changed.length - 30 } : {}),
    files: graph.files.slice(0, 50).map((f) => ({
      path: f.path,
      status: f.status,
      ...(f.ignored ? { ignored: true } : {}),
    })),
    ...(graph.files.length > 50 ? { moreFiles: graph.files.length - 50 } : {}),
    ...(graph.warnings.length > 0 ? { warnings: graph.warnings.slice(0, 10) } : {}),
  };
}

/** How long, in words: "12 s", "3 min". */
const elapsed = (ms: number) =>
  ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;

/** The reviews tools: those that run at once, and those that ask. */
export function mcpReviews(
  { services, url }: Pick<McpContext, 'services' | 'url'>,
  { service, analyzed }: Pick<McpLookup, 'service' | 'analyzed'>,
) {
  const reads: Record<string, McpRead> = {
    async review(args, _caller, signal) {
      const branch = branchOf(args);
      const { info, graph, pending } = await analyzed(branch, signal);
      const head = {
        branch: info.branch,
        base: info.base,
        head: info.head,
        ...(info.into ? { into: info.into } : {}),
        ...(info.reviewed ? { reviewed: info.reviewed, since: info.since } : {}),
        ...(info.verdict ? { verdict: info.verdict } : {}),
        page: `${url()}review/${encodeURIComponent(info.branch)}/`,
      };
      if (!graph) {
        const how =
          pending?.status === 'running'
            ? { analyzing: pending.phase ?? 'starting', elapsedMs: pending.elapsedMs }
            : pending?.status === 'queued'
              ? { analyzing: `queued, ${pending.queued} before it`, elapsedMs: pending.elapsedMs }
              : { analyzing: 'starting', elapsedMs: 0 };
        return {
          ...head,
          ...how,
          note: `Symbiote is still analyzing ${branch} (${elapsed(how.elapsedMs)} so far): call review again in a minute.`,
        };
      }
      return { ...head, ...reviewOf(graph) };
    },
  };
  const asking: Record<string, McpAsking> = {
    async finish_review(args, caller, signal) {
      const branch = branchOf(args);
      const event = args.event;
      if (event !== 'approve' && event !== 'request-changes' && event !== 'comment') {
        throw new ToolProblem('event: approve, request-changes or comment');
      }
      if (typeof args.summary !== 'string') throw new ToolProblem('summary: the verdict in words');
      const comments = args.comments ?? [];
      if (!Array.isArray(comments)) throw new ToolProblem('comments: a list');
      const { info, pair, graph } = await analyzed(branch, signal);
      if (!graph) {
        throw new ToolProblem(`Symbiote is still analyzing ${branch}: call review, then finish it`);
      }
      let review;
      try {
        review = parseLocalReview(
          JSON.stringify({
            event,
            body: args.summary,
            // A line's file on the other side: the same path unless the agent names it.
            comments: comments.map((c: unknown, i) => {
              const comment = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
              return {
                ...comment,
                ...(comment.path !== undefined && comment.otherPath === undefined
                  ? { otherPath: comment.path }
                  : {}),
                id: `c${i + 1}`,
              };
            }),
          }),
          graph,
          sourceFiles(graph),
        );
      } catch (error) {
        throw new ToolProblem((error as Error).message);
      }
      const n = review.comments.length;
      const many = n > 0 ? ` (${plural(n, 'comment')})` : '';
      const at = `${branch} at ${short(info.head)}`;
      const said =
        event === 'approve'
          ? `Approve ${at}${info.into ? `: it is to be merged into ${info.into}` : ''}${many}`
          : event === 'request-changes'
            ? `Request changes on ${at}${many}`
            : `Comment on ${at}${many}`;
      const read = (side: 'base' | 'head', path: string) =>
        services.readFile(side === 'base' ? pair.base : pair.head, path);
      const finished = { ...review, via: via(caller) };
      return {
        words: said,
        act: () => service('reviews').finish(info, finished, read),
      };
    },
  };
  return { reads, asking };
}
