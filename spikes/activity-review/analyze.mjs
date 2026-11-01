// AR1: the counts by kind, from load.mjs's output. Prints Markdown tables.
// Usage: node analyze.mjs <load output.json> [exclude-branch...]
import { readFileSync } from 'node:fs';

const [file, ...exclude] = process.argv.slice(2);
const { workspaces: all, checks } = JSON.parse(readFileSync(file, 'utf8'));
const ws = all.filter((w) => !exclude.includes(w.branch) && w.first);
const min = (ms) => ms / 6e4;
const h = (ms) => (ms / 36e5).toFixed(1);
const sum = (xs, f = (x) => x) => xs.reduce((s, x) => s + (f(x) || 0), 0);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '–');
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(p * (s.length - 1))] : null;
};
const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const out = [];
const say = (...x) => out.push(x.join(' '));

const withCalls = ws.filter((w) => w.hasCalls);
say(`## Workspaces\n`);
say(`${ws.length} workspaces, ${withCalls.length} with calls recorded (from ${withCalls.map((w) => w.first).sort()[0]?.slice(0, 16)}); first ${ws.map((w) => w.first).sort()[0]?.slice(0, 10)}, last ${ws.map((w) => w.last).sort().at(-1)?.slice(0, 16)}.\n`);
say(table(['by', 'counts'], [
  ['kind', JSON.stringify(count(ws, (w) => w.kind))],
  ['agent', JSON.stringify(count(ws, (w) => w.agent))],
  ['model (record)', JSON.stringify(count(ws, (w) => w.model ?? 'default'))],
  ['model (transcript)', JSON.stringify(count(ws.filter((w) => w.transcript), (w) => w.transcript.models.join('+')))],
  ['effort', JSON.stringify(count(ws, (w) => w.effort ?? 'default'))],
  ['permission mode', JSON.stringify(count(ws, (w) => w.permissionMode ?? '-'))],
  ['plan first', JSON.stringify(count(ws, (w) => String(w.planFirst)))],
  ['started via', JSON.stringify(count(ws, (w) => w.via ?? 'the person'))],
  ['Hive drove it', JSON.stringify(count(ws, (w) => String(w.hive)))],
]));

// Cost and tokens.
const tr = ws.filter((w) => w.transcript);
const costs = tr.map((w) => w.transcript.cost);
say(`\n## Tokens and API-equivalent cost (transcripts)\n`);
say(`${tr.length} workspaces with transcripts. Total $${sum(costs).toFixed(0)}; median $${median(costs).toFixed(2)}, p90 $${q(costs, 0.9).toFixed(2)}, max $${Math.max(...costs).toFixed(2)}.`);
const tok = (k) => sum(tr, (w) => w.transcript.tokens[k]);
say(`Tokens: input ${tok('input')}, cache read ${tok('cacheRead')}, cache write ${tok('cacheWrite')}, output ${tok('output')}. Cache reads are ${pct(tok('cacheRead'), tok('input') + tok('cacheRead') + tok('cacheWrite'))} of input-side tokens.`);
say(`Max context of one request: median ${median(tr.map((w) => w.transcript.maxContext))}, max ${Math.max(...tr.map((w) => w.transcript.maxContext))}.`);
const byKey = (f) => {
  const g = {};
  for (const w of tr) (g[f(w)] ??= []).push(w.transcript.cost);
  return Object.entries(g).map(([k, v]) => [k, v.length, `$${sum(v).toFixed(0)}`, `$${median(v).toFixed(2)}`]);
};
say(table(['effort', 'workspaces', 'total', 'median'], byKey((w) => w.effort ?? 'default')));
say('');
say(table(['kind', 'workspaces', 'total', 'median'], byKey((w) => w.kind)));
say('');
say(table(['top workspaces by cost', 'kind', 'effort', 'cost', 'commits?'], [...tr].sort((a, b) => b.transcript.cost - a.transcript.cost).slice(0, 12).map((w) => [w.branch, w.kind, w.effort ?? '-', `$${w.transcript.cost.toFixed(2)}`, ''])));
say(`\nSubagent sessions: ${sum(tr, (w) => w.transcript.subagents)} in ${tr.filter((w) => w.transcript.subagents).length} workspaces. Interrupted turns: ${sum(tr, (w) => w.transcript.interrupted)}. Compactions: ${sum(tr, (w) => w.transcript.compactions)}. API errors: ${sum(tr, (w) => w.transcript.apiErrors)}.`);

// Calls.
say(`\n## Calls (${withCalls.length} workspaces)\n`);
const tools = {};
for (const w of withCalls) for (const [t, n] of Object.entries(w.byTool)) tools[t] = (tools[t] ?? 0) + n;
const totalCalls = sum(withCalls, (w) => w.calls);
say(`${totalCalls} calls; ${sum(withCalls, (w) => w.failed.length)} failed (${pct(sum(withCalls, (w) => w.failed.length), totalCalls)}).`);
say(table(['tool', 'calls'], Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([t, n]) => [t, n])));

// Failed calls by cause.
const causes = [
  ['the edit target was not found or not read first', (f) => /String to replace not found|File has not been read yet|has been modified since read|not been read/i.test(f.output)],
  ['a test or check failed', (f) => /\b(\d+ failed|FAIL |Tests? failed|AssertionError|expect\(|ELIFECYCLE|ERR_PNPM_RECURSIVE_RUN|error TS\d+|eslint|Prettier|Code style issues|\[warn\])/i.test(f.output)],
  ['a timeout', (f) => /timed? ?out|Timeout/i.test(f.output)],
  ['a command or path not found', (f) => /command not found|No such file|ENOENT|cannot access|not found/i.test(f.output)],
  ['git refused', (f) => /^fatal:|error: |CONFLICT|not a git repository/m.test(f.output) && /\bgit\b/.test(f.input)],
  ['grep or test found nothing (exit 1, no output)', (f) => f.exit === 1 && f.output.trim() === ''],
  ['permission or sandbox refused', (f) => /permission|denied|not allowed|refused/i.test(f.output)],
  ['killed or stopped', (f) => /killed|Interrupted|SIGTERM|stopped/i.test(f.output)],
];
const failed = withCalls.flatMap((w) => w.failed.map((f) => ({ ...f, branch: w.branch })));
const byCause = {};
for (const f of failed) {
  const c = causes.find(([, test]) => test(f))?.[0] ?? 'other';
  (byCause[c] ??= []).push(f);
}
say('');
say(table(['failed calls by cause', 'count', 'tools', 'workspaces'], Object.entries(byCause).sort((a, b) => b[1].length - a[1].length).map(([c, fs]) => [c, fs.length, JSON.stringify(count(fs, (f) => f.tool)), new Set(fs.map((f) => f.branch)).size])));

// Waits for the person.
say(`\n## Waits for the person\n`);
const waits = ws.flatMap((w) => w.waits.filter((x) => x.to === 'person').map((x) => ({ ...x, branch: w.branch })));
const within = waits.filter((x) => x.ms < 864e5);
const buckets = { '< 1 min': 0, '1–10 min': 0, '10–60 min': 0, '1–24 h': 0, '> 1 day': 0 };
for (const x of waits) {
  const m = min(x.ms);
  buckets[m < 1 ? '< 1 min' : m < 10 ? '1–10 min' : m < 60 ? '10–60 min' : m < 1440 ? '1–24 h' : '> 1 day']++;
}
say(`From a report to the person's next message: ${waits.length} times; median ${min(median(waits.map((x) => x.ms))).toFixed(1)} min; within a day ${within.length}, summing ${h(sum(within, (x) => x.ms))} h. ${JSON.stringify(buckets)}`);
const turns = ws.flatMap((w) => w.turns);
say(`Turns (a prompt to its report): ${turns.length}; median ${min(median(turns.map((t) => t.ms))).toFixed(1)} min; p90 ${min(q(turns.map((t) => t.ms), 0.9)).toFixed(1)} min; total ${h(sum(turns, (t) => t.ms))} h. By sender: ${JSON.stringify(count(turns, (t) => t.from))}`);
const perm = ws.flatMap((w) => w.permissionNotices.map((p) => ({ ...p, branch: w.branch })));
say(`Permission prompts (notices): ${perm.length} in ${new Set(perm.map((p) => p.branch)).size} workspaces; answered (next call ended) median ${perm.filter((p) => p.ms != null).length ? (median(perm.filter((p) => p.ms != null).map((p) => p.ms)) / 1000).toFixed(0) : '–'} s; sum ${h(sum(perm, (p) => p.ms ?? 0))} h.`);
const asks = ws.flatMap((w) => w.asks.map((a) => ({ ...a, branch: w.branch })));
say(`Asked (hooks' PermissionRequest/AskUserQuestion): ${JSON.stringify(count(asks, (a) => a.tool))}.`);
say(table(['asked for', 'workspace', 'when', 'input'], asks.filter((a) => a.tool !== 'AskUserQuestion').map((a) => [a.tool, a.branch, a.at.slice(0, 16), '`' + String(a.input ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 90) + '`'])));
say(`\nIdle notices ("waiting for your input"): ${sum(ws, (w) => w.idleNotices)}.`);

// Sessions.
say(`\n## Sessions\n`);
say(`Starts: ${JSON.stringify(count(ws.flatMap((w) => w.starts), (s) => s))}; ends: ${JSON.stringify(count(ws.flatMap((w) => w.ends), (s) => s))}. Workspaces resumed at least once: ${ws.filter((w) => w.starts.includes('resume')).length}.`);
say(`Messages by sender: ${JSON.stringify(ws.reduce((m, w) => { for (const [k, v] of Object.entries(w.msgs)) m[k] = (m[k] ?? 0) + v; return m; }, {}))}; reports ${sum(ws, (w) => w.reports)}.`);

// The check, run by the writer.
say(`\n## The project's check, run by the writer\n`);
say(`merge.checks: ${JSON.stringify(checks)}`);
const suite = withCalls.flatMap((w) => w.suiteRuns.map((s) => ({ ...s, branch: w.branch, hive: w.hive })));
const timed = suite.filter((s) => s.ms && !s.background);
say(`Full end-to-end suite runs by writers: ${suite.length} in ${new Set(suite.map((s) => s.branch)).size} of ${withCalls.length} workspaces (${suite.filter((s) => s.background).length} in the background, their time not recorded); foreground ones median ${min(median(timed.map((s) => s.ms)) ?? 0).toFixed(1)} min, sum ${h(sum(timed, (s) => s.ms))} h.`);
say(`Any check-like command (pnpm check|build|test:e2e, vitest, playwright): ${sum(withCalls, (w) => w.checkRuns)} calls, ${h(sum(withCalls, (w) => w.checkRunsMs))} h of foreground time. All Bash time: ${h(sum(withCalls, (w) => w.bashMs))} h.`);
const perWs = withCalls.map((w) => w.suiteRuns.length);
say(`Suite runs per workspace: median ${median(perWs)}, p90 ${q(perWs, 0.9)}, max ${Math.max(...perWs)}.`);

// Hive.
const hv = ws.filter((w) => w.hiveSteps.length);
say(`\n## Hive (${hv.length} workspaces)\n`);
const rows = [];
for (const w of hv) {
  const s = w.hiveSteps;
  const starts = s.filter((x) => x.kind === 'check-started' && x.commit);
  const done = s.filter((x) => x.kind === 'check');
  const passedAt = new Set();
  let rerunAfterPass = 0;
  for (const x of s) {
    if (x.kind === 'check-started' && x.commit && passedAt.has(x.commit)) rerunAfterPass++;
    if (x.kind === 'check' && x.ok) {
      const st = [...s.slice(0, s.indexOf(x))].reverse().find((y) => y.kind === 'check-started' && y.commit);
      if (st) passedAt.add(st.commit);
    }
  }
  const reviews = s.filter((x) => x.kind === 'review');
  rows.push([
    w.branch,
    starts.length,
    `${done.filter((x) => x.ok).length}/${done.length}`,
    `${min(sum(done, (x) => x.ms)).toFixed(0)}`,
    rerunAfterPass,
    reviews.map((r) => `${r.verdict}${r.kept ? ` ${r.kept} kept` : ''}${r.dropped ? ` ${r.dropped} dropped` : ''}${r.cost ? ` $${r.cost.toFixed(2)}` : ''}`).join('; ') || '–',
    s.filter((x) => x.kind === 'rounds-again').length,
    s.filter((x) => x.kind === 'sent').map((x) => x.key).join(', ') || '–',
    s.filter((x) => x.kind === 'off').length,
    (s.filter((x) => ['landed', 'landing', 'writing', 'checking'].includes(x.kind)).at(-1)?.kind ?? s.at(-1)?.kind) + (w.merges.some((m) => m.state === 'landed') ? ' (merged)' : ''),
  ]);
}
say(table(['workspace', 'checks started', 'passed/done', 'check min', 'started on a passed tip', 'reviews', 'rounds again (a message)', 'sent', 'off', 'last step'], rows));

// Reviews and merges.
say(`\n## Reviews and merges\n`);
const verdicts = ws.flatMap((w) => w.verdicts.map((v) => ({ ...v, branch: w.branch })));
say(`Verdicts: ${JSON.stringify(count(verdicts, (v) => v.event))}; via: ${JSON.stringify(count(verdicts, (v) => v.via ?? 'the page'))}; with comments: ${verdicts.filter((v) => v.comments).length} (${sum(verdicts, (v) => v.comments)} comments).`);
say(`Workspaces with a request-changes before approval: ${ws.filter((w) => w.verdicts.some((v) => v.event === 'request-changes')).length}; approved: ${ws.filter((w) => w.verdicts.some((v) => v.event === 'approve')).length} of ${ws.length}.`);
const merged = ws.filter((w) => w.merges.length);
say(`Merges in Symbiote's logs (from 2026-10-25): ${merged.length} workspaces; states ${JSON.stringify(count(merged.flatMap((w) => w.merges), (m) => m.state))}.`);
say(`Workspaces whose merge failed at least once: ${merged.filter((w) => w.merges.some((m) => m.state === 'failed')).map((w) => w.branch).join(', ') || 'none'}.`);
say(`Merges the merger resolved (a resolving step): ${merged.filter((w) => w.merges.some((m) => m.state === 'resolving')).length}.`);
const approveToLand = merged
  .map((w) => {
    const ap = w.verdicts.filter((v) => v.event === 'approve').at(-1);
    const land = w.merges.filter((m) => m.state === 'landed').at(-1);
    return ap && land && land.at > ap.at ? new Date(land.at) - new Date(ap.at) : null;
  })
  .filter((x) => x != null);
say(`Approve to landed: median ${min(median(approveToLand)).toFixed(1)} min, p90 ${min(q(approveToLand, 0.9)).toFixed(1)} min (${approveToLand.length} merges).`);

console.log(out.join('\n'));
