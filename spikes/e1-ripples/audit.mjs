// Prints the line diff of verified symbols, for a by-hand check that none hides a real change.
// Usage: node spikes/e1-ripples/audit.mjs <out.json> [--sample 40] [--seed 1]
// (needs output written with the `at` locations; repos from scripts/regression/setup.mjs)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { sample: { type: 'string', default: '40' }, seed: { type: 'string', default: '1' } },
});
const regressionDir = process.env.SYMBIOTE_REGRESSION_DIR ?? join(homedir(), '.cache', 'symbiote-regression');
const runs = positionals.flatMap((p) => JSON.parse(readFileSync(p, 'utf8')).runs).filter((r) => !r.error);
const verified = runs.flatMap((r) =>
  r.symbols.filter((s) => s.class !== 'decision' && s.class !== 'moved' && s.at?.head).map((s) => ({ r, s })),
);
// A small seeded generator, so a sample can be shown again.
let seed = Number(values.seed);
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const sample = [...verified].sort(() => random() - 0.5).slice(0, Number(values.sample));
const lines = (repo, [rev, file, from, to]) =>
  execFileSync('git', ['show', `${rev}:${file}`], { cwd: join(regressionDir, repo), encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .slice(from - 1, to);
for (const { r, s } of sample) {
  const head = lines(r.repo, s.at.head);
  const base = s.at.base ? lines(r.repo, s.at.base) : [];
  const gone = base.filter((l) => !head.includes(l));
  const come = head.filter((l) => !base.includes(l));
  console.log(`\n### ${r.repo} ${r.head} ${s.class} ${(s.kinds ?? []).join(',')} ${s.id}`);
  for (const l of gone.slice(0, 8)) console.log(`- ${l.trim().slice(0, 140)}`);
  for (const l of come.slice(0, 8)) console.log(`+ ${l.trim().slice(0, 140)}`);
}
console.log(`\n${sample.length} of ${verified.length} verified symbols (moves with identical code left out)`);
