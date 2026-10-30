// D2: the answer's numbers, from the data the other scripts wrote. Prints Markdown tables and
// writes results.md (every pull request, finding, AI comment and score) and results.json.
// Usage: node spikes/d2-review-precision/summarize.mjs [--answers <answers.json>]
//   --answers: the person's sample scores, { "<sample id>": "worth" | "noise" | "wrong" }, for the
//   agreement table; where they scored an item, their score is the one counted.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));
const { values } = parseArgs({ options: { answers: { type: 'string' } } });
const PROJECTS = ['zod', 'vite', 'bitwarden'];
const AI = /^(pullfrog\[bot\]|claude\[bot\]|copilot-pull-request-reviewer\[bot\]|Copilot|graphite-app\[bot\]|github-code-quality\[bot\])$/;
const scores = read('scores.json');
const causes = read('causes.json');
const sample = existsSync(join(here, 'data', 'sample.json')) ? read('sample.json') : [];
const person = values.answers ? JSON.parse(readFileSync(values.answers, 'utf8')) : {};
const personByKey = Object.fromEntries(sample.filter((s) => person[s.id]).map((s) => [s.key, person[s.id]]));
/** The score counted: the person's where they gave one, else the agent's. */
const counted = (key) => personByKey[key] ?? scores[key]?.score;

const prs = [];
for (const project of PROJECTS) {
  for (const run of read(`runs-${project}.json`)) {
    const forge = read(`forge/${project}-${run.number}.json`);
    prs.push({
      project,
      number: run.number,
      url: run.url,
      title: run.subject,
      ms: run.ms,
      error: run.error ?? null,
      findings: (run.findings ?? []).map((f) => ({
        key: f.key,
        rule: f.rule,
        severity: f.severity,
        message: f.message,
        score: counted(f.key),
        agent: scores[f.key]?.score,
        why: scores[f.key]?.why,
        cause: causes[f.key] ?? null,
      })),
      ai: forge.inline
        .filter((c) => AI.test(c.user.login) && !c.replyTo)
        .map((c) => {
          const key = `ai:${project}#${run.number}/${c.id}`;
          return { key, reviewer: c.user.login, url: c.url, score: counted(key), agent: scores[key]?.score, why: scores[key]?.why, cause: causes[key] ?? null };
        }),
    });
  }
}

// Wilson 95 % interval, in percent.
function wilson(k, n) {
  if (n === 0) return '–';
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return `${Math.round((100 * (c - r)) / d)}–${Math.round((100 * (c + r)) / d)}`;
}
const pct = (k, n) => (n === 0 ? '–' : `${Math.round((100 * k) / n)} %`);
function row(label, items) {
  const n = items.length;
  const k = (s) => items.filter((i) => i.score === s).length;
  const show = (s) => (n >= 10 ? `${k(s)} (${pct(k(s), n)}, ${wilson(k(s), n)})` : `${k(s)}`);
  return `| ${label} | ${n} | ${show('worth')} | ${show('noise')} | ${show('wrong')} |`;
}
const header = '| | Items | Right and worth reading | Right but noise | Wrong |\n|---|---|---|---|---|';
const findings = prs.flatMap((p) => p.findings.map((f) => ({ ...f, project: p.project })));
const posted = findings.filter((f) => f.severity !== 'info');
const comments = prs.flatMap((p) => p.ai.map((c) => ({ ...c, project: p.project })));
const out = [];

out.push('### Symbiote findings by kind (shares with 95 % Wilson intervals; counts only under 10)', '', header);
for (const rule of ['removed-still-referenced', 'orphan-added', 'signature-changed', 'exported-api-changed']) {
  out.push(row(`\`${rule}\` (all)`, findings.filter((f) => f.rule === rule)));
  out.push(row(`\`${rule}\` (warning, posted)`, posted.filter((f) => f.rule === rule)));
}
out.push(row('**All findings** (what the viewer lists)', findings));
out.push(row('**Warnings** (what the Action posts by default)', posted));
out.push('', '### By project', '', header);
for (const project of PROJECTS) {
  out.push(row(`${project}: all`, findings.filter((f) => f.project === project)));
  out.push(row(`${project}: warnings`, posted.filter((f) => f.project === project)));
}

const analyzed = prs.filter((p) => !p.error);
const per = (list) => {
  const counts = analyzed.map((p) => list(p).length);
  const total = counts.reduce((a, b) => a + b, 0);
  return { mean: (total / analyzed.length).toFixed(1), max: Math.max(...counts), none: counts.filter((c) => c === 0).length, total };
};
const all = per((p) => p.findings);
const warn = per((p) => p.findings.filter((f) => f.severity !== 'info'));
const worthAll = findings.filter((f) => f.score === 'worth').length;
const worthWarn = posted.filter((f) => f.score === 'worth').length;
const prsWithWorth = analyzed.filter((p) => p.findings.some((f) => f.score === 'worth')).length;
out.push(
  '',
  '### Per pull request',
  '',
  '| | Mean | Most | Pull requests with none | Read per one worth reading |',
  '|---|---|---|---|---|',
  `| All findings | ${all.mean} | ${all.max} | ${all.none} of ${analyzed.length} (${pct(all.none, analyzed.length)}) | ${worthAll ? (all.total / worthAll).toFixed(1) : '∞'} |`,
  `| Warnings | ${warn.mean} | ${warn.max} | ${warn.none} of ${analyzed.length} (${pct(warn.none, analyzed.length)}) | ${worthWarn ? (warn.total / worthWarn).toFixed(1) : '∞'} |`,
  '',
  `Pull requests with at least one finding worth reading: ${prsWithWorth} of ${analyzed.length}. Analysis time per pull request: ${PROJECTS.map((p) => {
    const ms = analyzed.filter((r) => r.project === p).map((r) => r.ms).sort((a, b) => a - b);
    return `${p} ${(ms[0] / 1000).toFixed(1)}–${(ms.at(-1) / 1000).toFixed(1)} s (median ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)} s)`;
  }).join(', ')}.`,
);

out.push('', '### Why findings were wrong or noise', '', '| Cause | Wrong | Noise |', '|---|---|---|');
const causeCount = {};
for (const f of findings.filter((x) => x.score !== 'worth')) {
  const c = (causeCount[f.cause ?? '(not tagged)'] ??= { wrong: 0, noise: 0 });
  c[f.score] += 1;
}
for (const [cause, c] of Object.entries(causeCount).sort((a, b) => b[1].wrong + b[1].noise - (a[1].wrong + a[1].noise))) {
  out.push(`| ${cause} | ${c.wrong} | ${c.noise} |`);
}

out.push('', '### AI reviewers (top-level inline comments)', '', header);
for (const reviewer of [...new Set(comments.map((c) => c.reviewer))].sort()) {
  out.push(row(`${reviewer} (${[...new Set(comments.filter((c) => c.reviewer === reviewer).map((c) => c.project))].join(', ')})`, comments.filter((c) => c.reviewer === reviewer)));
}
out.push(row('**All AI comments**', comments));
out.push('', '### Side by side, on the same pull requests', '', '| Project | Pull requests | Symbiote findings: worth / noise / wrong | Symbiote warnings: worth / noise / wrong | AI comments: worth / noise / wrong | Pull requests with an AI comment |', '|---|---|---|---|---|---|');
const triple = (items) => `${items.length}: ${['worth', 'noise', 'wrong'].map((s) => items.filter((i) => i.score === s).length).join(' / ')}`;
for (const project of PROJECTS) {
  const ps = analyzed.filter((p) => p.project === project);
  out.push(`| ${project} | ${ps.length} | ${triple(ps.flatMap((p) => p.findings))} | ${triple(ps.flatMap((p) => p.findings.filter((f) => f.severity !== 'info')))} | ${triple(ps.flatMap((p) => p.ai))} | ${ps.filter((p) => p.ai.length).length} |`);
}

if (Object.keys(person).length > 0) {
  const pairs = sample.filter((s) => person[s.id]).map((s) => ({ ...s, agent: scores[s.key].score, person: person[s.id] }));
  const agree = pairs.filter((p) => p.agent === p.person).length;
  const labels = ['worth', 'noise', 'wrong'];
  const po = agree / pairs.length;
  const pe = labels.reduce((a, l) => a + (pairs.filter((p) => p.agent === l).length / pairs.length) * (pairs.filter((p) => p.person === l).length / pairs.length), 0);
  const kappa = (po - pe) / (1 - pe);
  const wrongAgree = pairs.filter((p) => (p.agent === 'wrong') === (p.person === 'wrong')).length;
  out.push('', '### Agreement with the person\'s blind sample', '', `Scored by the person: ${pairs.length} of ${sample.length}. Same score: ${agree} (${pct(agree, pairs.length)}); Cohen's κ ${kappa.toFixed(2)}. Wrong against the rest: ${wrongAgree} of ${pairs.length} (${pct(wrongAgree, pairs.length)}).`, '', '| Agent \\ Person | worth | noise | wrong |', '|---|---|---|---|');
  for (const a of labels) out.push(`| ${a} | ${labels.map((p) => pairs.filter((x) => x.agent === a && x.person === p).length).join(' | ')} |`);
  out.push('', 'Disagreements:', '', ...pairs.filter((p) => p.agent !== p.person).map((p) => `- ${p.id} \`${p.key}\`: agent ${p.agent}, person ${p.person}`));
}

const tables = out.join('\n');
console.log(tables);
const list = prs.flatMap((p) => [
  '',
  `### ${p.project} [#${p.number}](${p.url}) — ${p.title.replace(/\s*\(#\d+\)\s*$/, '')}`,
  '',
  p.error ? `Error: ${p.error.split('\n')[0]}` : `${p.findings.length} finding(s), ${p.ai.length} AI comment(s); analyzed in ${(p.ms / 1000).toFixed(1)} s.`,
  ...p.findings.map((f) => `- \`${f.key}\` **${f.score}** · ${f.severity} \`${f.rule}\` — ${f.message.replace(/\|/g, '\\|')}\n  - ${f.why}`),
  ...p.ai.map((c) => `- [\`${c.key}\`](${c.url}) **${c.score}** · ${c.reviewer}\n  - ${c.why}`),
]);
writeFileSync(
  join(here, 'results.md'),
  [
    '# D2 — results',
    '',
    'Generated by `summarize.mjs` from `data/` (selection, runs, GitHub data, scores, causes, follow-ups). Scores: **worth** = right and worth reading, **noise** = right but noise, **wrong**. Where the person scored an item in the blind sample, their score is the one counted.',
    '',
    tables,
    '',
    '## Every pull request',
    ...list,
    '',
  ].join('\n'),
);
writeFileSync(join(here, 'results.json'), `${JSON.stringify(prs, null, 2)}\n`);
