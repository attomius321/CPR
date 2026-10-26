// Symbiote's log viewer (LG1, decision 357): `pnpm logs:up` starts Loki, Alloy and Grafana on the
// folder Symbiote writes (made first, as Symbiote's: one Docker made would be root's); `logs:down`
// stops them and keeps their copy; `logs:check` runs a second copy on a temporary folder and
// random ports, writes lines there and checks they reach Loki and Grafana as the dashboard reads
// them, then removes it. Needs Docker, and `pnpm build` (the folder comes from @symbiote/log).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/** The numbers of a query's frames: one series a frame, with its labels. */
function seriesOf(frames) {
  return frames.flatMap((frame) => {
    const i = frame.schema.fields.findIndex((field) => field.type === 'number');
    if (i < 0) return [];
    const values = frame.data.values[i].filter((value) => value !== null);
    const labels = frame.schema.fields[i].labels ?? {};
    return [{ labels, total: values.reduce((sum, value) => sum + value, 0) }];
  });
}

/** The rows a logs query shows. */
function rowsOf(frames) {
  return frames.flatMap((frame) => {
    const i = frame.schema.fields.findIndex((field) => field.name === 'Line');
    return i < 0 ? [] : frame.data.values[i];
  });
}

/** `{ label value: total }` of the series, by one label. */
function totalsBy(series, label) {
  return Object.fromEntries(series.map((one) => [one.labels[label] ?? '', one.total]));
}

/**
 * Runs every query of every panel of the dashboard Grafana serves, as the dashboard does (its
 * variables at "All", no text), on the lines `check` wrote (LG2): none fails, each finds them,
 * and the panels show what those lines say. Every difference is listed before it stops.
 */
async function checkDashboard(grafana, dashboard, from) {
  const panels = dashboard.panels.flatMap((panel) => [panel, ...(panel.panels ?? [])]);
  const wrong = [];
  const results = new Map();
  for (const panel of panels.filter((one) => one.targets)) {
    const frames = [];
    for (const target of panel.targets) {
      const expr = target.expr
        .replaceAll('$process', '.+')
        .replaceAll('$level', '.+')
        .replaceAll('$search', '');
      const answer = await fetch(`${grafana}/api/ds/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: String(from.getTime()),
          to: String(Date.now() + 60_000),
          queries: [
            { ...target, expr, maxDataPoints: panel.maxDataPoints ?? 100, intervalMs: 15_000 },
          ],
        }),
      });
      const result = (await answer.json()).results?.[target.refId];
      if (!answer.ok || !result || result.error) {
        wrong.push(`${panel.title} (${target.refId}): ${result?.error ?? answer.status}`);
      } else if (!result.frames?.length) wrong.push(`${panel.title} (${target.refId}): nothing`);
      else frames.push(...result.frames);
    }
    results.set(panel.title, frames);
  }

  const expect = (title, what, test) => {
    const frames = results.get(title);
    if (!frames) return wrong.push(`no panel "${title}"`);
    const shown = test(frames);
    if (shown !== true) wrong.push(`${title}: ${what}, shows ${JSON.stringify(shown)}`);
  };
  const total = (frames) => seriesOf(frames).reduce((sum, one) => sum + one.total, 0);
  const equal = (want) => (got) => (JSON.stringify(got) === JSON.stringify(want) ? true : got);
  const counts = { Crashes: 1, Errors: 3, Warnings: 2, Analyses: 1, Merged: 1, Agents: 1 };
  for (const [title, want] of Object.entries(counts)) {
    expect(title, `${want}`, (frames) => equal(want)(total(frames)));
  }
  expect('Problems over time', 'by level', (frames) =>
    equal({ error: 3, fatal: 1, warn: 2 })(sortKeys(totalsBy(seriesOf(frames), 'level'))),
  );
  expect('Problems by kind', 'five kinds, page did not load twice', (frames) => {
    const kinds = seriesOf(frames).map(
      ({ labels, total: n }) => `${labels.level} ${labels.msg} ${n}`,
    );
    return equal([
      'error page did not load 2',
      'error request failed 1',
      'fatal uncaught exception 1',
      'warn merge failed 1',
      'warn terminal ended 1',
    ])(kinds.sort());
  });
  expect('Agent terminals by program', 'claude 1', (frames) =>
    equal({ claude: 1 })(totalsBy(seriesOf(frames), 'program')),
  );
  expect('Requests by status', '2xx 2, 4xx 1, 5xx 1', (frames) =>
    equal({ '2xx': 2, '4xx': 1, '5xx': 1 })(sortKeys(totalsBy(seriesOf(frames), 'class'))),
  );
  expect('Slowest routes', "the terminal's ID taken out", (frames) => {
    const routes = seriesOf(frames).map(({ labels }) => labels.route);
    return routes.includes('POST /api/terminals/<id>/paths') || routes;
  });

  // The rows: what happened, in words; a stack under its row.
  const has = (want) => (frames) => rowsOf(frames).some((row) => row === want) || rowsOf(frames);
  const stack = '\nTypeError: x is undefined\n    at run (main.js:10:5)\n    at go (main.js:2:1)';
  const problems = 'Crashes, errors and warnings, with their stacks';
  expect(problems, 'six rows', (frames) => equal(6)(rowsOf(frames).length));
  expect(
    problems,
    "a page's network error",
    has('app · page did not load ERR_CONNECTION_REFUSED http://127.0.0.1:1/'),
  );
  expect(
    problems,
    'a crash and its stack',
    has(`analysis · uncaught exception — x is undefined${stack}`),
  );
  expect(problems, "a terminal's exit", has('view · terminal ended claude (exit 1)'));
  expect('Merges', 'landed and failed', (frames) =>
    equal([
      'view · merge failed feature/failed → main',
      'view · merge landed feature/landed → main',
    ])(rowsOf(frames).sort()),
  );
  expect('Requests', 'four rows', (frames) => equal(4)(rowsOf(frames).length));
  expect(
    'Requests',
    "a refusal's words",
    has('view · request POST /api/workspaces/clean 404 3 ms — no such workspace'),
  );
  expect(
    'Requests',
    'seconds past one',
    has('view · request POST /api/terminals/05a699f4…/paths 200 2.5 s'),
  );
  const every = 'Every line but requests';
  expect(every, 'no request', (frames) => {
    const requests = rowsOf(frames).filter((row) => / · request [A-Z]/.test(row));
    return requests.length === 0 || requests;
  });
  // A message's first line; a stack's first six, the rest in the row's details.
  const frames = [1, 2, 3, 4].map((n) => `\n    at f${n} (exec.js:${n}:1)`).join('');
  expect(
    every,
    'a failed request, its stack cut',
    has(
      `view · request failed GET /api/workspaces 500 14 ms — git config failed\nGitError: git config failed\nfatal: no email${frames}\n    …`,
    ),
  );
  expect(every, 'an analysis', has('view · analysis done abc1234..def5678 5.0 s'));
  expect(every, 'a start', has('view · view started /home/someone/project'));

  if (wrong.length > 0) fail(`the dashboard:\n  ${wrong.join('\n  ')}`);
  return results.size;
}

function sortKeys(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
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
  // The token in a field of its own: the dashboard's queries filter on `msg`.
  const line = (time, level, process, msg, more = {}) =>
    `${JSON.stringify({ level, time: time.toISOString(), pid: 1, process, ...more, check: token, msg })}\n`;
  const stack = 'TypeError: x is undefined\n    at run (main.js:10:5)\n    at go (main.js:2:1)';
  const err = { type: 'TypeError', message: 'x is undefined', stack };
  const merge = (state) => ({ branch: `feature/${state}`, into: 'main', state });
  const pageError = {
    url: 'http://127.0.0.1:1/',
    code: -102,
    description: 'ERR_CONNECTION_REFUSED',
  };
  // A line for every panel of the dashboard (LG2): what `checkDashboard` expects of them.
  const written = [
    line(now, 'info', 'view', 'view started', { repo: '/home/someone/project' }),
    line(now, 'info', 'view', 'request', {
      method: 'POST',
      path: '/api/reviews',
      status: 200,
      ms: 12,
    }),
    line(now, 'info', 'view', 'request', {
      method: 'POST',
      path: '/api/terminals/05a699f4…/paths',
      status: 200,
      ms: 2500,
    }),
    line(now, 'info', 'view', 'request', {
      method: 'POST',
      path: '/api/workspaces/clean',
      status: 404,
      ms: 3,
      answer: 'no such workspace',
    }),
    line(now, 'error', 'view', 'request failed', {
      method: 'GET',
      path: '/api/workspaces',
      status: 500,
      ms: 14,
      err: {
        type: 'GitError',
        message: 'git config failed\nfatal: no email',
        stack: `GitError: git config failed\nfatal: no email${[1, 2, 3, 4, 5, 6, 7, 8]
          .map((n) => `\n    at f${n} (exec.js:${n}:1)`)
          .join('')}`,
      },
    }),
    line(now, 'info', 'view', 'analysis done', { pair: 'abc1234..def5678', ms: 4991 }),
    line(now, 'info', 'view', 'merge landed', merge('landed')),
    line(now, 'warn', 'view', 'merge failed', merge('failed')),
    line(now, 'info', 'view', 'terminal opened', { terminal: 'c20e9fb0', program: 'claude' }),
    line(now, 'warn', 'view', 'terminal ended', {
      terminal: 'c20e9fb0',
      program: 'claude',
      exitCode: 1,
    }),
    line(now, 'error', 'app', 'page did not load', pageError),
    line(now, 'error', 'app', 'page did not load', pageError),
    line(now, 'fatal', 'analysis', 'uncaught exception', { err, origin: 'uncaughtException' }),
  ];
  writeFileSync(join(dir, `${day(now)}.jsonl`), written.join(''));
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
      async () =>
        (await lines(`{service_name="symbiote"} |= "${token}"`, hour)).length >= written.length,
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

    // A line 13 days old, read late (Loki finds it once flushed: chunk_idle_period).
    const late = await until(
      'the 13-day-old line',
      async () =>
        (await lines(`{service_name="symbiote"} |= "${token}"`, old)).length > written.length,
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
    const panels = await checkDashboard(grafana, (await board.json()).dashboard, hour);
    console.log(`the dashboard: ${panels} panels, every query through Grafana as expected`);
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
