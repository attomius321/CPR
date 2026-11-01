// AR1: every workspace of a repository as one normalized record, from Symbiote's own files.
// Reads (never writes) <repo>/symbiote/{workspaces,threads,activity,reviews,hive}, Claude Code's
// transcripts summary (transcripts.mjs's output) and Symbiote's logs (merges, Hive).
// Usage: node load.mjs <repo root> <transcripts.json> <out.json>
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { usd } from './price-table.mjs';

const [repo, transcriptsFile, out, cutoff = '9999'] = process.argv.slice(2);
// Records up to `cutoff` (ISO time) only: the person's export was taken at 2026-11-01T08:09:44Z.
const upTo = (list, key = 'at') => list.filter((x) => !x[key] || x[key] <= cutoff);
const sym = join(repo, 'symbiote');
const transcripts = JSON.parse(readFileSync(transcriptsFile, 'utf8'));

const jsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];
function walk(dir, ext) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) found.push(...walk(p, ext));
    else if (f.endsWith(ext)) found.push(p);
  }
  return found;
}
const branchOf = (dir, file, ext) => relative(dir, file).slice(0, -ext.length);

/** What sent a `prompt` line: Symbiote (its templates), a background task, or the person. */
export function promptKind(text) {
  const t = text.trimStart();
  if (/^You are starting a new (feature|fix|refactor|chore|spike|milestone)/.test(t)) return 'start';
  if (/^Symbiote ran the check on /.test(t)) return 'hive.check';
  if (/^A reviewer with a clean context ran your change/.test(t)) return 'hive.review';
  if (/^You ended your turn with /.test(t)) return 'hive.commit';
  if (/^You were stopped mid-turn: Hive was turned off/.test(t)) return 'hive.resume';
  if (/^Approved the branch .* Symbiote merges/.test(t)) return 'verdict.approve';
  if (/^Approved the unpushed commits/.test(t)) return 'verdict.push';
  if (/^Address this review of the branch/.test(t)) return 'verdict.address';
  if (/^<task-notification>/.test(t)) return 'task';
  return 'person';
}

const DAY = 864e5;
const ms = (a, b) => new Date(b).getTime() - new Date(a).getTime();

// The project's check commands (merge.checks), to find the writer's own full runs.
let checks = [];
try {
  checks = JSON.parse(readFileSync(join(sym, 'config.json'), 'utf8')).merge?.checks ?? [];
} catch {}

// Symbiote's logs: merges and Hive, by branch (logs from 2026-10-25).
const logDir = join(homedir(), '.cache', 'symbiote', 'logs');
const logs = existsSync(logDir) ? readdirSync(logDir).flatMap((f) => jsonl(join(logDir, f))) : [];
const mergeLog = {};
for (const l of logs) if (/^merge /.test(l.msg ?? '') && l.branch) if (l.time <= cutoff) (mergeLog[l.branch] ??= []).push({ at: l.time, state: l.state });

const records = {};
for (const f of walk(join(sym, 'workspaces'), '.json')) {
  const b = branchOf(join(sym, 'workspaces'), f, '.json');
  records[b] = JSON.parse(readFileSync(f, 'utf8'));
}
const branches = new Set([
  ...Object.keys(records),
  ...walk(join(sym, 'threads'), '.jsonl').map((f) => branchOf(join(sym, 'threads'), f, '.jsonl')),
]);

const result = [];
for (const branch of [...branches].sort()) {
  const rec = records[branch] ?? null;
  if (rec?.created && rec.created > cutoff) continue; // started after the export
  const thread = upTo(jsonl(join(sym, 'threads', `${branch}.jsonl`))).sort((a, b) => (a.at < b.at ? -1 : 1));
  const activity = upTo(jsonl(join(sym, 'activity', `${branch}.jsonl`)));
  const hive = upTo(jsonl(join(sym, 'hive', `${branch}.jsonl`)));
  const reviewDir = join(sym, 'reviews', branch);
  const verdicts = existsSync(reviewDir)
    ? readdirSync(reviewDir)
        .filter((f) => f.endsWith('.json'))
        .flatMap((f) => upTo(JSON.parse(readFileSync(join(reviewDir, f), 'utf8')).verdicts ?? []))
    : [];

  // Calls: start and end by id.
  const calls = new Map();
  for (const a of activity) {
    const c = calls.get(a.id) ?? { id: a.id, tool: a.tool };
    if (a.phase === 'start') Object.assign(c, { at: a.at, input: a.input ?? a.subject, about: a.about, task: a.task });
    else Object.assign(c, { endAt: a.at, ms: a.ms, failed: !!a.failed, exit: a.exit, output: a.output, background: a.background });
    calls.set(a.id, c);
  }
  const callList = [...calls.values()];
  // A background call's time: to its task notification (Claude Code names the call's id there).
  for (const e of thread) {
    if (e.kind !== 'prompt' || !e.text.startsWith('<task-notification>')) continue;
    const id = /<tool-use-id>([^<]+)</.exec(e.text)?.[1];
    const c = id && calls.get(id);
    if (c && c.at && !c.doneAt) {
      c.doneAt = e.at;
      c.doneStatus = /<status>([^<]+)</.exec(e.text)?.[1];
      c.doneExit = /exit code (\d+)/.exec(e.text)?.[1];
    }
  }
  const took = (c) => (c.doneAt ? ms(c.at, c.doneAt) : c.background ? null : c.ms ?? null);

  // Messages, turns and waits.
  const events = thread.map((e) => (e.kind === 'prompt' ? { ...e, from: promptKind(e.text) } : e));
  const msgs = {};
  for (const e of events) if (e.kind === 'prompt') msgs[e.from] = (msgs[e.from] ?? 0) + 1;
  const reports = events.filter((e) => e.kind === 'report');
  const personMsgs = events.filter((e) => e.kind === 'prompt' && e.from === 'person');
  // The person's reply time: from a report to the next prompt the person typed (not Hive's, a
  // verdict's or a task's), when it comes within a day; gaps over a day are "left".
  const waits = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind !== 'report') continue;
    const next = events.slice(i + 1).find((x) => x.kind === 'prompt' || x.kind === 'report');
    if (!next || next.kind !== 'prompt') continue;
    waits.push({ at: e.at, ms: ms(e.at, next.at), to: next.from });
  }
  // Turns: a prompt to the report that ends it.
  const turns = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind !== 'prompt') continue;
    const end = events.slice(i + 1).find((x) => x.kind === 'report' || x.kind === 'prompt');
    if (end?.kind === 'report') turns.push({ at: e.at, ms: ms(e.at, end.at), from: e.from });
  }
  const notices = events.filter((e) => e.kind === 'notice');
  // A permission prompt's wait: to the next call that ended or the next event after it.
  const permissionWaits = notices
    .filter((n) => n.type === 'permission_prompt')
    .map((n) => {
      const after = callList.filter((c) => c.endAt && c.endAt > n.at).sort((a, b) => (a.endAt < b.endAt ? -1 : 1))[0];
      return { at: n.at, ms: after ? ms(n.at, after.endAt) : null };
    });
  const asks = events.filter((e) => e.kind === 'asks').map((e) => ({ at: e.at, tool: e.tool, input: e.input, questions: e.questions ? e.questions.length ?? 1 : undefined }));
  const starts = events.filter((e) => e.kind === 'start').map((e) => e.source);
  const ends = events.filter((e) => e.kind === 'end').map((e) => e.reason);

  // The writer's own runs of the project's check: a command holding a check command's words.
  // The whole end-to-end suite: `test:e2e`, or `playwright test` with no file, grep or project.
  const fullSuite = (input) =>
    /\btest:e2e\b|\bplaywright test\b/.test(input) && !/--grep|\s-g\s|\.spec\.ts|--project|probe|--last-failed|--repeat/.test(input);
  const fullCheck = (input) => /\bpnpm (run )?check\b/.test(input);
  const checkLike = (input) => /\bpnpm (check|test:e2e|build)\b|\bplaywright test\b|\bvitest run\b/.test(input);
  const bash = callList.filter((c) => c.tool === 'Bash' && typeof c.input === 'string');
  const suiteRuns = bash.filter((c) => fullSuite(c.input));
  const fullChecks = bash.filter((c) => fullCheck(c.input));
  const checkRuns = bash.filter((c) => checkLike(c.input));

  // Transcripts: the worktree's folder, dashed.
  const wt = rec?.worktree ?? '';
  const tdir = wt.replace(/[^A-Za-z0-9]/g, '-');
  const tr = transcripts[tdir] ?? null;
  let cost = null;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  if (tr) {
    // Dollars from the requests up to the cutoff; tokens over the whole transcript.
    cost = tr.requests.filter(([at]) => at <= cutoff).reduce((s, [, c]) => s + c, 0);
    for (const [m, u] of Object.entries(tr.models)) {
      tokens.input += u.input;
      tokens.output += u.output;
      tokens.cacheRead += u.cacheRead;
      tokens.cacheWrite += u.cacheWrite5m + u.cacheWrite1h;
    }
  }
  const first = events[0]?.at ?? rec?.created ?? null;
  const last = events.at(-1)?.at ?? null;

  result.push({
    branch,
    kind: rec?.kind ?? branch.split('/')[0],
    agent: rec?.agent?.kind ?? null,
    model: rec?.agent?.model ?? null,
    effort: rec?.agent?.effort ?? null,
    permissionMode: rec?.agent?.permissionMode ?? null,
    planFirst: rec?.planFirst ?? null,
    via: rec?.via ?? null,
    hive: !!rec?.hive || hive.length > 0,
    created: rec?.created ?? first,
    finished: rec?.finished ?? null,
    brief: rec?.brief ?? null,
    first,
    last,
    hasCalls: activity.length > 0,
    worktreeDir: tdir,
    msgs,
    reports: reports.length,
    personMsgs: personMsgs.map((p) => ({ at: p.at, text: p.text.slice(0, 600) })),
    reportTexts: reports.map((r) => ({ at: r.at, text: r.text })),
    waits,
    turns,
    idleNotices: notices.filter((n) => n.type === 'idle_prompt').length,
    permissionNotices: permissionWaits,
    asks,
    starts,
    ends,
    calls: callList.length,
    failed: callList.filter((c) => c.failed).map((c) => ({ at: c.at, tool: c.tool, exit: c.exit, ms: c.ms, input: String(c.input ?? '').slice(0, 400), output: String(c.output ?? '').slice(0, 1200) })),
    byTool: callList.reduce((m, c) => ((m[c.tool] = (m[c.tool] ?? 0) + 1), m), {}),
    bashMs: bash.reduce((s, c) => s + (c.ms ?? 0), 0),
    suiteRuns: suiteRuns.map((c) => ({ at: c.at, ms: took(c), background: !!c.background || !!c.doneAt, exit: c.doneExit ?? c.exit ?? null, input: c.input.slice(0, 200) })),
    fullChecks: fullChecks.map((c) => ({ at: c.at, ms: took(c), input: c.input.slice(0, 120) })),
    checkRuns: checkRuns.length,
    checkRunsMs: checkRuns.reduce((s, c) => s + (took(c) ?? 0), 0),
    commitsAt: callList.filter((c) => c.tool === 'Bash' && /\bgit commit\b/.test(c.input ?? '') && !c.failed).map((c) => c.at),
    verdicts: verdicts.map((v) => ({ at: v.at, event: v.event, via: v.via, comments: v.comments?.length ?? 0 })),
    merges: mergeLog[branch] ?? [],
    hiveSteps: hive,
    transcript: tr
      ? { sessions: tr.sessions, subagents: tr.subagentSessions, models: Object.keys(tr.models), efforts: tr.efforts, interrupted: tr.interrupted + tr.interruptedTool, compactions: tr.compactions, apiErrors: tr.apiErrors, maxContext: tr.maxContext, tokens, cost }
      : null,
  });
}
writeFileSync(out, JSON.stringify({ repo, checks, workspaces: result }, null, 1));
console.log(result.length, 'workspaces;', result.filter((w) => w.hasCalls).length, 'with calls;', result.filter((w) => w.transcript).length, 'with transcripts');
