// Runs a Symbiote build over a regression set and writes what it found, for compare.mjs.
// Usage: node scripts/regression/run.mjs --set <name> --out <file.json>
//          [--symbiote <checkout>]      Symbiote to run (default: this checkout); it must be built
//          [--plugins a,b]         instead of the set's plugins; --no-plugins for none
// Repos come from setup.mjs ($SYMBIOTE_REGRESSION_DIR, else ~/.cache/symbiote-regression).
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'sets.json'), 'utf8'));
const regressionDir =
  process.env.SYMBIOTE_REGRESSION_DIR ?? join(homedir(), '.cache', 'symbiote-regression');

const { values } = parseArgs({
  options: {
    set: { type: 'string' },
    out: { type: 'string' },
    symbiote: { type: 'string', default: join(here, '../..') },
    plugins: { type: 'string' },
    'no-plugins': { type: 'boolean', default: false },
  },
});
const set = config.sets[values.set ?? ''];
if (!set || !values.out) {
  throw new Error(
    `usage: run.mjs --set <${Object.keys(config.sets).join('|')}> --out <file.json> [--symbiote <checkout>] [--plugins a,b | --no-plugins]`,
  );
}
const symbiote = resolve(values.symbiote);
const load = (path) => import(pathToFileURL(join(symbiote, path)).href);
const { analyzeGit, createTypescriptAdapter } = await load('packages/core/dist/index.js');
const pluginNames = values['no-plugins']
  ? []
  : values.plugins !== undefined
    ? values.plugins.split(',').filter(Boolean)
    : (set.plugins ?? []);
const plugins = await Promise.all(
  pluginNames.map(async (name) => (await load(`packages/plugin-${name}/dist/index.js`)).default),
);
const adapter = createTypescriptAdapter({ plugins });

const runs = [];
for (const [repo, ...revs] of set.comparisons) {
  const [base, head] = revs.length === 1 ? [`${revs[0]}~1`, revs[0]] : revs;
  const started = performance.now();
  const run = { repo, base, head, plugins: pluginNames };
  try {
    const analysis = await analyzeGit({
      cwd: join(regressionDir, repo),
      base,
      head,
      mergeBase: false,
      adapter,
    });
    Object.assign(run, {
      changes: Object.fromEntries(
        ['added', 'removed', 'modified'].map((status) => [
          status,
          analysis.changes.filter((c) => c.status === status).length,
        ]),
      ),
      edges: analysis.edges.map((e) => ({
        key: `${e.from} -${e.kind}-> ${e.to} [${e.side}]`,
        possible: Boolean(e.possible),
        site: e.sites.head?.[0] ?? e.sites.base?.[0] ?? null,
      })),
      findings: analysis.findings.map((f) => `${f.severity} ${f.rule} ${f.symbol} — ${f.message}`),
      warnings: analysis.warnings,
      ...(analysis.projects ? { projects: analysis.projects } : {}),
    });
  } catch (error) {
    run.error = String(error?.stack ?? error).slice(0, 600);
  }
  run.ms = Math.round(performance.now() - started);
  runs.push(run);
  const what = run.error
    ? `ERROR ${run.error.split('\n')[0]}`
    : `${run.edges.length} edges, ${run.findings.length} findings`;
  console.error(`${repo} ${base}..${head}: ${what} (${run.ms} ms)`);
}
writeFileSync(
  values.out,
  JSON.stringify({ set: values.set, symbiote, plugins: pluginNames, runs }),
);
console.error(`wrote ${values.out}`);
