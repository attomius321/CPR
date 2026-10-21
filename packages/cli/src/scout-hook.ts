// Scout's gate as Claude Code runs it (V35): a PreToolUse hook from `symbiote/scout-settings.json`,
// the tool call on stdin, its decision on stdout (`scout-gate.ts`). Input it cannot read gets no
// answer, which leaves the call to Claude Code's `dontAsk` mode: denied unless it reads.
import { gateDecision, hookOutput } from './scout-gate.js';

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
  process.stdout.write(hookOutput(gateDecision(input)));
  process.exitCode = 0;
});
