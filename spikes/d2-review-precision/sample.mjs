// D2: draws the person's blind sample and writes it as a Markdown file and as the data of the
// scoring page. The agent's scores are not in either.
// Usage: node spikes/d2-review-precision/sample.mjs --repos <dir> --graphs <dir> [--page <file.html>]
// Strata (fixed before drawing, 35 items): Symbiote findings by kind and severity —
// signature-changed warning 6, info 6; orphan-added warning 4, info 1; exported-api-changed 5 —
// and AI reviewers' comments — claude[bot] 5, pullfrog[bot] 5, github-code-quality[bot] 2, the
// others (Graphite, Copilot) 1. Seeded; the order is shuffled so sources are mixed.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: { repos: { type: 'string' }, graphs: { type: 'string' }, page: { type: 'string' } },
});
const SEED = 20261101;
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const next = random(SEED);
const draw = (list, n) => {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length > 0) out.push(...pool.splice(Math.floor(next() * pool.length), 1));
  return out;
};
const lines = (cmd, args) =>
  execFileSync('node', [join(here, cmd), ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

const findings = ['zod', 'vite', 'bitwarden'].flatMap((p) =>
  JSON.parse(readFileSync(join(here, 'data', `runs-${p}.json`), 'utf8')).flatMap((r) => r.findings ?? []),
);
const strata = [
  [(f) => f.rule === 'signature-changed' && f.severity !== 'info', 6],
  [(f) => f.rule === 'signature-changed' && f.severity === 'info', 6],
  [(f) => f.rule === 'orphan-added' && f.severity !== 'info', 4],
  [(f) => f.rule === 'orphan-added' && f.severity === 'info', 1],
  [(f) => f.rule === 'exported-api-changed', 5],
];
const findingKeys = strata.flatMap(([test, n]) => draw(findings.filter(test).map((f) => f.key).sort(), n));
const comments = lines('ai-context.mjs', ['--repos', values.repos, '--json']);
const aiStrata = [
  [(c) => c.reviewer === 'claude[bot]', 5],
  [(c) => c.reviewer === 'pullfrog[bot]', 5],
  [(c) => c.reviewer === 'github-code-quality[bot]', 2],
  [(c) => ['graphite-app[bot]', 'Copilot'].includes(c.reviewer), 1],
];
const aiPicked = aiStrata.flatMap(([test, n]) => draw(comments.filter(test).sort((a, b) => a.key.localeCompare(b.key)), n));
const contexts = lines('context.mjs', ['--repos', values.repos, '--graphs', values.graphs, '--json', ...findingKeys]);
const titles = new Map(
  ['zod', 'vite', 'bitwarden'].flatMap((p) =>
    JSON.parse(readFileSync(join(here, 'data', `runs-${p}.json`), 'utf8')).map((r) => [`${p}#${r.number}`, r.subject]),
  ),
);

const trim = (text, max) => {
  const l = (text ?? '').split('\n');
  return l.length > max ? `${l.slice(0, max).join('\n')}\n… (${l.length - max} more lines)` : (text ?? '');
};
const items = draw(
  [
    ...contexts.map((c) => ({
      key: c.key,
      source: 'symbiote',
      label: `Symbiote finding · ${c.severity} · ${c.rule}`,
      project: c.project,
      number: c.number,
      url: c.url,
      title: c.title,
      claim: c.message,
      code: [
        c.diff ? `Change to ${c.symbol}:\n${trim(c.diff, 50)}` : `${c.symbol} at head:\n${trim(c.head, 40)}`,
        ...c.uses.map(
          (u) =>
            `Used by ${u.id} (${u.status}):\n${u.sites.map((s) => `${s.file}:${s.line}\n${s.code ?? ''}`).join('\n')}`,
        ),
      ].join('\n\n'),
      links: [c.links.head && ['the symbol at head', c.links.head], c.links.base && ['the symbol at base', c.links.base]].filter(Boolean),
    })),
    ...aiPicked.map((c) => ({
      key: c.key,
      source: 'ai',
      label: `Review comment · ${c.reviewer}`,
      project: c.project,
      number: c.number,
      url: `https://github.com/${{ zod: 'colinhacks/zod', vite: 'vitejs/vite', bitwarden: 'bitwarden/clients' }[c.project]}/pull/${c.number}`,
      title: titles.get(`${c.project}#${c.number}`),
      claim: trim(c.body.replace(/<\/?(details|summary|p|i|sup|picture|source|img|a)[^>]*>/g, '').replace(/\*Spotted by[\s\S]*$/, ''), 40),
      code: `${c.path}:${c.line} (commented on ${c.commit.slice(0, 10)})\n${trim(c.hunk, 20)}`,
      thread: c.replies.map((r) => `${r.user}: ${trim(r.body, 6)}`),
      links: [['the comment on GitHub', c.url]],
    })),
  ],
  35,
).map((item, i) => ({ id: `s${String(i + 1).padStart(2, '0')}`, ...item }));

writeFileSync(join(here, 'data', 'sample.json'), `${JSON.stringify(items, null, 2)}\n`);
const md = [
  '# D2 — your blind sample',
  '',
  `${items.length} items drawn at random (seed ${SEED}): ${findingKeys.length} of Symbiote's 97 findings and ${aiPicked.length} of the AI reviewers' 119 comments. Tick one box per item; a note is welcome but optional. Please do not open \`data/scores.json\` before you finish.`,
  '',
  '- **Right and worth reading**: true, and it names something the diff does not make obvious; a reviewer would check or ask about it.',
  '- **Right but noise**: true, but nothing to act on.',
  '- **Wrong**: a claim in it is false at the commit it talks about.',
  '',
  ...items.flatMap((it) => [
    `## ${it.id} · ${it.label}`,
    '',
    `[${it.project} #${it.number}](${it.url}) — ${it.title}`,
    '',
    '> ' + it.claim.split('\n').join('\n> '),
    '',
    '```diff',
    it.code,
    '```',
    ...(it.thread?.length ? ['', 'Thread:', ...it.thread.map((t) => `- ${t.split('\n').join(' ')}`)] : []),
    '',
    it.links.map(([text, href]) => `[${text}](${href})`).join(' · '),
    '',
    '- [ ] right and worth reading',
    '- [ ] right but noise',
    '- [ ] wrong',
    '',
    'Note:',
    '',
  ]),
].join('\n');
writeFileSync(join(here, 'sample.md'), md);
if (values.page) {
  const template = readFileSync(join(here, 'sample-page.html'), 'utf8');
  const data = JSON.stringify(items).replace(/</g, '\\u003c');
  writeFileSync(values.page, template.replace('/*ITEMS*/[]', data));
}
console.log(`${items.length} items: ${items.filter((i) => i.source === 'symbiote').length} findings, ${items.filter((i) => i.source === 'ai').length} AI comments`);
