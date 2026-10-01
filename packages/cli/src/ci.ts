import { readFileSync } from 'node:fs';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The pull/merge request a CI job runs for, so `cpr pr` needs no number there: GitLab's merge
 * request pipelines set `CI_MERGE_REQUEST_IID`; GitHub Actions describes the triggering event in
 * the JSON file at `GITHUB_EVENT_PATH` (`pull_request`, `pull_request_target`, `issue_comment`
 * on a pull request).
 */
export function ciChangeRequestNumber(env: Env): number | undefined {
  const valid = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
  if (env.CI_MERGE_REQUEST_IID) return valid(Number(env.CI_MERGE_REQUEST_IID));
  if (env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as {
        pull_request?: { number?: unknown };
        issue?: { number?: unknown; pull_request?: unknown };
      };
      return (
        valid(event.pull_request?.number) ??
        (event.issue?.pull_request ? valid(event.issue.number) : undefined)
      );
    } catch {
      return undefined;
    }
  }
  return undefined;
}
