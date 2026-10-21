import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  analyzeGit,
  buildGraph,
  checkout,
  CprError,
  createTypescriptAdapter,
  defaultCacheDir,
  fetchRefs,
  commitDetails,
  defaultBranchTips,
  hasCommitGraph,
  historyState,
  isCommit,
  listRefs,
  listChangedLines,
  NoMergeBaseError,
  openRepo,
  readFileAtRevision,
  remoteUrl,
  resolveCommit,
  SCHEMA_VERSION,
  streamHistory,
  workingState,
  type Analysis,
  type AnalysisPhase,
  type ChangedLines,
  type Graph,
  type AgentKind,
  type MergeEntry,
  type Severity,
  type TsPlugin,
} from '@cpr/core';
import { detectForge, type ChangeRequest, type Forge } from '@cpr/forge';
import {
  findApp,
  installApp,
  openAppWindow,
  recordAgain,
  uninstallApp,
  type AppWindow,
} from './app.js';
import { ciChangeRequestNumber } from './ci.js';
import { codeQualityReport } from './codequality.js';
import { Diffs, pairKey } from './diffs.js';
import { formatAnalysis } from './format.js';
import { Histories, slowListingHint } from './history.js';
import { frameworkHints, loadPlugins } from './plugins.js';
import { findingsReview, planFindings, postedMarkers } from './post-findings.js';
import { childRunner, type PhaseMessage } from './runner.js';
import { startViewServer, type ReviewTarget } from './server.js';
import { terminals as agentTerminals } from './terminal.js';
import { vsCodeFolder, vsCodeOpener } from './editor.js';
import { fileStateStore, stateDir } from './state.js';
import { branchReviews } from './reviews.js';
import { merger, MergeRefused } from './merges.js';
import { claudeMerger, codexMerger, type MergerAgent } from './merge-agent.js';
import { promptSettingsService } from './prompts.js';
import { readClaudeUsage, readCodexUsage, usageService } from './usage.js';
import { codex, findCodex, type Codex } from './codex.js';
import {
  claudeCode,
  workspaces,
  findClaude,
  readWorkspaceConfig,
  type ClaudeCode,
} from './workspaces.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export interface CliContext {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Opens a URL in the user's browser (best effort). */
  openUrl: (url: string) => void;
  /**
   * Opens the viewer in CPR's own window (N1): the window once it shows the page, why it did not
   * open, or null when the desktop app is not set up.
   */
  openApp?: (url: string, title: string) => Promise<AppWindow | { error: string } | null>;
  /** Resolves when a long-running command (`view`) should stop: Ctrl+C. */
  waitForExit: () => Promise<void>;
  /** Environment: tokens, API URLs, `CPR_*` settings. */
  env: Readonly<Record<string, string | undefined>>;
  /** Told each phase of an analysis as it starts: set when `cpr view` runs this CLI. */
  onPhase?: (phase: AnalysisPhase) => void;
}

/** This CLI's script, which `cpr view` runs to analyze a pair of commits. */
const CLI_SCRIPT = fileURLToPath(new URL('./bin.js', import.meta.url));

const processContext = (): CliContext => ({
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  openUrl,
  openApp: (url, title) => {
    const app = findApp(process.env);
    if (!app) return Promise.resolve(null);
    // The launcher's app starts cpr view with what this shell has (decision 197).
    const where = { env: process.env, platform: process.platform };
    recordAgain({ ...where, node: process.execPath, cli: CLI_SCRIPT });
    return openAppWindow(app, url, title, process.env);
  },
  env: process.env,
  // Started by `cpr view` with an IPC channel: phases go back to it.
  ...(process.send ? { onPhase: (phase) => process.send?.({ phase } satisfies PhaseMessage) } : {}),
  waitForExit: () =>
    new Promise((resolve) => {
      process.once('SIGINT', () => resolve());
      process.once('SIGTERM', () => resolve());
      // Started by CPR's app from the desktop (N1b): it stops with the app, even one that died.
      if (process.env.CPR_STDIN_STOPS === '1') {
        process.stdin.once('end', () => resolve());
        process.stdin.resume();
      }
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
  view [<base> [head]] Same comparison, reviewed in the browser; without revisions,
                       History: every branch, to compare or review, with workspaces
                       (agents' branches) beside it
  pr [<number>]        Review a GitHub pull request or GitLab merge request (alias: mr);
                       in a CI job, the job's own
  merge <branch>       Merge a branch's approved commit, check it, and land it
  app install          Add CPR's window to your desktop's apps (app uninstall: remove it)

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
  --codequality <file> Also write the findings as a GitLab Code Quality report
  --fail-on <level>    Exit 1 if a finding is at least: error, warning, info (default: never)
  --no-merge-base      Compare against base directly
  --since <rev>        Mark each changed symbol new, updated or the same as in an earlier
                       head of this change (before a push or rebase)
  --project <path>     tsconfig to load, relative to the repo root (default: tsconfig.json)
  --depth <n>          Hops of unchanged callers/callees to include (default: 1)
  --plugin <name|path> Analyze with a plugin, e.g. angular or qwik (repeatable; also
                       read from "plugins" in cpr/config.json at the repo root)
  -h, --help           Show this help
`;

const VIEW_HELP = `Usage: cpr view [<base> [head]] [options]

Serves the graph viewer on localhost until Ctrl+C, in CPR's own window once the
desktop app is set up (pnpm app:setup), else in the browser. It opens on History (h): every
branch, local and remote, as a graph. Its sidenav lists the workspaces: each a branch
with its own worktree and agent, started from the page. In Compare mode (x), pick two commits to
compare them (the older is the base), or one against its parent; each pair is analyzed
when picked. With <base>, analyzes like \`cpr diff\` first and opens that
comparison.

Options:
  --port <n>           Port to listen on (default: any free port)
  --browser            Open the browser, not CPR's window
  --no-open            Open neither
  --no-merge-base      Compare against base directly
  --since <rev>        Mark each changed symbol new, updated or the same as in an earlier
                       head of this change (before a push or rebase)
  --project <path>     tsconfig to load, relative to the repo root (default: tsconfig.json)
  --depth <n>          Hops of unchanged callers/callees to include (default: 1)
  --plugin <name|path> Analyze with a plugin, e.g. angular or qwik (repeatable; also
                       read from "plugins" in cpr/config.json at the repo root)
  -h, --help           Show this help
`;

const PR_HELP = `Usage: cpr pr [<number>] [options]      (alias: cpr mr)

Reviews a GitHub pull request or GitLab merge request of the \`origin\` remote: reads it
through the forge's API, fetches its head and target branch, and opens the viewer (CPR's
window, or the browser), where comments on symbols are submitted as one review (comment,
approve, or request changes).

In a GitHub Actions or GitLab CI job for a pull/merge request, <number> defaults to it.

Tokens: GITHUB_TOKEN / GH_TOKEN (or gh auth login) · GITLAB_TOKEN.
API overrides: GITHUB_API_URL · GITLAB_API_URL.

Options:
  --summary            Print the summary instead of opening the viewer
  --json               Print the graph JSON instead of opening the viewer
  --out <file>         Also write the graph JSON to a file
  --codequality <file> Also write the findings as a GitLab Code Quality report
  --fail-on <level>    Exit 1 if a finding is at least: error, warning, info
  --post-findings <level>
                       Post new findings at or above the level (error, warning, info) as
                       review comments on their lines, instead of opening the viewer;
                       findings posted by an earlier run are not repeated
  --forge <name>       github or gitlab, for hosts whose name doesn't say
  --remote <name>      Remote to read and fetch from (default: origin)
  --port <n>           Viewer port (default: any free port)
  --browser            Open the browser, not CPR's window
  --no-open            Open neither
  --since <sha>        Mark each changed symbol new, updated or the same as in an earlier
                       head of this pull/merge request (fetched if needed)
  --project <path>     tsconfig to load, relative to the repo root (default: tsconfig.json)
  --depth <n>          Hops of unchanged callers/callees to include (default: 1)
  --plugin <name|path> Analyze with a plugin, e.g. angular or qwik (repeatable; also
                       read from "plugins" in cpr/config.json at the repo root)
  -h, --help           Show this help
`;

const APP_HELP = `Usage: cpr app install | uninstall

CPR's window, the desktop app (pnpm app:setup in CPR's folder fetches it). install adds
CPR to your desktop's apps, for this user, so it opens without a terminal: on the last
repository it showed, or one you choose. It records this node, this CLI and your PATH,
which an app started from the desktop does not have. uninstall removes it. Linux only
for now (WSL included, through WSLg).

Options:
  -h, --help           Show this help
`;

const MERGE_HELP = `Usage: cpr merge <branch> [options]

Merges the commit your CPR review of <branch> approved into a target branch, as Merge
in CPR does: with --no-ff, in a worktree in CPR's cache, never in your checkout. Then
it runs the check (merge.checks in cpr/config.json, else the one guessed from the
target's files) and moves the target by fast-forward: in the worktree that has it
checked out, else its ref. merge.push: true pushes it after. Without a check, the
merge waits for --land. A conflict goes to a merger agent (Claude Code or Codex,
merge.agent, merge.model) that answers each region; CPR writes its answer, and the
merge waits for your --approve.

Options:
  --into <branch>      Branch to merge into (default: the branch its workspace started
                       from, else the one the approval names, else the default branch)
  --land               Land the branch's merge that waits for it
  --approve            Approve the merger agent's resolution of a conflict: it lands
  --again <words>      Ask the merger agent again, with what to change in its resolution
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
    if (command === 'merge') return await merge(rest, ctx);
    if (command === 'app') return appCommand(rest, ctx);
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
  plugin: { type: 'string', multiple: true },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

interface AnalysisArgs {
  positionals: string[];
  values: {
    'no-merge-base': boolean;
    since?: string | undefined;
    project?: string | undefined;
    depth: string;
    plugin?: string[] | undefined;
  };
}

/**
 * Runs the analysis for `diff`/`view` arguments; returns it with the time it took and the
 * plugins it ran with.
 */
async function analyze(
  { positionals, values }: AnalysisArgs,
  ctx: CliContext,
  help: string,
): Promise<{ analysis: Analysis; durationMs: number; plugins: TsPlugin[] }> {
  const [base, head = 'HEAD', ...extra] = positionals;
  if (base === undefined) throw new UsageError('missing <base>', help);
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`, help);
  const depth = checkDepth(values.depth, help);

  const started = performance.now();
  const repo = await openRepo(ctx.cwd);
  const plugins = await loadPlugins(values.plugin ?? [], { cwd: ctx.cwd, repoRoot: repo.root });
  try {
    const analysis = await analyzeGit({
      cwd: ctx.cwd,
      base,
      head,
      mergeBase: !values['no-merge-base'],
      depth,
      cacheDir: defaultCacheDir(ctx.env),
      adapter: createTypescriptAdapter({ plugins }),
      ...(ctx.onPhase ? { onPhase: ctx.onPhase } : {}),
      ...(values.since === undefined ? {} : { since: values.since }),
      ...(values.project === undefined ? {} : { project: values.project }),
    });
    for (const hint of frameworkHints(plugins, analysis.files, repo.root)) {
      ctx.stderr(`hint: ${hint}\n`);
    }
    return { analysis, durationMs: Math.round(performance.now() - started), plugins };
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
  codequality: { type: 'string' },
  'fail-on': { type: 'string' },
} as const;

const SERVE_OPTIONS = {
  port: { type: 'string', default: '0' },
  'no-open': { type: 'boolean', default: false },
  browser: { type: 'boolean', default: false },
} as const;

interface ReportArgs {
  json: boolean;
  out?: string | undefined;
  codequality?: string | undefined;
  'fail-on'?: string | undefined;
}

interface ServeArgs {
  port: string;
  'no-open': boolean;
  browser: boolean;
}

/**
 * Shows the viewer at `url`: in CPR's window when the app is set up (N1), else, or with
 * `--browser`, in the browser; nowhere with `--no-open`. Then waits for Ctrl+C or, in the
 * window, for it to close.
 */
async function showUntilExit(
  url: string,
  title: string,
  args: ServeArgs,
  ctx: CliContext,
): Promise<void> {
  if (args['no-open']) return ctx.waitForExit();
  const shown = args.browser ? null : await ctx.openApp?.(url, title);
  if (shown && 'closed' in shown) {
    ctx.stdout("CPR's window is open: close it, or Ctrl+C, to stop\n");
    await Promise.race([ctx.waitForExit(), shown.closed]);
    shown.close();
    return;
  }
  if (shown) ctx.stderr(`cpr: CPR's window did not open (${shown.error}); opening the browser\n`);
  ctx.openUrl(url);
  return ctx.waitForExit();
}

function checkFailOn(failOn: string | undefined, help: string): void {
  if (failOn !== undefined && !SEVERITIES.includes(failOn as Severity)) {
    throw new UsageError(`--fail-on must be error, warning or info, got '${failOn}'`, help);
  }
}

function checkDepth(value: string, help: string): number {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 1) {
    throw new UsageError(`--depth must be a positive integer, got '${value}'`, help);
  }
  return depth;
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
  await writeCodeQuality(analysis, graph, args.codequality, ctx);
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

/** Writes the GitLab Code Quality report, when asked for. */
async function writeCodeQuality(
  analysis: Analysis,
  graph: Graph,
  file: string | undefined,
  ctx: CliContext,
): Promise<void> {
  const { from } = analysis.revisions;
  const head = analysis.revisions.head.sha;
  if (file === undefined || !from || !head) return;
  const lines = await listChangedLines(await openRepo(ctx.cwd), from, head);
  const report = codeQualityReport(graph, lines);
  await writeFile(resolve(ctx.cwd, file), `${JSON.stringify(report, null, 2)}\n`);
}

/** Serves the viewer for one graph (`cpr pr`) until the user stops it. */
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
    open: vsCodeOpener(repo, ctx.env),
  });
  ctx.stdout(`${statsLine(graph)}\nCPR viewer: ${server.url}  (Ctrl+C to stop)\n`);
  for (const warning of analysis.warnings) ctx.stderr(`warning: ${warning}\n`);

  await showUntilExit(server.url, basename(repo.root), args, ctx);
  await server.close();
  return 0;
}

function statsLine(graph: Graph): string {
  const { symbols } = graph.stats;
  const changed = symbols.added + symbols.removed + symbols.modified;
  return `${graph.stats.filesChanged} files · ${changed} symbols changed · ${graph.findings.length} findings`;
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
  const { analysis, durationMs, plugins } = await analyze({ positionals, values }, ctx, DIFF_HELP);
  const graph = buildGraph(analysis, { generator: { name: 'cpr', version }, durationMs, plugins });
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
  const port = checkPort(values.port, VIEW_HELP);
  checkDepth(values.depth, VIEW_HELP);
  if (positionals.length === 0 && values.since !== undefined) {
    throw new UsageError('--since needs <base>', VIEW_HELP);
  }
  // With revisions, that pair is analyzed before serving, as `cpr diff` would.
  const first =
    positionals.length > 0 ? await analyze({ positionals, values }, ctx, VIEW_HELP) : undefined;

  const repo = await openRepo(ctx.cwd);
  const cacheDir = defaultCacheDir(ctx.env);
  // Pairs picked in the viewer: the same analysis options, in a child process each.
  const diffs = new Diffs(
    childRunner({
      command: [process.execPath, ...process.execArgv, CLI_SCRIPT],
      cwd: ctx.cwd,
      env: ctx.env,
      args: [
        ...(values.plugin ?? []).flatMap((plugin) => ['--plugin', plugin]),
        ...(values.project === undefined ? [] : ['--project', values.project]),
        '--depth',
        values.depth,
      ],
      stderr: ctx.stderr,
    }),
  );
  let hinted = false;
  // Terminals on workspaces' agents (V21): node-pty is loaded only when one is asked for;
  // `CPR_TERMINAL=off` turns them off (the panel keeps Talk).
  const terminals = agentTerminals(
    ctx.env.CPR_TERMINAL === 'off'
      ? { pty: () => Promise.resolve({ error: 'terminals are turned off (CPR_TERMINAL=off)' }) }
      : {},
  );
  // One Codex for workspaces and usage: one connection to its app server.
  const codexOf = codexFinder(repo.root, ctx.env);
  const server = await startViewServer({
    port,
    viewerDir: viewerDir(ctx),
    repository: {
      name: basename(repo.root),
      history: new Histories(
        {
          state: () => historyState(repo),
          stream: (scope, onRows) => streamHistory(repo, scope, onRows),
          details: (shas) => commitDetails(repo, shas),
          defaultBranch: () => defaultBranchTips(repo),
        },
        {
          onListed: (_scope, rows, ms) => {
            const hint = hinted ? null : slowListingHint(rows, ms, hasCommitGraph(repo));
            if (hint) ctx.stderr(hint);
            hinted ||= hint !== null;
          },
        },
      ),
      status: async () => ({ ...(await historyState(repo)), ...(await workingState(repo)) }),
      refs: () => listRefs(repo),
      checkout: (target) => checkout(repo, target),
      isCommit: (sha) => isCommit(repo, sha),
      diffs,
      readFile: (sha, path) => readFileAtRevision(repo, sha, path),
      state: (graph) => fileStateStore(stateDir(cacheDir, repo.id, graph)),
      reviews: branchReviews(repo, cacheDir),
      workspaces: workspaces(repo, cacheDir, {
        claude: agentFinder(repo.root, ctx.env),
        codex: codexOf,
        env: ctx.env,
        openFolder: vsCodeFolder(ctx.env),
        terminals,
      }),
      terminals,
      merges: merger(repo, cacheDir, { mergerAgent: mergerFinder(repo.root, ctx.env) }),
      settings: promptSettingsService(repo),
      // Each subscription's windows (V29c): agents CPR can start, signed in to a plan.
      usage: usageService(
        {
          claude: () =>
            readClaudeUsage({
              installed: async () => (await findClaude(ctx.env)) !== null,
              env: ctx.env,
              home: homedir(),
              // Shared by every `cpr view` on this machine, and kept for the next run.
              lastFile: join(cacheDir, 'usage', 'claude.json'),
            }),
          codex: () => readCodexUsage({ codex: codexOf, env: ctx.env, home: homedir() }),
        },
        { off: ctx.env.CPR_USAGE === 'off' },
      ),
    },
    open: vsCodeOpener(repo, ctx.env),
  });

  let url = server.url;
  if (first) {
    const { analysis, durationMs, plugins } = first;
    const graph = buildGraph(analysis, {
      generator: { name: 'cpr', version },
      durationMs,
      plugins,
    });
    const { from, head } = analysis.revisions;
    if (from && head.sha) {
      const pair = { base: from, head: head.sha };
      diffs.add(pair, graph);
      url = `${server.url}diff/${pairKey(pair)}/`;
    }
    ctx.stdout(`${statsLine(graph)}\n`);
  }
  ctx.stdout(`CPR viewer: ${url}  (Ctrl+C to stop)\n`);
  for (const warning of first?.analysis.warnings ?? []) ctx.stderr(`warning: ${warning}\n`);

  await showUntilExit(url, basename(repo.root), values, ctx);
  diffs.close();
  await server.close();
  return 0;
}

/** A merge's state as `cpr merge` prints it, one line each. */
function mergeLine(entry: MergeEntry): string {
  const check = entry.check;
  const time = check?.ms === undefined ? '' : ` (${(check.ms / 1000).toFixed(1)} s)`;
  switch (entry.state) {
    case 'queued':
      return `queued: ${entry.head.slice(0, 7)} into ${entry.into}${entry.message ? ` (${entry.message})` : ''}`;
    case 'merging':
      return `merging into ${entry.into} at ${entry.base?.slice(0, 7) ?? '?'}`;
    case 'resolving':
      return `resolving: ${entry.conflicts?.length ?? 0} conflicting file(s), asked of the merger agent`;
    case 'checking':
      return `checking: ${check?.commands.join(' && ') ?? ''} (${check?.source ?? ''})`;
    case 'needs-you': {
      const regions = entry.resolution?.regions ?? [];
      if (regions.length > 0 && entry.merge) {
        const by = entry.resolution?.model ?? entry.resolution?.agent ?? '';
        const tokens = entry.resolution?.usage
          ? `, ${entry.resolution.usage.input} tokens in, ${entry.resolution.usage.output} out`
          : '';
        const checked =
          check?.ok === false
            ? `; its check failed: ${check.failed ?? ''}`
            : check?.ok
              ? `; checked${time}`
              : '';
        const lines = regions.map(
          (r) =>
            `  ${r.path}:${r.line}${r.note ? ` — ${r.note}` : ''}\n${r.text.replace(/^/gm, '    | ')}`,
        );
        return `needs you: review the resolution (${by}${tokens})${checked}\n${lines.join('\n')}\n  then --approve, or --again "<what to change>"`;
      }
      return `needs you: ${entry.message ?? ''}${entry.conflicts ? `\n  ${entry.conflicts.join('\n  ')}` : ''}`;
    }
    case 'ready':
      return `ready to land${time}${entry.message ? `: ${entry.message}` : ''}`;
    case 'landed': {
      const pushed = entry.pushed
        ? entry.pushed.ok
          ? `, pushed to ${entry.pushed.remote}`
          : `; not pushed: ${entry.pushed.error}`
        : '';
      return `landed: ${entry.into} is at ${entry.merge?.slice(0, 7) ?? entry.head.slice(0, 7)}${time}${pushed}${entry.message ? ` (${entry.message})` : ''}`;
    }
    case 'failed':
      return check?.ok === false
        ? `failed: ${check.failed ?? ''}${time}\n${check.output ?? ''}`
        : `failed: ${entry.message ?? ''}`;
  }
}

/** `cpr app install|uninstall` (N1b): CPR's window in the desktop's apps. */
function appCommand(argv: string[], ctx: CliContext): number {
  const { values, positionals } = parse(
    {
      args: argv,
      allowPositionals: true,
      options: { help: { type: 'boolean', short: 'h', default: false } },
    },
    APP_HELP,
  );
  const [action, ...extra] = positionals;
  if (values.help || action === undefined) {
    ctx.stdout(APP_HELP);
    return values.help ? 0 : 2;
  }
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`, APP_HELP);
  const where = { env: ctx.env, platform: process.platform };
  if (action === 'uninstall') {
    ctx.stdout(uninstallApp(where));
    return 0;
  }
  if (action !== 'install') throw new UsageError(`unknown action '${action}'`, APP_HELP);
  const app = findApp(ctx.env);
  if (!app) {
    throw new CprError(
      "CPR's window is not set up: run pnpm app:setup and pnpm build in CPR's folder",
    );
  }
  const desktop = dirname(require.resolve('@cpr/desktop/package.json'));
  ctx.stdout(
    installApp({
      ...where,
      app,
      icon: join(desktop, 'icons', 'cpr.png'),
      node: process.execPath,
      cli: CLI_SCRIPT,
    }),
  );
  if (refusesSandbox()) {
    ctx.stderr(
      "warning: AppArmor here refuses Chromium's sandbox to apps outside a package " +
        "(kernel.apparmor_restrict_unprivileged_userns=1): CPR's window may not open; see CPR's window in the README\n",
    );
  }
  return 0;
}

/** Whether AppArmor refuses user namespaces to unpackaged programs (Ubuntu 23.10 and later). */
function refusesSandbox(): boolean {
  try {
    return (
      readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1'
    );
  } catch {
    return false;
  }
}

async function merge(argv: string[], ctx: CliContext): Promise<number> {
  const { values, positionals } = parse(
    {
      args: argv,
      allowPositionals: true,
      options: {
        into: { type: 'string' },
        land: { type: 'boolean', default: false },
        approve: { type: 'boolean', default: false },
        again: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    },
    MERGE_HELP,
  );
  if (values.help) {
    ctx.stdout(MERGE_HELP);
    return 0;
  }
  const [branch, ...extra] = positionals;
  if (!branch || extra.length > 0) throw new UsageError('one branch to merge', MERGE_HELP);
  const repo = await openRepo(ctx.cwd);
  let last = '';
  const print = (entry: MergeEntry) => {
    const line = mergeLine(entry);
    if (line !== last) ctx.stdout(`${line}\n`);
    last = line;
  };
  const merges = merger(repo, defaultCacheDir(ctx.env), {
    onChange: print,
    mergerAgent: mergerFinder(repo.root, ctx.env),
  });
  const done = (entry: MergeEntry | undefined) => (entry?.state === 'landed' ? 0 : 1);
  try {
    const targets = await merges.targets(branch);
    if (values.approve || values.again !== undefined) {
      const entry = targets.entry;
      if (entry?.state !== 'needs-you' || !entry.resolution) {
        ctx.stderr(`cpr merge: ${branch} has no resolution to review\n`);
        return 1;
      }
      const after = values.approve
        ? await merges.approve(entry.id)
        : await merges.requestChanges(entry.id, values.again ?? '');
      print(after);
      await merges.idle();
      const now = (await merges.list()).merges.find((e) => e.id === entry.id);
      if (now) print(now);
      return done(now);
    }
    if (values.land) {
      if (targets.entry?.state !== 'ready') {
        ctx.stderr(`cpr merge: ${branch} has no merge waiting to land\n`);
        return 1;
      }
      const entry = await merges.land(targets.entry.id);
      print(entry);
      await merges.idle();
      return done(entry);
    }
    const into = values.into ?? targets.into;
    if (!into) throw new UsageError('no default branch: name one with --into', MERGE_HELP);
    const queued = await merges.enqueue({ branch, into });
    print(queued);
    await merges.idle();
    // Another CPR process (\`cpr view\`) merges in this repository: its progress, from the queue.
    for (;;) {
      const entry = (await merges.list()).merges.find((e) => e.id === queued.id);
      if (!entry || !['queued', 'merging', 'resolving', 'checking'].includes(entry.state)) {
        if (entry) print(entry);
        return done(entry);
      }
      print(entry);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } catch (error) {
    if (error instanceof MergeRefused) {
      ctx.stderr(`cpr merge: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

/** Claude Code for workspaces (V18), found when first needed and looked for again until it is. */
function agentFinder(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): () => Promise<ClaudeCode | null> {
  let found: ClaudeCode | null = null;
  return async () => {
    if (found) return found;
    const command = await findClaude(env);
    if (!command) return null;
    const { model } = readWorkspaceConfig(root);
    found = claudeCode(command, { cwd: root, ...(model ? { model } : {}) });
    return found;
  };
}

/** Codex for workspaces (V20a), found as Claude Code is; on its app server when it has one (V27a). */
function codexFinder(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): () => Promise<Codex | null> {
  let found: Codex | null = null;
  return async () => {
    if (found) return found;
    const command = await findCodex(env);
    if (!command) return null;
    found = codex(command, { cwd: root, version });
    return found;
  };
}

/**
 * The merger agent (V26c): `kind` (`merge.agent`), else `agent.kind`, else Claude Code, else
 * Codex, whichever is installed.
 */
function mergerFinder(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): (kind?: AgentKind) => Promise<MergerAgent | null> {
  return async (kind) => {
    const first = kind ?? readWorkspaceConfig(root).agent;
    const order: AgentKind[] = first === 'codex' ? ['codex', 'claude'] : ['claude', 'codex'];
    for (const each of kind ? [kind] : order) {
      const command = each === 'claude' ? await findClaude(env) : await findCodex(env);
      if (command) return each === 'claude' ? claudeMerger(command) : codexMerger(command);
    }
    return null;
  };
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
  // In a CI job for a pull/merge request, the number comes from the job.
  const number =
    arg === undefined ? ciChangeRequestNumber(ctx.env) : Number(arg.replace(/^[#!]/, ''));
  if (number === undefined) {
    throw new UsageError('missing <number> (and not in a pull/merge request CI job)', PR_HELP);
  }
  if (!Number.isInteger(number) || number <= 0) {
    throw new UsageError(`not a pull/merge request number: '${arg}'`, PR_HELP);
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

  const { analysis, durationMs, plugins } = await analyze(
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
    plugins,
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
  await writeCodeQuality(analysis, graph, values.codequality, ctx);
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
