// Symbiote's MCP bridge as an agent starts it (MC1): `node mcp-stdio.js --view <record> [--as
// scout]`, written into Nucleus's configuration by Symbiote (`mcp-bridge.ts`). `symbiote mcp` runs the
// same bridge for the repository it is run in.
import { parseArgs } from 'node:util';
import { runBridge } from './mcp-bridge.js';

const { values } = parseArgs({
  options: { view: { type: 'string' }, as: { type: 'string' } },
  strict: false,
});
if (typeof values.view !== 'string') {
  process.stderr.write("Symbiote's MCP bridge: --view <file> names symbiote view's record\n");
  process.exitCode = 2;
} else {
  void runBridge({
    view: values.view,
    ...(values.as === 'scout' ? { as: 'scout' as const } : {}),
    input: process.stdin,
    output: process.stdout,
    folder: process.cwd(),
  });
}
