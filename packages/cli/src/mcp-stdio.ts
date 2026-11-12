// Symbiote's MCP bridge as an agent starts it (MC1): `node mcp-stdio.js --view <record> [--as
// nucleus]`, written into Nucleus's configuration by Symbiote (`mcp-bridge.ts`; `--as scout` in a
// file from before NU1). `symbiote mcp` runs the same bridge for the repository it is run in.
// Nucleus's key comes in its environment, `SYMBIOTE_NUCLEUS_KEY` (SC1, decision 931): Symbiote sets
// it in Nucleus's MCP configuration alone.
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
  const nucleusKey = process.env.SYMBIOTE_NUCLEUS_KEY;
  void runBridge({
    ...(nucleusKey ? { nucleusKey } : {}),
    view: values.view,
    ...(as ? { as } : {}),
    input: process.stdin,
    output: process.stdout,
    folder: process.cwd(),
  });
}
