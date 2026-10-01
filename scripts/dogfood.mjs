// Runs CPR on recent commits of a repository and prints one line per commit.
// Usage: node scripts/dogfood.mjs <repo> [count=10] [--json]
// Build first: pnpm build.
import { execFileSync } from 'node:child_process';
import { analyzeGit } from '../packages/core/dist/index.js';

const [repo, countArg = '10', flag] = process.argv.slice(2);
if (!repo) throw new Error('usage: node scripts/dogfood.mjs <repo> [count] [--json]');

const commits = execFileSync(
  'git',
  [
    'log',
    '--no-merges',
    '--format=%H %s',
    `-n${countArg}`,
    '--',
    '*.ts',
    '*.tsx',
    '*.mts',
    '*.cts',
  ],
  { cwd: repo, encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .map((line) => ({ sha: line.slice(0, 40), subject: line.slice(41, 81) }));

const rows = [];
for (const { sha, subject } of commits) {
  const started = performance.now();
  try {
    const analysis = await analyzeGit({ cwd: repo, base: `${sha}~1`, head: sha, mergeBase: false });
    const changed = analysis.changes.filter((c) => c.status !== 'unchanged');
    const rules = {};
    for (const f of analysis.findings)
      rules[`${f.rule}:${f.severity}`] = (rules[`${f.rule}:${f.severity}`] ?? 0) + 1;
    rows.push({
      sha: sha.slice(0, 8),
      subject,
      ms: Math.round(performance.now() - started),
      files: analysis.files.length,
      symbols: changed.length,
      edges: analysis.edges.length,
      context: analysis.context.length,
      findings: rules,
      warnings: analysis.warnings.length,
      details:
        flag === '--json'
          ? analysis.findings.map((f) => `${f.severity} ${f.rule} ${f.symbol} — ${f.message}`)
          : undefined,
    });
  } catch (error) {
    rows.push({
      sha: sha.slice(0, 8),
      subject,
      ms: Math.round(performance.now() - started),
      error: String(error.stack ?? error).slice(0, 400),
    });
  }
  const row = rows[rows.length - 1];
  console.log(
    row.error
      ? `${row.sha} ${String(row.ms).padStart(6)}ms ERROR ${row.error}`
      : `${row.sha} ${String(row.ms).padStart(6)}ms files=${row.files} symbols=${row.symbols} edges=${row.edges} ctx=${row.context} warn=${row.warnings} ${JSON.stringify(row.findings)}  ${row.subject}`,
  );
  if (row.details?.length) for (const d of row.details) console.log(`      ${d}`);
}
