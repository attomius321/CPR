#!/usr/bin/env node
// HV1 spike: a reviewer that runs code. On a finished run's result (a fresh clone of its `main`,
// thrown away after), a clean-context Opus may write and run tests, but reports only defects it
// proves with a failing test; then this script runs those tests itself and keeps the ones that fail.
//   node probe-review.mjs <run-dir>
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RUN = resolve(process.argv[2]);
const state = JSON.parse(readFileSync(join(RUN, 'state.json'), 'utf8'));
const run = (cmd, args, cwd, input) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 1_200_000, input });

const out = join(RUN, 'probe');
rmSync(out, { recursive: true, force: true });
run('git', ['clone', '-q', state.repo, out], RUN);
const diff = run('git', ['diff', `${state.base}..HEAD`], out).stdout;

const schema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          text: { type: 'string' },
          test: { type: 'string', description: 'The failing test: its file and name' },
        },
        required: ['severity', 'text', 'test'],
      },
    },
  },
  required: ['summary', 'findings'],
};
const prompt = [
  `The goal this change was written for:\n\n${state.goal}`,
  `The change (git diff ${state.base.slice(0, 7)}..HEAD):\n\`\`\`diff\n${diff.slice(0, 80_000)}\n\`\`\``,
  'This folder is a throwaway copy: change nothing in src/. Find where the change is wrong by',
  'running it: write vitest tests in test/probe-*.test.ts, each a real case the goal covers,',
  'and run them (`npx vitest run test/probe-*.test.ts`). Report only defects that a test of',
  'yours shows failing, each with the test. A defect you only suspect, or a case the goal does',
  'not cover, is not a finding. Keep the failing tests in place; delete the passing ones.',
].join('\n\n');
const started = Date.now();
const r = run(
  'claude',
  [
    '-p', '--output-format', 'json', '--setting-sources', 'project,local', '--model', 'opus',
    '--effort', 'high', '--permission-mode', 'bypassPermissions', '--json-schema',
    JSON.stringify(schema), '--max-budget-usd', '4', '--no-session-persistence',
  ],
  out,
  prompt,
);
let review;
try {
  const j = JSON.parse(r.stdout);
  review = { ...j.structured_output, cost: j.total_cost_usd, ms: Date.now() - started };
} catch {
  review = { error: (r.stdout + r.stderr).slice(-2000) };
}
// The runner's own check of the evidence: run the reviewer's tests; a finding counts when one fails.
const probes = readdirSync(join(out, 'test')).filter((f) => /^probe-.*\.test\.ts$/.test(f));
const report = join(out, 'probe-report.json');
run('npx', ['vitest', 'run', ...probes.map((f) => `test/${f}`), '--reporter=json', `--outputFile=${report}`], out);
let tests = null;
try {
  const j = JSON.parse(readFileSync(report, 'utf8'));
  const all = j.testResults.flatMap((f) => f.assertionResults);
  tests = {
    files: probes,
    failed: all.filter((a) => a.status === 'failed').map((a) => a.fullName ?? a.title),
    passed: all.filter((a) => a.status === 'passed').length,
  };
} catch {
  tests = { files: probes, error: 'no report' };
}
const src = run('git', ['status', '--porcelain', 'src'], out).stdout.trim();
const result = { review, tests, srcTouched: src || undefined };
writeFileSync(join(RUN, 'probe.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ run: RUN.split('/').at(-1), cost: review.cost, findings: review.findings?.length, failing: tests.failed?.length, srcTouched: Boolean(src) }));
