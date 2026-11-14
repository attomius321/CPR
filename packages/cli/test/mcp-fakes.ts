// The fakes Symbiote's MCP tests share (moved from mcp.test.ts for MC3's own file): services that
// record each call, a server over them, a tool's call and the ask it holds.
import { readFileSync } from 'node:fs';
import type {
  BranchReviewInfo,
  Graph,
  IssueRecord,
  LocalReview,
  McpCaller,
  MergeEntry,
  SuggestRequest,
  WorkspaceRequest,
  WorkspaceStart,
  WorkspaceSuggestion,
  WorkspaceSummary,
} from '@symbiote/core';
import type { DiffStatus, Pair } from '../src/diffs.js';
import type { McpServices } from '../src/mcp-context.js';
import { symbioteMcp } from '../src/mcp.js';
import { MergeRefused } from '../src/merge-context.js';
import { ReviewRefused } from '../src/reviews.js';
import { WorkspaceRefused } from '../src/workspace-record.js';

export const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
    'utf8',
  ),
) as Graph;

export const NUCLEUS: McpCaller = { via: 'nucleus' };
export const SUGGESTION: WorkspaceSuggestion = {
  agent: 'codex',
  model: 'gpt-6',
  effort: 'high',
  planFirst: true,
  why: 'Three parts of the app change together.',
  by: { model: 'gpt-6-luna', name: 'GPT-6 Luna', effort: 'low' },
};
/** A take the fake classifier records for any number (HV9c). */
export const TAKEN = {
  forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
  number: 12,
  url: 'https://github.com/acme/app/issues/12',
  title: 'The search ignores case',
  state: 'open',
  snapshot: {
    hash: 'h'.repeat(64),
    at: '2026-11-14T10:00:00.000Z',
    text: 'Title: The search ignores case',
    read: { members: 1, author: 0 },
    outside: 2,
    flags: [],
  },
  decision: 'take',
  held: ['new-dependency'],
  answer: {
    decision: 'take',
    reasons: ['A clear bug with a reproduction.'],
    refusal: 'none',
    question: '',
    kind: 'fix',
    title: 'Make the search ignore case',
    parts: { happens: 'Searching Foo misses foo.' },
    size: 'small',
    model: 'sonnet',
    effort: 'medium',
    flags: ['new-dependency'],
  },
  brief:
    'From issue #12 (https://github.com/acme/app/issues/12), classified at 2026-11-14T10:00:00.000Z.\n\n# Make the search ignore case',
  classifier: {
    agent: 'claude',
    model: 'opus',
    effort: 'high',
    prompt: 'p'.repeat(64),
    card: 'c'.repeat(64),
    rules: 1,
    identity: 'i'.repeat(64),
  },
  run: { at: '2026-11-14T10:00:00.000Z', ms: 11_000, cost: 0.031, tries: 1 },
} satisfies IssueRecord;

export const BASE = 'a'.repeat(40);
export const HEAD = 'b'.repeat(40);
/** The tip of a branch nobody approved (MC3). */
export const TIP = 'c'.repeat(40);

export function workspace(
  branch: string,
  state: WorkspaceSummary['agent']['state'],
  more: Partial<WorkspaceSummary> = {},
): WorkspaceSummary {
  return {
    branch,
    kind: 'fix',
    title: `Title of ${branch}`,
    base: BASE,
    created: '2026-10-25T10:00:00.000Z',
    planFirst: true,
    brief: `# The brief of ${branch}\n\nA long text.`,
    worktree: { path: `/w/${branch}`, exists: true, changed: 0 },
    tip: HEAD,
    ahead: 2,
    merged: false,
    agent: { state, kind: 'codex' },
    ...more,
  };
}

export function entry(more: Partial<MergeEntry> = {}): MergeEntry {
  return {
    id: 'm1',
    branch: 'fix/a',
    head: HEAD,
    into: 'main',
    title: 'Merge fix/a: Title',
    state: 'ready',
    queued: '2026-10-25T10:00:00.000Z',
    updated: '2026-10-25T10:01:00.000Z',
    ...more,
  };
}

export const info: BranchReviewInfo = {
  branch: 'fix/a',
  ref: 'fix/a',
  base: BASE,
  head: HEAD,
  reviewed: null,
  since: null,
  into: 'main',
};

/** Fake services, each call recorded as `[method, ...arguments]`. */
export function fakes(
  options: {
    workspaces?: WorkspaceSummary[];
    merges?: MergeEntry[];
    diff?: () => DiffStatus | undefined;
    /** The advisor's answer, or its refusal. */
    suggest?: () => Promise<WorkspaceSuggestion>;
    /** A start, a clean-up or a merge the service refuses, by branch: its words (MC3). */
    refuse?: {
      start?: Record<string, string>;
      clean?: Record<string, string>;
      enqueue?: Record<string, string>;
    };
    /** Branches a review resolves, beside fix/a: none approved, at TIP (MC3). */
    reviewable?: string[];
    /** A start from an issue, or its refusal (HV10b). */
    startFromIssue?: (number: number) => Promise<WorkspaceStart>;
    /** The classifier's record of an issue, or its refusal (HV9c). */
    classify?: (number: number) => Promise<IssueRecord>;
  } = {},
) {
  const calls: unknown[][] = [];
  const list = options.workspaces ?? [
    workspace('fix/a', 'plan-ready'),
    workspace('feature/b', 'working'),
    workspace('chore/c', 'needs-you', {
      agent: { state: 'needs-you', waitingFor: 'a permission' },
    }),
  ];
  let queue = options.merges ?? [
    entry({ branch: 'feature/d', state: 'needs-you', message: 'a resolution' }),
  ];
  const services: McpServices = {
    name: 'trial',
    status: () =>
      Promise.resolve({ branch: 'main', head: HEAD, version: 'v1', changed: 1, operation: null }),
    readFile: (sha, path) => {
      calls.push(['readFile', sha, path]);
      return Promise.resolve('line 1\nline 2\nline 3\n');
    },
    diffs: {
      start: (pair: Pair) => void calls.push(['diffs.start', pair]),
      status: () => (options.diff ? options.diff() : { status: 'done', graph }),
    },
    workspaces: {
      list: () => Promise.resolve({ workspaces: list, place: 'repository' }),
      options: () =>
        Promise.resolve({
          base: { from: 'main', sha: HEAD },
          branches: [{ name: 'main', sha: HEAD }],
          branchPrefixes: {
            feature: 'feature/',
            fix: 'fix/',
            refactor: 'refactor/',
            chore: 'chore/',
            spike: 'spike/',
          },
          kinds: [
            {
              kind: 'fix',
              name: 'Fix',
              parts: [{ part: 'happens', heading: 'What happens', required: true }],
            },
          ],
          worktrees: '../trial.worktrees/<branch>',
          agents: [{ kind: 'codex', command: 'codex' }],
          maxBrief: 20000,
          documents: {
            folder: 'symbiote/documents/<branch>',
            maxFiles: 10,
            maxBytes: 1,
            maxTotal: 1,
          },
        }),
      changes: (branch: string) =>
        Promise.resolve({
          branch,
          base: BASE,
          since: 'main',
          tip: HEAD,
          commits: {
            count: 1,
            listed: [
              {
                sha: HEAD,
                subject: 'Fix: the thing',
                author: 'A',
                date: '2026-10-25T10:00:00+00:00',
              },
            ],
          },
          files: {
            count: 1,
            added: 3,
            removed: 1,
            listed: [{ status: 'modified', path: 'src/a.ts', added: 3, removed: 1 }],
          },
          uncommitted: { count: 0, listed: [] },
        }),
      merge: () => Promise.resolve({ into: 'main', clean: true }),
      exportActivity: (branch: string, format: string, options?: { maxBytes?: number }) => {
        calls.push(['exportActivity', branch, format, options]);
        return branch === 'none/x'
          ? Promise.reject(new WorkspaceRefused(`no workspace ${branch}`, 404))
          : Promise.resolve({
              text: `---\nof: workspace\n---\n\n# Activity: ${branch}\n`,
              name: 'activity.md',
              type: 'text/markdown; charset=utf-8',
            });
      },
      thread: (branch: string) =>
        Promise.resolve({
          recorded: true,
          entries: Array.from({ length: 30 }, (_, i) => ({
            at: `2026-10-25T10:${String(i).padStart(2, '0')}:00.000Z`,
            session: 's1',
            kind: 'report' as const,
            text: `report ${i} of ${branch}`,
          })),
        }),
      reply: (request) => {
        calls.push(['reply', request]);
        if (request.branch === 'gone/x') {
          return Promise.reject(new WorkspaceRefused('no workspace gone/x', 404));
        }
        return Promise.resolve({ workspace: workspace(request.branch, 'working') });
      },
      stopAgent: (branch: string) => {
        calls.push(['stopAgent', branch]);
        return Promise.resolve({ workspace: workspace(branch, 'stopped'), prompt: '' });
      },
      startAgent: (branch: string) => {
        calls.push(['startAgent', branch]);
        return Promise.resolve({ workspace: workspace(branch, 'working'), prompt: 'the prompt' });
      },
      suggest: (request: SuggestRequest) => {
        calls.push(['suggest', request]);
        return options.suggest ? options.suggest() : Promise.resolve(SUGGESTION);
      },
      start: (request: WorkspaceRequest) => {
        calls.push(['start', request]);
        const refused = options.refuse?.start?.[request.branch];
        if (refused) return Promise.reject(new WorkspaceRefused(refused, 409));
        return Promise.resolve({
          workspace: workspace(request.branch, 'working'),
          prompt: 'the prompt',
        });
      },
      clean: (request) => {
        calls.push(['clean', request]);
        const refused = options.refuse?.clean?.[request.branch];
        if (refused) return Promise.reject(new WorkspaceRefused(refused, 409));
        return Promise.resolve({ finished: '2026-10-25T11:00:00.000Z' });
      },
    },
    reviews: {
      list: () =>
        Promise.resolve({
          defaultBranch: 'main',
          reviewer: 'person@example.com',
          place: 'repository',
          reviews: [],
        }),
      resolve: (ref: string) => {
        if (ref === 'fix/a') return Promise.resolve({ info, pair: { base: BASE, head: HEAD } });
        if (!options.reviewable?.includes(ref)) {
          return Promise.reject(new ReviewRefused(`no branch ${ref}`));
        }
        return Promise.resolve({
          info: { ...info, branch: ref, ref, head: TIP },
          pair: { base: BASE, head: TIP },
        });
      },
      finish: async (at, review: LocalReview, read) => {
        calls.push(['finish', at.branch, review, await read('head', 'src/math.ts')]);
        return {
          verdict: {
            at: '2026-10-25T11:00:00.000Z',
            comments: [],
            event: review.event,
            head: HEAD,
            summary: review.body,
          },
          text: 'for the agent',
        };
      },
    },
    merges: {
      list: () => Promise.resolve({ merges: queue }),
      targets: (branch: string) =>
        Promise.resolve(
          branch === 'fix/a'
            ? {
                // Its entry still in the queue, as the merger answers.
                ...((e) => (e ? { entry: e } : {}))(
                  queue.find((e) => e.branch === branch && e.state !== 'landed'),
                ),
                branches: ['main', 'release'],
                into: 'main',
                head: HEAD,
                strategy: 'merge' as const,
                fastForward: ['main'],
              }
            : {
                branches: ['main'],
                into: 'main',
                strategy: 'merge' as const,
                blocked: `${branch} has no approval`,
              },
        ),
      enqueue: (request) => {
        calls.push(['enqueue', request]);
        const refused = options.refuse?.enqueue?.[request.branch];
        if (refused) return Promise.reject(new MergeRefused(refused, 409));
        const queued = entry({ branch: request.branch, into: request.into, state: 'queued' });
        queue = [...queue, queued];
        return Promise.resolve(queued);
      },
      land: (id: string) => {
        calls.push(['land', id]);
        return Promise.resolve(entry({ id, state: 'landed' }));
      },
      retry: (id: string) => Promise.resolve(entry({ id, state: 'queued' })),
      recheck: (id: string) => Promise.resolve(entry({ id, state: 'checking' })),
      mergeCommit: (id: string) => {
        calls.push(['mergeCommit', id]);
        return Promise.resolve(entry({ id, state: 'queued' }));
      },
      remove: (id: string) => {
        calls.push(['remove', id]);
        return id === 'busy'
          ? Promise.reject(new MergeRefused('it is merging', 409))
          : Promise.resolve();
      },
      approve: (id: string) => Promise.resolve(entry({ id, state: 'landed' })),
      requestChanges: (id: string, comments: string) => {
        calls.push(['requestChanges', id, comments]);
        return Promise.resolve(entry({ id, state: 'resolving' }));
      },
      log: (id: string) =>
        Promise.resolve(
          id === 'm1'
            ? {
                lines: Array.from({ length: 80 }, (_, i) => ({ at: i, out: `line ${i}` })),
                next: 999,
              }
            : null,
        ),
    },
    usage: { report: () => Promise.resolve({ subscriptions: [] }) },
    issueStart: {
      start: (number, how) => {
        calls.push(['startFromIssue', number, how]);
        if (options.startFromIssue) return options.startFromIssue(number);
        const branch = `fix/${number}-the-search-ignores-case`;
        return Promise.resolve({
          workspace: workspace(branch, 'working', {
            hive: { step: 'writing' } as WorkspaceSummary['hive'],
            issue: {
              forge: 'github',
              host: 'github.com',
              project: 'acme/app',
              number,
              url: `https://github.com/acme/app/issues/${number}`,
              title: 'The search ignores case',
              hash: 'f'.repeat(64),
            },
          }),
          prompt: '',
        });
      },
    },
    issueClassifier: {
      classify: (number) => {
        calls.push(['classify', number]);
        return options.classify ? options.classify(number) : Promise.resolve({ ...TAKEN, number });
      },
    },
    monitor: {
      map: () =>
        Promise.resolve({
          version: 1 as const,
          commit: HEAD,
          files: [
            {
              path: 'src/a.ts',
              kind: 'source' as const,
              language: 'TypeScript',
              lines: 100,
              code: 80,
              comments: 10,
              blank: 10,
            },
            {
              path: 'src/b/c.ts',
              kind: 'source' as const,
              language: 'TypeScript',
              lines: 50,
              code: 40,
              comments: 5,
              blank: 5,
            },
            {
              path: 'docs/x.md',
              kind: 'docs' as const,
              language: 'Markdown',
              lines: 20,
              code: 20,
              comments: 0,
              blank: 0,
            },
          ],
        }),
    },
  };
  return {
    services,
    calls,
    setQueue: (next: MergeEntry[]) => (queue = next),
    setWorkspaces: (next: WorkspaceSummary[]) => list.splice(0, list.length, ...next),
  };
}

export type Mcp = ReturnType<typeof symbioteMcp>;

export function server(
  services: McpServices,
  options: Parameters<typeof symbioteMcp>[1] = {},
): Mcp {
  return symbioteMcp(services, {
    version: '1.2.3',
    url: () => 'http://127.0.0.1:4100/',
    analysisMs: 30,
    pollMs: 5,
    ...options,
  });
}

let ids = 0;
/** A tool's call: its text, whether it is an error, and its JSON when it is some. */
export async function call(
  mcp: Mcp,
  name: string,
  args: Record<string, unknown> = {},
  caller: McpCaller = NUCLEUS,
  signal?: AbortSignal,
) {
  const answer = await mcp.handle(
    { jsonrpc: '2.0', id: ++ids, method: 'tools/call', params: { name, arguments: args } },
    caller,
    signal,
  );
  const result = (
    answer as { result?: { content: { type: string; text: string }[]; isError?: boolean } }
  ).result;
  if (!result) throw new Error(`no result: ${JSON.stringify(answer)}`);
  const text = result.content.map((c) => c.text).join('');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  return { text, isError: result.isError === true, value: value as Record<string, unknown> };
}

/** Waits until `mcp` holds an ask, and answers its ID. */
export async function askOf(mcp: Mcp): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const ask = mcp.asks().asks[0];
    if (ask) return ask.id;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('no ask');
}
