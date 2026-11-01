// Measures Claude Code's stop → resume race (fix/hive-runner-flaws, decision 720): a background
// session on Haiku with a hook that logs each event; per round, `claude stop`, then
// `claude --bg --resume` with a prompt; whether Claude Code woke the session or started a copy
// (whose hooks record nothing). Modes: `now` resumes as soon as the stop answers (Symbiote's reply
// before the fix); `wait` once `claude agents` lists no process; `attached-*` with a
// `claude attach` client on the session (the person's terminal on 2026-10-31 at 17:00:13);
// `attached-full` waits for the client's end too, as the reply does for its own terminals.
// Each round is a turn on your account. Every session of the folder is removed at the end.
//
// Usage: [MODES=attached-full,now] node scripts/hive/resume-race.mjs <scratch folder> <rounds>
//   [<repository folder>]
// The repository folder must be one Claude Code trusts (`--bg` refuses others); by default
// `<scratch folder>/repo`. Results: `<scratch folder>/results.jsonl`, one line a round.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const rounds = Number(process.argv[3] ?? 4);
const repo = process.argv[4] ?? join(dir, 'repo');
mkdirSync(dir, { recursive: true });
const events = join(dir, 'events.jsonl');
const results = join(dir, 'results.jsonl');
mkdirSync(repo, { recursive: true });
const sh = (cmd, args, cwd = repo) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120_000 });
if (!existsSync(join(repo, '.git'))) {
  sh('git', ['init', '-q']);
  writeFileSync(join(repo, 'README.md'), 'race\n');
  sh('git', ['add', '-A']);
  sh('git', ['-c', 'user.name=r', '-c', 'user.email=r@example.com', 'commit', '-qm', 'race']);
}
const hook = join(dir, 'hook.mjs');
writeFileSync(
  hook,
  `import { appendFileSync } from 'node:fs';
let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  try {
    const e = JSON.parse(s);
    appendFileSync(${JSON.stringify(events)}, JSON.stringify({ at: new Date().toISOString(), event: e.hook_event_name, session: e.session_id, prompt: e.prompt }) + '\\n');
  } catch {}
});
`,
);
const settings = join(dir, 'settings.json');
const command = `'${process.execPath}' '${hook}'`;
writeFileSync(
  settings,
  JSON.stringify({
    hooks: Object.fromEntries(
      ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'].map((e) => [
        e,
        [{ hooks: [{ type: 'command', command, timeout: 30 }] }],
      ]),
    ),
  }),
);

const claude = (args) => sh('claude', args);
const list = () => {
  const r = claude(['agents', '--json', '--all']);
  return JSON.parse(r.stdout || '[]').filter((s) => s.cwd === repo);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const readEvents = () =>
  existsSync(events)
    ? readFileSync(events, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const log = (line) => {
  appendFileSync(results, `${JSON.stringify(line)}\n`);
  console.log(JSON.stringify(line));
};

/** Waits until the session's turn ended and its process idles. */
async function idle(id) {
  for (let i = 0; i < 360; i++) {
    const s = list().find((x) => x.id === id);
    if (s && s.status === 'idle' && s.state !== 'working') return s;
    await sleep(500);
  }
  throw new Error(`never idle: ${id}`);
}

/** Waits until `claude agents` lists no process for the session; how long it took. */
async function ended(id, limit = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const s = list().find((x) => x.id === id);
    if (!s || s.status === undefined) return Date.now() - t0;
    if (Date.now() - t0 > limit) return -1;
    await sleep(200);
  }
}

// The first session, or the one a run before left.
let base = list().sort((a, b) => b.startedAt - a.startedAt)[0];
if (!base) {
  const t = Date.now();
  const start = claude([
    '--bg',
    '--name',
    'race',
    '--model',
    'haiku',
    '--settings',
    settings,
    '--',
    'Reply with the one word: ok',
  ]);
  if (start.status !== 0) {
    log({ error: 'start', out: start.stdout, err: start.stderr });
    process.exit(1);
  }
  base = list().sort((a, b) => b.startedAt - a.startedAt)[0];
  log({ started: base.id, sessionId: base.sessionId, ms: Date.now() - t });
}
await idle(base.id);

const modes = process.env.MODES
  ? Array.from({ length: rounds }, () => process.env.MODES.split(',')).flat()
  : [];
if (modes.length === 0) {
  for (let i = 0; i < rounds; i++) modes.push('now', 'wait');
  for (let i = 0; i < rounds; i++) modes.push('attached-now', 'attached-wait');
}

for (const [n, mode] of modes.entries()) {
  let client = null;
  let clientGone = null;
  if (mode.startsWith('attached')) {
    client = spawn('script', ['-qfc', `claude attach ${base.id}`, '/dev/null'], {
      cwd: repo,
      stdio: 'ignore',
      detached: true,
    });
    clientGone = new Promise((done) => client.on('exit', done));
    await sleep(3_000);
  }
  const before = new Set(list().map((s) => s.id));
  const t0 = Date.now();
  const stopped = claude(['stop', base.id]);
  const stopMs = Date.now() - t0;
  // `now`: the resume right after the stop answers, as Symbiote's reply did before the fix.
  const w0 = Date.now();
  if (mode.endsWith('wait') || mode.endsWith('full')) await ended(base.id);
  // `full`: the attached client's end too, as Symbiote's reply waits for its own terminals.
  if (mode.endsWith('full') && clientGone) await Promise.race([clientGone, sleep(10_000)]);
  const waitedMs = Date.now() - w0;
  const text = `Reply with the one word: ok (round ${n} ${mode})`;
  const resumed = claude(['--bg', '--resume', base.sessionId, '--', text]);
  const note = `${resumed.stdout}\n${resumed.stderr}`
    .split('\n')
    .find((l) => l.startsWith('note:'));
  const fresh = list().filter((s) => !before.has(s.id));
  await sleep(2_000);
  const recorded = readEvents().some(
    (e) => e.event === 'UserPromptSubmit' && e.prompt === text && e.session === base.sessionId,
  );
  const anyRecorded = readEvents().some((e) => e.event === 'UserPromptSubmit' && e.prompt === text);
  const copy = fresh[0] ?? null;
  log({
    round: n,
    mode,
    stop: stopped.status,
    stopMs,
    waitedMs,
    resume: resumed.status,
    note: note ?? (resumed.stdout + resumed.stderr).trim().slice(-200),
    copy: copy?.id ?? null,
    recordedOnOriginal: recorded,
    recordedAnywhere: anyRecorded,
  });
  if (client) {
    try {
      process.kill(-client.pid, 'SIGTERM');
    } catch {
      // Ended already: the stop ends a `claude attach` client.
    }
  }
  if (copy) {
    // The copy runs unseen: stop it, then wake the original again for the next round.
    await idle(copy.id).catch(() => undefined);
    claude(['stop', copy.id]);
    await ended(copy.id);
    claude(['rm', copy.id]);
    await ended(base.id);
    claude(['--bg', '--resume', base.sessionId, '--', 'Reply with the one word: ok (again)']);
  }
  base = list().find((s) => s.id === base.id) ?? base;
  await idle(base.id);
}

// Clean up: every session of this folder stopped and removed.
for (const s of list()) {
  if (s.status !== undefined) claude(['stop', s.id]);
  await ended(s.id);
  claude(['rm', s.id]);
}
log({ done: true, left: list().length });
