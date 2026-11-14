// The Issues page's service (IS1): origin's GitHub or GitLab issues, read only, for
// `/api/issues` and `/api/issues/<number>`. Every problem is an answer in words, never a 500:
// no origin, origin on neither forge, the forge's own error.
import {
  SymbioteError,
  type GitRepo,
  type IssueAnswer,
  type IssueListAnswer,
  type IssueQuery,
  type IssueSource,
} from '@symbiote/core';
import type { Env, Forge } from '@symbiote/forge';
import { originForge } from './hive-request.js';
import { issueSnapshot } from './issue-snapshot.js';

export interface IssuesService {
  list(query: IssueQuery): Promise<IssueListAnswer>;
  one(number: number): Promise<IssueAnswer>;
}

/**
 * How long origin's forge is kept once found: finding it reads git twice, and GitHub's token may
 * be `gh auth token`'s (a process each time). A token set since shows within this.
 */
const FOUND_MS = 30_000;

type Found = Awaited<ReturnType<typeof originForge>>;

/** The issues of the forge `repo`'s origin names, with the token `env` gives or none. */
export function issuesService(
  repo: GitRepo,
  env: Env,
  make?: (url: string, env: Env) => Forge,
): IssuesService {
  let found: { at: number; value: Promise<Found> } | undefined;
  const origin = () => {
    if (!found || Date.now() - found.at > FOUND_MS) {
      found = { at: Date.now(), value: originForge(repo, env, make) };
    }
    return found.value;
  };

  /** The source's words, and the task's answer or its problem (an answer of either kind). */
  async function ask<T extends object>(
    task: (forge: Forge) => Promise<T>,
  ): Promise<IssueSource & Partial<T>> {
    type Answer = IssueSource & Partial<T>;
    const at = await origin();
    const forge = at.forge;
    if (!forge) {
      const missing = 'missing' in at ? at.missing : 'forge';
      return {
        token: false,
        problem: {
          kind: missing === 'origin' ? 'no-origin' : 'no-forge',
          message: 'why' in at ? at.why : 'origin is not a GitHub or GitLab repository',
        },
      } as Answer;
    }
    const source: IssueSource = {
      forge: { kind: forge.kind, host: forge.host, project: forge.project },
      token: forge.token,
      // Public issues read without a token (decision 945): the page says what to set.
      ...('why' in at ? { tokenHint: at.why } : {}),
    };
    try {
      return { ...source, ...(await task(forge)) };
    } catch (error) {
      if (!(error instanceof SymbioteError)) throw error;
      return { ...source, problem: { kind: 'forge', message: error.message } } as Answer;
    }
  }

  return {
    list: (query) => ask((forge) => forge.listIssues(query)),
    one: (number) =>
      ask(async (forge) => {
        const issue = await forge.getIssue(number);
        // The hash the classifier's snapshot would have now (HV9c, decision 1057): the page sees
        // an edit since a classification with no read of the forge more.
        return { issue, snapshot: issueSnapshot(issue, new Date().toISOString()).hash };
      }),
  };
}
