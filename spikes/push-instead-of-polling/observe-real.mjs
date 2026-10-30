// Read-only: how long after a real agent's hook writes its thread does Claude Code's own list
// (`claude agents --json --all`, decision 99) say the new state? Watches a `symbiote/` folder's
// threads (never writes there) and asks Claude Code every `--every` ms. One JSON line per event.
//   node observe-real.mjs <symbiote-folder> <minutes> [--every=250] > out.jsonl
import { execFile } from 'node:child_process';
import { watch, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, relative } from 'node:path';

const [folder, minutes = '30'] = process.argv.slice(2);
const every = Number(process.argv.find((a) => a.startsWith('--every='))?.slice(8) ?? 250);
const out = (o) => process.stdout.write(`${JSON.stringify({ t: Date.now(), ...o })}\n`);

// Thread lines: read what each file gained since its last size.
const sizes = new Map();
let scanned = false;
function grown(path) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return [];
  }
  const from = sizes.get(path) ?? (scanned ? 0 : size);
  sizes.set(path, size);
  if (size <= from) return [];
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(size - from);
  readSync(fd, buf, 0, buf.length, from);
  closeSync(fd);
  return buf
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
// Every file's size at the start: its first append is then read, not taken as the start.
import { readdirSync } from 'node:fs';
for (const sub of ['threads', 'activity']) {
  for (const name of readdirSync(join(folder, sub), { recursive: true })) {
    if (String(name).endsWith('.jsonl')) grown(join(folder, sub, String(name)));
  }
}
scanned = true;
for (const sub of ['threads', 'activity']) {
  const dir = join(folder, sub);
  watch(dir, { recursive: true }, (_event, name) => {
    if (!name?.endsWith('.jsonl')) return;
    const path = join(dir, name);
    for (const e of grown(path)) {
      out({
        src: sub,
        file: relative(folder, path),
        kind: e.kind ?? e.phase ?? e.event,
        tool: e.tool,
        at: e.at,
        session: e.session,
      });
    }
  });
}

// Claude Code's list: a line per session whose state changed.
const last = new Map();
let asking = false;
function ask() {
  if (asking) return;
  asking = true;
  const started = Date.now();
  execFile('claude', ['agents', '--json', '--all'], { timeout: 5000 }, (error, stdout) => {
    asking = false;
    if (error) return out({ src: 'agents', error: error.message });
    let list;
    try {
      list = JSON.parse(stdout);
    } catch {
      return;
    }
    for (const s of list) {
      const key = s.sessionId ?? s.id;
      const state = [s.status ?? s.state ?? '-', s.waitingFor ?? ''].join('/');
      if (last.get(key) !== state) {
        last.set(key, state);
        out({ src: 'agents', session: s.sessionId, name: s.name, state, askedAt: started });
      }
    }
  });
}
setInterval(ask, every);
setTimeout(() => process.exit(0), Number(minutes) * 60_000);
