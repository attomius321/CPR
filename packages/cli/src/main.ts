import { createRequire } from 'node:module';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  analyzeGit,
  buildGraph,
  CprError,
  NoMergeBaseError,
  openRepo,
  readFileAtRevision,
  SCHEMA_VERSION,
  type Analysis,
  type Severity,
} from '@cpr/core';
import { formatAnalysis } from './format.js';
import { startViewServer } from './server.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export interface CliContext {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Opens a URL in the user's browser (best effort). */
  openUrl: (url: string) => void;
  /** Resolves when a long-running command (`view`) should stop: Ctrl+C. */
  waitForExit: () => Promise<void>;
}

const processContext = (): CliContext => ({
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  openUrl,
  waitForExit: () =>
    new Promise((resolve) => {
      process.once('SIGINT', () => resolve());
      process.once('SIGTERM', () => resolve());
    }),
});

function openUrl(url: string): void {
  const [command, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined); // no browser available: the URL is printed anyway
    child.unref();
  } catch {
    // ignore
  }
}

/** Most severe first. */
const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

const HELP = `Usage: cpr <command> [options]

Commands:
  diff <base> [head]   Compare head (default: HEAD) against base
  view <base> [head]   Same comparison, reviewed in the browser

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

const VIEW_HELP = `Usage: cpr view <base> [head] [options]

Analyzes like \`cpr diff\` and serves the graph viewer on localhost until Ctrl+C.

Options:
  --port <n>           Port to listen on (default: any free port)
  --no-open            Don't open the browser
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
    if (command === 'view') return await view(rest, ctx);
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

/** Options shared by `diff` and `view`: what to compare and how far to look. */
const ANALYSIS_OPTIONS = {
  'no-merge-base': { type: 'boolean', default: false },
  project: { type: 'string' },
  depth: { type: 'string', default: '1' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

interface AnalysisArgs {
  positionals: string[];
  values: { 'no-merge-base': boolean; project?: string | undefined; depth: string };
}

/** Runs the analysis for `diff`/`view` arguments; returns it with the time it took. */
async function analyze(
  { positionals, values }: AnalysisArgs,
  ctx: CliContext,
  help: string,
): Promise<{ analysis: Analysis; durationMs: number }> {
  const [base, head = 'HEAD', ...extra] = positionals;
  if (base === undefined) throw new UsageError('missing <base>', help);
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`, help);

  const depth = Number(values.depth);
  if (!Number.isInteger(depth) || depth < 1) {
    throw new UsageError(`--depth must be a positive integer, got '${values.depth}'`, help);
  }

  const started = performance.now();
  try {
    const analysis = await analyzeGit({
      cwd: ctx.cwd,
      base,
      head,
      mergeBase: !values['no-merge-base'],
      depth,
      ...(values.project === undefined ? {} : { project: values.project }),
    });
    return { analysis, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof NoMergeBaseError) {
      throw new CprError(`${error.message}; use --no-merge-base to compare them directly`, {
        cause: error,
      });
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
        ...ANALYSIS_OPTIONS,
        json: { type: 'boolean', default: false },
        out: { type: 'string' },
        'fail-on': { type: 'string' },
      },
    },
    DIFF_HELP,
  );
  if (values.help) {
    ctx.stdout(DIFF_HELP);
    return 0;
  }

  const failOn = values['fail-on'];
  if (failOn !== undefined && !SEVERITIES.includes(failOn as Severity)) {
    throw new UsageError(`--fail-on must be error, warning or info, got '${failOn}'`, DIFF_HELP);
  }

  const { analysis, durationMs } = await analyze({ positionals, values }, ctx, DIFF_HELP);
  const graph = buildGraph(analysis, { generator: { name: 'cpr', version }, durationMs });
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

async function view(argv: string[], ctx: CliContext): Promise<number> {
  const { values, positionals } = parse(
    {
      args: argv,
      allowPositionals: true,
      options: {
        ...ANALYSIS_OPTIONS,
        port: { type: 'string', default: '0' },
        'no-open': { type: 'boolean', default: false },
      },
    },
    VIEW_HELP,
  );
  if (values.help) {
    ctx.stdout(VIEW_HELP);
    return 0;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`--port must be a port number, got '${values.port}'`, VIEW_HELP);
  }

  const { analysis, durationMs } = await analyze({ positionals, values }, ctx, VIEW_HELP);
  const graph = buildGraph(analysis, { generator: { name: 'cpr', version }, durationMs });
  const repo = await openRepo(ctx.cwd);
  const shas = { base: analysis.revisions.from, head: analysis.revisions.head.sha };

  const server = await startViewServer({
    graph,
    port,
    viewerDir: viewerDir(),
    readSource: (side, path) => {
      const sha = shas[side];
      if (!sha) return Promise.reject(new Error(`no ${side} revision`));
      return readFileAtRevision(repo, sha, path);
    },
  });
  const changed =
    graph.stats.symbols.added + graph.stats.symbols.removed + graph.stats.symbols.modified;
  ctx.stdout(
    `${graph.stats.filesChanged} files · ${changed} symbols changed · ${graph.findings.length} findings\n` +
      `CPR viewer: ${server.url}  (Ctrl+C to stop)\n`,
  );
  for (const warning of analysis.warnings) ctx.stderr(`warning: ${warning}\n`);
  if (!values['no-open']) ctx.openUrl(server.url);

  await ctx.waitForExit();
  await server.close();
  return 0;
}

/** The built viewer that ships with the CLI (`CPR_VIEWER_DIR` overrides, e.g. for tests). */
function viewerDir(): string {
  const dir =
    process.env.CPR_VIEWER_DIR ??
    join(dirname(require.resolve('@cpr/viewer/package.json')), 'dist');
  if (!existsSync(join(dir, 'index.html'))) {
    throw new CprError(`the viewer is not built (${dir}); run pnpm build`);
  }
  return dir;
}
