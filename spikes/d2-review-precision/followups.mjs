// D2: later commits that may have had to fix what an analyzed pull request did.
// Usage: node spikes/d2-review-precision/followups.mjs --repos <dir> --graphs <dir> --project <name>
//          [--until 2026-10-31] [--analyze]
// For each run in data/runs-<project>.json, the first-parent commits after its merge:
//   revert   — a revert that names the pull request (number or subject);
//   mention  — the message cites #<number>;
//   fix      — a fix-like subject (fix, bug, regress, revert, hotfix, crash) touching a file whose
//              symbols the pull request changed.
// With --analyze, each `fix` candidate is analyzed by Symbiote (<commit>^1 → <commit>) and kept
// only when it changes a symbol the pull request changed (by ID, base or head).
// Writes data/followups-<project>.json.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../../packages/cli/dist/bin.js');
const { values } = parseArgs({
  options: {
    repos: { type: 'string' },
    graphs: { type: 'string' },
    project: { type: 'string' },
    until: { type: 'string', default: '2026-10-31T00:00:00Z' },
    analyze: { type: 'boolean', default: false },
  },
});
const selection = JSON.parse(readFileSync(join(here, 'data', 'selection.json'), 'utf8'));
const project = selection.projects[values.project];
const repo = join(values.repos, values.project);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const FIX = /\b(fix(es|ed)?|bug|regress\w*|revert\w*|hotfix|crash\w*)\b/i;
const out = join(here, 'data', `followups-${values.project}.json`);
const done = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
const cache = join(values.graphs, 'followups');
mkdirSync(cache, { recursive: true });

/** IDs of the symbols a graph changed, both sides. */
const changedIds = (graph) =>
  new Set(graph.nodes.filter((n) => n.status !== 'unchanged').flatMap((n) => [n.id, n.previousId].filter(Boolean)));

for (const run of JSON.parse(readFileSync(join(here, 'data', `runs-${values.project}.json`), 'utf8'))) {
  if (run.error) continue;
  const graph = JSON.parse(readFileSync(join(values.graphs, `${values.project}-${run.number}.json`), 'utf8'));
  const ids = changedIds(graph);
  const files = new Set(graph.nodes.filter((n) => n.status !== 'unchanged').flatMap((n) => [n.base?.file, n.head?.file].filter(Boolean)));
  const subject = run.subject.replace(/\s*\(#\d+\)\s*$/, '');
  const log = git('log', '--first-parent', `--until=${values.until}`, '--format=%H%x09%cI%x09%s', `${run.merge}..origin/${project.branch}`);
  const entry = done[run.number] ?? { number: run.number, merge: run.merge, candidates: [] };
  for (const line of log.split('\n').filter(Boolean)) {
    const [sha, date, title] = line.split('\t');
    if (entry.candidates.some((c) => c.sha === sha)) continue;
    const body = git('log', '-1', '--format=%B', sha);
    const why = [];
    if (/revert/i.test(title) && (body.includes(`#${run.number}`) || body.includes(subject))) why.push('revert');
    if (new RegExp(`#${run.number}(?!\\d)`).test(body) && !title.includes(`(#${run.number})`)) why.push('mention');
    let touched = [];
    if (FIX.test(title)) {
      touched = git('diff', '--name-only', `${sha}^1`, sha).split('\n').filter((f) => files.has(f));
      if (touched.length > 0) why.push('fix');
    }
    if (why.length === 0) continue;
    const candidate = { sha, date, title, why, files: touched };
    if (values.analyze && why.includes('fix')) {
      const file = join(cache, `${values.project}-${sha.slice(0, 12)}.json`);
      try {
        if (!existsSync(file)) {
          const args = [cli, 'diff', `${sha}^1`, sha, '--no-merge-base', '--out', file];
          for (const plugin of project.plugins) args.push('--plugin', plugin);
          execFileSync('node', args, { cwd: repo, stdio: 'ignore', timeout: 20 * 60_000 });
        }
        candidate.symbols = [...changedIds(JSON.parse(readFileSync(file, 'utf8')))].filter((id) => ids.has(id));
      } catch (error) {
        candidate.error = String(error).slice(0, 300);
      }
    }
    entry.candidates.push(candidate);
  }
  done[run.number] = entry;
  writeFileSync(out, `${JSON.stringify(done, null, 2)}\n`);
  const fixes = entry.candidates.filter((c) => c.why.includes('fix'));
  console.log(
    `${values.project} #${run.number}: ${entry.candidates.length} candidate(s): ${entry.candidates.filter((c) => c.why.includes('revert')).length} revert, ${entry.candidates.filter((c) => c.why.includes('mention')).length} mention, ${fixes.length} fix${values.analyze ? ` (${fixes.filter((c) => c.symbols?.length).length} change its symbols)` : ''}`,
  );
}
