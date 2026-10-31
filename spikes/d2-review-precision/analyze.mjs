// D2: runs `symbiote diff <merge>^ <pull request head>` on the drawn pull requests and keeps what a
// reviewer would see: the findings, with the code they point at.
// Usage: node spikes/d2-review-precision/analyze.mjs --repos <dir> --graphs <dir> --project <name>
//          [--from 0] [--count 17]
// Runs the pull requests at positions [from, from + count) of the project's shuffled order
// (data/selection.json) with this checkout's CLI, and adds them to data/runs-<project>.json
// (pull requests already there are skipped). Set SYMBIOTE_CACHE_DIR to keep worktrees elsewhere.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../../packages/cli/dist/bin.js');
const { values } = parseArgs({
  options: {
    repos: { type: 'string' },
    graphs: { type: 'string' },
    project: { type: 'string' },
    from: { type: 'string', default: '0' },
    count: { type: 'string', default: '17' },
  },
});
if (!values.repos || !values.graphs || !values.project) {
  throw new Error('usage: analyze.mjs --repos <dir> --graphs <dir> --project <name> [--from 0] [--count 17]');
}
const selection = JSON.parse(readFileSync(join(here, 'data', 'selection.json'), 'utf8'));
const project = selection.projects[values.project];
const repo = join(values.repos, values.project);
const out = join(here, 'data', `runs-${values.project}.json`);
const runs = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
mkdirSync(values.graphs, { recursive: true });
const run = promisify(execFile);

const from = Number(values.from);
const picks = project.order.slice(from, from + Number(values.count));
for (const [i, pr] of picks.entries()) {
  if (runs.some((r) => r.number === pr.number)) continue;
  const graphFile = join(values.graphs, `${values.project}-${pr.number}.json`);
  const args = [cli, 'diff', pr.base, `refs/pr/${pr.number}`, '--out', graphFile];
  for (const plugin of project.plugins) args.push('--plugin', plugin);
  const started = performance.now();
  const record = {
    project: values.project,
    position: from + i,
    number: pr.number,
    url: `https://github.com/${project.github}/pull/${pr.number}`,
    subject: pr.subject,
    author: pr.author,
    merged: pr.date,
    merge: pr.merge,
    head: pr.head,
  };
  try {
    const { stdout } = await run('node', args, { cwd: repo, maxBuffer: 1 << 28, timeout: 30 * 60_000 });
    record.summary = stdout;
    const graph = JSON.parse(readFileSync(graphFile, 'utf8'));
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const at = (id) => {
      const n = nodes.get(id);
      if (!n) return null;
      return {
        id,
        kind: n.kind,
        status: n.status,
        exported: n.exported,
        ...(n.base ? { base: { file: n.base.file, lines: [n.base.range.start.line, n.base.range.end.line], signature: n.base.signature } } : {}),
        ...(n.head ? { head: { file: n.head.file, lines: [n.head.range.start.line, n.head.range.end.line], signature: n.head.signature } } : {}),
      };
    };
    Object.assign(record, {
      mergeBase: graph.revisions.from,
      files: graph.files.length,
      stats: graph.stats,
      warnings: graph.warnings,
      findings: graph.findings.map((f) => ({
        key: `${values.project}#${pr.number}/${f.id}`,
        ...f,
        node: at(f.symbol),
        relatedNodes: f.related.slice(0, 12).map(at).filter(Boolean),
      })),
    });
  } catch (error) {
    record.error = String(error?.stderr || error?.stack || error).slice(0, 2000);
  }
  record.ms = Math.round(performance.now() - started);
  runs.push(record);
  runs.sort((a, b) => a.position - b.position);
  writeFileSync(out, `${JSON.stringify(runs, null, 2)}\n`);
  console.log(
    `${values.project} #${pr.number}: ${record.error ? `error ${record.error.split('\n')[0]}` : `${record.findings.length} finding(s)`} in ${(record.ms / 1000).toFixed(1)} s`,
  );
}
