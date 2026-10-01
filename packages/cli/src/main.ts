import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  analyzeGit,
  buildGraph,
  CprError,
  defaultCacheDir,
  fetchRefs,
  listChangedLines,
  NoMergeBaseError,
  openRepo,
  readFileAtRevision,
  remoteUrl,
  resolveCommit,
  SCHEMA_VERSION,
  type Analysis,
  type ChangedLines,
  type Graph,
  type Severity,
} from '@cpr/core';
import { detectForge, type ChangeRequest, type Forge } from '@cpr/forge';
import { formatAnalysis } from './format.js';
import { findingsReview, planFindings, postedMarkers } from './post-findings.js';
import { startViewServer, type ReviewTarget } from './server.js';
import { fileStateStore, stateDir } from './state.js';

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
  /** Environment: tokens, API URLs, `CPR_*` settings. */
  env: Readonly<Record<string, string | undefined>>;
}

const processContext = (): CliContext => ({
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  openUrl,
  env: process.env,
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
  pr <number>          Review a GitHub pull request or GitLab merge request (alias: mr)

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
  --since <rev>        Mark each changed symbol new, updated or the same as in an earlier
                       head of this change (before a push or rebase)
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
  --since <rev>        Mark each changed symbol new, updated or the same as in an earlier
                       head of this change (before a push or rebase)
  --project <path>     tsconfig to load, relative to the repo root (default: tsconfig.json)
  --depth <n>          Hops of unchanged callers/callees to include (default: 1)
  -h, --help           Show this help
`;

const PR_HELP = `Usage: cpr pr <number> [options]      (alias: cpr mr)

Reviews a GitHub pull request or GitLab merge request of the \`origin\` remote: reads it
through the forge's API, fetches its head and target branch, and opens the viewer, where
comments on symbols are submitted as one review (comment, approve, or request changes).

Tokens: GITHUB_TOKEN / GH_TOKEN (or gh auth login) · GITLAB_TOKEN.
API overrides: GITHUB_API_URL · GITLAB_API_URL.

Options:
  --summary            Print the summary instead of opening the viewer
  --json               Print the graph JSON instead of opening the viewer
  --out <file>         Also write the graph JSON to a file
  --fail-on <level>    Exit 1 if a finding is at least: error, warning, info
  --post-findings <level>
                       Post new findings at or above the level (error, warning, info) as
                       review comments on their lines, instead of opening the viewer;
                       findings posted by an earlier run are not repeated
  --forge <name>       github or gitlab, for hosts whose name doesn't say
  --remote <name>      Remote to read and fetch from (default: origin)
  --port <n>           Viewer port (default: any free port)
  --no-open            Don't open the browser
  --since <sha>        Mark each changed symbol new, updated or the same as in an earlier
                       head of this pull/merge request (fetched if needed)
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
    if (command === 'pr' || command === 'mr') return await pr(rest, ctx);
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
  since: { type: 'string' },
  project: { type: 'string' },
  depth: { type: 'string', default: '1' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

interface AnalysisArgs {
  positionals: string[];
  values: {
    'no-merge-base': boolean;
    since?: string | undefined;
    project?: string | undefined;
    depth: string;
  };
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
      cacheDir: defaultCacheDir(ctx.env),
      ...(values.since === undefined ? {} : { since: values.since }),
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

const REPORT_OPTIONS = {
  json: { type: 'boolean', default: false },
  out: { type: 'string' },
  'fail-on': { type: 'string' },
} as const;

const SERVE_OPTIONS = {
  port: { type: 'string', default: '0' },
  'no-open': { type: 'boolean', default: false },
} as const;

interface ReportArgs {
  json: boolean;
  out?: string | undefined;
  'fail-on'?: string | undefined;
}

interface ServeArgs {
  port: string;
  'no-open': boolean;
}

function checkFailOn(failOn: string | undefined, help: string): void {
  if (failOn !== undefined && !SEVERITIES.includes(failOn as Severity)) {
    throw new UsageError(`--fail-on must be error, warning or info, got '${failOn}'`, help);
  }
}

function checkPort(port: string, help: string): number {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new UsageError(`--port must be a port number, got '${port}'`, help);
  }
  return value;
}

/** Prints the summary or the graph JSON, writes `--out`, applies `--fail-on`. */
async function report(
  analysis: Analysis,
  graph: Graph,
  args: ReportArgs,
  ctx: CliContext,
): Promise<number> {
  const json = `${JSON.stringify(graph, null, 2)}\n`;
  if (args.out !== undefined) await writeFile(resolve(ctx.cwd, args.out), json);
  ctx.stdout(args.json ? json : formatAnalysis(analysis, graph.changeRequest));
  for (const warning of analysis.warnings) ctx.stderr(`warning: ${warning}\n`);

  const failOn = args['fail-on'];
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

/** Serves the viewer for a graph until the user stops it. */
async function serve(
  analysis: Analysis,
  graph: Graph,
  args: ServeArgs,
  ctx: CliContext,
  help: string,
  review?: ReviewTarget,
): Promise<number> {
  const port = checkPort(args.port, help);
  const repo = await openRepo(ctx.cwd);
  const shas = { base: analysis.revisions.from, head: analysis.revisions.head.sha };
  const server = await startViewServer({
    graph,
    port,
    viewerDir: viewerDir(ctx),
    readSource: (side, path) => {
      const sha = shas[side];
      if (!sha) return Promise.reject(new Error(`no ${side} revision`));
      return readFileAtRevision(repo, sha, path);
    },
    state: fileStateStore(stateDir(defaultCacheDir(ctx.env), repo.id, graph)),
    ...(review ? { review } : {}),
  });
  const changed =
    graph.stats.symbols.added + graph.stats.symbols.removed + graph.stats.symbols.modified;
  ctx.stdout(
    `${graph.stats.filesChanged} files · ${changed} symbols changed · ${graph.findings.length} findings\n` +
      `CPR viewer: ${server.url}  (Ctrl+C to stop)\n`,
  );
  for (const warning of analysis.warnings) ctx.stderr(`warning: ${warning}\n`);
  if (!args['no-open']) ctx.openUrl(server.url);

  await ctx.waitForExit();
  await server.close();
  return 0;
}

async function diff(argv: string[], ctx: CliContext): Promise<number> {
  const { values, positionals } = parse(
    { args: argv, allowPositionals: true, options: { ...ANALYSIS_OPTIONS, ...REPORT_OPTIONS } },
    DIFF_HELP,
  );
  if (values.help) {
    ctx.stdout(DIFF_HELP);
    return 0;
  }
  checkFailOn(values['fail-on'], DIFF_HELP);
  const { analysis, durationMs } = await analyze({ positionals, values }, ctx, DIFF_HELP);
  const graph = buildGraph(analysis, { generator: { name: 'cpr', version }, durationMs });
  return report(analysis, graph, values, ctx);
}

async function view(argv: string[], ctx: CliContext): Promise<number> {
  const { values, positionals } = parse(
    { args: argv, allowPositionals: true, options: { ...ANALYSIS_OPTIONS, ...SERVE_OPTIONS } },
    VIEW_HELP,
  );
  if (values.help) {
    ctx.stdout(VIEW_HELP);
    return 0;
  }
  checkPort(values.port, VIEW_HELP);
  const { analysis, durationMs } = await analyze({ positionals, values }, ctx, VIEW_HELP);
  const graph = buildGraph(analysis, { generator: { name: 'cpr', version }, durationMs });
  return serve(analysis, graph, values, ctx, VIEW_HELP);
}

/**
 * Reviews a GitHub pull request or GitLab merge request: reads it through the forge's API,
 * fetches its head and target branch, and analyzes the same diff the forge shows.
 */
async function pr(argv: string[], ctx: CliContext): Promise<number> {
  const { values, positionals } = parse(
    {
      args: argv,
      allowPositionals: true,
      options: {
        ...ANALYSIS_OPTIONS,
        ...REPORT_OPTIONS,
        ...SERVE_OPTIONS,
        summary: { type: 'boolean', default: false },
        'post-findings': { type: 'string' },
        forge: { type: 'string' },
        remote: { type: 'string', default: 'origin' },
      },
    },
    PR_HELP,
  );
  if (values.help) {
    ctx.stdout(PR_HELP);
    return 0;
  }
  const [arg, ...extra] = positionals;
  const number = Number(arg?.replace(/^[#!]/, ''));
  if (!Number.isInteger(number) || number <= 0) {
    throw new UsageError(
      arg === undefined ? 'missing <number>' : `not a pull/merge request number: '${arg}'`,
      PR_HELP,
    );
  }
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`, PR_HELP);
  if (values.forge !== undefined && values.forge !== 'github' && values.forge !== 'gitlab') {
    throw new UsageError(`--forge must be github or gitlab, got '${values.forge}'`, PR_HELP);
  }
  checkFailOn(values['fail-on'], PR_HELP);
  checkPort(values.port, PR_HELP);
  const post = values['post-findings'];
  if (post !== undefined && !SEVERITIES.includes(post as Severity)) {
    throw new UsageError(`--post-findings must be error, warning or info, got '${post}'`, PR_HELP);
  }

  const repo = await openRepo(ctx.cwd);
  const forge = detectForge(await remoteUrl(repo, values.remote), ctx.env, values.forge);
  const request = await forge.getChangeRequest(number);
  const sign = forge.kind === 'gitlab' ? '!' : '#';
  ctx.stderr(
    `${sign}${request.number} ${request.title} (${request.state}, by ${request.author})\n`,
  );

  // Bring both commits in; if the API's commit is gone (force-push), use the fetched ref.
  const local = `refs/cpr/${forge.kind}/${number}`;
  await fetchRefs(repo, values.remote, [
    { from: request.refs.head, to: `${local}/head` },
    { from: request.refs.base, to: `${local}/base` },
  ]);
  const available = async (sha: string, fallback: string) => {
    try {
      return await resolveCommit(repo, sha);
    } catch {
      return fallback;
    }
  };
  const head = await available(request.head.sha, `${local}/head`);
  const base = await available(request.mergeBase ?? request.base.sha, `${local}/base`);
  // An earlier head may be gone from every branch after a force-push; forges still serve it.
  if (values.since !== undefined) {
    try {
      await resolveCommit(repo, values.since);
    } catch {
      try {
        await fetchRefs(repo, values.remote, [{ from: values.since, to: `${local}/since` }]);
      } catch (error) {
        throw new CprError(`cannot find or fetch --since ${values.since}`, { cause: error });
      }
    }
  }

  const { analysis, durationMs } = await analyze(
    // GitLab says which commit it diffs against; for GitHub, merge-base(base, head) is it.
    {
      positionals: [base, head],
      values: { ...values, 'no-merge-base': request.mergeBase !== null },
    },
    ctx,
    PR_HELP,
  );
  analysis.revisions.base.ref = request.base.ref;
  analysis.revisions.head.ref = `${sign}${request.number} ${request.head.ref}`;
  const graph = buildGraph(analysis, {
    generator: { name: 'cpr', version },
    durationMs,
    changeRequest: {
      forge: request.forge,
      number: request.number,
      title: request.title,
      url: request.url,
      author: request.author,
      state: request.state,
      draft: request.draft,
    },
  });

  // Comments are anchored to the analyzed commits, which may predate a newer push.
  const reviewed = {
    ...request,
    head: { ...request.head, sha: analysis.revisions.head.sha ?? request.head.sha },
  };
  if (post !== undefined) {
    const lines = await listChangedLines(repo, analysis.revisions.from ?? base, reviewed.head.sha);
    await postFindings(forge, reviewed, graph, lines, post as Severity, ctx);
  }

  const reportOnly =
    values.summary || values.json || values['fail-on'] !== undefined || post !== undefined;
  if (reportOnly) return report(analysis, graph, values, ctx);
  if (values.out !== undefined)
    await writeFile(resolve(ctx.cwd, values.out), `${JSON.stringify(graph, null, 2)}\n`);
  return serve(analysis, graph, values, ctx, PR_HELP, {
    forge: forge.kind,
    submit: (review) => forge.submitReview(reviewed, review),
  });
}

/**
 * Posts the findings no earlier run posted, as one review: inline on their symbols' changed
 * lines, the rest in the summary. If the forge refuses the inline comments (a line outside its
 * diff), everything goes into the summary instead.
 */
async function postFindings(
  forge: Forge,
  request: ChangeRequest,
  graph: Graph,
  lines: ChangedLines,
  level: Severity,
  ctx: CliContext,
): Promise<void> {
  const plan = planFindings(graph, lines, level, postedMarkers(await forge.commentBodies(request)));
  const count = plan.inline.length + plan.summary.length;
  const already = plan.skipped.length > 0 ? ` (${plan.skipped.length} already posted)` : '';
  if (count === 0) {
    ctx.stderr(`No new findings to post${already}\n`);
    return;
  }
  let result: { url: string };
  try {
    result = await forge.submitReview(request, findingsReview(plan));
  } catch (error) {
    if (plan.inline.length === 0) throw error;
    ctx.stderr(
      `warning: inline comments were refused (${(error as Error).message}); posting the findings in the summary\n`,
    );
    result = await forge.submitReview(request, findingsReview(plan, { inline: false }));
  }
  ctx.stderr(`Posted ${count} finding${count === 1 ? '' : 's'}${already}: ${result.url}\n`);
}

/** The built viewer that ships with the CLI (`CPR_VIEWER_DIR` overrides, e.g. for tests). */
function viewerDir(ctx: CliContext): string {
  const dir =
    ctx.env.CPR_VIEWER_DIR ?? join(dirname(require.resolve('@cpr/viewer/package.json')), 'dist');
  if (!existsSync(join(dir, 'index.html'))) {
    throw new CprError(`the viewer is not built (${dir}); run pnpm build`);
  }
  return dir;
}
