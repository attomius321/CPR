// Nucleus's gate as Claude Code runs it (V35): a PreToolUse hook from `symbiote/nucleus-settings.json`,
// its options its arguments (the checkout and the workspaces' records, V80: the worktrees it opens;
// `--web`, NU1), the tool call on stdin, its decision on stdout (`nucleus-gate.ts`). Input it cannot
// read gets no answer, which leaves the call to Claude Code's `dontAsk` mode: denied unless it reads.
import { gateDecision, gateOptions, hookOutput } from './nucleus-gate.js';

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => (stdin += chunk));
process.stdin.on('end', () => {
  let input: unknown = null;
  try {
    input = JSON.parse(stdin);
  } catch {
    // Not a tool call Symbiote can read.
  }
  process.stdout.write(hookOutput(gateDecision(input, gateOptions(process.argv.slice(2)))));
  process.exitCode = 0;
});
