// Checks the commits page's lanes against git on whole histories (V10): every line drawn from a
// commit runs down its lane, row by row, and ends in exactly that commit's parent; a line cut
// into arrows has its arrow up over the parent; lane 0 holds exactly HEAD's first-parent line.
// Prints the widest rows next to git's own `--graph` (which draws every line whole).
// Usage: node --experimental-strip-types scripts/viewer/lanes-check.mjs <repo>… [--scope current]
//        [--no-git-graph]   (git's --graph takes 1 s on CPython's branches)
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { layoutLanes } from '../../packages/viewer/src/lanes.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scope: { type: 'string', default: 'all' },
    'no-git-graph': { type: 'boolean', default: false },
  },
});
if (positionals.length === 0) throw new Error('usage: lanes-check.mjs <repo>…');
// As `streamHistory` lists them (packages/core/src/git/log.ts).
const tips = values.scope === 'current' ? ['HEAD'] : ['HEAD', '--branches', '--remotes'];

const quantile = (sorted, f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];

for (const repo of positionals) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 30 });
  // Read as `streamHistory` reads it: a root commit's parents are empty, not one parent ''.
  const rows = git('log', '--topo-order', '-z', '--format=%H%x1f%P', ...tips, '--')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const [sha = '', ps = ''] = record.split('\x1f');
      return [sha, ...(ps === '' ? [] : ps.split(' '))];
    });
  const at = new Map(rows.map(([sha], i) => [sha, i]));
  const parents = rows.map(([, ...ps]) => ps.map((p) => at.get(p) ?? -1));
  const head = at.get(git('rev-parse', 'HEAD').trim()) ?? null;

  const started = performance.now();
  const lanes = layoutLanes(parents, head);
  const ms = performance.now() - started;

  const errors = [];
  // Every line from a dot runs down its lane to its parent's row; a line cut into arrows has
  // the arrow up over its parent.
  let arrows = 0;
  lanes.forEach((row, r) => {
    for (const target of row.down) {
      arrows++;
      if (!parents[r].includes(target)) errors.push(`row ${r}: an arrow to ${target}, no parent`);
      else if (target >= 0 && !lanes[target].up.includes(r)) {
        errors.push(`row ${r}: no arrow up at ${target}`);
      }
    }
    const drawn = parents[r].filter((p) => !row.down.includes(p));
    if (drawn.length !== row.to.length) errors.push(`row ${r}: ${row.to.length} lines`);
    row.to.forEach((lane, i) => {
      const target = drawn[i];
      for (let k = r + 1; k < lanes.length; k++) {
        if (lanes[k].from.includes(lane)) {
          if (k !== target) {
            errors.push(`row ${r}: line ${i} in lane ${lane} ends at ${k}, not ${target}`);
          }
          return;
        }
        if (!lanes[k].through.includes(lane)) {
          errors.push(`row ${r}: line ${i} in lane ${lane} breaks at row ${k}`);
          return;
        }
      }
      if (target >= 0) errors.push(`row ${r}: line ${i} never reaches ${target}`);
    });
  });
  // Lane 0 is HEAD's first-parent line, and only it.
  const line = new Set();
  for (let r = head; r !== null && r !== undefined && r >= 0 && !line.has(r); r = parents[r][0]) {
    line.add(r);
  }
  lanes.forEach((row, r) => {
    if ((row.lane === 0) !== line.has(r) && head !== null)
      errors.push(`row ${r}: lane ${row.lane}`);
  });

  const widths = lanes.map((row) => row.width).sort((a, b) => a - b);
  let gitGraph = '';
  if (!values['no-git-graph']) {
    const graph = git('log', '--graph', '--topo-order', '--format=format:*', ...tips, '--');
    const lines = graph.split('\n').filter((l) => l.endsWith('*'));
    const gitWidths = lines.map((l) => Math.ceil((l.length - 1) / 2)).sort((a, b) => a - b);
    gitGraph = `; git --graph: max ${gitWidths.at(-1)}, p95 ${quantile(gitWidths, 0.95)}`;
  }
  console.log(
    `${repo}: ${rows.length} rows, lanes in ${ms.toFixed(0)} ms; max ${widths.at(-1)}, p95 ${quantile(widths, 0.95)}, p50 ${quantile(widths, 0.5)}; ${arrows} arrows${gitGraph}; ${errors.length} errors`,
  );
  for (const error of errors.slice(0, 10)) console.log(`  ${error}`);
  if (errors.length > 0) process.exitCode = 1;
}
