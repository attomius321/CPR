// The Issues page's words and addresses (IS1), pure: what the list and an issue say.
import type {
  Issue,
  IssueAuthor,
  IssueAuthorRole,
  IssueFilter,
  IssueProblem,
  IssueSource,
  IssueSummary,
} from '@symbiote/core';
import { relativeDate } from '../history/commits.js';
import { plural } from '../ui/plural.js';

export const FORGE_NAMES = { github: 'GitHub', gitlab: 'GitLab' } as const;

export const STATES: readonly { state: IssueFilter; label: string }[] = [
  { state: 'open', label: 'Open' },
  { state: 'closed', label: 'Closed' },
  { state: 'all', label: 'All' },
];

/** `/api/issues` for a state, the search's words and a page's cursor. */
export function listAddress(state: IssueFilter, search: string, cursor?: string): string {
  const query = new URLSearchParams({ state });
  if (search.trim()) query.set('q', search.trim());
  if (cursor) query.set('cursor', cursor);
  return `/api/issues?${query.toString()}`;
}

export function issueAddress(number: number): string {
  return `/api/issues/${number}`;
}

/** An author's standing in words; none when they have none or the forge does not say. */
export function roleWord(role: IssueAuthorRole | undefined): string | undefined {
  if (!role || role === 'none') return undefined;
  return role[0]!.toUpperCase() + role.slice(1);
}

/** An author's name, a bot said to be one. */
export function authorName(author: IssueAuthor): string {
  return author.bot ? `${author.login} (bot)` : author.login;
}

/** A row's line under its title: who, when it was updated, how many comments. */
export function issueLine(issue: IssueSummary, now: number): string {
  return [
    authorName(issue.author),
    `updated ${relativeDate(issue.updated, now)}`,
    ...(issue.comments > 0 ? [plural(issue.comments, 'comment')] : []),
  ].join(' · ');
}

/** What an empty list says. */
export function emptyWords(state: IssueFilter, search: string): string {
  const kind = state === 'all' ? 'issues' : `${state} issues`;
  const words = search.trim();
  return words ? `No ${kind} with “${words}” in their title.` : `No ${kind}.`;
}

/** A problem's heading; its message says the rest. */
export function problemTitle(problem: IssueProblem, forge?: keyof typeof FORGE_NAMES): string {
  if (problem.kind === 'no-origin') return 'No origin';
  if (problem.kind === 'no-forge') return 'origin is not on GitHub or GitLab';
  return `${forge ? FORGE_NAMES[forge] : 'The forge'} did not answer`;
}

/** What the comments' end says: none, more on the forge, or a token they need. */
export function commentsWords(issue: Issue): string | undefined {
  const forge = FORGE_NAMES[issue.forge];
  if (issue.commentsNeedToken) {
    return `${plural(issue.moreComments, 'comment')}: ${forge} shows them only with a token (GITLAB_TOKEN).`;
  }
  if (issue.moreComments > 0) {
    return `${plural(issue.moreComments, 'more comment')} on ${forge}, past the first 100.`;
  }
  return issue.thread.length === 0 ? 'No comments.' : undefined;
}

/** `3 hours ago`, as the Git page says it. */
export function relativeTime(iso: string, now: number): string {
  return relativeDate(iso, now);
}

/** The project's issues on the forge: what the head's line opens. */
export function forgeIssuesUrl(forge: NonNullable<IssueSource['forge']>): string {
  const project = forge.project.split('/').map(encodeURIComponent).join('/');
  return forge.kind === 'github'
    ? `https://${forge.host}/${project}/issues`
    : `https://${forge.host}/${project}/-/issues`;
}

/** A label's dot colour, only a `#rrggbb` (the forge's text is untrusted; decision 949). */
export function labelColour(color: string | undefined): string | undefined {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

/** What the list says when no token was found (decision 945): what is read, and what to set. */
export function tokenNote(source: IssueSource): string | undefined {
  if (source.token || !source.forge || source.problem?.kind === 'no-origin') return undefined;
  const limit =
    source.forge.kind === 'github'
      ? 'public issues only, 60 requests an hour'
      : 'public issues only, without their comments';
  const hint = source.tokenHint
    ? ` ${source.tokenHint[0]!.toUpperCase()}${source.tokenHint.slice(1)}.`
    : '';
  return `Read without a token: ${limit}.${hint}`;
}

/** Labels a row shows (GitLab's issues carry 9 to 12 scoped ones): the first `max`, and how many more. */
export function rowLabels<T>(labels: readonly T[], max = 4): { shown: readonly T[]; more: number } {
  return labels.length <= max + 1
    ? { shown: labels, more: 0 }
    : { shown: labels.slice(0, max), more: labels.length - max };
}
