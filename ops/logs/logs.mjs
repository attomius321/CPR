// Symbiote's log viewer (LG1, decision 357): `pnpm logs:up` starts Loki, Alloy and Grafana on the
// folder Symbiote writes (made first, as Symbiote's: one Docker made would be root's); `logs:down`
// stops them and keeps their copy; `logs:check` runs a second copy on a temporary folder and
// random ports, writes lines there and checks they reach Loki and Grafana as the dashboard reads
// them, then removes it. Needs Docker, and `pnpm build` (the folder comes from @symbiote/log).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const compose = join(here, 'compose.yml');
const grafanaPort = process.env.SYMBIOTE_GRAFANA_PORT || '3300';

class Failed extends Error {}

/** Stops with `words`; a check still removes its stack first (`finally`). */
function fail(words) {
  throw new Failed(words);
}

/** The folder Symbiote writes: `SYMBIOTE_LOG_DIR`, else `<cache>/logs`. */
async function logsFolder() {
  const built = join(here, '..', '..', 'packages', 'log', 'dist', 'index.js');
  try {
    const { logsDir } = await import(built);
    return logsDir(process.env, process.platform, homedir());
  } catch {
    return fail('build Symbiote first: pnpm build');
  }
}

/** `docker compose` on the stack, with `env` for its file; its exit code. */
function docker(args, env, quiet = false) {
  const run = spawnSync('docker', ['compose', '-f', compose, ...args], {
    stdio: quiet ? 'pipe' : 'inherit',
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (run.error) fail(`docker: ${run.error.message}`);
  return run;
}

async function up() {
  const dir = await logsFolder();
  mkdirSync(dir, { recursive: true });
  if (docker(['up', '-d'], { SYMBIOTE_LOG_DIR: dir }).status !== 0) fail('the stack did not start');
  console.log(`Symbiote's logs: http://localhost:${grafanaPort}/ (Grafana), reading ${dir}`);
}

async function down() {
  const dir = await logsFolder();
  if (docker(['down'], { SYMBIOTE_LOG_DIR: dir }).status !== 0) fail('the stack did not stop');
}

/** Polls `test` every half second until it answers true; the seconds it took. */
async function until(what, test, seconds) {
  const started = Date.now();
  for (;;) {
    try {
      if (await test()) return (Date.now() - started) / 1000;
    } catch {
      // Not up yet.
    }
    if (Date.now() - started > seconds * 1000) fail(`${what}: not within ${seconds} s`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function check() {
  const dir = mkdtempSync(join(tmpdir(), 'symbiote-logs-check-'));
  const project = ['-p', 'symbiote-logs-check'];
  // Empty ports: Docker picks free ones, so it runs beside the person's own viewer.
  const env = { SYMBIOTE_LOG_DIR: dir, SYMBIOTE_LOKI_PORT: '', SYMBIOTE_GRAFANA_PORT: '' };
  const token = `check-${process.pid}-${Date.now()}`;
  const now = new Date();
  const old = new Date(now.getTime() - 13 * 86_400_000);
  const day = (date) => date.toLocaleDateString('sv-SE');
  const line = (time, level, process, msg, more = {}) =>
    `${JSON.stringify({ level, time: time.toISOString(), pid: 1, process, msg: `${msg} ${token}`, ...more })}\n`;
  const stack = 'TypeError: x is undefined\n    at run (main.js:10:5)\n    at go (main.js:2:1)';
  writeFileSync(
    join(dir, `${day(now)}.jsonl`),
    line(now, 'info', 'view', 'view started') +
      line(now, 'error', 'view', 'request failed', {
        method: 'GET',
        path: '/api/workspaces',
        status: 500,
        err: { type: 'TypeError', message: 'x is undefined', stack },
      }) +
      line(now, 'fatal', 'analysis', 'uncaught exception', {
        err: { type: 'TypeError', message: 'x is undefined', stack },
      }),
  );
  writeFileSync(join(dir, `${day(old)}.jsonl`), line(old, 'error', 'app', 'server ended'));

  // From nothing: a copy left by a stopped check would keep its read positions, which Alloy keys
  // by the path in the container, the same for every check's folder.
  docker([...project, 'down', '-v'], env, true);
  if (docker([...project, 'up', '-d'], env).status !== 0) fail('the stack did not start');
  try {
    const portOf = (service, inner) =>
      docker([...project, 'port', service, String(inner)], env, true).stdout.trim();
    const loki = `http://${portOf('loki', 3100)}`;
    const grafana = `http://${portOf('grafana', 3000)}`;
    const lines = async (query, from) => {
      const url = new URL('/loki/api/v1/query_range', loki);
      url.searchParams.set('query', query);
      url.searchParams.set('start', `${from.getTime()}000000`);
      url.searchParams.set('limit', '100');
      const answer = await (await fetch(url)).json();
      return answer.data.result.flatMap((stream) =>
        stream.values.map(([ns, text]) => ({ stream: stream.stream, ns, text })),
      );
    };
    const hour = new Date(now.getTime() - 3_600_000);
    const ready = await until('Loki ready', async () => (await fetch(`${loki}/ready`)).ok, 120);
    console.log(`Loki ready after ${ready.toFixed(1)} s`);
    const today = await until(
      "today's lines in Loki",
      async () => (await lines(`{service_name="symbiote"} |= "${token}"`, hour)).length >= 3,
      60,
    );
    console.log(`today's lines in Loki ${today.toFixed(1)} s after it was ready`);

    // The labels Alloy gives, and the line's own time.
    const [fatal] = await lines(
      `{service_name="symbiote", process="analysis", level="fatal"} |= "${token}"`,
      hour,
    );
    if (!fatal) fail('no fatal line with process="analysis" and level="fatal"');
    const back = new Date(Number(BigInt(fatal.ns) / 1_000_000n)).toISOString();
    if (back !== now.toISOString())
      fail(`the line's time is ${back}, written ${now.toISOString()}`);

    // The dashboard's crashes panel: one line a problem, the stack as lines.
    const dashboard = JSON.parse(
      readFileSync(join(here, 'grafana', 'dashboards', 'symbiote.json'), 'utf8'),
    );
    const problems = dashboard.panels.find((panel) => panel.title.startsWith('Errors and crashes'));
    const expr = problems.targets[0].expr.replace('$process', '.+').replace('$search', token);
    const shown = await lines(expr, hour);
    if (shown.length !== 2) fail(`the crashes panel shows ${shown.length} lines, not 2`);
    for (const { text } of shown) {
      if (!text.includes('\n    at run (main.js:10:5)')) fail(`no stack in "${text}"`);
    }
    console.log(`the crashes panel: ${JSON.stringify(shown[0].text.split('\n')[0])}, its stack`);

    // A line 13 days old, read late (Loki finds it once flushed: chunk_idle_period).
    const late = await until(
      'the 13-day-old line',
      async () => (await lines(`{service_name="symbiote"} |= "${token}"`, old)).length >= 4,
      240,
    );
    console.log(`the 13-day-old line in Loki ${late.toFixed(1)} s after today's`);

    await until('Grafana up', async () => (await fetch(`${grafana}/api/health`)).ok, 120);
    const source = await (
      await fetch(`${grafana}/api/datasources/uid/symbiote-loki/health`)
    ).json();
    if (source.status !== 'OK') fail(`Grafana's Loki: ${source.message}`);
    const board = await fetch(`${grafana}/api/dashboards/uid/symbiote`);
    if (!board.ok) fail(`the Symbiote dashboard: ${board.status}`);
    // Installed by Grafana after it starts answering (its preinstalled plugins).
    const drilldown = await until(
      'Logs Drilldown',
      async () => (await fetch(`${grafana}/api/plugins/grafana-lokiexplore-app/settings`)).ok,
      120,
    );
    console.log(
      `Grafana: Loki connected, the Symbiote dashboard; Logs Drilldown ${drilldown.toFixed(1)} s later`,
    );
  } finally {
    if (process.env.SYMBIOTE_LOGS_CHECK_KEEP !== '1') docker([...project, 'down', '-v'], env, true);
    rmSync(dir, { recursive: true, force: true });
  }
}

const command = process.argv[2];
try {
  if (command === 'up') await up();
  else if (command === 'down') await down();
  else if (command === 'check') await check();
  else fail('up, down or check');
} catch (error) {
  if (!(error instanceof Failed)) throw error;
  console.error(`logs: ${error.message}`);
  process.exitCode = 1;
}
