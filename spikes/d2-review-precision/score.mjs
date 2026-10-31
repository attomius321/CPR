// D2: adds the agent's scores to data/scores.json. Reads a JSON object on stdin:
//   { "<key>": ["worth" | "noise" | "wrong", "why, with the lines that show it"], … }
// A key is a finding's (`zod#6380/f1`) or an AI reviewer comment's (`ai:zod#6380/<comment id>`).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), 'data', 'scores.json');
const scores = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const batch = JSON.parse(readFileSync(0, 'utf8'));
for (const [key, [score, why]] of Object.entries(batch)) {
  if (!['worth', 'noise', 'wrong'].includes(score)) throw new Error(`${key}: score ${score}`);
  scores[key] = { score, why };
}
const sorted = Object.fromEntries(Object.entries(scores).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${Object.keys(batch).length} scored, ${Object.keys(sorted).length} in all`);
