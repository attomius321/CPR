#!/usr/bin/env node
// HV1 spike: the results table from the kept runs (runs/<run>/state.json, eval.json, probe.json).
//   node summary.mjs [runs-dir]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const RUNS = resolve(process.argv[2] ?? join(dirname(new URL(import.meta.url).pathname), 'runs'));
const json = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
const rows = [];
const tokens = {};
for (const run of readdirSync(RUNS).sort()) {
  const state = json(join(RUNS, run, 'state.json'));
  if (!state || state.profile === 'fake') continue;
  const ev = json(join(RUNS, run, 'eval.json'));
  const first = json(join(RUNS, run, 'eval.round1.json'));
  const goal = /g1-/.test(state.goalFile) ? 'G1' : /g2-/.test(state.goalFile) ? 'G2' : 'G3';
  const writer = state.calls.find((c) => c.role === 'main' || c.role === 'one')?.model;
  const reviews = state.nodes.flatMap((n) => n.reviews);
  const sev = (e, s) => (e?.blind?.findings ?? []).filter((f) => f.severity === s).length;
  const blind = (e) => (e ? `${sev(e, 'blocker')}/${sev(e, 'major')}/${sev(e, 'minor')}` : '');
  const ms = state.runs.reduce((sum, r) => sum + (Date.parse(r.ended ?? state.finished) - Date.parse(r.started)), 0);
  for (const c of state.calls) {
    for (const [model, u] of Object.entries(c.modelUsage ?? {})) {
      const t = (tokens[model] ??= { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 });
      t.input += u.inputTokens ?? 0;
      t.cacheRead += u.cacheReadInputTokens ?? 0;
      t.cacheWrite += u.cacheCreationInputTokens ?? 0;
      t.output += u.outputTokens ?? 0;
      t.cost += u.costUSD ?? 0;
    }
  }
  rows.push({
    run,
    goal,
    arm: `${state.mode}${state.review === 'probe' ? '+probe' : ''}`,
    writer,
    workspaces: state.nodes.length,
    cost: state.calls.reduce((s, c) => s + (c.cost ?? 0), 0),
    minutes: ms / 60000,
    calls: state.calls.length,
    reviews: reviews.map((r) => `${r.verdict === 'approve' ? 'A' : 'C'}${r.findings.length}`).join(' '),
    hidden: ev?.acceptance ? `${ev.acceptance.passed}/${ev.acceptance.total}` : '',
    check: ev?.check ? 'pass' : 'fail',
    blind: first ? `${blind(first)} → ${blind(ev)}` : blind(ev),
    added: Number(/(\d+) insertion/.exec(ev?.change?.shortstat ?? '')?.[1] ?? 0),
  });
}
const head = ['run', 'goal', 'arm', 'writer', 'ws', '$', 'min', 'calls', 'in-loop reviews', 'hidden', 'check', 'blind b/M/m', '+lines'];
console.log(`| ${head.join(' | ')} |`);
console.log(`|${head.map(() => '---').join('|')}|`);
for (const r of rows) {
  console.log(
    `| ${r.run} | ${r.goal} | ${r.arm} | ${r.writer} | ${r.workspaces} | ${r.cost.toFixed(2)} | ${r.minutes.toFixed(1)} | ${r.calls} | ${r.reviews} | ${r.hidden} | ${r.check} | ${r.blind} | ${r.added} |`,
  );
}
console.log('\nTokens by model (every measured run, the trial included):');
for (const [model, t] of Object.entries(tokens)) {
  console.log(
    `- ${model}: ${(t.input / 1e3).toFixed(0)}K input, ${(t.cacheRead / 1e6).toFixed(2)}M cache reads, ${(t.cacheWrite / 1e3).toFixed(0)}K cache writes, ${(t.output / 1e3).toFixed(0)}K output; $${t.cost.toFixed(2)}`,
  );
}
for (const run of readdirSync(RUNS).sort()) {
  const p = json(join(RUNS, run, 'probe.json'));
  if (p) console.log(`probe ${run}: $${p.review.cost?.toFixed(2)}, ${Math.round(p.review.ms / 1000)} s, ${p.review.findings?.length} findings, ${p.tests.failed?.length} failing tests`);
}
