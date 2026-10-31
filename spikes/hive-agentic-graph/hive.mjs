#!/usr/bin/env node
// HV1 spike: Hive's agentic graph on a runner of Symbiote's own (no dependency). Throwaway.
//
//   node hive.mjs start --run <dir> --template <repo> --goal <file> --mode graph|loop|one|subagents
//                       [--profile real|cheap|fake] [--fake <script>]
//   node hive.mjs resume --run <dir>
//   node hive.mjs off --run <dir>        (Hive turned off: every agent stopped)
//
// The outer graph: the orchestrator turns the goal into workspaces with dependencies; ready ones
// start (a dependent one from its parent's approved branch); approved ones merge into `main` in
// dependency order (a merge worktree, the check, then a fast-forward). The inner loop, per
// workspace: a read-only researcher, the main agent (the only writer), the runner's check, a
// clean-context reviewer (the diff and Symbiote's graph); at most ROUND_CAP rounds; a stall (two
// rounds without progress) asks the orchestrator for a new plan. Everything is in `state.json`,
// written after each step, so `resume` continues from the step a stop interrupted.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const SYMBIOTE = resolve(HERE, '../../packages/cli/dist/bin.js');
const ROUND_CAP = 3;
const STALL_ROUNDS = 2;
const MAX_REPLANS = 2;
const LIMITS = { fiveHour: 70, week: 85 };

/** Models and effort per role; `fake` runs fake-agent.mjs instead of Claude Code. */
const PROFILES = {
  real: {
    orchestrator: { model: 'opus', effort: 'high', budget: 4 },
    researcher: { model: 'sonnet', effort: 'medium', budget: 2 },
    main: { model: 'opus', effort: 'high', budget: 10 },
    reviewer: { model: 'sonnet', effort: 'high', budget: 3 },
    one: { model: 'opus', effort: 'high', budget: 20 },
  },
  cheap: {
    orchestrator: { model: 'haiku', budget: 1 },
    researcher: { model: 'haiku', budget: 1 },
    main: { model: 'sonnet', effort: 'medium', budget: 3 },
    reviewer: { model: 'haiku', budget: 1 },
    one: { model: 'sonnet', effort: 'medium', budget: 5 },
  },
};
// A weaker writer with an Opus reviewer: does the inner loop lift it to Opus alone?
PROFILES.sonnet = {
  orchestrator: { model: 'opus', effort: 'high', budget: 4 },
  researcher: { model: 'sonnet', effort: 'medium', budget: 2 },
  main: { model: 'sonnet', effort: 'high', budget: 6 },
  reviewer: { model: 'opus', effort: 'high', budget: 4 },
  one: { model: 'sonnet', effort: 'high', budget: 10 },
};
PROFILES.haiku = {
  ...PROFILES.sonnet,
  researcher: { model: 'haiku', budget: 1 },
  main: { model: 'haiku', budget: 3 },
  one: { model: 'haiku', budget: 5 },
};
PROFILES.fake = Object.fromEntries(
  Object.keys(PROFILES.real).map((role) => [role, { model: 'fake', budget: 1 }]),
);

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const READ_ALLOWED = [
  'Read',
  'Grep',
  'Glob',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git status:*)',
  'Bash(ls:*)',
];

// ---------------------------------------------------------------------------------------------
// State

let RUN = '';
let state = null;
const running = new Map(); // pid -> { role, node }
/** Set once Hive is turned off: a call its stop ended is not a finished step. */
let stopping = false;

const now = () => new Date().toISOString();
function save() {
  const file = join(RUN, 'state.json');
  writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
function event(kind, data = {}) {
  const line = { at: now(), kind, ...data };
  appendFileSync(join(RUN, 'events.jsonl'), `${JSON.stringify(line)}\n`);
  const what = Object.entries(data)
    .filter(([, v]) => typeof v !== 'object')
    .map(([k, v]) => `${k}=${String(v).slice(0, 80)}`)
    .join(' ');
  console.log(`${line.at.slice(11, 19)} ${kind} ${what}`);
}

function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} in ${cwd}: ${r.stderr.trim()}`);
  }
  return allowFail ? r : r.stdout.trim();
}

// ---------------------------------------------------------------------------------------------
// The switch and the usage windows

const hiveFile = () => join(state.repo, 'symbiote', 'hive.json');
function hiveOn() {
  try {
    return JSON.parse(readFileSync(hiveFile(), 'utf8')).on === true;
  } catch {
    return false;
  }
}
function setHive(on) {
  mkdirSync(dirname(hiveFile()), { recursive: true });
  writeFileSync(hiveFile(), `${JSON.stringify({ on, since: now() })}\n`);
}

/** Hive turned off: every running agent's process group stopped, the run marked `off`. */
function watchSwitch() {
  const timer = setInterval(() => {
    if (hiveOn()) return;
    clearInterval(timer);
    stopping = true;
    const pids = [...running.keys()];
    event('hive-off', { agents: pids.length });
    for (const pid of pids) killGroup(pid, 'SIGTERM');
    setTimeout(() => {
      for (const pid of pids) killGroup(pid, 'SIGKILL');
      state.status = 'off';
      state.stoppedAt = now();
      save();
      event('stopped', { status: 'off' });
      process.exit(0);
    }, 3000);
  }, 1000);
  timer.unref();
}
function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    /* gone */
  }
}

let usageRead = null;
/** The Claude subscription's windows, as Symbiote's `usage` reads them (read only). */
async function windows() {
  if (state.profile === 'fake') return null;
  if (usageRead && Date.now() - usageRead.at < 120_000) return usageRead.value;
  try {
    const { readClaudeUsage } = await import(resolve(HERE, '../../packages/cli/dist/usage.js'));
    const r = await readClaudeUsage({
      installed: async () => true,
      env: process.env,
      home: process.env.HOME,
      lastFile: join(RUN, 'usage-last.json'),
    });
    const w = r.subscription?.windows ?? [];
    const value = {
      fiveHour: w.find((x) => x.minutes === 300)?.usedPercent,
      week: w.find((x) => x.minutes === 10080 && !x.scope)?.usedPercent,
      at: r.subscription?.at,
    };
    usageRead = { at: Date.now(), value };
    return value;
  } catch (error) {
    return { error: String(error) };
  }
}
/** Stops the run before an agent starts when a window is past its limit. */
async function usageGate(role) {
  const w = await windows();
  if (!w || w.error) return;
  if ((w.fiveHour ?? 0) > LIMITS.fiveHour || (w.week ?? 0) > LIMITS.week) {
    event('usage-limit', { role, fiveHour: w.fiveHour, week: w.week });
    state.status = 'waiting-usage';
    save();
    process.exit(3);
  }
}

// ---------------------------------------------------------------------------------------------
// One agent call: Claude Code headless (`-p`, stream-json), or the fake agent

async function agent({
  role,
  node,
  round,
  prompt,
  cwd,
  system,
  permissionMode,
  tools,
  allowed,
  disallowed,
  schema,
  resume,
  sessionId,
  agents,
  profileRole = role,
}) {
  if (!hiveOn()) throw new Error('Hive is off');
  await usageGate(role);
  const p = PROFILES[state.profile][profileRole];
  const session = resume ?? sessionId ?? randomUUID();
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  args.push('--setting-sources', 'project,local', '--model', p.model);
  if (p.effort) args.push('--effort', p.effort);
  args.push('--permission-mode', permissionMode);
  if (tools) args.push('--tools', tools.join(','));
  if (allowed) args.push('--allowedTools', ...allowed);
  if (disallowed) args.push('--disallowedTools', ...disallowed);
  if (resume) args.push('--resume', resume);
  else args.push('--session-id', session);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (agents) args.push('--agents', JSON.stringify(agents));
  args.push('--append-system-prompt', `Hive role: ${role}.\n${system ?? ''}`);
  args.push('--max-budget-usd', String(p.budget));

  const n = state.calls.length + 1;
  const log = join(RUN, 'agents', `${String(n).padStart(2, '0')}-${role}-${node ?? 'run'}-r${round ?? 0}.jsonl`);
  mkdirSync(dirname(log), { recursive: true });
  const command = p.model === 'fake' ? process.execPath : 'claude';
  const commandArgs = p.model === 'fake' ? [join(HERE, 'fake-agent.mjs'), ...args] : args;
  const started = Date.now();
  event('agent-start', { role, node, round, model: p.model, session, resume: Boolean(resume) });

  const child = spawn(command, commandArgs, {
    cwd,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HIVE_FAKE: state.fake ?? '', HIVE_NODE: node ?? '', HIVE_ROUND: String(round ?? 0) },
  });
  running.set(child.pid, { role, node });
  const call = { role, node, round, model: p.model, effort: p.effort, session, pid: child.pid, started: now(), log };
  state.calls.push(call);
  save();
  child.stdin.end(prompt);
  const out = createWriteStream(log);
  let result = null;
  let buffer = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    out.write(chunk);
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      try {
        const value = JSON.parse(line);
        if (value.type === 'result') result = value;
      } catch {
        /* not JSON */
      }
    }
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exit = await new Promise((done) => child.on('close', done));
  out.end();
  // Stopped by Hive turned off: the step stays where it was; the switch ends the process.
  if (stopping) await new Promise(() => {});
  running.delete(child.pid);

  Object.assign(call, {
    ended: now(),
    ms: Date.now() - started,
    exit,
    session: result?.session_id ?? session,
    cost: result?.total_cost_usd ?? 0,
    turns: result?.num_turns,
    usage: result?.usage,
    modelUsage: result?.modelUsage,
    subtype: result?.subtype,
    ...(stderr.trim() ? { stderr: stderr.trim().slice(-2000) } : {}),
  });
  delete call.pid;
  save();
  event('agent-end', {
    role,
    node,
    round,
    exit,
    subtype: result?.subtype,
    cost: (result?.total_cost_usd ?? 0).toFixed(3),
    s: Math.round((Date.now() - started) / 1000),
  });
  let structured = result?.structured_output;
  if (schema && structured === undefined && typeof result?.result === 'string') {
    structured = parseJson(result.result);
  }
  return { ok: exit === 0 && result?.subtype === 'success', text: result?.result ?? '', structured, session: call.session };
}

/** A resume of a session a stop cut before it was written fails: start it again, fresh. */
async function agentResumed(request, fresh) {
  const r = await agent(request);
  if (r.ok || !request.resume) return r;
  event('resume-failed', { role: request.role, node: request.node });
  return agent({ ...request, resume: undefined, sessionId: randomUUID(), prompt: fresh() });
}

function parseJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  try {
    return JSON.parse(fenced);
  } catch {
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    try {
      return JSON.parse(fenced.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The orchestrator

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    facts: { type: 'array', items: { type: 'string' } },
    guesses: { type: 'array', items: { type: 'string' } },
    plan: { type: 'string' },
    workspaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9-]+$' },
          title: { type: 'string' },
          brief: { type: 'string' },
          deps: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'brief', 'deps'],
      },
    },
  },
  required: ['facts', 'guesses', 'plan', 'workspaces'],
};

const REPLAN_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['retry', 'stop'] },
    brief: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['action', 'note'],
};

async function plan() {
  const r = await agent({
    role: 'orchestrator',
    prompt: `The goal:\n\n${state.goal}\n\nRead the repository as you need (read only), then plan.`,
    cwd: state.repo,
    system: [
      "You are Hive's orchestrator. Turn the goal into a graph of workspaces. A workspace is one",
      'branch with one agent that writes; a workspace that needs code from another depends on it',
      "and starts from that one's branch once it is approved.",
      'Rules: use the fewest workspaces that keep each a coherent change one can review on its own;',
      'one workspace when the goal is one change; at most 4. Split only along real dependencies or',
      'truly independent parts. Each brief is what its agent must do, with the exact interfaces it',
      'provides or relies on; its agent also sees the whole goal. Write the task ledger too: facts',
      "you checked in the repository, guesses still to check, the plan in a sentence. Don't write code.",
    ].join('\n'),
    permissionMode: 'dontAsk',
    tools: READ_TOOLS,
    allowed: READ_ALLOWED,
    schema: PLAN_SCHEMA,
  });
  const p = r.structured;
  if (!r.ok || !p?.workspaces?.length) throw new Error(`no plan: ${r.text.slice(0, 500)}`);
  const ids = new Set(p.workspaces.map((w) => w.id));
  for (const w of p.workspaces) w.deps = w.deps.filter((d) => ids.has(d) && d !== w.id);
  if (hasCycle(p.workspaces)) throw new Error('the plan has a cycle');
  state.ledger = { facts: p.facts, guesses: p.guesses, plan: p.plan };
  state.nodes = p.workspaces.slice(0, 4).map((w) => newNode(w));
  event('planned', { workspaces: state.nodes.map((n) => `${n.id}<-[${n.deps}]`).join(' ') });
}

function hasCycle(ws) {
  const deps = new Map(ws.map((w) => [w.id, w.deps]));
  const seen = new Set();
  const visit = (id, path) => {
    if (path.has(id)) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (deps.get(id) ?? []).some((d) => visit(d, new Set([...path, id])));
  };
  return ws.some((w) => visit(w.id, new Set()));
}

function newNode({ id, title, brief, deps }) {
  return {
    id,
    title,
    brief,
    deps,
    branch: `hive/${id}`,
    phase: 'pending',
    round: 0,
    reviews: [],
    checks: [],
    progress: [],
    replans: 0,
  };
}

async function replan(n) {
  state.replans = (state.replans ?? 0) + 1;
  const last = n.reviews.at(-1);
  const r = await agent({
    role: 'orchestrator',
    node: n.id,
    round: n.round,
    prompt: [
      `The goal:\n\n${state.goal}`,
      `Task ledger: ${JSON.stringify(state.ledger)}`,
      `Workspace ${n.id} (${n.title}) has stalled: ${STALL_ROUNDS} rounds without progress.`,
      `Its brief:\n${n.brief}`,
      `Progress ledger: ${JSON.stringify(n.progress)}`,
      `The last review: ${JSON.stringify(last ?? null)}`,
      `The last check: ${n.checks.at(-1)?.ok ? 'passed' : `failed:\n${n.checks.at(-1)?.tail ?? ''}`}`,
      "Decide: retry with a new brief (a fresh agent on the same branch, which keeps its commits), or stop for the person.",
    ].join('\n\n'),
    cwd: n.worktree,
    system: "You are Hive's orchestrator, replanning one stalled workspace. Don't write code.",
    permissionMode: 'dontAsk',
    tools: READ_TOOLS,
    allowed: READ_ALLOWED,
    schema: REPLAN_SCHEMA,
  });
  const d = r.structured ?? { action: 'stop', note: 'no answer' };
  event('replanned', { node: n.id, action: d.action, note: d.note });
  return d;
}

// ---------------------------------------------------------------------------------------------
// A workspace: its worktree, the inner loop

function ensureWorktree(n) {
  if (n.worktree && existsSync(n.worktree)) return;
  const deps = n.deps.map((id) => node(id));
  const from = deps.length === 1 && deps[0].phase !== 'merged' ? deps[0].branch : 'main';
  n.from = from;
  n.worktree = join(RUN, 'wt', n.id);
  git(state.repo, ['worktree', 'add', '-b', n.branch, n.worktree, from]);
  n.forkBase = git(n.worktree, ['rev-parse', 'HEAD']);
  event('workspace-start', { node: n.id, from, base: n.forkBase.slice(0, 7) });
  save();
}

function check(cwd) {
  const started = Date.now();
  const r = spawnSync('npm', ['run', 'check'], { cwd, encoding: 'utf8', timeout: 600_000 });
  const tail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-40).join('\n');
  return { ok: r.status === 0, ms: Date.now() - started, tail };
}

function symbioteDiff(cwd, base) {
  const r = spawnSync(process.execPath, [SYMBIOTE, 'diff', base, 'HEAD'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SYMBIOTE_CACHE_DIR: join(RUN, 'symbiote-cache') },
  });
  return (r.stdout || r.stderr).trim().slice(0, 8000);
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          path: { type: 'string' },
          line: { type: 'integer' },
          text: { type: 'string' },
        },
        required: ['severity', 'path', 'text'],
      },
    },
  },
  required: ['verdict', 'summary', 'findings'],
};

const blocking = (review) =>
  (review?.findings ?? []).filter((f) => f.severity === 'blocker' || f.severity === 'major').length;

function mainSystem(n) {
  const others = state.nodes.filter((o) => o.id !== n.id);
  return [
    'You are the main agent of one Hive workspace: the only one who writes in this worktree and on',
    `its branch (${n.branch}). Do your part of the goal, nothing more.`,
    others.length
      ? `Other workspaces do the other parts: ${others.map((o) => `${o.id} (${o.title})`).join('; ')}.`
      : '',
    'Run `npm run check` until it passes, then commit on this branch. Never push, never switch',
    'branches, never touch another worktree. End with a short summary of what you did.',
  ].join('\n');
}

async function runNode(n) {
  ensureWorktree(n);
  if (n.phase === 'pending') n.phase = 'research';
  if (n.phase === 'research') {
    const r = await agent({
      role: 'researcher',
      node: n.id,
      round: 0,
      prompt: `The goal:\n\n${state.goal}\n\nThis workspace's part (${n.title}):\n${n.brief}\n\nResearch the repository for the main agent who will write it.`,
      cwd: n.worktree,
      system: [
        "You are a Hive workspace's researcher: read only. Find what the main agent needs: the files",
        'and functions to change or reuse, the conventions and tests to follow, traps in the brief.',
        "Don't write code or files. Answer in at most 400 words.",
      ].join('\n'),
      permissionMode: 'dontAsk',
      tools: READ_TOOLS,
      allowed: READ_ALLOWED,
    });
    n.research = r.text;
    n.phase = 'main';
    n.round = 1;
    save();
  }
  for (;;) {
    if (n.phase === 'main') {
      const before = git(n.worktree, ['rev-parse', 'HEAD']);
      n.roundStart = before;
      const last = n.reviews.at(-1);
      const lastCheck = n.checks.at(-1);
      const tests = (last?.tests ?? []).map((t) => `\`${t.file}\`:\n\`\`\`ts\n${t.text}\n\`\`\``).join('\n\n');
      let prompt;
      let resume;
      if (n.rebase && n.session) {
        resume = n.session;
        prompt = [
          n.rebase.why === 'conflict'
            ? 'Other workspaces were merged into `main` while you worked, and your branch no longer merges cleanly:'
            : 'Other workspaces were merged into `main` while you worked; merged with your branch, the check fails:',
          '```\n' + n.rebase.detail + '\n```',
          'Merge `main` into your branch (`git merge main`), resolve it keeping what both sides meant, run the check, commit the merge.',
        ].join('\n\n');
      } else if (n.session && n.round > 1 && !n.fresh) {
        resume = n.session;
        prompt = [
          `A clean-context reviewer read your change (round ${n.round - 1}).`,
          `Verdict: ${last?.verdict}. ${last?.summary ?? ''}`,
          `Findings:\n${(last?.findings ?? []).map((f) => `- [${f.severity}] ${f.path}${f.line ? `:${f.line}` : ''} ${f.text}`).join('\n') || '(none)'}`,
          `The check: ${lastCheck?.ok ? 'passed' : `failed:\n${lastCheck?.tail}`}`,
          tests ? `The reviewer's tests that fail on your branch (add them to test/ and make them pass, or say in one line why one is wrong):\n\n${tests}` : '',
          'Fix what is right in these findings; for one you reject, say why in one line. Run the check, commit.',
        ].join('\n\n');
      } else if (n.session && n.interrupted) {
        resume = n.session;
        prompt = 'You were interrupted. Continue the task where you stopped: finish it, run the check, commit.';
      } else {
        prompt = [
          `The goal:\n\n${state.goal}`,
          `This workspace's part (${n.title}):\n${n.brief}`,
          `The researcher's notes:\n${n.research ?? '(none)'}`,
        ].join('\n\n');
      }
      // A round's resume after a stop: the same feedback again; the round's first call: anew.
      if (!resume) n.session = randomUUID();
      n.interrupted = true;
      save();
      const firstPrompt = () =>
        [
          `The goal:\n\n${state.goal}`,
          `This workspace's part (${n.title}):\n${n.brief}`,
          `The researcher's notes:\n${n.research ?? '(none)'}`,
        ].join('\n\n');
      const r = await agentResumed(
        {
          role: 'main',
          node: n.id,
          round: n.round,
          prompt,
          resume,
          sessionId: n.session,
          cwd: n.worktree,
          system: mainSystem(n),
          permissionMode: 'bypassPermissions',
        },
        firstPrompt,
      );
      n.session = r.session;
      n.interrupted = false;
      n.fresh = false;
      n.rebase = undefined;
      const dirty = git(n.worktree, ['status', '--porcelain']);
      if (dirty) {
        event('uncommitted', { node: n.id, files: dirty.split('\n').length });
        git(n.worktree, ['add', '-A']);
        git(n.worktree, ['commit', '-qm', `${n.id}: work the agent left uncommitted (Hive)`]);
      }
      n.commits = Number(git(n.worktree, ['rev-list', '--count', `${before}..HEAD`]));
      n.phase = 'check';
      save();
    }
    if (n.phase === 'check') {
      const c = check(n.worktree);
      n.checks.push({ round: n.round, ok: c.ok, ms: c.ms, tail: c.ok ? '' : c.tail });
      event('check', { node: n.id, round: n.round, ok: c.ok, ms: c.ms });
      n.phase = 'review';
      save();
    }
    if (n.phase === 'review' && state.review === 'probe') {
      const review = await probeReview(n);
      n.reviews.push({ round: n.round, ...review });
      n.phase = 'decide';
      save();
    }
    if (n.phase === 'review') {
      const diff = git(n.worktree, ['diff', `${n.forkBase}..HEAD`]);
      const graph = symbioteDiff(n.worktree, n.forkBase);
      const c = n.checks.at(-1);
      const r = await agent({
        role: 'reviewer',
        node: n.id,
        round: n.round,
        prompt: [
          `The brief:\n${n.title}\n${n.brief}`,
          `The change (git diff ${n.forkBase.slice(0, 7)}..HEAD):\n\`\`\`diff\n${diff.slice(0, 60_000)}\n\`\`\``,
          `Symbiote's review graph of it (changed symbols, who uses them, findings):\n${graph}`,
          `The check (npm run check): ${c?.ok ? 'passed' : `failed:\n${c?.tail}`}`,
        ].join('\n\n'),
        cwd: n.worktree,
        system: [
          'You review one change with a clean context: you see the brief, the diff and Symbiote\'s',
          'graph, and you may read the repository (read only). Report only real defects: wrong or',
          'missing behaviour the brief asks for, bugs, a failing check. Each with its path and line.',
          'blocker: the brief is not met, a crash, the check fails. major: a real bug in a case the',
          'brief covers. minor: anything else worth fixing. Verdict approve when there is no blocker',
          'or major. No style opinions, no praise.',
        ].join('\n'),
        permissionMode: 'dontAsk',
        tools: READ_TOOLS,
        allowed: READ_ALLOWED,
        schema: REVIEW_SCHEMA,
      });
      const review = r.structured ?? { verdict: 'changes', summary: 'no verdict', findings: [] };
      n.reviews.push({ round: n.round, ...review });
      n.phase = 'decide';
      save();
    }
    if (n.phase === 'decide') {
      const c = n.checks.at(-1);
      const review = n.reviews.at(-1);
      const prev = n.progress.at(-1);
      const b = blocking(review);
      const progressed =
        n.round === 1 || (n.commits > 0 && (b < (prev?.blocking ?? Infinity) || (c?.ok && !prev?.check)));
      n.progress.push({ round: n.round, commits: n.commits, check: c?.ok ?? false, blocking: b, progressed });
      event('review', { node: n.id, round: n.round, verdict: review.verdict, blocking: b, findings: review.findings.length });
      save();

      if (review.verdict === 'approve' && b === 0 && c?.ok) {
        n.phase = 'approved';
        save();
        return;
      }
      const stalled = n.progress.slice(-STALL_ROUNDS).filter((p) => !p.progressed).length === STALL_ROUNDS;
      if (stalled && n.replans < MAX_REPLANS) {
        n.replans++;
        const d = await replan(n);
        if (d.action === 'retry' && d.brief) {
          n.brief = d.brief;
          n.fresh = true;
          n.session = undefined;
          n.progress.push({ round: n.round, replanned: true, progressed: true });
          n.roundBase = n.round;
          n.round++;
          n.phase = 'main';
          save();
          continue;
        }
        n.phase = 'needs-person';
        n.note = `stopped by the orchestrator: ${d.note}`;
        gate('stuck', n);
        save();
        return;
      }
      if (n.round - (n.roundBase ?? 0) >= ROUND_CAP) {
        if (c?.ok && b === 0) {
          n.phase = 'approved';
          n.note = 'approved at the round cap with minor findings left';
        } else {
          n.phase = 'needs-person';
          n.note = `round cap (${ROUND_CAP}) reached: ${b} blocking findings, check ${c?.ok ? 'passing' : 'failing'}`;
          gate('round-cap', n);
        }
        save();
        return;
      }
      n.round++;
      n.phase = 'main';
      save();
    }
  }
}

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          path: { type: 'string' },
          text: { type: 'string' },
          test: { type: 'string' },
        },
        required: ['severity', 'path', 'text', 'test'],
      },
    },
  },
  required: ['summary', 'findings'],
};

/**
 * A reviewer that runs code: a clean context in a throwaway worktree at the branch's tip, free to
 * write and run tests there, reporting only defects a failing test of its shows. The runner then
 * runs those tests itself: a finding counts only when its test fails. Nothing reaches the branch.
 */
async function probeReview(n) {
  const dir = join(RUN, 'probes', `${n.id}-r${n.round}`);
  git(state.repo, ['worktree', 'add', '--detach', dir, n.branch]);
  const diff = git(dir, ['diff', `${n.forkBase}..HEAD`]);
  const c = n.checks.at(-1);
  const r = await agent({
    role: 'reviewer',
    node: n.id,
    round: n.round,
    prompt: [
      `The brief:\n${n.title}\n${n.brief}`,
      `The change (git diff ${n.forkBase.slice(0, 7)}..HEAD):\n\`\`\`diff\n${diff.slice(0, 60_000)}\n\`\`\``,
      `The check (npm run check): ${c?.ok ? 'passed' : `failed:\n${c?.tail}`}`,
      'This folder is a throwaway copy: change nothing in src/. Find where the change is wrong by',
      'running it: write vitest tests in test/probe-*.test.ts, each a real case the brief covers,',
      'and run them. Report only defects a test of yours shows failing, each with the test. A defect',
      'you only suspect, or a case the brief does not cover, is not a finding. Keep the failing',
      'tests; delete the passing ones.',
    ].join('\n\n'),
    cwd: dir,
    system: "You review one change with a clean context, by running it in a throwaway copy.",
    permissionMode: 'bypassPermissions',
    schema: PROBE_SCHEMA,
  });
  const files = existsSync(join(dir, 'test'))
    ? readdirSync(join(dir, 'test')).filter((f) => /^probe-.*\.test\.ts$/.test(f))
    : [];
  const report = join(dir, 'probe-report.json');
  spawnSync('npx', ['vitest', 'run', ...files.map((f) => `test/${f}`), '--reporter=json', `--outputFile=${report}`], { cwd: dir, encoding: 'utf8' });
  let failed = [];
  try {
    failed = JSON.parse(readFileSync(report, 'utf8'))
      .testResults.flatMap((f) => f.assertionResults)
      .filter((a) => a.status === 'failed')
      .map((a) => a.fullName ?? a.title);
  } catch {
    failed = [];
  }
  const tests = failed.length
    ? files.map((file) => ({ file: `test/${file}`, text: readFileSync(join(dir, 'test', file), 'utf8') }))
    : [];
  const findings = failed.length
    ? (r.structured?.findings ?? []).map((f) => ({ ...f, severity: f.severity === 'minor' ? 'minor' : f.severity }))
    : [];
  git(state.repo, ['worktree', 'remove', '--force', dir], { allowFail: true });
  event('probe', { node: n.id, round: n.round, tests: files.length, failing: failed.length });
  return {
    verdict: failed.length ? 'changes' : 'approve',
    summary: r.structured?.summary ?? r.text.slice(0, 500),
    findings: failed.length && !findings.some((f) => f.severity !== 'minor')
      ? [...findings, { severity: 'major', path: 'test', text: `failing: ${failed.join('; ')}` }]
      : findings,
    failing: failed,
    tests,
  };
}

/** A stop for the person. In the spike `land` is approved automatically (the person's answer). */
function gate(kind, n) {
  const auto = kind === 'land';
  state.gates.push({ kind, node: n.id, at: now(), auto });
  event('gate', { kind, node: n.id, auto });
}

// ---------------------------------------------------------------------------------------------
// Merges: in dependency order, one at a time, through a merge worktree

const node = (id) => state.nodes.find((n) => n.id === id);

function mergeNode(n) {
  gate('land', n);
  const wt = join(RUN, 'merge');
  if (!existsSync(wt)) git(state.repo, ['worktree', 'add', '--detach', wt, 'main']);
  git(wt, ['checkout', '-q', '--detach', 'main']);
  const m = git(wt, ['merge', '--no-ff', n.branch, '-m', `Merge ${n.id}: ${n.title}`], { allowFail: true });
  if (m.status !== 0) {
    git(wt, ['merge', '--abort'], { allowFail: true });
    return backToWriter(n, 'conflict', m.stdout.trim().slice(-1500));
  }
  const c = check(wt);
  event('merge-check', { node: n.id, ok: c.ok, ms: c.ms });
  if (!c.ok) return backToWriter(n, 'merge-check', c.tail);
  const sha = git(wt, ['rev-parse', 'HEAD']);
  git(state.repo, ['merge', '--ff-only', '-q', sha]);
  n.phase = 'merged';
  n.merged = sha;
  state.merges.push({ node: n.id, sha, at: now() });
  event('merged', { node: n.id, sha: sha.slice(0, 7) });
  save();
}

/**
 * `main` moved under an approved workspace (another one merged): its own writer merges `main`
 * into its branch and resolves it, then the check and a review again; twice at most, then the
 * person.
 */
function backToWriter(n, why, detail) {
  n.rebases = (n.rebases ?? 0) + 1;
  event(why, { node: n.id, times: n.rebases });
  if (n.rebases > 2) {
    n.phase = 'needs-person';
    n.note = `${why} after ${n.rebases - 1} merges of main: ${detail.slice(-300)}`;
    gate(why, n);
    save();
    return;
  }
  n.rebase = { why, detail };
  n.roundBase = n.round;
  n.round++;
  n.phase = 'main';
  save();
}

// ---------------------------------------------------------------------------------------------
// Modes

async function graph() {
  if (!state.nodes.length) {
    await plan();
    save();
  }
  const active = new Map();
  const done = (n) => n.phase === 'merged';
  const stuck = (n) => n.phase === 'needs-person';
  for (;;) {
    let changed = false;
    for (const n of state.nodes) {
      if (active.has(n.id) || done(n) || stuck(n)) continue;
      const deps = n.deps.map(node);
      if (deps.some(stuck)) {
        n.phase = 'needs-person';
        n.note = 'a workspace it depends on stopped';
        save();
        continue;
      }
      if (n.phase === 'approved') continue;
      const ready = deps.every((d) => d.phase === 'approved' || done(d));
      const fromOne = deps.length <= 1 || deps.every(done);
      if (ready && fromOne) {
        active.set(n.id, runNode(n).finally(() => active.delete(n.id)));
        changed = true;
      }
    }
    // Merge, in dependency order, every approved workspace whose dependencies are merged.
    for (const n of state.nodes) {
      if (n.phase === 'approved' && n.deps.map(node).every(done)) {
        mergeNode(n);
        changed = true;
      }
    }
    if (state.nodes.every((n) => done(n) || stuck(n))) break;
    if (!active.size) {
      if (changed) continue;
      break;
    }
    await Promise.race(active.values());
  }
}

async function single() {
  if (!state.nodes.length) {
    state.nodes = [newNode({ id: 'goal', title: 'the whole goal', brief: state.goal, deps: [] })];
    save();
  }
  const n = state.nodes[0];
  if (state.mode === 'loop') {
    await runNode(n);
  } else {
    ensureWorktree(n);
    if (n.phase === 'pending' || n.phase === 'main') {
      n.phase = 'main';
      const resume = n.session && n.interrupted ? n.session : undefined;
      if (!resume) n.session = randomUUID();
      n.interrupted = true;
      save();
      const r = await agentResumed({
        role: state.mode === 'subagents' ? 'main' : 'one',
        profileRole: 'one',
        node: n.id,
        round: 1,
        resume,
        prompt: resume
          ? 'You were interrupted. Continue the task where you stopped: finish it, run the check, commit.'
          : `The goal:\n\n${state.goal}`,
        cwd: n.worktree,
        system: state.mode === 'subagents' ? SUBAGENTS_SYSTEM : ONE_SYSTEM,
        sessionId: n.session,
        permissionMode: 'bypassPermissions',
        ...(state.mode === 'subagents' ? { agents: subagents() } : {}),
      }, () => `The goal:\n\n${state.goal}`);
      n.session = r.session;
      n.interrupted = false;
      const dirty = git(n.worktree, ['status', '--porcelain']);
      if (dirty) {
        event('uncommitted', { node: n.id, files: dirty.split('\n').length });
        git(n.worktree, ['add', '-A']);
        git(n.worktree, ['commit', '-qm', 'work the agent left uncommitted (Hive)']);
      }
      n.phase = 'check';
      save();
    }
    if (n.phase === 'check') {
      const c = check(n.worktree);
      n.checks.push({ round: 1, ok: c.ok, ms: c.ms, tail: c.ok ? '' : c.tail });
      event('check', { node: n.id, ok: c.ok });
      n.phase = 'approved';
      save();
    }
  }
  if (n.phase === 'approved') mergeNode(n);
}

const ONE_SYSTEM = [
  'You are the one agent working on this goal, in this worktree and on its branch. Do the goal.',
  'Run `npm run check` until it passes, then commit. Never push, never switch branches.',
  'End with a short summary of what you did.',
].join('\n');

const SUBAGENTS_SYSTEM = [
  'You are the main agent of a Hive workspace: the only one who writes. You have two subagents:',
  'researcher (read only) and reviewer (read only, clean context). First ask the researcher what',
  'you need to know. Write the change; run `npm run check` until it passes; commit. Then ask the',
  'reviewer to review the diff of this branch against where it started (give it the brief and',
  'the base commit, nothing else); fix what is right; at most 3 review rounds. Never push.',
].join('\n');

function subagents() {
  const sonnet = PROFILES[state.profile].researcher.model;
  const reviewer = PROFILES[state.profile].reviewer.model;
  return {
    researcher: {
      description: 'Reads the repository and reports what the main agent needs: files, conventions, tests, traps. Read only.',
      prompt: "You are a Hive workspace's researcher: read only. Find the files and functions to change or reuse, the conventions and tests to follow, traps in the brief. Answer in at most 400 words.",
      tools: ['Read', 'Grep', 'Glob'],
      model: sonnet,
    },
    reviewer: {
      description: "Reviews the branch's change with a clean context against the brief. Read only.",
      prompt: 'You review one change with a clean context: read the brief you are given and the diff (git diff <base>..HEAD). Report only real defects (blocker: the brief not met, a crash, the check fails; major: a real bug in a case the brief covers; minor: anything else worth fixing), each with path and line. Verdict approve when there is no blocker or major. No style opinions.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      model: reviewer,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Commands

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  const command = a._[0];
  RUN = resolve(a.run ?? '');
  if (!a.run) throw new Error('--run <dir>');
  if (command === 'off') {
    state = JSON.parse(readFileSync(join(RUN, 'state.json'), 'utf8'));
    setHive(false);
    console.log('Hive off');
    return;
  }
  if (command === 'on') {
    state = JSON.parse(readFileSync(join(RUN, 'state.json'), 'utf8'));
    setHive(true);
    console.log('Hive on');
    return;
  }
  if (command === 'start') {
    mkdirSync(RUN, { recursive: true });
    const repo = join(RUN, 'repo');
    git(RUN, ['clone', '-q', resolve(a.template), repo]);
    git(repo, ['config', 'user.name', 'Hive Spike']);
    git(repo, ['config', 'user.email', 'hive-spike@example.invalid']);
    state = {
      version: 1,
      mode: a.mode ?? 'graph',
      profile: a.profile ?? 'real',
      ...(a.fake ? { fake: a.fake } : {}),
      ...(a.review ? { review: a.review } : {}),
      goal: readFileSync(a.goal, 'utf8'),
      goalFile: resolve(a.goal),
      template: resolve(a.template),
      repo,
      base: git(repo, ['rev-parse', 'HEAD']),
      status: 'running',
      started: now(),
      ledger: null,
      nodes: [],
      merges: [],
      gates: [],
      calls: [],
      runs: [],
    };
    setHive(true);
  } else if (command === 'resume') {
    state = JSON.parse(readFileSync(join(RUN, 'state.json'), 'utf8'));
    if (!hiveOn()) throw new Error('Hive is off: turn it on first (node hive.mjs on --run …)');
    for (const c of state.calls) {
      if (c.pid && !c.ended) {
        killGroup(c.pid, 'SIGTERM');
        c.ended = now();
        c.exit = 'lost';
        delete c.pid;
      }
    }
    state.status = 'running';
    event('resume', { phases: state.nodes.map((n) => `${n.id}:${n.phase}`).join(' ') });
  } else {
    throw new Error('start | resume | off | on');
  }
  state.runs.push({ pid: process.pid, started: now(), windows: await windows() });
  save();
  watchSwitch();
  event('run', { mode: state.mode, profile: state.profile, fake: state.fake ?? '' });
  if (state.mode === 'graph') await graph();
  else await single();
  state.status = state.nodes.every((n) => n.phase === 'merged') ? 'done' : 'needs-person';
  state.finished = now();
  state.runs.at(-1).ended = now();
  usageRead = null;
  state.runs.at(-1).windowsAfter = await windows();
  save();
  event('finished', {
    status: state.status,
    cost: state.calls.reduce((s, c) => s + (c.cost ?? 0), 0).toFixed(2),
  });
}

main().catch((error) => {
  console.error(error);
  if (state && RUN) {
    state.status = 'failed';
    state.error = String(error?.stack ?? error);
    save();
  }
  process.exit(1);
});
