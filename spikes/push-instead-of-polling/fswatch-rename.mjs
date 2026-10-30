// Node's recursive fs.watch on Linux: writes by rename (git's refs, records written whole), three
// times, in a folder made before the watch and in one made after; and a watch on a folder that
// is not there yet. Usage: node fswatch-rename.mjs <scratch-folder>
import { watch, mkdirSync, writeFileSync, renameSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir] = process.argv.slice(2);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'before'), { recursive: true });
const seen = [];
const w = watch(dir, { recursive: true }, (k, n) => seen.push(String(n)));
let missingError = 'no error';
const ghost = [];
try {
  const m = watch(join(dir, 'later'), { recursive: true }, (k, n) => ghost.push(String(n)));
  m.on('error', (e) => (missingError = `error event: ${e.code}`));
} catch (e) {
  missingError = `threw: ${e.code}`;
}
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
await settle();
mkdirSync(join(dir, 'after'));
await settle();
for (const where of ['before', 'after']) {
  for (let i = 1; i <= 3; i++) {
    const n = seen.length;
    writeFileSync(join(dir, where, 'ref.lock'), `${i}`);
    renameSync(join(dir, where, 'ref.lock'), join(dir, where, 'ref'));
    await settle();
    const got = seen.slice(n).filter((x) => x.includes('ref'));
    console.log(`${where}: rename ${i}: ${got.length ? `seen (${got.join(', ')})` : 'NOT seen'}`);
  }
  for (let i = 1; i <= 2; i++) {
    const n = seen.length;
    appendFileSync(join(dir, where, 'log'), `${i}\n`);
    await settle();
    console.log(`${where}: append ${i}: ${seen.slice(n).some((x) => x.includes('log')) ? 'seen' : 'NOT seen'}`);
  }
}
console.log(`a watch on a missing folder: ${missingError}`);
mkdirSync(join(dir, 'later'));
writeFileSync(join(dir, 'later', 'x'), '1');
await settle();
console.log(`  then the folder made and written: ${ghost.length ? 'seen' : 'NOT seen'}`);
w.close();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
