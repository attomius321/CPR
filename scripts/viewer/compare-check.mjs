// Checks the commits page's comparisons against git on real histories (V10c): for random pairs
// of rows (near the top, where a reader picks, and anywhere), the viewer's own `comparison` must
// name git's fork point (`merge-base`; one of `--all` for a criss-cross), both sides' commit
// counts (`rev-list --left-right --count`), no comparison for unrelated lines, and the base's
// side by its rules, checked here with git's own first-parent lists. Then the default branch's
// tip against every unmerged remote branch: the branch must be head, compared from the fork.
// Usage: pnpm build; node --experimental-strip-types scripts/viewer/compare-check.mjs <repo>…
//        [--pairs 500] [--scope current]
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { defaultBranchTips, openRepo } from '../../packages/core/dist/index.js';
import { comparison } from '../../packages/viewer/src/history/commits.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pairs: { type: 'string', default: '500' },
    scope: { type: 'string', default: 'all' },
  },
});
if (positionals.length === 0) throw new Error('usage: compare-check.mjs <repo>…');
const perKind = Number(values.pairs);
// As `streamHistory` lists them (packages/core/src/git/log.ts).
const tips = values.scope === 'current' ? ['HEAD'] : ['HEAD', '--branches', '--remotes'];

let failed = false;
for (const repo of positionals) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 30 }).trim();
  const tryGit = (...args) => {
    try {
      return git(...args);
    } catch (error) {
      if (error.status === 1) return '';
      throw error;
    }
  };
  const rows = git('log', '--topo-order', '--format=%H %P', ...tips, '--')
    .split('\n')
    .map((line) => line.split(' '));
  const shas = rows.map(([sha]) => sha);
  const at = new Map(shas.map((sha, i) => [sha, i]));
  // A root commit's line ends in a space: no parent.
  const parents = rows.map(([, ...ps]) => ps.filter(Boolean).map((p) => at.get(p) ?? -1));
  const head = at.get(git('rev-parse', 'HEAD')) ?? null;
  const main = await defaultBranchTips(await openRepo(repo));
  const trunk = (main?.tips ?? []).flatMap((tip) => at.get(tip) ?? []);
  const lines = { parents, head, trunk, complete: true, shaAt: (row) => shas[row] };

  // Git's own first-parent lines, to check the base's side.
  const firstParents = (revs) =>
    new Set(revs.length === 0 ? [] : git('rev-list', '--first-parent', ...revs).split('\n'));
  const onTrunk = firstParents((main?.tips ?? []).filter((t) => at.has(t)));
  const onHead = firstParents(head === null ? [] : ['HEAD']);
  const expectedBase = (a, b) => {
    for (const line of [onTrunk, onHead]) {
      if (line.has(a.sha) !== line.has(b.sha)) return line.has(a.sha) ? a : b;
    }
    return a.row > b.row ? a : b;
  };

  const picked = (row) => ({
    sha: shas[row],
    row,
    ...(rows[row][1] ? { parent: rows[row][1] } : {}),
  });
  const errors = [];
  const tally = {
    pairs: 0,
    diverged: 0,
    unrelated: 0,
    gitsBase: 0,
    severalBases: 0,
    counts: 0,
    sides: 0,
    slowestMs: 0,
  };
  const check = (a, b) => {
    const started = performance.now();
    const result = comparison([a, b], lines);
    tally.slowestMs = Math.max(tally.slowestMs, performance.now() - started);
    tally.pairs++;
    const all = tryGit('merge-base', '--all', a.sha, b.sha);
    const what = `${a.sha.slice(0, 9)} ${b.sha.slice(0, 9)}`;
    if (all === '') {
      tally.unrelated++;
      if (result?.pair !== null || !/share no history/.test(result.label)) {
        errors.push(`${what}: unrelated, but ${JSON.stringify(result)}`);
      }
      return;
    }
    if (!result?.pair) return errors.push(`${what}: nothing to compare: ${result?.label}`);
    const bases = all.split('\n');
    if (bases.length > 1) tally.severalBases++;
    const fork = result.pair.base;
    if (!bases.includes(fork)) errors.push(`${what}: fork ${fork}, git has ${all}`);
    if (fork === git('merge-base', a.sha, b.sha)) tally.gitsBase++;
    const headPick = result.pair.head === a.sha ? a : b;
    const other = headPick === a ? b : a;
    const [otherOnly, headOnly] = git(
      'rev-list',
      '--count',
      '--left-right',
      `${other.sha}...${headPick.sha}`,
    )
      .split('\t')
      .map(Number);
    const count = Number(/· (\d+) commits?/.exec(result.label)?.[1]);
    const diverged = !bases.includes(a.sha) && !bases.includes(b.sha);
    if (count === headOnly && (!diverged || result.diverged?.otherCommits === otherOnly)) {
      tally.counts++;
    } else {
      errors.push(
        `${what}: counts ${count}/${result.diverged?.otherCommits}, git ${headOnly}/${otherOnly}`,
      );
    }
    if (diverged) {
      tally.diverged++;
      if (!result.diverged) errors.push(`${what}: diverged, not said`);
      if (expectedBase(a, b) === other) tally.sides++;
      else errors.push(`${what}: base's side ${other.sha.slice(0, 9)}, expected the other`);
    } else if (result.diverged) {
      errors.push(`${what}: an ancestor pair said to diverge`);
    } else if (bases.includes(other.sha)) {
      tally.sides++;
    } else errors.push(`${what}: the base is not the ancestor`);
  };

  let seed = 1;
  const random = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (const span of [Math.min(rows.length, 2000), rows.length]) {
    for (let i = 0; i < perKind; i++) {
      const a = random(span);
      const b = random(span);
      if (a !== b) check(picked(a), picked(b));
    }
  }

  // The default branch's newest tip against each unmerged remote branch's tip.
  const branches = { pairs: 0, branchIsHead: 0 };
  const mainTip = trunk.length > 0 ? Math.min(...trunk) : null;
  if (mainTip !== null) {
    const remotes = git('for-each-ref', '--format=%(objectname)', 'refs/remotes').split('\n');
    for (const tip of new Set(remotes)) {
      const row = at.get(tip);
      if (row === undefined || row === mainTip) continue;
      const fork = tryGit('merge-base', shas[mainTip], tip);
      if (fork === '' || fork === tip || fork === shas[mainTip]) continue;
      branches.pairs++;
      const result = comparison([picked(mainTip), picked(row)], lines);
      if (result?.pair?.head === tip && result.pair.base === fork) branches.branchIsHead++;
      else errors.push(`${main?.name} vs ${tip.slice(0, 9)}: ${JSON.stringify(result?.pair)}`);
    }
  }

  const name = repo.replace(/\/$/, '').split('/').pop();
  console.log(
    `${name}: ${rows.length} rows, default branch ${main?.name ?? 'none'}; ` +
      `${tally.pairs} pairs (${tally.diverged} diverged, ${tally.unrelated} unrelated, ` +
      `${tally.severalBases} with several bases): fork = git merge-base ${tally.gitsBase}, ` +
      `counts ${tally.counts}, base's side ${tally.sides}; slowest ${tally.slowestMs.toFixed(1)} ms. ` +
      `${main?.name ?? 'default'} against ${branches.pairs} diverged remote branches: ` +
      `branch as head from the fork ${branches.branchIsHead}. Errors: ${errors.length}`,
  );
  for (const error of errors.slice(0, 10)) console.log(`  ${error}`);
  if (errors.length > 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
