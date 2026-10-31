// D2: prints a finding with the code a reviewer needs to judge it — the symbol's diff (base → head)
// and, for each symbol it names, the lines where it uses the finding's symbol.
// Usage: node spikes/d2-review-precision/context.mjs --repos <dir> --graphs <dir> <key>…
//          [--json]       one JSON object a line instead of text (for the sample page)
//          [--pr zod#6380] every finding of a pull request
// A key is `<project>#<number>/<finding id>` (data/runs-<project>.json).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repos: { type: 'string' },
    graphs: { type: 'string' },
    json: { type: 'boolean', default: false },
    pr: { type: 'string' },
    users: { type: 'string', default: '6' },
  },
});
const git = (repo, ...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
const runsOf = new Map();
const runs = (project) => {
  if (!runsOf.has(project)) runsOf.set(project, JSON.parse(readFileSync(join(here, 'data', `runs-${project}.json`), 'utf8')));
  return runsOf.get(project);
};
const graphs = new Map();
const graph = (project, number) => {
  const key = `${project}-${number}`;
  if (!graphs.has(key)) graphs.set(key, JSON.parse(readFileSync(join(values.graphs, `${key}.json`), 'utf8')));
  return graphs.get(key);
};
const lines = (repo, sha, file, from, to) => {
  try {
    return git(repo, 'show', `${sha}:${file}`).split('\n').slice(from - 1, to).join('\n');
  } catch {
    return null;
  }
};
const scratch = mkdtempSync(join(tmpdir(), 'd2-context-'));
const unified = (a, b) => {
  writeFileSync(join(scratch, 'a'), a ? `${a}\n` : '');
  writeFileSync(join(scratch, 'b'), b ? `${b}\n` : '');
  try {
    return execFileSync('git', ['diff', '--no-index', '--no-color', '-U3', 'a', 'b'], { cwd: scratch, encoding: 'utf8' });
  } catch (error) {
    // git diff --no-index exits 1 when the files differ.
    return String(error.stdout).split('\n').slice(4).join('\n');
  }
};

/** Everything a reviewer reads to judge one finding. */
export function context(key) {
  const [, project, number, id] = /^(\w+)#(\d+)\/(f\d+)$/.exec(key) ?? [];
  if (!project) throw new Error(`not a key: ${key}`);
  const run = runs(project).find((r) => r.number === Number(number));
  const finding = run.findings.find((f) => f.id === id);
  const g = graph(project, number);
  const repo = join(values.repos, project);
  const base = g.revisions.from;
  const head = g.revisions.head.sha;
  const node = g.nodes.find((n) => n.id === finding.symbol);
  const code = (side, n) => {
    const at = n?.[side];
    if (!at) return null;
    return lines(repo, side === 'base' ? base : head, at.file, at.range.start.line, at.range.end.line);
  };
  const before = code('base', node);
  const after = code('head', node);
  // Uses of the symbol (or of its members) by the symbols the finding names, at head, else base.
  const targets = new Set([finding.symbol, ...g.nodes.filter((n) => n.container === finding.symbol).map((n) => n.id)]);
  const uses = finding.related.slice(0, Number(values.users)).map((from) => {
    const user = g.nodes.find((n) => n.id === from);
    const edges = g.edges.filter((e) => e.from === from && targets.has(e.to));
    const sites = edges.flatMap((e) => (e.sites.head ?? e.sites.base ?? []).map((s) => ({ ...s, side: e.sites.head ? 'head' : 'base', kind: e.kind, to: e.to })));
    const shown = sites.slice(0, 3).map((s) => ({
      ...s,
      code: lines(repo, s.side === 'head' ? head : base, s.file, Math.max(1, s.line - 2), s.line + 2),
    }));
    return { id: from, status: user?.status ?? null, kind: user?.kind ?? null, sites: shown, more: Math.max(0, sites.length - 3) };
  });
  const link = (sha, at) => at && `https://github.com/${run.url.split('/').slice(3, 5).join('/')}/blob/${sha}/${at.file}#L${at.range.start.line}-L${at.range.end.line}`;
  return {
    key,
    project,
    number: Number(number),
    url: run.url,
    title: run.subject,
    rule: finding.rule,
    severity: finding.severity,
    symbol: finding.symbol,
    message: finding.message,
    data: finding.data,
    status: node?.status ?? null,
    kind: node?.kind ?? null,
    links: { base: link(base, node?.base), head: link(head, node?.head) },
    diff: before === after ? null : unified(before, after),
    head: after,
    uses,
  };
}

const keys = values.pr
  ? (() => {
      const [project, number] = values.pr.split('#');
      return runs(project).find((r) => r.number === Number(number)).findings.map((f) => f.key);
    })()
  : positionals;
for (const key of keys) {
  const c = context(key);
  if (values.json) {
    console.log(JSON.stringify(c));
    continue;
  }
  console.log(`\n=== ${c.key} · ${c.severity} ${c.rule} · ${c.kind} ${c.status}\n${c.title}\n${c.url}`);
  console.log(`> ${c.message}`);
  console.log(`data: ${JSON.stringify(c.data)}`);
  if (c.diff) console.log(`--- diff of ${c.symbol}\n${c.diff.split('\n').slice(0, 80).join('\n')}`);
  else if (c.head) console.log(`--- head of ${c.symbol}\n${c.head.split('\n').slice(0, 40).join('\n')}`);
  for (const u of c.uses) {
    console.log(`--- used by ${u.id} (${u.kind} ${u.status})${u.more ? ` +${u.more} more sites` : ''}`);
    for (const s of u.sites) console.log(`  ${s.side} ${s.file}:${s.line} ${s.kind} → ${s.to}\n${(s.code ?? '').replace(/^/gm, '    | ')}`);
  }
}
