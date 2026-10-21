// Symbiote's hook for a workspace's agent (V18c), run by Claude Code once per event with the event
// on stdin and the `symbiote/` folder as its argument (`claude-settings.json`). It records the
// event in the workspace's thread and decides nothing: it prints nothing and always exits 0.
import { hookMain } from './thread.js';

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => (stdin += chunk));
process.stdin.on('end', () => {
  void hookMain(stdin, process.argv[2], new Date().toISOString()).finally(() => {
    process.exitCode = 0;
  });
});
