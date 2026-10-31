#!/usr/bin/env node
// HV1 spike: scores a finished hive.mjs run the same way for every arm.
//   node eval.mjs <run-dir> --hidden <test file> [--no-review]
// Its usage from state.json (every call's tokens by model and Claude Code's cost); its wall time;
// the result on `main` from a fresh clone: the repository's check, the hidden acceptance tests,
// the change's size, Symbiote's findings (`symbiote diff`), and a blind review by a fresh Opus
// that saw nothing of the run. Writes eval.json beside state.json.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const SYMBIOTE = resolve(HERE, '../../packages/cli/dist/bin.js');
const argv = process.argv.slice(2);
const RUN = resolve(argv[0]);
const hidden = argv.includes('--hidden') ? resolve(argv[argv.indexOf('--hidden') + 1]) : null;
const review = !argv.includes('--no-review');
const state = JSON.parse(readFileSync(join(RUN, 'state.json'), 'utf8'));

const run = (cmd, args, cwd, env = {}, input) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 900_000, input });
const git = (cwd, ...args) => run('git', args, cwd).stdout.trim();

// --- Usage: tokens by model, cost, calls by role
const byModel = {};
const byRole = {};
let cost = 0;
for (const c of state.calls) {
  cost += c.cost ?? 0;
  const role = (byRole[c.role] ??= { calls: 0, cost: 0, ms: 0 });
  role.calls++;
  role.cost += c.cost ?? 0;
  role.ms += c.ms ?? 0;
  for (const [model, u] of Object.entries(c.modelUsage ?? {})) {
    const m = (byModel[model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
    m.input += u.inputTokens ?? 0;
    m.output += u.outputTokens ?? 0;
    m.cacheRead += u.cacheReadInputTokens ?? 0;
    m.cacheWrite += u.cacheCreationInputTokens ?? 0;
    m.cost += u.costUSD ?? 0;
  }
}
const ms = state.runs.reduce(
  (sum, r) => sum + ((r.ended ? Date.parse(r.ended) : Date.parse(state.finished ?? r.started)) - Date.parse(r.started)),
  0,
);

// --- The result: a fresh clone of main
const out = join(RUN, 'eval');
rmSync(out, { recursive: true, force: true });
run('git', ['clone', '-q', state.repo, out], RUN);
const head = git(out, 'rev-parse', 'HEAD');
const shortstat = git(out, 'diff', '--shortstat', `${state.base}..HEAD`);
const files = git(out, 'diff', '--name-status', `${state.base}..HEAD`).split('\n').filter(Boolean);
const check = run('npm', ['run', 'check'], out);
const build = run('npm', ['run', 'build'], out);
let acceptance = null;
if (hidden) {
  copyFileSync(hidden, join(out, 'test', 'hidden-acceptance.test.ts'));
  const report = join(out, 'hidden-report.json');
  const t = run('npx', ['vitest', 'run', 'test/hidden-acceptance.test.ts', '--reporter=json', `--outputFile=${report}`], out);
  try {
    const j = JSON.parse(readFileSync(report, 'utf8'));
    acceptance = {
      passed: j.numPassedTests,
      total: j.numTotalTests,
      failed: j.testResults
        .flatMap((f) => f.assertionResults)
        .filter((a) => a.status !== 'passed')
        .map((a) => a.fullName ?? a.title),
    };
  } catch {
    acceptance = { error: (t.stdout + t.stderr).slice(-2000) };
  }
  rmSync(join(out, 'test', 'hidden-acceptance.test.ts'));
}
const graphFile = join(RUN, 'eval-graph.json');
run(process.execPath, [SYMBIOTE, 'diff', state.base, 'HEAD', '--out', graphFile], out, {
  SYMBIOTE_CACHE_DIR: join(RUN, 'symbiote-cache'),
});
const graph = existsSync(graphFile) ? JSON.parse(readFileSync(graphFile, 'utf8')) : null;
const symbioteFindings = (graph?.findings ?? []).map((f) => `${f.severity} ${f.rule} ${f.symbol}: ${f.message}`);

// --- A blind review: fresh Opus, the goal and the diff only, read-only, one fixed rubric
let blind = null;
if (review) {
  const diff = git(out, 'diff', `${state.base}..HEAD`);
  const schema = {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
            path: { type: 'string' },
            line: { type: 'integer' },
            text: { type: 'string' },
          },
          required: ['severity', 'path', 'text'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['findings', 'summary'],
  };
  const prompt = [
    `The goal this change was written for:\n\n${state.goal}`,
    `The change (git diff ${state.base.slice(0, 7)}..HEAD):\n\`\`\`diff\n${diff.slice(0, 80_000)}\n\`\`\``,
    'List every real defect left: the goal not met or met wrongly, bugs, edge cases the goal covers',
    'that break, tests that do not test what they claim. blocker: the goal is not met or a crash;',
    'major: a real bug in a case the goal covers; minor: worth fixing. Each with path and line.',
    'Read the repository as you need (read only). No style opinions.',
  ].join('\n\n');
  const r = run(
    'claude',
    [
      '-p', '--output-format', 'json', '--setting-sources', 'project,local', '--model', 'opus',
      '--effort', 'high', '--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob',
      '--allowedTools', 'Read', 'Grep', 'Glob', '--json-schema', JSON.stringify(schema),
      '--max-budget-usd', '3', '--no-session-persistence',
    ],
    out,
    {},
    prompt,
  );
  try {
    const j = JSON.parse(r.stdout);
    blind = {
      findings: j.structured_output?.findings ?? [],
      summary: j.structured_output?.summary,
      cost: j.total_cost_usd,
    };
  } catch {
    blind = { error: (r.stdout + r.stderr).slice(-2000) };
  }
}

const result = {
  run: RUN,
  mode: state.mode,
  profile: state.profile,
  status: state.status,
  head,
  cost: Number(cost.toFixed(3)),
  byModel,
  byRole,
  calls: state.calls.length,
  wallMinutes: Number((ms / 60000).toFixed(1)),
  nodes: state.nodes.map((n) => ({
    id: n.id,
    phase: n.phase,
    rounds: n.round,
    from: n.from,
    replans: n.replans,
    reviews: n.reviews.map((r) => ({ round: r.round, verdict: r.verdict, blocking: r.findings.filter((f) => f.severity !== 'minor').length, minor: r.findings.filter((f) => f.severity === 'minor').length })),
    checks: n.checks.map((c) => c.ok),
    note: n.note,
  })),
  gates: state.gates,
  windows: state.runs.map((r) => ({ before: r.windows, after: r.windowsAfter })),
  change: { shortstat, files },
  check: check.status === 0,
  build: build.status === 0,
  acceptance,
  symbioteFindings,
  blind,
};
writeFileSync(join(RUN, 'eval.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, byModel: undefined, nodes: undefined, blind: blind && { n: blind.findings?.length, cost: blind.cost } }, null, 1));
