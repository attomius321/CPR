// Scribe's gate as Claude Code runs it (V41): a PreToolUse hook from `symbiote/scribe-settings.json`,
// the skills folder its argument, the tool call on stdin, its decision on stdout (`scribe-gate.ts`).
// Input it cannot read gets no answer, which leaves the call to Claude Code's own rules.
import { scribeDecision } from './scribe-gate.js';
import { hookOutput } from './scout-gate.js';

const skills = process.argv[2] ?? '';
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
  // Without its folder, nothing is a skill's: every write is denied.
  process.stdout.write(hookOutput(scribeDecision(input, skills || '/nonexistent'), 'Scribe'));
  process.exitCode = 0;
});
