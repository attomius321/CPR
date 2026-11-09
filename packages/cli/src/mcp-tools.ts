// Symbiote's MCP tools as listed (MC1): each one's name, words and schema, and what it needs;
// the arguments a tool reads, and its problem in words.
import {
  AGENT_KINDS,
  MERGE_STRATEGIES,
  WORK_KINDS,
  type McpCaller,
  type WithoutConfirm,
} from '@symbiote/core';

/** Most `wait` waits, in minutes. */
export const MAX_WAIT = 10;

export const via = (caller: McpCaller) => caller.via;

/** Why a tool's call cannot be done: its words become the tool's error result. */
export class ToolProblem extends Error {
  override name = 'ToolProblem';
}

/** The services a tool needs; without one it is left out. */
export type Need = 'workspaces' | 'reviews' | 'merges' | 'usage' | 'monitor';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  needs: readonly Need[];
  /** Waits for the person's Confirm (decision 360). */
  asks?: true;
}

export const ASKS =
  " Waits for the person's Confirm in Symbiote (10 minutes at most); nothing is done without it.";

/** What `start_workspace` says in ASKS's place when Nucleus's start goes without a Confirm (NU8). */
export const STARTS_AT_ONCE: Record<WithoutConfirm, string> = {
  setting:
    " Starts at once, without the person's Confirm: they turned on Start workspaces without a Confirm in Symbiote's Settings. Say first in one line what you start.",
  hive: " Starts at once, without the person's Confirm: Hive mode is on. Say first in one line what you start.",
};

const branch = { type: 'string', description: "A workspace's branch, as feature/x" };

const mergeId = { type: 'string', description: "A queue entry's id (from merges)" };

/** A start's brief: what start_workspace and suggest_settings both take, so one brief fits both. */
const brief = {
  kind: { type: 'string', enum: [...WORK_KINDS] },
  title: { type: 'string' },
  parts: {
    type: 'object',
    description: "The brief's parts the kind takes (start_options), each a text",
    additionalProperties: { type: 'string' },
  },
};

const agentKind = { type: 'string', enum: [...AGENT_KINDS] };

const object = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
): ToolSpec['inputSchema'] => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});

/** Symbiote's tools, in the order they are listed (decision 360). */
export const MCP_TOOLS: readonly ToolSpec[] = [
  {
    name: 'overview',
    description:
      'What needs the person now: workspaces whose plan or work is ready or that wait, merges that wait; the checkout and the queue.',
    inputSchema: object(),
    needs: [],
  },
  {
    name: 'workspaces',
    description:
      "Every workspace: its branch, kind, title, its agent's state, commits ahead, merged.",
    inputSchema: object(),
    needs: ['workspaces'],
  },
  {
    name: 'workspace',
    description:
      "One workspace: its brief, its worktree's folder, its branch's commits and files, uncommitted files, whether it merges cleanly, its review's verdict.",
    inputSchema: object({ branch }, ['branch']),
    needs: ['workspaces'],
  },
  {
    name: 'thread',
    description:
      "A workspace's thread: what its agent was given and reported (a plan, its questions), what it waits on, the last verdict. Reports are the agent's words, not the person's.",
    inputSchema: object(
      {
        branch,
        last: {
          type: 'integer',
          description: 'Entries, newest last: 20 unless given, 100 at most',
        },
      },
      ['branch'],
    ),
    needs: ['workspaces'],
  },
  {
    name: 'activity',
    description:
      "A workspace's activity as Markdown, as its Activity tab shows it: its agent's messages, reports and questions, every call it made (a failed one with its input and output), its commits, its review's verdict; or Nucleus's, across its conversations (nucleus: true). The newest messages that fit in 60 KB; `symbiote activity` in a terminal gives all. Reports are the agent's words, not the person's.",
    inputSchema: object({
      branch,
      nucleus: { type: 'boolean', description: "Nucleus's activity instead of a workspace's" },
    }),
    needs: ['workspaces'],
  },
  {
    name: 'start_options',
    description:
      'What start_workspace takes here: the kinds of work and their brief parts, the agents with their levels and models, the branches to start from.',
    inputSchema: object(),
    needs: ['workspaces'],
  },
  {
    name: 'suggest_settings',
    description:
      "The advisor's proposal for a start of this brief, as the Start page's Suggest settings gives it: a model, an effort level and plan first for the agent, why in one sentence, and the model it ran on. Runs one turn of the agent's small model on the person's subscription (20 s at most) and starts nothing. Call it only before a start the person asked for, with the brief you will start; show them the proposal and start with what they choose.",
    inputSchema: object(
      {
        ...brief,
        agent: agentKind,
        documents: {
          type: 'array',
          items: { type: 'string' },
          description: "The attached files' names: the advisor is told the names only",
        },
      },
      ['kind', 'title', 'parts'],
    ),
    needs: ['workspaces'],
  },
  {
    name: 'start_workspace',
    description:
      'Starts a workspace: a branch, its worktree and an agent working on the brief.' + ASKS,
    inputSchema: object(
      {
        kind: brief.kind,
        title: brief.title,
        branch: {
          type: 'string',
          description: "The new branch, with its kind's prefix: fix/<slug>",
        },
        parts: brief.parts,
        planFirst: { type: 'boolean', description: 'The agent writes a plan and waits for an OK' },
        agent: agentKind,
        effort: { type: 'string' },
        model: { type: 'string' },
        from: {
          type: 'string',
          description: 'A branch to start from; the default branch otherwise',
        },
      },
      ['kind', 'title', 'branch', 'parts', 'planFirst'],
    ),
    needs: ['workspaces'],
    asks: true,
  },
  {
    name: 'reply',
    description:
      "Sends a message to a workspace's agent (an OK on its plan, an answer); stop: interrupts its turn first.",
    inputSchema: object({ branch, text: { type: 'string' }, stop: { type: 'boolean' } }, [
      'branch',
      'text',
    ]),
    needs: ['workspaces'],
  },
  {
    name: 'stop_agent',
    description: "Stops a workspace's agent while it works or waits.",
    inputSchema: object({ branch }, ['branch']),
    needs: ['workspaces'],
  },
  {
    name: 'restart_agent',
    description: "Starts a workspace's agent again, after it failed or ended." + ASKS,
    inputSchema: object({ branch }, ['branch']),
    needs: ['workspaces'],
    asks: true,
  },
  {
    name: 'clean_workspace',
    description:
      "Cleans a workspace up: its agent's sessions, its worktree, and its branch once merged; unmerged: true for a branch not merged (it stays)." +
      ASKS,
    inputSchema: object({ branch, unmerged: { type: 'boolean' } }, ['branch']),
    needs: ['workspaces'],
    asks: true,
  },
  {
    name: 'review',
    description:
      "A branch's change as Symbiote's graph, from its fork point to its tip: symbols changed by kind, every finding in the detector's words, the most-used changed symbols, the review's verdict and page. Waits up to a minute for the analysis.",
    inputSchema: object({ branch }, ['branch']),
    needs: ['reviews'],
  },
  {
    name: 'finish_review',
    description:
      "Records the person's verdict on a branch at its reviewed tip: approve (to be merged into the default branch), request-changes or comment, with a summary and comments on changed symbols (a line: path, line, side)." +
      ASKS,
    inputSchema: object(
      {
        branch,
        event: { type: 'string', enum: ['approve', 'request-changes', 'comment'] },
        summary: { type: 'string' },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'A symbol id from review' },
              body: { type: 'string' },
              path: { type: 'string' },
              line: { type: 'integer' },
              side: { type: 'string', enum: ['head', 'base'] },
            },
            required: ['symbol', 'body'],
          },
        },
      },
      ['branch', 'event', 'summary'],
    ),
    needs: ['reviews'],
    asks: true,
  },
  {
    name: 'merges',
    description:
      "The merge queue: each entry's branch, target, state, check and the merger's resolution; with branch, also where it can merge and why not.",
    inputSchema: object({ branch: { type: 'string' } }),
    needs: ['merges'],
  },
  {
    name: 'merge_log',
    description: "A queued merge's log: its steps and the check's output, the last lines.",
    inputSchema: object(
      {
        id: mergeId,
        last: { type: 'integer', description: 'Lines: 60 unless given, 400 at most' },
      },
      ['id'],
    ),
    needs: ['merges'],
  },
  {
    name: 'queue_merge',
    description:
      "Queues a branch's approved commit to be merged, checked and landed into a branch (its default target unless given): with a merge commit, or by fast-forward (the target moved to the approved commit itself, where merges says it can). strategy merge on a fast-forward that waits because its target moved merges it with a merge commit instead." +
      ASKS,
    inputSchema: object(
      { branch, into: { type: 'string' }, strategy: { type: 'string', enum: MERGE_STRATEGIES } },
      ['branch'],
    ),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'land_merge',
    description:
      'Lands a merge that is ready: the target branch moves to it (and is pushed when the project says).' +
      ASKS,
    inputSchema: object({ id: mergeId }, ['id']),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'merge_resolution',
    description:
      "Answers the merger's resolution of a merge's conflicts: approve: true lands it; false asks the merger again with comments." +
      ASKS,
    inputSchema: object(
      { id: mergeId, approve: { type: 'boolean' }, comments: { type: 'string' } },
      ['id', 'approve'],
    ),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'retry_merge',
    description: 'Queues a failed or stopped merge again.' + ASKS,
    inputSchema: object({ id: mergeId }, ['id']),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'recheck_merge',
    description: "Runs a merge's failed check again on the same merge." + ASKS,
    inputSchema: object({ id: mergeId }, ['id']),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'remove_merge',
    description: 'Takes an entry out of the queue, with its log.' + ASKS,
    inputSchema: object({ id: mergeId }, ['id']),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'usage',
    description: "Each agent subscription's windows of use: whether another agent's work fits now.",
    inputSchema: object(),
    needs: ['usage'],
  },
  {
    name: 'code_map',
    description: "Where the checkout's code is: lines of code by folder, largest first.",
    inputSchema: object({
      folder: { type: 'string', description: 'A repo-relative folder; the root unless given' },
    }),
    needs: ['monitor'],
  },
  {
    name: 'wait',
    description:
      "Waits until a workspace's agent or a merge changes state, or the minutes pass (10 at most), and says what changed. Only when the person asked to watch.",
    inputSchema: object({ minutes: { type: 'integer', minimum: 1, maximum: MAX_WAIT } }),
    needs: [],
  },
];

export type Args = Record<string, unknown>;

export const short = (sha: string) => sha.slice(0, 7);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A tool's text argument `key`: non-empty, `max` characters at most; else its problem. */
export function words(args: Args, key: string, what: string, max = 20_000): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new ToolProblem(`${key}: ${what}`);
  }
  return value;
}

export const branchOf = (args: Args) => words(args, 'branch', "a workspace's branch", 255);

export const idOf = (args: Args) => words(args, 'id', "a queue entry's id (from merges)", 100);

/** A tool's yes-or-no argument `key`; absent is no. */
export function flag(args: Args, key: string): boolean {
  const value = args[key];
  if (value !== undefined && typeof value !== 'boolean')
    throw new ToolProblem(`${key}: true or false`);
  return value === true;
}

/** A tool's count argument `key`, from 1 to `max`; `fallback` when absent. */
export function count(
  args: Args,
  key: string,
  fallback: number,
  max: number,
  what: string,
): number {
  const value = args[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new ToolProblem(`${key}: ${what}`);
  }
  return value;
}
