import { SymbioteError, SCHEMA_VERSION } from '@symbiote/core';
import { version, type CliContext, processContext } from './command-context.js';
import { UsageError } from './command-args.js';
import { diff } from './command-diff.js';
import { view } from './command-view.js';
import { pr } from './command-pr.js';
import { merge } from './command-merge.js';
import { activityCommand } from './command-activity.js';
import { mcpCommand } from './command-mcp.js';
import { appCommand } from './command-app.js';

/**
 * The program's name in its lines (LG1): its command, `pr` for `mr`, and `analysis` for a
 * `symbiote diff` that `symbiote view` started (it has an IPC channel back); `cli` for the rest.
 * Nothing is ever written on stdout, where `symbiote mcp` speaks MCP.
 */
export function logProcess(command: string | undefined, fromView: boolean): string {
  if (command === 'diff') return fromView ? 'analysis' : 'diff';
  if (command === 'mr') return 'pr';
  if (['view', 'pr', 'merge', 'app', 'mcp'].includes(command ?? '')) return command ?? '';
  return 'cli';
}

const HELP = `Usage: symbiote <command> [options]

Commands:
  diff <base> [head]   Compare head (default: HEAD) against base
  view [<base> [head]] Same comparison, reviewed in the browser; without revisions,
                       Git: every branch, to compare or review, with workspaces
                       (agents' branches) beside it
  pr [<number>]        Review a GitHub pull request or GitLab merge request (alias: mr);
                       in a CI job, the job's own
  merge <branch>       Merge a branch's approved commit, check it, and land it
  activity [<branch>]  A workspace's activity (or Nucleus's, --nucleus) as Markdown, for
                       you or an agent to read
  mcp                  Symbiote's tools for an agent of yours (MCP on stdin and stdout):
                       workspaces, reviews and merges, through the symbiote view running
  app install          Add Symbiote's window to your desktop's apps (app uninstall: remove it)

Options:
  -h, --help           Show this help
  -v, --version        Show version
`;

/** Runs the CLI and returns the process exit code: 0 ok, 1 failure, 2 usage error. */
export async function run(
  argv: readonly string[],
  ctx: CliContext = processContext(),
): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '-h' || command === '--help') {
    ctx.stdout(HELP);
    return 0;
  }
  if (command === '-v' || command === '--version') {
    ctx.stdout(`symbiote ${version} (graph schema ${SCHEMA_VERSION})\n`);
    return 0;
  }

  try {
    if (command === 'diff') return await diff(rest, ctx);
    if (command === 'view') return await view(rest, ctx);
    if (command === 'pr' || command === 'mr') return await pr(rest, ctx);
    if (command === 'merge') return await merge(rest, ctx);
    if (command === 'activity') return await activityCommand(rest, ctx);
    if (command === 'mcp') return await mcpCommand(rest, ctx);
    if (command === 'app') return appCommand(rest, ctx);
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.stderr(`symbiote ${command}: ${error.message}\n\n${error.help}`);
      return 2;
    }
    if (error instanceof SymbioteError) {
      ctx.log?.log.warn({ command, err: error }, 'refused');
      ctx.stderr(`symbiote: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  ctx.stderr(`symbiote: unknown command '${command}'\n\n${HELP}`);
  return 2;
}
