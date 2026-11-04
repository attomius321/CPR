// V94d: what one page costs `symbiote view` while agents work, polling (main) against push (the
// branch), on a copy of this repository: its records (`symbiote/`, Hive off) and a clone of its
// git. The view runs the build given, a headless Chromium opens one page (the Overview), and agent
// hooks write at the real rate (18 a minute, the spike's: 15 tools, 3 thread entries), run as Claude
// Code runs them: the build's own `agent-hook.js`, which pings on the branch. The view's CPU (its
// own and its children's: git, `claude agents`) comes from /proc; the page's requests are counted.
//
//   node measure.mjs <build root> <replica repo> <minutes> <label> [--poll]
//
// Throwaway: not built, linted or tested with the repository.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [build, replica, minutesText, label, ...flags] = process.argv.slice(2);
const minutes = Number(minutesText);
// Playwright from this checkout's install, whichever build is measured: one browser for both.
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const tick = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));

/** A process's CPU in ms: its own, and its reaped children's. */
function cpu(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const ms = (i) => (Number(f[i]) * 1000) / tick;
  return { own: ms(11) + ms(12), children: ms(13) + ms(14) };
}

/** The open workspaces of the replica's records: their branch and worktree. */
function openWorkspaces() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (path.endsWith('.json')) {
        const r = JSON.parse(readFileSync(path, 'utf8'));
        if (!r.finished) out.push({ branch: r.branch, worktree: r.worktree });
      }
    }
  };
  walk(join(replica, 'symbiote', 'workspaces'));
  return out;
}

const cache = mkdtempSync(join(tmpdir(), `v94-${label}-cache-`));
const env = { ...process.env };
delete env.WAYLAND_DISPLAY;
Object.assign(env, {
  SYMBIOTE_CACHE_DIR: cache,
  SYMBIOTE_USAGE: 'off',
  SYMBIOTE_INTRO: 'off',
  XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), `v94-${label}-config-`)),
});
const view = spawn(process.execPath, [join(build, 'packages/cli/dist/bin.js'), 'view', '--no-open'], {
  cwd: replica,
  env,
});
const url = await new Promise((resolve, reject) => {
  let out = '';
  view.stdout.on('data', (d) => {
    out += d;
    const m = /Symbiote viewer: (\S+)/.exec(out);
    if (m) resolve(m[1]);
  });
  view.on('exit', (code) => reject(new Error(`view exited ${code}: ${out}`)));
});

const browser = await chromium.launch();
const page = await browser.newPage();
let requests = 0;
let bytes = 0;
let counting = false;
/** Requests by address, without its query. */
const byPath = {};
page.on('request', (r) => {
  if (!counting) return;
  requests++;
  const path = new URL(r.url()).pathname;
  byPath[path] = (byPath[path] ?? 0) + 1;
});
page.on('response', async (r) => {
  if (!counting) return;
  const length = Number(r.headers()['content-length'] ?? 0);
  bytes += length;
});
await page.goto(`${url}overview${flags.includes('--poll') ? '?poll' : ''}`);
await page.waitForTimeout(30_000);

// The hooks' writes: 18 a minute, round the open workspaces.
const workspaces = openWorkspaces();
const hook = join(build, 'packages/cli/dist/agent-hook.js');
let n = 0;
const runHook = (input, mode) =>
  new Promise((resolve) => {
    const args = [hook, join(replica, 'symbiote'), ...(mode ? [mode] : []), `--cache=${cache}`];
    const child = spawn(process.execPath, args, { env: { PATH: process.env.PATH } });
    child.on('exit', resolve);
    child.stdin.end(JSON.stringify(input));
  });
const writer = setInterval(() => {
  const w = workspaces[n % workspaces.length];
  n += 1;
  const at = new Date().toISOString();
  if (n % 6 === 0) {
    void runHook({ hook_event_name: 'Notification', cwd: w.worktree, session_id: 'v94', message: `note ${at}` });
  } else {
    void runHook(
      {
        hook_event_name: n % 2 ? 'PreToolUse' : 'PostToolUse',
        cwd: w.worktree,
        session_id: 'v94',
        tool_name: 'Read',
        tool_input: { file_path: join(w.worktree, 'README.md') },
        tool_use_id: `v94-${Math.floor(n / 2)}`,
      },
      'activity',
    );
  }
}, 60_000 / 18);

counting = true;
const start = cpu(view.pid);
const t0 = Date.now();
await page.waitForTimeout(minutes * 60_000);
const end = cpu(view.pid);
const elapsed = (Date.now() - t0) / 60_000;
counting = false;
clearInterval(writer);

const result = {
  label,
  minutes: Number(elapsed.toFixed(2)),
  hooks: n,
  cpuOwnPerMin: Math.round((end.own - start.own) / elapsed),
  cpuChildrenPerMin: Math.round((end.children - start.children) / elapsed),
  cpuPerMin: Math.round((end.own + end.children - start.own - start.children) / elapsed),
  requestsPerMin: Number((requests / elapsed).toFixed(1)),
  byPath,
  kbPerMin: Number((bytes / 1024 / elapsed).toFixed(1)),
};
console.log(JSON.stringify(result));
if (process.env.V94_RESULTS) appendFileSync(process.env.V94_RESULTS, `${JSON.stringify(result)}\n`);
await browser.close();
view.kill('SIGINT');
