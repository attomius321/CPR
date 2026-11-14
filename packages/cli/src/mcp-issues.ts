// Symbiote's MCP: the classifier (HV9c, decision 1058). `classify_issue` runs it as the Issues
// page's Classify does and answers the decision; it writes a record and starts nothing, so it asks
// for no Confirm, as `suggest_settings` (decision 582). `start_from_issue` (HV10b) starts a Hive
// workspace from an issue the classifier took: asked, as `start_workspace`, but for Nucleus with Hive on.
import type { IssueRecord } from '@symbiote/core';
import type { McpContext, McpRead, McpAsking } from './mcp-context.js';
import type { McpLookup } from './mcp-lookup.js';
import { ToolProblem, type Args } from './mcp-tools.js';
import { row } from './mcp-workspaces.js';

/** An issue's number in a tool's call: 1 to 10 digits, as the Issues page's address takes it. */
function issueNumber(args: Args): number {
  const value = args.number;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 9_999_999_999) {
    throw new ToolProblem("number: an issue's number, as 12");
  }
  return value;
}

/**
 * A record as the tool answers it: the decision and what decided it, the work and the brief for a
 * take, the run; not the snapshot's text, which is the issue's, nor the hashes.
 */
export function classifiedAnswer(record: IssueRecord, page: string): Record<string, unknown> {
  const answer = record.answer;
  const take = record.decision === 'take' && answer;
  const flags = [...(answer?.flags ?? []), ...(record.snapshot?.flags ?? [])];
  return {
    issue: record.number,
    url: record.url,
    title: record.title,
    decision: record.decision,
    ...(record.held?.length ? { held: record.held } : {}),
    ...(record.refusal ? { refusal: record.refusal } : {}),
    ...(record.refusedBy?.length ? { refusedBy: record.refusedBy } : {}),
    ...(record.failed ? { failed: record.failed } : {}),
    ...(answer?.reasons.length ? { reasons: answer.reasons } : {}),
    ...(record.decision === 'ask' && answer?.question ? { question: answer.question } : {}),
    ...(take
      ? {
          work: {
            kind: answer.kind,
            title: answer.title,
            size: answer.size,
            model: answer.model,
            effort: answer.effort,
          },
        }
      : {}),
    ...(flags.length ? { flags } : {}),
    ...(take && record.brief ? { brief: record.brief } : {}),
    ...(record.snapshot?.outside ? { commentsLeftOut: record.snapshot.outside } : {}),
    classifier: {
      model: record.classifier.model,
      ...(record.classifier.effort ? { effort: record.classifier.effort } : {}),
    },
    cost: record.run.cost,
    at: record.run.at,
    page,
  };
}

/** The classifier's tool, which runs at once, and the start from an issue, which asks (HV10b). */
export function mcpIssues(
  { url, exclusive }: Pick<McpContext, 'url' | 'exclusive'>,
  { service }: Pick<McpLookup, 'service'>,
) {
  const reads: Record<string, McpRead> = {
    async classify_issue(args) {
      const number = issueNumber(args);
      const record = await service('issueClassifier').classify(number);
      return classifiedAnswer(record, new URL(`issues?number=${number}`, url()).toString());
    },
  };
  const asking: Record<string, McpAsking> = {
    start_from_issue(args, caller) {
      const number = issueNumber(args);
      const from = args.from;
      if (from !== undefined && (typeof from !== 'string' || from.trim() === '')) {
        throw new ToolProblem("from: a branch's name");
      }
      const by = caller.via === 'nucleus' ? 'nucleus' : 'mcp';
      return Promise.resolve({
        words: `Start a Hive workspace from issue #${number}${from ? `, from ${from}` : ''}`,
        act: () =>
          // One start at a time, as start_workspace's.
          exclusive('a workspace is being started', () =>
            service('issueStart').start(number, { by, ...(from ? { from } : {}) }),
          ).then((started) => ({ workspace: row(started.workspace) })),
      });
    },
  };
  return { reads, asking };
}
