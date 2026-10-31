// D2: reads, through `gh api` (read only), what GitHub shows on each analyzed pull request: its
// body, reviews, inline review comments, conversation comments, and later issues and pull
// requests that cite it (timeline cross-references).
// Usage: node spikes/d2-review-precision/forge.mjs [--project <name>]
// Writes data/forge/<project>-<number>.json, one per run in data/runs-<project>.json; existing
// files are kept (delete one to read it again).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { project: { type: 'string' } } });
const selection = JSON.parse(readFileSync(join(here, 'data', 'selection.json'), 'utf8'));
const dir = join(here, 'data', 'forge');
mkdirSync(dir, { recursive: true });

// This gh has no --slurp: lists are read page by page (100 a page) until a short one.
const get = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const api = (path) => {
  if (!path.includes('per_page=')) return [get(path)];
  const all = [];
  for (let page = 1; ; page++) {
    const items = get(`${path}&page=${page}`);
    all.push(...items);
    if (items.length < 100) return all;
  }
};
const user = (u) => ({ login: u?.login ?? null, type: u?.type ?? null });

for (const name of values.project ? [values.project] : Object.keys(selection.projects)) {
  const runsFile = join(here, 'data', `runs-${name}.json`);
  if (!existsSync(runsFile)) continue;
  const { github } = selection.projects[name];
  for (const run of JSON.parse(readFileSync(runsFile, 'utf8'))) {
    const file = join(dir, `${name}-${run.number}.json`);
    if (existsSync(file)) continue;
    const base = `repos/${github}`;
    const [pull] = api(`${base}/pulls/${run.number}`);
    const reviews = api(`${base}/pulls/${run.number}/reviews?per_page=100`);
    const inline = api(`${base}/pulls/${run.number}/comments?per_page=100`);
    const comments = api(`${base}/issues/${run.number}/comments?per_page=100`);
    const timeline = api(`${base}/issues/${run.number}/timeline?per_page=100`);
    const record = {
      number: run.number,
      title: pull.title,
      body: pull.body,
      user: user(pull.user),
      baseSha: pull.base.sha,
      headSha: pull.head.sha,
      mergedAt: pull.merged_at,
      mergeCommit: pull.merge_commit_sha,
      commits: pull.commits,
      reviews: reviews.map((r) => ({
        id: r.id,
        user: user(r.user),
        state: r.state,
        commit: r.commit_id,
        at: r.submitted_at,
        body: r.body,
        url: r.html_url,
      })),
      inline: inline.map((c) => ({
        id: c.id,
        review: c.pull_request_review_id,
        replyTo: c.in_reply_to_id ?? null,
        user: user(c.user),
        path: c.path,
        line: c.line ?? null,
        originalLine: c.original_line ?? null,
        commit: c.commit_id,
        originalCommit: c.original_commit_id,
        at: c.created_at,
        body: c.body,
        diffHunk: c.diff_hunk,
        url: c.html_url,
      })),
      comments: comments.map((c) => ({
        id: c.id,
        user: user(c.user),
        at: c.created_at,
        updated: c.updated_at,
        body: c.body,
        url: c.html_url,
      })),
      citedBy: timeline
        .filter((e) => e.event === 'cross-referenced' && e.source?.issue)
        .map((e) => ({
          at: e.created_at,
          number: e.source.issue.number,
          repo: e.source.issue.repository?.full_name ?? null,
          pull: Boolean(e.source.issue.pull_request),
          title: e.source.issue.title,
          state: e.source.issue.state,
          url: e.source.issue.html_url,
        })),
    };
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    const bots = [...new Set([...record.reviews, ...record.inline, ...record.comments].filter((c) => c.user.type === 'Bot').map((c) => c.user.login))];
    console.log(`${name} #${run.number}: ${record.reviews.length} reviews, ${record.inline.length} inline, ${record.comments.length} comments, cited by ${record.citedBy.length}; bots: ${bots.join(' ')}`);
  }
}
