import { createRequire } from 'node:module';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  analyzeGit,
  buildGraph,
  CprError,
  NoMergeBaseError,
  SCHEMA_VERSION,
  type Analysis,
  type Severity,
} from '@cpr/core';
import { formatAnalysis } from './format.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export interface CliContext {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processContext = (): CliContext => ({
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});

/** Most severe first. */
const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

const HELP = `Usage: cpr <command> [options]

Commands:
  diff <base> [head]   Compare head (default: HEAD) against base

Options:
  -h, --help           Show this help
  -v, --version        Show version
`;

const DIFF_HELP = `Usage: cpr diff <base> [head] [options]

Compares head (default: HEAD) against the merge-base of base and head,
like a GitHub pull request, and lists the changed symbols in each file.

Options:
  --json               Print the graph JSON instead of the summary
  --out <file>         Also write the graph JSON to a file
  --fail-on <level>    Exit 1 if a finding is at least: error, warning, info (default: never)
  --no-merge-base      Compare against base directly
  --project <path>     tsconfig to load, relative to the repo root (default: tsconfig.json)
  --depth <n>          Hops of unchanged callers/callees to include (default: 1)
  -h, --help           Show this help
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
    ctx.stdout(`cpr ${version} (graph schema ${SCHEMA_VERSION})\n`);
    return 0;
  }

  try {
    if (command === 'diff') return await diff(rest, ctx);
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.stderr(`cpr ${command}: ${error.message}\n\n${error.help}`);
      return 2;
    }
    if (error instanceof CprError) {
      ctx.stderr(`cpr: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  ctx.stderr(`cpr: unknown command '${command}'\n\n${HELP}`);
  return 2;
}

class UsageError extends Error {
  constructor(
    message: string,
    readonly help: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

function parse<const T extends ParseArgsConfig>(config: T, help: string) {
  try {
    return parseArgs(config);
  } catch (error) {
    // parseArgs throws TypeErrors with ERR_PARSE_ARGS_* codes for bad input.
    if (
      error instanceof TypeError &&
      'code' in error &&
      String(error.code).startsWith('ERR_PARSE_ARGS')
    ) {
      throw new UsageError(error.message, help, { cause: error });
    }
    throw error;
  }
}

async function diff(argv: string[], ctx: CliContext): Promise<number> {
  const { values, positionals } = parse(
    {
      args: argv,
      allowPositionals: true,
      options: {
        'no-merge-base': { type: 'boolean', default: false },
        project: { type: 'string' },
        depth: { type: 'string', default: '1' },
        json: { type: 'boolean', default: false },
        out: { type: 'string' },
        'fail-on': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    },
    DIFF_HELP,
  );
  if (values.help) {
    ctx.stdout(DIFF_HELP);
    return 0;
  }

  const [base, head = 'HEAD', ...extra] = positionals;
  if (base === undefined) throw new UsageError('missing <base>', DIFF_HELP);
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`, DIFF_HELP);

  const depth = Number(values.depth);
  if (!Number.isInteger(depth) || depth < 1) {
    throw new UsageError(`--depth must be a positive integer, got '${values.depth}'`, DIFF_HELP);
  }

  const failOn = values['fail-on'];
  if (failOn !== undefined && !SEVERITIES.includes(failOn as Severity)) {
    throw new UsageError(`--fail-on must be error, warning or info, got '${failOn}'`, DIFF_HELP);
  }

  const started = performance.now();
  let analysis: Analysis;
  try {
    analysis = await analyzeGit({
      cwd: ctx.cwd,
      base,
      head,
      mergeBase: !values['no-merge-base'],
      depth,
      ...(values.project === undefined ? {} : { project: values.project }),
    });
  } catch (error) {
    if (error instanceof NoMergeBaseError) {
      throw new CprError(`${error.message}; use --no-merge-base to compare them directly`, {
        cause: error,
      });
    }
    throw error;
  }

  const graph = buildGraph(analysis, {
    generator: { name: 'cpr', version },
    durationMs: Math.round(performance.now() - started),
  });
  const json = `${JSON.stringify(graph, null, 2)}\n`;
  if (values.out !== undefined) await writeFile(resolve(ctx.cwd, values.out), json);
  ctx.stdout(values.json ? json : formatAnalysis(analysis));
  for (const warning of analysis.warnings) ctx.stderr(`warning: ${warning}\n`);

  if (failOn !== undefined) {
    const threshold = SEVERITIES.indexOf(failOn as Severity);
    const failing = analysis.findings.filter((f) => SEVERITIES.indexOf(f.severity) <= threshold);
    if (failing.length > 0) {
      ctx.stderr(
        `cpr: ${failing.length} finding${failing.length === 1 ? '' : 's'} at or above '${failOn}'\n`,
      );
      return 1;
    }
  }
  return 0;
}
