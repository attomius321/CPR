// Symbiote's hook for a workspace's agent (V18c), run by Claude Code once per event with the event
// on stdin and the `symbiote/` folder as its argument (`claude-settings.json`). It records the
// event in the workspace's thread — or, with `activity` after the folder (V48f, the tools' hooks),
// a tool's start or end in its activity — and decides nothing: it prints nothing, always exits 0.
import { hookMain } from './thread.js';

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => (stdin += chunk));
process.stdin.on('end', () => {
  void hookMain(stdin, process.argv[2], new Date().toISOString(), process.argv[3]).finally(() => {
    process.exitCode = 0;
  });
});
