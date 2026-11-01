// AR2: the prompts of every workspace's thread, labelled by the built reader (`readThread`), from a
// repository's `symbiote/` (read only). Usage: node labels.mjs <repo root> [cutoff ISO time]
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readThread } from '../../packages/cli/dist/thread.js';

const [repo, cutoff = '9999'] = process.argv.slice(2);
const symbiote = join(repo, 'symbiote');
const dir = join(symbiote, 'threads');
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const counts = {};
const examples = {};
for (const file of walk(dir)) {
  const branch = relative(dir, file).replace(/\.jsonl$/, '');
  if (branch === 'spike/activity-review') continue;
  for (const e of await readThread(symbiote, branch, Number.POSITIVE_INFINITY)) {
    if (e.kind !== 'prompt' || e.at > cutoff) continue;
    const key = e.from + (e.key ? ` (${e.key})` : '');
    counts[key] = (counts[key] ?? 0) + 1;
    (examples[key] ??= []).push(`${branch}: ${e.text.replace(/\s+/g, ' ').slice(0, 60)}`);
  }
}
for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(String(n).padStart(4), k, k.startsWith('person') || k.startsWith('task') ? '' : `\n       e.g. ${examples[k].slice(0, 2).join(' | ')}`);
}
