// Nucleus's gate as Claude Code runs it (V35): a PreToolUse hook from `symbiote/nucleus-settings.json`,
// its options its arguments (the checkout and the workspaces' records, V80: the worktrees it opens;
// `--web`, NU1), the tool call on stdin, its decision on stdout (`nucleus-gate.ts`). Input it cannot
// read gets no answer, which leaves the call to Claude Code's `dontAsk` mode: denied unless it reads.
// With `--activity=<file>` (NU2) it records the call and the decision there first
// (`nucleus-record.ts`), and Claude Code runs it for Nucleus's other events too, in the
// background, to record them (`nucleus-activity.ts`, loaded only then).
import { gateHook } from './nucleus-record.js';

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
  const args = process.argv.slice(2);
  const at = new Date().toISOString();
  const answer = gateHook(input, args, process.env, at);
  if (answer !== null) {
    process.stdout.write(answer);
    process.exitCode = 0;
    return;
  }
  void import('./nucleus-activity.js')
    .then(({ recordHook }) => recordHook(input, args, process.env, at))
    .catch(() => {})
    .finally(() => {
      process.exitCode = 0;
    });
});
