// A Hive workspace from an issue (HV10b, decisions 1011–1014, 1061, 1062): one function behind the
// Issues page's Start in Hive and Nucleus's `start_from_issue`. It starts only an issue the
// classifier took on the issue's current text, with Hive on, and one workspace an issue at a time.
import {
  listRefs,
  type GitRepo,
  type IssueForge,
  type IssueRecord,
  type WorkKind,
  type WorkspaceIssue,
  type WorkspaceRequest,
  type WorkspaceStart,
  type WorkspaceSummary,
} from '@symbiote/core';
import { IssueRefused, type IssueClassifier } from './issue-classifier.js';
import { appendIssueEvent } from './issue-record.js';
import type { IssuesService } from './issues.js';
import type { Workspaces } from './workspace-context.js';

/** Who asks for the start: the page's click is the person's; Nucleus and `symbiote mcp` are not. */
export type IssueStartBy = 'page' | 'nucleus' | 'mcp';

/** What a start from an issue needs: Hive, the classifier, the issue now, the workspaces. */
export interface IssueStartContext {
  hive(): Promise<boolean>;
  classifier: Pick<IssueClassifier, 'record' | 'classify'>;
  /**
   * The issue as the classifier would read it now (decision 1057): its snapshot's hash and its
   * forge, or why it cannot be read.
   */
  now(number: number): Promise<{ hash: string; forge: IssueForge } | { why: string }>;
  /** The `symbiote/` folder that holds the issues' records (HV9b). */
  folder(): Promise<string>;
  /** The open workspaces (not cleaned up), as the page lists them. */
  workspaces(): Promise<WorkspaceSummary[]>;
  /** Whether a branch of this name exists, here or on a remote. */
  taken(branch: string): Promise<boolean>;
  start(request: WorkspaceRequest): Promise<WorkspaceStart>;
}

/** Longest slug after `<kind>/<number>-`. */
const MAX_SLUG = 40;

/** The slug of an issue's title: its first five words, lowercase, ASCII, at most 40 characters. */
export function issueSlug(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '')
    .slice(0, 5);
  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > MAX_SLUG) break;
    slug = next;
  }
  return slug || words[0]?.slice(0, MAX_SLUG) || 'issue';
}

/**
 * The branch of issue `number`'s workspace (decisions 1013, 1062): `<kind>/<number>-<slug>`; when a
 * branch of that name is left from an earlier workspace, `-2`, `-3`… after it.
 */
export async function issueBranch(
  kind: WorkKind,
  number: number,
  title: string,
  taken: (branch: string) => Promise<boolean>,
): Promise<string> {
  const base = `${kind}/${number}-${issueSlug(title)}`;
  if (!(await taken(base))) return base;
  for (let n = 2; ; n++) if (!(await taken(`${base}-${n}`))) return `${base}-${n}`;
}

const sameForge = (a: IssueForge, b: Pick<WorkspaceIssue, 'forge' | 'host' | 'project'>) =>
  a.kind === b.forge && a.host === b.host && a.project === b.project;

/**
 * The workspace of issue `number` not yet landed, merged or cleaned up (decision 1014); undefined
 * when it has none.
 */
export function openWorkspaceOf(
  workspaces: readonly WorkspaceSummary[],
  number: number,
  forge: IssueForge,
): WorkspaceSummary | undefined {
  return workspaces.find(
    (w) =>
      w.issue?.number === number &&
      sameForge(forge, w.issue) &&
      !w.finished &&
      !w.merged &&
      w.hive?.step !== 'landed',
  );
}

const DECISION_WORDS: Record<Exclude<IssueRecord['decision'], 'take'>, string> = {
  ask: 'asked its author a question',
  refuse: 'refused it',
  failed: 'did not answer',
};

/** The words of a hold (decision 1034) for a refusal. */
const HOLD_WORDS: Record<NonNullable<IssueRecord['held']>[number], string> = {
  'new-dependency': 'it adds a dependency',
  'weakens-checks': 'it weakens a check',
  'hidden-text': 'it had hidden text',
  cut: 'it was too long to read whole',
  personal: 'its brief names the person',
};

/** `startFromIssue`: refusals in words the page shows, else the started workspace. */
export function issueStarter(ctx: IssueStartContext) {
  /** One start at a time an issue: two clicks start one workspace. */
  const starting = new Set<number>();

  async function start(
    number: number,
    { by, from }: { by: IssueStartBy; from?: string },
  ): Promise<WorkspaceStart> {
    if (!(await ctx.hive())) {
      throw new IssueRefused('Hive mode is off: work starts from an issue only while it is on', 409);
    }
    let record = await ctx.classifier.record(number);
    if (!record) {
      throw new IssueRefused(`Issue #${number} is not classified: classify it first`, 409);
    }
    const now = await ctx.now(number);
    if ('why' in now) throw new IssueRefused(now.why, 409);
    // Changed since its snapshot: classified again first, and the new decision holds (1011).
    if (record.snapshot?.hash !== now.hash) record = await ctx.classifier.classify(number);
    if (record.decision !== 'take') {
      throw new IssueRefused(
        `Issue #${number} is not taken: the classifier ${DECISION_WORDS[record.decision]}`,
        409,
      );
    }
    const answer = record.answer;
    if (!answer) throw new IssueRefused(`Issue #${number}'s record holds no answer`, 409);
    // A hold waits for the person's click on the Issues page (decisions 1034, 1061).
    if (record.held?.length && by !== 'page') {
      throw new IssueRefused(
        `Issue #${number} is held for the person: ${record.held.map((h) => HOLD_WORDS[h]).join('; ')}. They start it with Start in Hive on the Issues page`,
        409,
      );
    }
    const open = openWorkspaceOf(await ctx.workspaces(), number, record.forge);
    if (open) {
      throw new IssueRefused(
        `Issue #${number} has a workspace already: ${open.branch}${open.hive ? `, ${open.hive.step}` : ''}`,
        409,
      );
    }
    const issue: WorkspaceIssue = {
      forge: record.forge.kind,
      host: record.forge.host,
      project: record.forge.project,
      number,
      url: record.url,
      title: record.title,
      hash: record.snapshot.hash,
    };
    const branch = await issueBranch(answer.kind, number, record.title, (b) => ctx.taken(b));
    const started = await ctx.start({
      kind: answer.kind,
      title: answer.title,
      // The schema has every kind's part: the other kinds' come empty, and a start refuses them.
      parts: Object.fromEntries(
        Object.entries(answer.parts).filter(([, text]) => text.trim() !== ''),
      ),
      branch,
      planFirst: false,
      agent: 'claude',
      model: answer.model,
      effort: answer.effort,
      ...(from ? { from } : {}),
      ...(by === 'page' ? {} : { via: by }),
      issue,
    });
    await appendIssueEvent(await ctx.folder(), number, {
      event: 'started',
      at: started.workspace.created,
      branch,
      ...(record.classifier?.identity ? { identity: record.classifier.identity } : {}),
    });
    return started;
  }

  return {
    async start(number: number, how: { by: IssueStartBy; from?: string }) {
      if (starting.has(number)) throw new IssueRefused(`Issue #${number} is being started`, 409);
      starting.add(number);
      try {
        return await start(number, how);
      } finally {
        starting.delete(number);
      }
    },
  };
}

export type IssueStarter = ReturnType<typeof issueStarter>;

/** The start from an issue of `symbiote view` on `repo`: the Issues page's reads, its workspaces. */
export function viewIssueStarter(
  repo: GitRepo,
  {
    hive,
    classifier,
    issues,
    workspaces,
    folder,
  }: {
    hive: () => Promise<boolean>;
    classifier: Pick<IssueClassifier, 'record' | 'classify'>;
    issues: Pick<IssuesService, 'one'>;
    workspaces: Pick<Workspaces, 'list' | 'start'>;
    folder: () => Promise<string>;
  },
): IssueStarter {
  return issueStarter({
    hive,
    classifier,
    async now(number) {
      const read = await issues.one(number);
      if (read.problem) return { why: read.problem.message };
      if (!read.forge || !read.snapshot) return { why: `Issue #${number} could not be read` };
      return { hash: read.snapshot, forge: read.forge };
    },
    folder,
    workspaces: async () => (await workspaces.list()).workspaces,
    async taken(branch) {
      const { branches, remotes } = await listRefs(repo);
      return branches.some((b) => b.name === branch) || remotes.some((r) => r.branch === branch);
    },
    start: (request) => workspaces.start(request),
  });
}
