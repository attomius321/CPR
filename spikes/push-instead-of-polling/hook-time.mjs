// A hook's time with and without the ping (spike). Runs a build's `dist/agent-hook.js` as Claude
// Code does — a process per event, the event on stdin — against a scratch `symbiote/` folder (a
// copy of real workspace records) and a stand-in view that counts the pings it gets.
//   node hook-time.mjs <main-cli-dist> <spike-cli-dist> <records-folder> [runs]
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [mainDist, spikeDist, records, runsArg = '60'] = process.argv.slice(2);
const RUNS = Number(runsArg);
const scratch = mkdtempSync(join(process.env.SPIKE_TMP ?? tmpdir(), 'hook-time-'));
const repo = join(scratch, 'repo');
const symbiote = join(repo, 'symbiote');
const cache = join(scratch, 'cache');
const worktree = join(scratch, 'wt');
mkdirSync(join(symbiote, 'workspaces', 'spike'), { recursive: true });
mkdirSync(worktree, { recursive: true });
mkdirSync(join(cache, 'running'), { recursive: true });
if (records) cpSync(records, join(symbiote, 'workspaces'), { recursive: true });
// The workspace the events are for, last in the folder's order as a real one may be.
writeFileSync(
  join(symbiote, 'workspaces', 'spike', 'zz-hook-time.json'),
  JSON.stringify({ branch: 'spike/zz-hook-time', worktree }),
);
const event = JSON.stringify({
  hook_event_name: 'Stop',
  session_id: 's1',
  cwd: worktree,
  last_assistant_message: 'Done: the change is in.',
});

// The stand-in view: HTTP and UDP on one port number, a line per ping in `pings`.
const pings = join(scratch, 'pings');
const listener = `
const http = require('node:http'), dgram = require('node:dgram'), fs = require('node:fs');
const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { fs.appendFileSync(${JSON.stringify(pings)}, 'h\\n'); res.writeHead(204); res.end(); }); });
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const udp = dgram.createSocket('udp4');
  udp.on('message', () => fs.appendFileSync(${JSON.stringify(pings)}, 'u\\n'));
  udp.bind(port, '127.0.0.1', () => process.stdout.write(port + '\\n'));
});`;
const view = spawn(process.execPath, ['-e', listener], { stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((resolve) => view.stdout.once('data', (d) => resolve(Number(d))));
const record = (url) =>
  writeFileSync(
    join(cache, 'running', `${view.pid}.json`),
    JSON.stringify({ url, pid: view.pid, root: repo, name: 'repo', started: new Date().toISOString() }),
  );

function time(dist, ping) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [join(dist, 'agent-hook.js'), symbiote], {
    input: event,
    env: { ...process.env, SYMBIOTE_CACHE_DIR: cache, SPIKE_PING: ping },
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
  return ms;
}
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
  return `median ${q(0.5)} ms, p90 ${q(0.9)}, max ${s.at(-1).toFixed(1)}`;
};
const countPings = () => (existsSync(pings) ? readFileSync(pings, 'utf8').split('\n').filter(Boolean).length : 0);

const variants = [
  ['main (no ping)', mainDist, 'off'],
  ['spike, ping off', spikeDist, 'off'],
  ['spike, http (waits)', spikeDist, 'http'],
  ['spike, http (no wait)', spikeDist, 'nowait'],
  ['spike, udp', spikeDist, 'udp'],
  ['spike, tcp (bare POST)', spikeDist, 'net'],
  ['spike, tcp (no answer)', spikeDist, 'netflush'],
];
async function round(title) {
  console.log(`\n## ${title}`);
  for (const [name, dist, ping] of variants) {
    time(dist, ping); // warm the file cache
    const before = countPings();
    const xs = [];
    for (let i = 0; i < RUNS; i++) xs.push(time(dist, ping));
    console.log(`${name.padEnd(24)} ${stats(xs)}; pings received ${countPings() - before}/${RUNS}`);
  }
}
record(`http://127.0.0.1:${port}/`);
await round('the view runs');
process.kill(view.pid, 'SIGSTOP');
await round('the view hangs (SIGSTOP)');
process.kill(view.pid, 'SIGCONT');
await new Promise((r) => setTimeout(r, 500));
rmSync(join(cache, 'running', `${view.pid}.json`));
await round('no view runs (no record)');
record('http://127.0.0.1:1/');
await round('a stale record (nothing on its port)');
view.kill();
const lines = readFileSync(join(symbiote, 'threads', 'spike', 'zz-hook-time.jsonl'), 'utf8').split('\n').length - 1;
console.log(`\nthread lines written: ${lines}`);
rmSync(scratch, { recursive: true, force: true });
