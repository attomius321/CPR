// Makes the spike's graph sample: the last 30 merges on Symbiote's main (base = the merge's
// first parent, head = its second, compared from their merge-base as a review does), r1's real
// commits (not its 3 experiments), bitwarden-projects and qwik-docs with their plugins.
// Usage: SYMBIOTE_CACHE_DIR=<own> node make-graphs.mjs <repos dir> <out dir> [set…]
// <repos dir> holds `git clone --shared` copies (symbiote, ky, zod, vite, realworld, bitwarden,
// qwik), so Symbiote's worktrees never touch the regression clones.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const root = resolve(here, '../../..');
const cli = join(root, 'packages/cli/dist/bin.js');
const [reposDir, outDir, ...only] = process.argv.slice(2);
const sets = JSON.parse(readFileSync(join(root, 'scripts/regression/sets.json'), 'utf8')).sets;

const jobs = [];
const want = (name) => only.length === 0 || only.includes(name);
if (want('own')) {
  const merges = execFileSync(
    'git',
    ['log', '--first-parent', '--merges', '--format=%h', '-30', 'origin/main'],
    { cwd: join(reposDir, 'symbiote'), encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  for (const m of merges)
    jobs.push({ set: 'own', repo: 'symbiote', base: `${m}^1`, head: `${m}^2`, id: m, args: [] });
}
for (const name of ['r1', 'bitwarden-projects', 'qwik-docs']) {
  if (!want(name)) continue;
  const set = sets[name];
  for (const [repo, ...revs] of set.comparisons) {
    if (revs.length !== 1) continue; // r1's experiments: patches, not real changes
    jobs.push({
      set: name,
      repo,
      base: `${revs[0]}~1`,
      head: revs[0],
      id: revs[0],
      args: ['--no-merge-base', ...(set.plugins ?? []).flatMap((p) => ['--plugin', p])],
    });
  }
}

const index = [];
for (const job of jobs) {
  const file = join(outDir, `${job.set}-${job.repo}-${job.id}.json`);
  const started = Date.now();
  if (!existsSync(file)) {
    try {
      execFileSync('node', [cli, 'diff', job.base, job.head, ...job.args, '--out', file], {
        cwd: join(reposDir, job.repo),
        stdio: ['ignore', 'ignore', 'pipe'],
        maxBuffer: 1 << 28,
      });
    } catch (error) {
      console.error(`${job.set} ${job.repo} ${job.id}: ERROR ${String(error.stderr ?? error).slice(0, 300)}`);
      continue;
    }
  }
  index.push({ ...job, file, ms: Date.now() - started });
  console.error(`${job.set} ${job.repo} ${job.id}: ${Date.now() - started} ms`);
}
writeFileSync(join(outDir, `index-${only.join('+') || 'all'}.json`), JSON.stringify(index, null, 1));
