// The advisor's eval (V75): how often Suggest settings sizes a brief as the person would.
//
//   node scripts/advisor-eval.mjs sheet <records> <labels.json>
//     picks 24 briefs from a repository's workspace records (symbiote/workspaces/): every chore
//     and refactor, then the other kinds in turn, oldest first. Writes them to <labels.json> with
//     an empty label each, for the person to fill in before seeing any suggestion: "size"
//     (small, mid, large or largest), "effort" (a level) and "planFirst" (true or false).
//
//   node scripts/advisor-eval.mjs run <labels.json> <view URL> [agent:model:effort ...]
//     asks the advisor for each brief, once per run (default: claude:haiku:low,
//     claude:haiku:medium, codex:gpt-6-luna:none, codex:gpt-6-luna:low), with the agents and
//     models a running `symbiote view` lists. Prints each run's agreement with the labels on size
//     and plan first, and its time at the 50th and 90th percentile; writes every answer beside the
//     labels (<labels>.results.json).
//
// Build first: pnpm build. The records hold the person's briefs: keep the labels file out of git.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_PROMPTS } from '../packages/cli/dist/prompts.js';
import { advise } from '../packages/cli/dist/workspace-advice.js';

/** Each current model's size, as the advisor prompt's guide says it. */
const SIZES = {
  haiku: 'small',
  'gpt-6-luna': 'small',
  'gpt-6.1-terra': 'small',
  sonnet: 'mid',
  'gpt-6.1-sol': 'mid',
  opus: 'large',
  'gpt-6-astra': 'large',
  fable: 'largest',
};
const DEFAULT_RUNS = [
  'claude:haiku:low',
  'claude:haiku:medium',
  'codex:gpt-6-luna:none',
  'codex:gpt-6-luna:low',
];
const BRIEFS = 24;

const [command, ...args] = process.argv.slice(2);
if (command === 'sheet' && args.length === 2) sheet(args[0], args[1]);
else if (command === 'run' && args.length >= 2) await run(args[0], args[1], args.slice(2));
else {
  console.error(
    'Usage: node scripts/advisor-eval.mjs sheet <records> <labels.json>\n' +
      '       node scripts/advisor-eval.mjs run <labels.json> <view URL> [agent:model:effort ...]',
  );
  process.exit(2);
}

/** Every record under `dir` with a kind, a title and parts: the briefs a start page wrote. */
function records(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const record = JSON.parse(readFileSync(join(entry.parentPath, entry.name), 'utf8'));
    if (record.kind && record.title && record.parts) found.push(record);
  }
  return found.sort((a, b) => String(a.created).localeCompare(String(b.created)));
}

function sheet(dir, out) {
  const all = records(dir);
  const picked = all.filter((r) => r.kind === 'chore' || r.kind === 'refactor');
  const rest = ['fix', 'spike', 'feature'].map((kind) => all.filter((r) => r.kind === kind));
  while (picked.length < BRIEFS && rest.some((list) => list.length > 0)) {
    for (const list of rest) {
      const next = list.shift();
      if (next && picked.length < BRIEFS) picked.push(next);
    }
  }
  const labels = picked.map((r) => ({
    branch: r.branch,
    kind: r.kind,
    title: r.title,
    parts: r.parts,
    label: { size: '', effort: '', planFirst: null },
  }));
  writeFileSync(out, `${JSON.stringify(labels, null, 2)}\n`);
  console.log(`${labels.length} briefs written to ${out}: fill in each "label", then run.`);
}

/**
 * The value at the `p`th percentile of `values` (nearest rank). A declaration, not a const: the
 * commands above run before a const below them would be set.
 */
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

async function run(file, view, given) {
  const briefs = JSON.parse(readFileSync(file, 'utf8'));
  const options = await (await fetch(new URL('/api/workspaces/options', view))).json();
  const cacheDir = process.env.SYMBIOTE_CACHE_DIR ?? join(homedir(), '.cache', 'symbiote');
  const results = [];
  const out = file.replace(/\.json$/, '') + '.results.json';
  console.log('| Run | Size agrees | Plan first agrees | Errors | p50 | p90 |');
  console.log('|---|---|---|---|---|---|');
  for (const spec of given.length > 0 ? given : DEFAULT_RUNS) {
    const [kind, model, effort] = spec.split(':');
    const agent = options.agents.find((a) => a.kind === kind);
    if (!agent?.models) {
      console.log(`| ${spec} | ${kind} is not installed, or lists no models | | | | |`);
      continue;
    }
    let size = 0;
    let plan = 0;
    let labelled = 0;
    let errors = 0;
    const times = [];
    for (const brief of briefs) {
      const started = Date.now();
      let answer;
      try {
        answer = await advise({
          agent: {
            kind,
            command: agent.command,
            name: kind === 'claude' ? 'Claude Code' : 'Codex',
          },
          models: agent.models,
          prompt: DEFAULT_PROMPTS.advisor,
          request: { kind: brief.kind, title: brief.title, parts: brief.parts },
          config: { model, effort },
          cacheDir,
        });
      } catch (error) {
        answer = { error: error.message };
        errors += 1;
      }
      times.push(Date.now() - started);
      results.push({ run: spec, branch: brief.branch, answer, ms: times.at(-1) });
      if (answer.error || !brief.label?.size) continue;
      labelled += 1;
      if ((SIZES[answer.model] ?? 'default') === brief.label.size) size += 1;
      if (answer.planFirst === brief.label.planFirst) plan += 1;
    }
    const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
    console.log(
      `| ${spec} | ${size} of ${labelled} | ${plan} of ${labelled} | ${errors} | ${seconds(percentile(times, 50))} | ${seconds(percentile(times, 90))} |`,
    );
    // After each run: a later failure keeps the answers already paid for.
    writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  }
  console.log(`\nEvery answer: ${out}`);
}
