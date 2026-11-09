// `symbiote mcp`: Symbiote's MCP over stdio, bridged to a running `symbiote view` (MC1).
import { defaultCacheDir, openRepo } from '@symbiote/core';
import { runBridge, viewFile } from './mcp-bridge.js';
import type { CliContext } from './command-context.js';
import { UsageError, parse } from './command-args.js';

const MCP_HELP = `Usage: symbiote mcp

An MCP server on stdin and stdout for an agent of yours, with Symbiote's tools for this
repository: what needs you, the workspaces and their agents' threads, a branch's review as
Symbiote's graph, the merge queue. It hands each call to the symbiote view running for the
repository; without one, it says so. Starting a workspace or its agent again, a verdict,
every merge action and a clean-up wait for your Confirm in Symbiote, 10 minutes at most.

  claude mcp add symbiote -- symbiote mcp
  Codex: [mcp_servers.symbiote] command = "symbiote", args = ["mcp"] in its config.toml

Options:
  -h, --help           Show this help
`;

/** `symbiote mcp` (MC1): the bridge to the `symbiote view` of the repository it runs in. */
export async function mcpCommand(argv: string[], ctx: CliContext): Promise<number> {
  const { values } = parse(
    { args: argv, options: { help: { type: 'boolean', short: 'h', default: false } } },
    MCP_HELP,
  );
  if (values.help) {
    ctx.stdout(MCP_HELP);
    return 0;
  }
  if (!ctx.stdio) throw new UsageError('it speaks on stdin and stdout, and has neither', MCP_HELP);
  const repo = await openRepo(ctx.cwd);
  await runBridge({
    view: viewFile(defaultCacheDir(ctx.env), repo.commonDir),
    input: ctx.stdio.input,
    output: ctx.stdio.output,
    folder: ctx.cwd,
  });
  return 0;
}
