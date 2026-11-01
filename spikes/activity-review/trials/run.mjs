// AR1 trials: one real `claude -p` run in a fresh clone of the trial repository, its calls timed.
// Usage: node run.mjs <base repo> <branch> <prompt file> <out dir> [--system <file>] [--schema]
// Model and effort: TRIAL_MODEL (sonnet), TRIAL_EFFORT (medium). Writes <out>/run.json.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, branch, promptFile, out, ...rest] = process.argv.slice(2);
const system = rest.includes('--system') ? readFileSync(rest[rest.indexOf('--system') + 1], 'utf8') : null;
const schema = rest.includes('--schema');
mkdirSync(out, { recursive: true });
const copy = join(out, 'repo');
execFileSync('git', ['clone', '-q', '--branch', branch, base, copy]);
execFileSync('git', ['-C', copy, 'config', 'user.email', 't@example.com']);
execFileSync('git', ['-C', copy, 'config', 'user.name', 'Trial']);
const head = execFileSync('git', ['-C', copy, 'rev-parse', 'HEAD']).toString().trim();
// Confined as Symbiote's running reviewer is (decision 677): Claude Code's sandbox required, every
// command run in it (writes only in the copy, no network); edits accepted only in the copy
// (`acceptEdits`), anything else refused (no one to ask); no hooks.
const settingsJson = JSON.stringify({
  disableAllHooks: true,
  permissions: { allow: ['Bash'] },
  sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false },
});
const SCHEMA = { type: 'object', properties: { summary: { type: 'string' }, ran: { type: 'string' }, findings: { type: 'array', items: { type: 'object', properties: { defect: { type: 'string' }, test: { type: 'string' }, command: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['defect', 'test', 'command', 'files'] } } }, required: ['summary', 'ran', 'findings'] };
// A file, as Symbiote gives its reviewer's: `./**` is read from the session's folder.
const settings = join(out, 'settings.json');
writeFileSync(settings, settingsJson);
const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', process.env.TRIAL_MODEL ?? 'sonnet', '--effort', process.env.TRIAL_EFFORT ?? 'medium',
  '--permission-mode', 'acceptEdits', '--settings', settings, '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--max-budget-usd', '1.5',
  ...(schema ? ['--json-schema', JSON.stringify(SCHEMA)] : []), ...(system ? ['--append-system-prompt', system] : [])];
const started = Date.now();
const child = spawn('claude', args, { cwd: copy, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end(readFileSync(promptFile, 'utf8'));
let buf = '';
const lines = [];
child.stdout.on('data', (d) => {
  buf += d;
  const parts = buf.split('\n');
  buf = parts.pop();
  for (const p of parts) if (p.trim()) lines.push({ t: Date.now() - started, line: p });
});
let err = '';
child.stderr.on('data', (d) => (err += d));
child.on('close', (code) => {
  const calls = new Map();
  let result = null;
  for (const { t, line } of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'assistant') for (const c of o.message?.content ?? []) if (c.type === 'tool_use') calls.set(c.id, { tool: c.name, input: c.input?.command ?? c.input?.file_path ?? JSON.stringify(c.input).slice(0, 200), at: t });
    if (o.type === 'user') for (const c of o.message?.content ?? []) if (c.type === 'tool_result' && calls.has(c.tool_use_id)) {
      const call = calls.get(c.tool_use_id);
      call.s = +((t - call.at) / 1000).toFixed(1);
      const text = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x) => x.text ?? '').join('');
      call.out = text.slice(0, 400);
    }
    if (o.type === 'result') result = o;
  }
  const commits = execFileSync('git', ['-C', copy, 'rev-list', '--count', `${head}..HEAD`]).toString().trim();
  let unit = 'fail';
  try { execFileSync('python3', ['-m', 'unittest', 'tests.test_stock'], { cwd: copy, stdio: 'pipe' }); unit = 'pass'; } catch {}
  const run = { code, ms: Date.now() - started, cost: result?.total_cost_usd ?? null, turns: result?.num_turns ?? null, commits: +commits, unit,
    calls: [...calls.values()], structured: result?.structured_output ?? null, result: typeof result?.result === 'string' ? result.result.slice(0, 1500) : null, stderr: err.slice(0, 500) };
  writeFileSync(join(out, 'run.json'), JSON.stringify(run, null, 1));
  console.log(out, 'cost', run.cost, 'ms', run.ms, 'commits', run.commits, 'unit', run.unit, 'calls', run.calls.length);
});
