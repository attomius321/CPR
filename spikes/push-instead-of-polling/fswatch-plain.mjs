// The same renames as fswatch-rename.mjs, watched by a plain (non-recursive) fs.watch on the
// folder itself, 10 times each; and a missing folder. Usage: node fswatch-plain.mjs <scratch-folder>
import { watch, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [dir] = process.argv.slice(2);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'feature'), { recursive: true });
const seen = [];
watch(join(dir, 'feature'), (k, n) => seen.push(String(n)));
const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
for (let i = 1; i <= 10; i++) {
  const n = seen.length;
  writeFileSync(join(dir, 'feature', 'ref.lock'), `${i}`);
  renameSync(join(dir, 'feature', 'ref.lock'), join(dir, 'feature', 'ref'));
  await settle();
  if (seen.slice(n).includes('ref')) ok++;
}
console.log(`plain watch, renames seen: ${ok}/10`);
try {
  watch(join(dir, 'missing'), () => {});
  console.log('plain watch on a missing folder: no error');
} catch (e) {
  console.log(`plain watch on a missing folder: threw ${e.code}`);
}
rmSync(dir, { recursive: true, force: true });
process.exit(0);
