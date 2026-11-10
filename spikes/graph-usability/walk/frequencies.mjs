// How often each problem bites, over the graph sample and the first-fit audit: zoom bands and
// screens (from audit.mjs's JSON lines), findings by severity and the head against the tab,
// stylesheet and test symbols, symbols linked only by type references, and on this repository's
// merges, the file Files opens on and where the top finding's file sits.
// Usage: node frequencies.mjs <graphs dir> <first-fit.jsonl> <scratch clone of this repository>
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [dir, auditFile, clone] = process.argv.slice(2);
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const graphs = readdirSync(dir)
  .filter((f) => /^(own|bitwarden|qwik|r1)-.*\.json$/.test(f))
  .map((f) => ({ name: f.replace('.json', ''), g: JSON.parse(readFileSync(join(dir, f), 'utf8')) }))
  .filter(({ g }) => g.nodes.length > 0);
const own = (n) => n.startsWith('own-');
const changed = (g) => g.nodes.filter((n) => n.status !== 'unchanged');
const fileOf = (n) => (n.head ?? n.base).file;

// The first view, by zoom band (names are 12 px at zoom 1; under 11 px they cannot be read).
const rows = readFileSync(auditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.zoom != null);
for (const [label, keep] of [['your merges', (r) => own(r.graph)], ['r1', (r) => r.graph.startsWith('r1')], ['sample', () => true]]) {
  const s = rows.filter(keep);
  console.log(`first view, ${label}: ${s.length} graphs; names under 11 px ${s.filter((r) => r.nameOnScreenPx < 11).length}; map ${s.filter((r) => r.zoom < 0.45).length}; 0.45–0.92 ${s.filter((r) => r.zoom >= 0.45 && r.zoom < 11 / 12).length}; readable ${s.filter((r) => r.zoom >= 11 / 12).length}; median zoom ${med(s.map((r) => r.zoom)).toFixed(2)}, name ${med(s.map((r) => r.nameOnScreenPx))} px; screens at zoom 1 median ${med(s.map((r) => r.screensAtReading))}, max ${Math.max(...s.map((r) => r.screensAtReading))}; unchanged per changed ${med(s.map((r) => r.drawn.context / Math.max(1, r.drawn.changed))).toFixed(2)}; summary cards ${med(s.map((r) => r.drawn.summaries))}; first paint median ${med(s.map((r) => r.firstPaintMs))} ms, max ${Math.max(...s.map((r) => r.firstPaintMs))} ms`);
}

// Findings: severities, and the head (errors and warnings) against the tab (all).
let withFindings = 0, differ = 0, headEmpty = 0;
const sev = {};
for (const { g } of graphs) {
  const s = {};
  for (const f of g.findings) s[f.severity] = (s[f.severity] ?? 0) + 1, sev[f.severity] = (sev[f.severity] ?? 0) + 1;
  if (!g.findings.length) continue;
  withFindings++;
  if (s.info) differ++;
  if (!s.error && !s.warning) headEmpty++;
}
console.log(`findings: ${JSON.stringify(sev)}; graphs with findings ${withFindings}; head differs from tab ${differ}; head shows none ${headEmpty}`);

// Stylesheet rules and tests among changed symbols, on your merges.
let all = 0, css = 0, tests = 0, withCss = 0;
for (const { name, g } of graphs.filter((x) => own(x.name))) {
  const ch = changed(g);
  const c = ch.filter((n) => /\.(css|scss|less)$/.test(fileOf(n))).length;
  all += ch.length, css += c, withCss += c > 0 ? 1 : 0;
  tests += ch.filter((n) => /(\.test\.|\.spec\.|\/e2e\/|\/test\/)/.test(fileOf(n))).length;
  if (c * 3 > ch.length) console.log(`  ${name}: ${c} of ${ch.length} changed symbols are CSS rules`);
}
console.log(`your merges: ${all} changed symbols, ${css} CSS rules, ${tests} in tests; ${withCss} merges have CSS`);

// Changed symbols whose every link is a type reference (Focus draws them alone).
let total = 0, typeOnly = 0, someHidden = 0, findingSyms = 0, findingTypeOnly = 0;
for (const { g } of graphs) {
  const links = new Map();
  for (const e of g.edges)
    for (const id of [e.from, e.to]) {
      const l = links.get(id) ?? { type: 0, other: 0 };
      l[e.kind === 'type-reference' ? 'type' : 'other']++;
      links.set(id, l);
    }
  const flagged = new Set(g.findings.map((f) => f.symbol));
  for (const n of changed(g)) {
    const l = links.get(n.id) ?? { type: 0, other: 0 };
    const only = l.other === 0 && l.type > 0;
    total++, typeOnly += only, someHidden += l.type > 0;
    if (flagged.has(n.id)) findingSyms++, findingTypeOnly += only;
  }
}
console.log(`type references: ${typeOnly} of ${total} changed symbols linked only by them; ${someHidden} have some; of ${findingSyms} symbols with findings, ${findingTypeOnly} only by them`);

// Files on this repository's merges: the first file (path order) and the top finding's file.
const git = (...a) => execFileSync('git', a, { cwd: clone, encoding: 'utf8' }).trim();
const merges = git('log', '--first-parent', '--merges', '--format=%h', '-30', 'origin/main').split('\n');
const code = (f) => /\.(tsx?|jsx?|mjs|css|scss|html)$/.test(f);
let docsFirst = 0;
const at = [];
for (const m of merges) {
  const base = git('merge-base', `${m}^1`, `${m}^2`);
  const files = git('diff', '--name-only', base, `${m}^2`).split('\n').filter(Boolean).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!code(files[0])) docsFirst++;
  const entry = graphs.find((x) => x.name === `own-symbiote-${m}`);
  if (!entry?.g.findings.length) continue;
  const rank = { error: 0, warning: 1, info: 2 };
  const top = [...entry.g.findings].sort((a, b) => rank[a.severity] - rank[b.severity])[0];
  const node = entry.g.nodes.find((n) => n.id === top.symbol);
  at.push(files.indexOf(fileOf(node)));
}
console.log(`Files: ${docsFirst} of ${merges.length} merges open on a file that is not code; the top finding's file at median position ${med(at)} (${Math.min(...at)}–${Math.max(...at)}) of ${at.length}`);
