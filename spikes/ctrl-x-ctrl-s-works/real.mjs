// Steps 2 and 3 of the spike: a real Claude Code, as Symbiote runs it — a background session
// (`claude --bg`) and a terminal on it (`claude attach <id>`, node-pty, xterm-256color) — sent the
// bytes the agent terminal sends (bytes.spec.ts) while a message waits behind a running turn.
//
//   node real.mjs trust <repo>             accept the folder's trust prompt once
//   node real.mjs run <repo> [variant…]    the trials; results appended to data/real.jsonl
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname;
const require = createRequire(join(here, '../../packages/cli/package.json'));
const pty = require('node-pty');

const DATA = join(here, 'data');
const SLEEP = 30;
// A long turn: Claude Code blocks a standalone `sleep` ("use Monitor"), so a wait in node.
const WAIT = `node -e "setTimeout(() => console.log('done'), ${SLEEP * 1000})"`;
const SETTINGS = join(DATA, 'spike-settings.json');
writeFileSync(SETTINGS, JSON.stringify({ agentPushNotifEnabled: false }) + '\n');

/** This session's own variables left out: the agent runs as Symbiote's server starts it. */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^CLAUDE/.test(name)),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>78]/g, '');

/** A program in a pseudo-terminal, as Symbiote's server opens one; its output kept. */
function open(args, cwd) {
  const term = pty.spawn('claude', args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd,
    env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });
  const out = { raw: '', chunks: [] };
  term.onData((d) => {
    out.raw += d;
    out.chunks.push({ at: Date.now(), text: plain(d) });
  });
  return { term, out };
}

async function waitFor(test, ms, step = 200) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await test();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

const claude = (args, cwd) =>
  execFileSync('claude', args, { cwd, env, encoding: 'utf8', timeout: 60_000 });
const sessions = (cwd) => JSON.parse(claude(['agents', '--json', '--all'], cwd));

/** The transcript's entries, each with its line's text, once Claude Code has written it. */
function transcript(sessionId) {
  const root = join(homedir(), '.claude', 'projects');
  for (const dir of readdirSync(root)) {
    const file = join(root, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) {
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ ...JSON.parse(line), line }));
    }
  }
  return [];
}

async function trust(repo) {
  const { term, out } = open([], repo);
  const asked = await waitFor(() => /trust/i.test(plain(out.raw)), 30_000);
  console.log('trust prompt seen:', Boolean(asked));
  // "No, exit" is the default: down to "Yes, I trust this folder" first.
  if (asked) {
    await sleep(1000);
    term.write('\x1b[B');
    await sleep(500);
    term.write('\r');
  }
  await sleep(6000);
  term.kill('SIGHUP');
  writeFileSync(join(DATA, 'trust-screen.txt'), plain(out.raw));
}

/** What each variant sends once the message waits: the bytes, and the gaps between them. */
const VARIANTS = {
  none: [],
  'one-write': [['\x18\x13', 0]],
  'gap-10ms': [['\x18', 0], ['\x13', 10]],
  'gap-150ms': [['\x18', 0], ['\x13', 150]],
  'gap-1500ms': [['\x18', 0], ['\x13', 1500]],
  'ctrl+enter (\\r)': [['\r', 0]],
};

async function run(repo, wanted) {
  const name = `sendnow-${Date.now().toString(36)}`;
  console.log(
    claude(
      ['--bg', '--name', name, '--model', 'haiku', '--settings', SETTINGS, '--strict-mcp-config',
        '--allowedTools', 'Bash(node -e:*)', 'Reply with only the word READY.'],
      repo,
    ).trim(),
  );
  const mine = await waitFor(() => sessions(repo).find((s) => s.name === name), 30_000, 1000);
  if (!mine) throw new Error('no session');
  console.log('session', mine.id, mine.sessionId);
  await waitFor(() => sessions(repo).find((s) => s.id === mine.id && s.status === 'idle'), 90_000, 1000);
  const { term, out } = open(['attach', mine.id], repo);
  await sleep(4000);
  // The terminal's line discipline while Claude Code reads it: ^S is XOFF unless -ixon.
  const tty = execFileSync('readlink', [`/proc/${term.pid}/fd/0`], { encoding: 'utf8' }).trim();
  const stty = execFileSync('stty', ['-a', '-F', tty], { encoding: 'utf8' });
  appendFileSync(join(DATA, 'real.jsonl'), JSON.stringify({ kind: 'stty', session: mine.id, tty, stty }) + '\n');
  console.log(tty, stty.match(/-?ixon/)?.[0], stty.match(/-?icanon/)?.[0]);

  let n = 0;
  for (const variant of wanted) {
    n += 1;
    const tag = `${name.slice(8)}-${n}`;
    const from = out.chunks.length;
    const typed = Date.now();
    term.write(`Run exactly this command with the Bash tool, in the foreground: ${WAIT} — when it ends, reply with only: SLEPT-${tag}.`);
    await sleep(300);
    term.write('\r');
    // The wait running: its tool call in the transcript.
    const call = await waitFor(
      () => transcript(mine.sessionId).find((e) => e.type === 'assistant' && e.line.includes('setTimeout') && e.line.includes('tool_use') && Date.parse(e.timestamp) >= typed - 1000),
      60_000,
    );
    const toolAt = call ? Date.parse(call.timestamp) : null;
    await sleep(3000);
    term.write(`Reply with only the word PINEAPPLE-${tag}.`);
    await sleep(300);
    term.write('\r');
    const queuedAt = Date.now();
    // The hint under the waiting message.
    const hint = await waitFor(() => {
      const text = out.chunks.slice(from).map((c) => c.text).join('');
      return text.match(/[^\n]{0,30}to send now[^\n]{0,30}/)?.[0];
    }, 6000);
    await sleep(2000);
    const pressedAt = Date.now();
    for (const [bytes, gap] of VARIANTS[variant]) {
      if (gap) await sleep(gap);
      term.write(bytes);
    }
    // Until every turn is over, the wait's own end included (a wait moved to the background ends
    // later in a turn of its own): past its end, the session idle and its transcript still for 3 s.
    const answeredText = (e) => e.type === 'assistant' && Array.isArray(e.message?.content) &&
      e.message.content.some((c) => c.type === 'text' && c.text.includes(`PINEAPPLE-${tag}`));
    const quietAt = (toolAt ?? pressedAt) + SLEEP * 1000 + 8000;
    let size = -1;
    await waitFor(
      () => {
        const t = transcript(mine.sessionId);
        const still = t.length === size;
        size = t.length;
        return Date.now() > quietAt && t.some(answeredText) && still &&
          sessions(repo).find((s) => s.id === mine.id)?.status === 'idle';
      },
      (SLEEP + 90) * 1000,
      3000,
    );
    const t = transcript(mine.sessionId).filter((e) => e.timestamp && Date.parse(e.timestamp) >= typed - 1000);
    const first = (test) => t.find(test);
    // Taken in: the queue lets the message go — `remove` (sent into the running turn) or `dequeue`
    // (a turn of its own) — or a user entry has it.
    const takenIn = first((e) => e.line.includes(`PINEAPPLE-${tag}`) &&
      ((e.type === 'queue-operation' && e.operation !== 'enqueue') || (e.type === 'user' && typeof e.message?.content === 'string')));
    const queue = t.filter((e) => e.type === 'queue-operation').map((e) => ({ msAfterPress: Date.parse(e.timestamp) - pressedAt, operation: e.operation, content: e.content }));
    const toolId = call?.message?.content?.find?.((c) => c.type === 'tool_use')?.id;
    const answered = first(answeredText);
    const result = first((e) => e.type === 'user' && toolId && e.line.includes(toolId) && e.line.includes('tool_result'));
    const resultAt = result ? Date.parse(result.timestamp) : null;
    const screen = out.chunks.slice(from).map((c) => c.text).join('');
    const record = {
      kind: 'trial',
      session: mine.id,
      tag,
      variant,
      bytes: VARIANTS[variant],
      sleepSeconds: SLEEP,
      toolStartedMsAfterTyped: toolAt && toolAt - typed,
      pressedMsAfterToolStarted: toolAt && pressedAt - toolAt,
      hint: hint ?? null,
      takenInMsAfterPress: takenIn ? Date.parse(takenIn.timestamp) - pressedAt : null,
      takenInAs: takenIn ? (takenIn.operation ?? takenIn.type) : null,
      answeredMsAfterPress: answered ? Date.parse(answered.timestamp) - pressedAt : null,
      sleepEndedMsAfterPress: result ? Date.parse(result.timestamp) - pressedAt : null,
      sleepResult: result ? JSON.stringify(result.message?.content).slice(0, 300) : null,
      waitMovedToBackground: /moved to the background/.test(result?.line ?? ''),
      // Valid: the wait ran, and was still running when the keys were pressed.
      valid: Boolean(toolAt && (resultAt === null || resultAt > pressedAt) && !/tool_use_error/.test(result?.line ?? '')),
      queue,
      interrupted: t.some((e) => e.line.includes('Request interrupted')),
      unavailable: /Send now isn't available/.test(screen),
      notes: (screen.match(/[^\n]{0,60}(send now|interrupt)[^\n]{0,60}/gi) ?? []).slice(0, 8),
      queuedAt,
      pressedAt,
    };
    appendFileSync(join(DATA, 'real.jsonl'), JSON.stringify(record) + '\n');
    writeFileSync(join(DATA, `real-screen-${tag}.txt`), screen);
    writeFileSync(join(DATA, `real-transcript-${tag}.jsonl`), t.map((e) => e.line).join('\n') + '\n');
    console.log(variant, '→ valid', record.valid, '; taken in', record.takenInMsAfterPress, 'ms as', record.takenInAs, '; answered', record.answeredMsAfterPress, 'ms; wait result', record.sleepEndedMsAfterPress, 'ms, to background', record.waitMovedToBackground, '; interrupted', record.interrupted, '; unavailable', record.unavailable);
  }
  writeFileSync(join(DATA, `real-attach-${name}.raw`), out.raw);
  term.kill('SIGHUP');
  claude(['stop', mine.id], repo);
  console.log('stopped', mine.id);
}

const [what, repo, ...rest] = process.argv.slice(2);
if (what === 'trust') await trust(repo);
else if (what === 'run') await run(repo, rest.length ? rest : Object.keys(VARIANTS));
else console.log('node real.mjs trust|run <repo> [variant…]');
