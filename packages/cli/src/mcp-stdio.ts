// Symbiote's MCP bridge as an agent starts it (MC1): `node mcp-stdio.js --view <record> [--as
// nucleus]`, written into Nucleus's configuration by Symbiote (`mcp-bridge.ts`; `--as scout` in a
// file from before NU1). `symbiote mcp` runs the same bridge for the repository it is run in.
import { parseArgs } from 'node:util';
import { bridgeCaller, runBridge } from './mcp-bridge.js';

const { values } = parseArgs({
  options: { view: { type: 'string' }, as: { type: 'string' } },
  strict: false,
});
if (typeof values.view !== 'string') {
  process.stderr.write("Symbiote's MCP bridge: --view <file> names symbiote view's record\n");
  process.exitCode = 2;
} else {
  const as = bridgeCaller(values.as);
  void runBridge({
    view: values.view,
    ...(as ? { as } : {}),
    input: process.stdin,
    output: process.stdout,
    folder: process.cwd(),
  });
}
