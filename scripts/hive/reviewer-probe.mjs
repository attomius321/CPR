// HV3: one real running review, as Hive runs it, on any repository: a clone at `<tip>`, the
// install, `claude -p` in Claude Code's sandbox, Symbiote's rerun under bubblewrap. Prints the
// review (verdict, kept and dropped findings, time, cost) as JSON; the copies are removed.
// Usage: node scripts/hive/reviewer-probe.mjs <repo> <base> <tip> <brief file>
//          [--install "<command>"]… [--model opus] [--effort high] [--out <review.json>]
// Build first: pnpm build. Runs a real Claude Code on your subscription.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findClaude } from '../../packages/cli/dist/claude-code.js';
import {
  findConfinement,
  reviewPrompt,
  REVIEWER_EFFORT,
  REVIEWER_MODEL,
  startReview,
} from '../../packages/cli/dist/hive-review.js';
import { DEFAULT_PROMPTS } from '../../packages/cli/dist/prompts.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    install: { type: 'string', multiple: true, default: [] },
    model: { type: 'string', default: REVIEWER_MODEL },
    effort: { type: 'string', default: REVIEWER_EFFORT },
    out: { type: 'string' },
  },
});
const [repoArg, base, tip, briefFile] = positionals;
if (!repoArg || !base || !tip || !briefFile) {
  throw new Error('usage: node scripts/hive/reviewer-probe.mjs <repo> <base> <tip> <brief file>');
}
const repo = resolve(repoArg);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const at = git('rev-parse', tip).trim();
const from = git('rev-parse', base).trim();
const folder = mkdtempSync(join(tmpdir(), 'symbiote-reviewer-probe-'));
const prompt = reviewPrompt({
  brief: readFileSync(briefFile, 'utf8'),
  branch: tip,
  base: from,
  tip: at,
  diff: git('diff', from, at),
  check: null,
  installs: values.install,
});
const started = Date.now();
const run = startReview(
  {
    source: repo,
    tip: at,
    round: 1,
    folder: join(folder, 'copies'),
    log: join(folder, 'reviewer.jsonl'),
    installs: values.install,
    prompt,
    instructions: DEFAULT_PROMPTS['hive.reviewer'],
    model: values.model,
    effort: values.effort,
  },
  {
    claude: await findClaude(process.env),
    confine: await findConfinement(process.env),
    onPid: (pid) =>
      process.stderr.write(`[${Math.round((Date.now() - started) / 1000)} s] pid ${pid}\n`),
  },
);
process.on('SIGINT', () => run.stop());
const outcome = await run.done;
const review = outcome?.review ?? null;
if (values.out) writeFileSync(values.out, `${JSON.stringify(review, null, 2)}\n`);
console.log(
  JSON.stringify(
    review && {
      verdict: review.verdict,
      kept: review.findings.filter((f) => f.kept).map((f) => f.defect),
      dropped: review.findings.filter((f) => !f.kept).map((f) => `${f.defect}: ${f.why}`),
      seconds: Math.round(review.ms / 1000),
      cost: review.cost,
      error: review.error,
      stream: join(folder, 'reviewer.jsonl'),
    },
    null,
    2,
  ),
);
