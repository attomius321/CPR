// Summarizes measure.mjs outputs: per set and overall, what share of changed symbols (and of
// their lines) is mechanical — moved, renamed, ripple — against what is left to read.
// Usage: node spikes/e1-ripples/summarize.mjs <out.json>…
import { readFileSync } from 'node:fs';

const runs = process.argv.slice(2).flatMap((path) => JSON.parse(readFileSync(path, 'utf8')).runs);
const ok = runs.filter((r) => !r.error);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)} %` : '–');

function totals(list) {
  const t = { runs: list.length, symbols: 0, lines: 0, by: {}, linesBy: {}, prodSymbols: 0, prodVerified: 0 };
  t.diff = 0;
  t.diffBy = {};
  for (const run of list) {
    for (const s of run.symbols) {
      const cls =
        s.class === 'ripple'
          ? `ripple ${s.kinds.includes('argument') ? 'argument' : s.linked ? 'linked' : 'spelling'}${s.kinds.includes('rename-in-text') ? ' +text' : ''}`
          : s.class === 'repeat'
            ? `repeat ${s.kinds[0]}`
            : s.class;
      t.symbols++;
      t.lines += s.lines;
      t.by[cls] = (t.by[cls] ?? 0) + 1;
      t.linesBy[cls] = (t.linesBy[cls] ?? 0) + s.lines;
      t.diff += s.diff ?? 0;
      t.diffBy[cls] = (t.diffBy[cls] ?? 0) + (s.diff ?? 0);
      if (!s.test) {
        t.prodSymbols++;
        if (s.class !== 'decision') t.prodVerified++;
      }
    }
  }
  t.verified = t.symbols - (t.by.decision ?? 0);
  t.verifiedLines = t.lines - (t.linesBy.decision ?? 0);
  t.verifiedDiff = t.diff - (t.diffBy.decision ?? 0);
  return t;
}

function report(name, list) {
  const t = totals(list);
  const shares = list.map((r) => {
    const n = r.symbols.length;
    return n ? r.symbols.filter((s) => s.class !== 'decision').length / n : 0;
  });
  const atLeast = (x) => shares.filter((s) => s >= x).length;
  console.log(`\n## ${name}: ${t.runs} changes, ${t.symbols} changed symbols, ${t.diff} diff lines`);
  console.log(
    `verified ${t.verified} symbols (${pct(t.verified, t.symbols)}), ${t.verifiedDiff} diff lines (${pct(t.verifiedDiff, t.diff)}); production symbols ${pct(t.prodVerified, t.prodSymbols)}`,
  );
  for (const [cls, n] of Object.entries(t.by).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cls.padEnd(24)} ${String(n).padStart(5)} symbols  ${String(t.diffBy[cls]).padStart(6)} diff lines`);
  }
  console.log(
    `changes with any verified symbol: ${atLeast(1e-9)}/${t.runs}; ≥ 25 %: ${atLeast(0.25)}; ≥ 50 %: ${atLeast(0.5)}`,
  );
}

for (const set of [...new Set(ok.map((r) => r.set))]) report(set, ok.filter((r) => r.set === set));
report('all', ok);

console.log('\n## Most verified');
const ranked = ok
  .map((r) => ({ r, v: r.symbols.filter((s) => s.class !== 'decision').length }))
  .filter((x) => x.v > 0)
  .sort((a, b) => b.v - a.v)
  .slice(0, 15);
for (const { r, v } of ranked) {
  console.log(`  ${r.set} ${r.repo} ${r.head}: ${v} of ${r.symbols.length} verified (${pct(v, r.symbols.length)}); renames: ${(r.subs ?? []).slice(0, 3).join('; ')}`);
}
const errors = runs.filter((r) => r.error);
if (errors.length) console.log(`\nerrors: ${errors.map((r) => `${r.repo} ${r.head}: ${r.error.split('\n')[0]}`).join('\n  ')}`);
