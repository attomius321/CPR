// AR1: tokens, turns and interruptions per workspace from Claude Code's transcripts
// (~/.claude/projects/<worktree path, dashed>/<session>.jsonl, subagents in <session>/subagents/).
// Read only. Usage: node transcripts.mjs <out.json> [<dir-prefix>...]
// Assistant lines repeat one API message per content block: usage is counted once per message id.
import { createReadStream, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { usd } from './price-table.mjs';

const root = join(homedir(), '.claude', 'projects');
const [out, ...prefixes] = process.argv.slice(2);
const wanted = prefixes.length
  ? prefixes
  : ['-home-anton-projects-Symbiote-worktrees-', '-home-anton-projects-Starknet-worktrees-',
     '-home-anton--cache-symbiote-worktrees-'];

async function readSession(file, acc) {
  const seen = new Set();
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { acc.bad++; continue; }
    const t = o.timestamp;
    if (t) { if (!acc.first || t < acc.first) acc.first = t; if (!acc.last || t > acc.last) acc.last = t; }
    if (o.type === 'assistant' && o.message?.usage) {
      const id = o.message.id ?? o.uuid;
      if (seen.has(id)) continue;
      seen.add(id);
      const m = o.message.model ?? '?';
      if (m === '<synthetic>') { if (o.isApiErrorMessage) acc.apiErrors++; continue; }
      const u = o.message.usage;
      const b = (acc.models[m] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0 });
      b.calls++;
      b.input += u.input_tokens ?? 0;
      b.output += u.output_tokens ?? 0;
      b.thinking += u.output_tokens_details?.thinking_tokens ?? 0;
      b.cacheRead += u.cache_read_input_tokens ?? 0;
      const cw = u.cache_creation ?? {};
      // Without the split (older versions), Claude Code's own cost counts writes at the 1-hour rate.
      const w5 = cw.ephemeral_5m_input_tokens ?? 0;
      const w1h = cw.ephemeral_1h_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w5);
      b.cacheWrite1h += w1h; b.cacheWrite5m += w5;
      if (o.effort) acc.efforts[o.effort] = (acc.efforts[o.effort] ?? 0) + 1;
      // One row per request: its time and API-equivalent dollars, to price phases of the work.
      acc.requests.push([o.timestamp, +(usd(m, { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite5m: w5, cacheWrite1h: w1h }) ?? 0).toFixed(5)]);
      // the context this request carried: input + cache read + cache write
      const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      if (ctx > acc.maxContext) acc.maxContext = ctx;
    } else if (o.type === 'assistant' && o.isApiErrorMessage) {
      acc.apiErrors++;
    } else if (o.type === 'user') {
      const c = o.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x.type === 'text' ? x.text : '')).join('') : '';
      if (/^\[Request interrupted by user/.test(text)) acc.interrupted++;
      if (Array.isArray(c)) for (const x of c) if (x.type === 'tool_result' && typeof x.content === 'string' && /^\[Request interrupted by user/.test(x.content)) acc.interruptedTool++;
      if (o.isCompactSummary) acc.compactions++;
    } else if (o.type === 'system') {
      if (o.subtype === 'turn_duration') { acc.turns++; acc.turnMs += o.durationMs ?? 0; }
      if (o.subtype === 'compact_boundary') acc.compactions++;
    } else if (o.type === 'cost-state') {
      acc.costStates.push({ session: o.sessionId, usd: o.totalCostUSD, ms: o.totalDuration, api: o.totalAPIDuration });
    } else if (o.type === 'permission-mode') {
      acc.permissionModes[o.permissionMode] = (acc.permissionModes[o.permissionMode] ?? 0) + 1;
    }
  }
}

const result = {};
for (const dir of readdirSync(root)) {
  if (!wanted.some((p) => dir.startsWith(p))) continue;
  const full = join(root, dir);
  const acc = { sessions: 0, subagentSessions: 0, models: {}, efforts: {}, interrupted: 0, interruptedTool: 0,
    compactions: 0, turns: 0, turnMs: 0, apiErrors: 0, maxContext: 0, first: null, last: null, bad: 0,
    costStates: [], permissionModes: {}, requests: [] };
  for (const f of readdirSync(full)) {
    const p = join(full, f);
    if (f.endsWith('.jsonl')) { acc.sessions++; await readSession(p, acc); }
    else if (statSync(p).isDirectory() && existsSync(join(p, 'subagents'))) {
      for (const s of readdirSync(join(p, 'subagents'))) if (s.endsWith('.jsonl')) { acc.subagentSessions++; await readSession(join(p, 'subagents', s), acc); }
    }
  }
  result[dir] = acc;
}
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(Object.keys(result).length, 'folders');
