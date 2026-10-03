// Compares two run.mjs results comparison by comparison: errors, edges, findings, time.
// Usage: node scripts/regression/compare.mjs <before.json> <after.json>
// Prints only what differs, then totals; "identical" when nothing does.
import { readFileSync } from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('usage: compare.mjs <before.json> <after.json>');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const before = read(beforePath);
const after = read(afterPath);
const key = (run) => `${run.repo} ${run.base}..${run.head}`;
const afterRuns = new Map(after.runs.map((run) => [key(run), run]));

const totals = {
  comparisons: 0,
  differing: 0,
  errors: 0,
  edgesBefore: 0,
  edgesAfter: 0,
  edgesDropped: 0,
  edgesAdded: 0,
  findingsGone: 0,
  findingsNew: 0,
  msBefore: 0,
  msAfter: 0,
};
for (const b of before.runs) {
  const a = afterRuns.get(key(b));
  if (!a) {
    console.log(`?? ${key(b)}: not in ${afterPath}`);
    continue;
  }
  totals.comparisons++;
  totals.msBefore += b.ms;
  totals.msAfter += a.ms;
  if (b.error || a.error) {
    totals.errors += a.error ? 1 : 0;
    if (b.error !== a.error) {
      totals.differing++;
      console.log(`== ${key(b)}`);
      if (b.error) console.log(`   before: ERROR ${b.error.split('\n')[0]}`);
      if (a.error) console.log(`   after:  ERROR ${a.error.split('\n')[0]}`);
    }
    continue;
  }
  const be = new Set(b.edges.map((e) => e.key));
  const ae = new Set(a.edges.map((e) => e.key));
  const dropped = [...be].filter((k) => !ae.has(k));
  const added = [...ae].filter((k) => !be.has(k));
  const bf = new Set(b.findings);
  const af = new Set(a.findings);
  const gone = [...bf].filter((f) => !af.has(f));
  const fresh = [...af].filter((f) => !bf.has(f));
  totals.edgesBefore += be.size;
  totals.edgesAfter += ae.size;
  totals.edgesDropped += dropped.length;
  totals.edgesAdded += added.length;
  totals.findingsGone += gone.length;
  totals.findingsNew += fresh.length;
  if (dropped.length + added.length + gone.length + fresh.length === 0) continue;
  totals.differing++;
  console.log(`== ${key(b)}: edges ${be.size} → ${ae.size}`);
  for (const k of dropped) console.log(`   - edge ${k}`);
  for (const k of added) console.log(`   + edge ${k}`);
  for (const f of gone) console.log(`   - finding ${f.slice(0, 240)}`);
  for (const f of fresh) console.log(`   + finding ${f.slice(0, 240)}`);
}
const ratio = totals.msBefore > 0 ? (totals.msAfter / totals.msBefore).toFixed(3) : 'n/a';
console.log(
  totals.differing === 0
    ? `identical: ${totals.comparisons} comparisons, ${totals.edgesAfter} edges`
    : `${totals.differing} of ${totals.comparisons} comparisons differ`,
);
console.log(`totals ${JSON.stringify(totals)} time after/before ${ratio}`);
