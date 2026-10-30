#!/usr/bin/env node
// HV1 spike: a fake Claude Code for hive.mjs's control flow, at no cost. It takes Claude Code's
// `-p` arguments, reads the prompt on stdin, acts by its role and HIVE_FAKE's script, and prints
// stream-json as Claude Code does (an init line, a result line).
//   happy  two workspaces (summary, then cli from it); a review asks for changes once, then approves
//   stall  as happy, but cli's agent commits nothing until a new plan; the orchestrator retries it
//   cap    summary's reviewer finds 3, 2, 1 blocking findings: the round cap stops it, and cli
//   slow   main's first call takes 120 s (to stop Hive or kill the runner mid-call); a resume is quick
//   parallel  two independent workspaces writing the same file: the second to merge conflicts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
const role = /Hive role: (\w+)/.exec(option('--append-system-prompt') ?? '')?.[1] ?? 'main';
const session = option('--resume') ?? option('--session-id') ?? randomUUID();
const resumed = argv.includes('--resume');
const script = process.env.HIVE_FAKE || 'happy';
const nodeId = process.env.HIVE_NODE || 'goal';
const round = Number(process.env.HIVE_ROUND || 0);
const prompt = readFileSync(0, 'utf8');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const say = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
say({ type: 'system', subtype: 'init', session_id: session, model: 'fake', cwd: process.cwd() });

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let text = 'done';
let structured;

if (role === 'orchestrator' && /has stalled/.test(prompt)) {
  structured = { action: 'retry', brief: 'Write the CLI part (replanned).', note: 'the agent wrote nothing: a narrower brief' };
} else if (role === 'orchestrator' && script === 'parallel') {
  structured = {
    facts: [],
    guesses: [],
    plan: 'two parts at once',
    workspaces: [
      { id: 'left', title: 'left part', brief: 'Write the left part.', deps: [] },
      { id: 'right', title: 'right part', brief: 'Write the right part.', deps: [] },
    ],
  };
} else if (role === 'orchestrator') {
  structured = {
    facts: ['src/count.ts counts lines'],
    guesses: ['a CLI needs a build'],
    plan: 'summary first, then the CLI on it',
    workspaces: [
      { id: 'summary', title: 'scanFolder and summarize', brief: 'Write scanFolder and summarize.', deps: [] },
      { id: 'cli', title: 'the loc command', brief: 'Write the CLI on summarize.', deps: ['summary'] },
    ],
  };
} else if (role === 'researcher') {
  text = 'Notes: count.ts and languages.ts; tests in test/.';
} else if (role === 'main' || role === 'one') {
  if (script === 'slow' && !resumed) await sleep(120_000);
  const writes = !(script === 'stall' && nodeId === 'cli' && !/replanned/.test(prompt));
  if (/git merge main/.test(prompt)) {
    try {
      execFileSync('git', ['merge', 'main'], { stdio: 'ignore' });
    } catch {
      /* a conflict: resolved below, both sides kept */
    }
  }
  if (writes && script === 'parallel') {
    const { writeFileSync } = await import('node:fs');
    const theirs = existsSync('shared.txt') ? readFileSync('shared.txt', 'utf8').replace(/^[<=>].*\n/gm, '') : '';
    writeFileSync('shared.txt', [...new Set([...theirs.split('\n').filter(Boolean), `${nodeId} round ${round}`])].join('\n') + '\n');
    git('add', '-A');
    git('commit', '-qm', `${nodeId}: round ${round}`);
  } else if (writes) {
    appendFileSync(`${nodeId}.txt`, `round ${round}${/replanned/.test(prompt) ? ' replanned' : ''}\n`);
    git('add', '-A');
    git('commit', '-qm', `${nodeId}: round ${round}`);
  }
  text = writes ? `wrote ${nodeId}.txt` : 'nothing written';
} else if (role === 'reviewer') {
  const file = `${nodeId}.txt`;
  const content = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const major = (n) =>
    Array.from({ length: n }, (_, i) => ({ severity: 'major', path: file, line: i + 1, text: `finding ${i + 1}` }));
  let findings = [];
  if (script === 'cap' && nodeId === 'summary') findings = major(Math.max(0, 4 - round));
  else if (script === 'stall' && nodeId === 'cli') findings = /replanned/.test(content) ? [] : major(1);
  else if (round <= 1) findings = major(1);
  structured = {
    verdict: findings.length ? 'changes' : 'approve',
    summary: `${findings.length} findings`,
    findings,
  };
}

say({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: structured ? JSON.stringify(structured) : text,
  ...(structured ? { structured_output: structured } : {}),
  session_id: session,
  total_cost_usd: 0,
  num_turns: 1,
  duration_ms: 1,
  usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
