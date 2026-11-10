// The walks' tables for the README: per task and change, the operations, the app's waits and
// the keystroke-level estimate of a person's time. Usage: node summarize.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { here } from './lib.mjs';

const CHANGES = ['flakes', 'issues', 'cli', 'bitwarden', 'qwik'];
const walks = CHANGES.map((c) => JSON.parse(readFileSync(join(here, `../data/walk-${c}.json`), 'utf8')));
const ops = (o) =>
  [
    o.click && `${o.click} click${o.click > 1 ? 's' : ''}`,
    o.key && `${o.key} key${o.key > 1 ? 's' : ''}`,
    o.type && `${o.type} typed`,
    o.wheel && `${o.wheel} wheel`,
    o.pan && `${o.pan} pan`,
  ]
    .filter(Boolean)
    .join(', ') || '—';
const tasks = walks[0].tasks.map((t) => t.name);
console.log(`| Task | ${CHANGES.join(' | ')} |`);
console.log(`|---|${CHANGES.map(() => '---').join('|')}|`);
for (const name of tasks) {
  const cells = walks.map((w) => {
    const t = w.tasks.find((x) => x.name === name);
    if (!t) return 'n/a';
    const wait = t.waits.reduce((s, x) => s + x.ms, 0);
    return `${ops(t.ops)}; wait ${wait < 1000 ? `${wait} ms` : `${(wait / 1000).toFixed(1)} s`}; ≈${t.klmSeconds} s`;
  });
  console.log(`| ${name} | ${cells.join(' | ')} |`);
}
console.log();
for (const w of walks) {
  const lost = w.tasks.flatMap((t) => t.notes.filter((n) => n.lost).map((n) => `${t.name}: ${n.lost}`));
  console.log(`${w.change}: ${lost.join(' / ') || 'nothing'}`);
}
