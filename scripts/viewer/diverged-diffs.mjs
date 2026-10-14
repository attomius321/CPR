// Checks what the commits page analyzes for diverged picks (V10c), end to end through `cpr view`'s
// server: the default branch's tip and an unmerged remote branch's tip picked, `comparison` run
// on the shape the server sends (as the page does), the pair posted to `/api/diffs`. The graph
// must hold exactly the branch's own changes — its files equal `git diff --name-only A...B`
// (from the merge-base) — and equal `cpr diff A B`'s (merge-base by default). The pair `main`
// sent (the lower row as the base, compared directly) is analyzed too, for the numbers.
// Usage: pnpm build; node --experimental-strip-types scripts/viewer/diverged-diffs.mjs <repo>
//        [--branches 3] [--no-before]
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { comparison } from '../../packages/viewer/src/commits.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    branches: { type: 'string', default: '3' },
    'no-before': { type: 'boolean', default: false },
  },
});
const [repo] = positionals;
if (!repo) throw new Error('usage: diverged-diffs.mjs <repo>');
const cli = new URL('../../packages/cli/dist/bin.js', import.meta.url).pathname;
const git = (...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 30 }).trim();

const cache = mkdtempSync(join(tmpdir(), 'cpr-diverged-'));
const server = spawn(process.execPath, [cli, 'view', '--no-open'], {
  cwd: repo,
  env: { ...process.env, CPR_CACHE_DIR: cache },
});
const url = await new Promise((resolve, reject) => {
  let output = '';
  server.stdout.on('data', (data) => {
    output += data;
    const match = /CPR viewer: (\S+)/.exec(output);
    if (match) resolve(match[1]);
  });
  server.stderr.on('data', (data) => (output += data));
  server.on('exit', (code) => reject(new Error(`cpr view exited with ${code}: ${output}`)));
});

const get = async (path) => {
  const response = await fetch(new URL(path, url));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
};
const first = await get('api/history?scope=all&from=0&to=200');
const shape = await get(`api/history/shape?scope=all&version=${first.version}`);
const details = new Map(first.commits.map((c, i) => [i, c]));
const rowOf = async (row) => {
  if (!details.has(row)) {
    const page = await get(
      `api/history?scope=all&from=${row}&to=${row + 1}&version=${first.version}`,
    );
    details.set(row, page.commits[0]);
  }
  return details.get(row);
};
const picked = async (row) => {
  const commit = await rowOf(row);
  return { sha: commit.sha, row, ...(commit.parents[0] ? { parent: commit.parents[0] } : {}) };
};
/** What the page would compare: `comparison`, with the fork point's row loaded when needed. */
async function compare(picks) {
  const lines = () => ({
    parents: shape.parents,
    head: shape.head,
    trunk: shape.defaultBranch?.rows ?? [],
    complete: true,
    shaAt: (row) => details.get(row)?.sha,
  });
  let result = comparison(picks, lines());
  if (result && !result.pair && result.diverged) {
    await rowOf(result.diverged.forkRow);
    result = comparison(picks, lines());
  }
  return result;
}
async function analyze(pair) {
  const response = await fetch(new URL('api/diffs', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cpr': '1' },
    body: JSON.stringify(pair),
  });
  if (!response.ok) throw new Error(`POST /api/diffs: ${await response.text()}`);
  const { url: page } = await response.json();
  const started = Date.now();
  for (;;) {
    const answer = await fetch(new URL(`${page}api/graph`, url));
    if (answer.status === 200) return { graph: await answer.json(), ms: Date.now() - started };
    if (answer.status !== 202) throw new Error(`${page}: ${answer.status} ${await answer.text()}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const summary = (graph) =>
  `${graph.stats.filesChanged} files; ${graph.stats.symbols.added} added, ` +
  `${graph.stats.symbols.removed} removed, ${graph.stats.symbols.modified} modified; ` +
  `${graph.findings.length} findings`;
// What two graphs of the same change share, whatever they were asked as.
const content = (graph) =>
  JSON.stringify({
    files: graph.files,
    nodes: graph.nodes,
    edges: graph.edges,
    findings: graph.findings,
    projects: graph.projects,
  });

let failed = false;
try {
  const mainRow = Math.min(...(shape.defaultBranch?.rows ?? []));
  if (!Number.isFinite(mainRow)) throw new Error('no default branch listed');
  const mainSha = (await rowOf(mainRow)).sha;
  // Unmerged remote branches that diverged from the default branch, nearest the top.
  const at = new Map(
    git('log', '--topo-order', '--format=%H', 'HEAD', '--branches', '--remotes', '--')
      .split('\n')
      .map((sha, i) => [sha, i]),
  );
  const candidates = [
    ...new Set(git('for-each-ref', '--format=%(objectname)', 'refs/remotes').split('\n')),
  ]
    .filter((sha) => at.has(sha) && sha !== mainSha)
    .sort((a, b) => at.get(a) - at.get(b));
  let done = 0;
  for (const tip of candidates) {
    if (done >= Number(values.branches)) break;
    let fork;
    try {
      fork = git('merge-base', mainSha, tip);
    } catch {
      continue;
    }
    if (fork === tip || fork === mainSha) continue;
    done++;
    const picks = [await picked(mainRow), await picked(at.get(tip))];
    const result = await compare(picks);
    const name = `${shape.defaultBranch.name} ${mainSha.slice(0, 7)} / ${tip.slice(0, 7)}`;
    if (result?.pair?.base !== fork || result.pair.head !== tip) {
      failed = true;
      console.log(`${name}: the page would compare ${JSON.stringify(result)}`);
      continue;
    }
    const after = await analyze(result.pair);
    const files = new Set(
      after.graph.files.flatMap((f) => [f.path, ...(f.previousPath ? [f.previousPath] : [])]),
    );
    const own = new Set(
      git('diff', '--name-only', '--no-renames', `${mainSha}...${tip}`).split('\n').filter(Boolean),
    );
    const sameFiles = files.size === own.size && [...own].every((f) => files.has(f));
    const cprDiff = JSON.parse(
      execFileSync(process.execPath, [cli, 'diff', mainSha, tip, '--json'], {
        cwd: repo,
        env: { ...process.env, CPR_CACHE_DIR: cache },
        encoding: 'utf8',
        maxBuffer: 1 << 30,
      }),
    );
    const sameGraph = content(cprDiff) === content(after.graph);
    if (!sameFiles || !sameGraph) failed = true;
    console.log(
      `${name}: ${result.label} — ${summary(after.graph)} (${(after.ms / 1000).toFixed(1)} s); ` +
        `files = git diff A...B: ${sameFiles ? 'yes' : `NO (${files.size} vs ${own.size})`}; ` +
        `graph = cpr diff A B: ${sameGraph ? 'yes' : 'NO'}`,
    );
    if (!values['no-before']) {
      // `main`'s page: the lower row as the base, compared directly.
      const [upper, lower] = picks[0].row < picks[1].row ? picks : [picks[1], picks[0]];
      const before = await analyze({ base: lower.sha, head: upper.sha });
      console.log(
        `  main sent ${lower.sha.slice(0, 7)} → ${upper.sha.slice(0, 7)}: ${summary(before.graph)}`,
      );
    }
  }
  if (done === 0) console.log('no unmerged remote branch diverged from the default branch');
} finally {
  server.kill('SIGINT');
  rmSync(cache, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.exitCode = failed ? 1 : 0;
