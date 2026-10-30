// Whether `fs.watch` sees what the push candidate (2) needs, on one folder's disk: how soon an
// append is seen, a folder made after the watch started (a new branch's `threads/fix/`), a whole
// write by rename (records, `merges.json`), git's refs (a commit, `pack-refs`), and, with
// `--windows`, writes made from Windows (cmd.exe) to a /mnt/c folder.
//   node fswatch.mjs <scratch-folder> [--windows]
import { watch, mkdirSync, appendFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const [dir] = process.argv.slice(2);
const windows = process.argv.includes('--windows');
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'symbiote', 'threads'), { recursive: true });
const seen = [];
const watcher = watch(join(dir, 'symbiote'), { recursive: true }, (kind, name) =>
  seen.push({ t: performance.now(), kind, name: String(name) }),
);
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const sawName = (from, part) => seen.some((e) => e.t >= from && e.name.includes(part));
await settle();

// 1. Appends: from the write's return to the event.
const delays = [];
for (let i = 0; i < 100; i++) {
  const t = performance.now();
  appendFileSync(join(dir, 'symbiote', 'threads', 'a.jsonl'), `{"i":${i}}\n`);
  for (let k = 0; k < 400 && !seen.some((e) => e.t >= t); k++) await settle(1);
  const e = seen.find((x) => x.t >= t);
  delays.push(e ? e.t - t : Infinity);
  await settle(5);
}
delays.sort((a, b) => a - b);
console.log(
  `appends: median ${delays[50].toFixed(2)} ms, p99 ${delays[98].toFixed(2)} ms, missed ${delays.filter((d) => d === Infinity).length}/100`,
);

// 2. A folder made after the watch started, then a file in it.
let t = performance.now();
mkdirSync(join(dir, 'symbiote', 'threads', 'fix', 'deep'), { recursive: true });
await settle(50);
appendFileSync(join(dir, 'symbiote', 'threads', 'fix', 'deep', 'b.jsonl'), '{}\n');
await settle();
console.log(`a file in a new folder: ${sawName(t, 'b.jsonl') ? 'seen' : 'NOT seen'}`);
// Made and written at once (as `mkdir -p` then append in one hook run).
t = performance.now();
mkdirSync(join(dir, 'symbiote', 'threads', 'chore', 'x'), { recursive: true });
appendFileSync(join(dir, 'symbiote', 'threads', 'chore', 'x', 'c.jsonl'), '{}\n');
await settle();
console.log(`a file written at once into a new folder: ${sawName(t, 'c.jsonl') ? 'seen' : 'NOT seen'}`);
t = performance.now();
appendFileSync(join(dir, 'symbiote', 'threads', 'chore', 'x', 'c.jsonl'), '{}\n');
await settle();
console.log(`  its next append: ${sawName(t, 'c.jsonl') ? 'seen' : 'NOT seen'}`);

// 3. A whole write by rename.
t = performance.now();
writeFileSync(join(dir, 'symbiote', 'rec.json.tmp'), '{}');
renameSync(join(dir, 'symbiote', 'rec.json.tmp'), join(dir, 'symbiote', 'rec.json'));
await settle();
console.log(`a write by rename: ${sawName(t, 'rec.json') ? 'seen' : 'NOT seen'}`);

// 4. Git's refs: a commit in a worktree, pack-refs, a commit after.
const repo = join(dir, 'repo');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
mkdirSync(repo);
git(repo, 'init', '-q', '-b', 'main');
git(repo, '-c', 'user.email=s@s', '-c', 'user.name=s', 'commit', '-q', '--allow-empty', '-m', 'one');
git(repo, 'worktree', 'add', '-q', '-b', 'feature/x', join(dir, 'wt'));
const refs = [];
const heads = watch(join(repo, '.git', 'refs', 'heads'), { recursive: true }, (k, n) =>
  refs.push({ t: performance.now(), name: String(n) }),
);
const top = watch(join(repo, '.git'), (k, n) => refs.push({ t: performance.now(), name: `.git/${n}` }));
await settle();
const commit = () => git(join(dir, 'wt'), '-c', 'user.email=s@s', '-c', 'user.name=s', 'commit', '-q', '--allow-empty', '-m', 'c');
t = performance.now();
commit();
await settle();
console.log(`a commit in a worktree: ${refs.some((e) => e.t >= t && e.name.includes('x')) ? 'seen in refs/heads' : 'NOT seen'}`);
t = performance.now();
git(repo, 'pack-refs', '--all');
await settle();
console.log(`pack-refs: ${refs.some((e) => e.t >= t && e.name === '.git/packed-refs') ? 'packed-refs seen' : 'NOT seen'}`);
t = performance.now();
commit();
await settle();
console.log(`a commit after pack-refs: ${refs.some((e) => e.t >= t && e.name.includes('x')) ? 'seen in refs/heads' : 'NOT seen'}`);
heads.close();
top.close();

// 5. From Windows: cmd.exe appends to a file in the watched folder (a /mnt/c folder only).
if (windows) {
  const win = execFileSync('wslpath', ['-w', join(dir, 'symbiote', 'threads', 'a.jsonl')], { encoding: 'utf8' }).trim();
  t = performance.now();
  execFileSync('cmd.exe', ['/c', `echo {"from":"windows"}>>${win}`], { stdio: 'ignore', cwd: '/mnt/c' });
  await settle(1000);
  console.log(`a write from Windows (cmd.exe): ${sawName(t, 'a.jsonl') ? 'seen' : 'NOT seen'}`);
  const winDir = execFileSync('wslpath', ['-w', join(dir, 'symbiote', 'threads')], { encoding: 'utf8' }).trim();
  t = performance.now();
  execFileSync('cmd.exe', ['/c', `mkdir ${winDir}\\fromwin && echo x>${winDir}\\fromwin\\d.jsonl`], { stdio: 'ignore', cwd: '/mnt/c' });
  await settle(1000);
  console.log(`a folder and file made from Windows: ${sawName(t, 'fromwin') ? 'seen' : 'NOT seen'}`);
}
console.log(`events seen in all: ${seen.length}`);
watcher.close();
rmSync(dir, { recursive: true, force: true });
