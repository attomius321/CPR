// `symbiote diff`: two commits analyzed and the graph reported; the analysis, the report and the
// one-graph server that `view` and `pr` use too.
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  analyzeGit,
  buildGraph,
  SymbioteError,
  createAdapter,
  defaultCacheDir,
  fileDiff,
  listChangedLines,
  listChangedBlobs,
  listLineCounts,
  NoMergeBaseError,
  openRepo,
  readFileAtRevision,
  type Analysis,
  type GitRepo,
  type Graph,
  type Severity,
  type TsPlugin,
} from '@symbiote/core';
import { codeQualityReport } from './codequality.js';
import { formatAnalysis } from './format.js';
import { frameworkHints, loadPlugins } from './plugins.js';
import { startViewServer } from './server.js';
import type { ChangeFiles, ReviewTarget } from './server-context.js';
import { introRecord, symbioteConfigDir, type IntroRecord } from './intro.js';
import { repositoryHive } from './hive.js';
import { vsCodeOpener } from './editor.js';
import { fileStateStore, stateDir } from './state.js';
import { type CliContext, version } from './command-context.js';
import {
  SEVERITIES,
  UsageError,
  parse,
  ANALYSIS_OPTIONS,
  type AnalysisArgs,
  REPORT_OPTIONS,
  type ReportArgs,
  type ServeArgs,
  checkFailOn,
  checkDepth,
  checkPort,
} from './command-args.js';

const require = createRequire(import.meta.url);

const DIFF_HELP = `Usage: symbiote diff <base> [head] [options]

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
                       read from "plugins" in symbiote/config.json at the repo root)
  -h, --help           Show this help
`;

/**
 * Runs the analysis for `diff`/`view` arguments; returns it with the time it took and the
 * plugins it ran with.
 */
export async function analyze(
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
      adapter: createAdapter({ plugins }),
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
      throw new SymbioteError(`${error.message}; use --no-merge-base to compare them directly`, {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Shows the viewer at `url`: in Symbiote's window when the app is set up (N1), else, or with
 * `--browser`, in the browser; nowhere with `--no-open`. Then waits for Ctrl+C or, in the
 * window, for it to close.
 */
export async function showUntilExit(
  url: string,
  title: string,
  args: ServeArgs,
  ctx: CliContext,
): Promise<void> {
  if (args['no-open']) return ctx.waitForExit();
  const shown = args.browser ? null : await ctx.openApp?.(url, title);
  if (shown && 'closed' in shown) {
    ctx.stdout("Symbiote's window is open: close it, or Ctrl+C, to stop\n");
    await Promise.race([ctx.waitForExit(), shown.closed]);
    shown.close();
    return;
  }
  if (shown)
    ctx.stderr(`symbiote: Symbiote's window did not open (${shown.error}); opening the browser\n`);
  ctx.openUrl(url);
  return ctx.waitForExit();
}

/** Prints the summary or the graph JSON, writes `--out`, applies `--fail-on`. */
export async function report(
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
        `symbiote: ${failing.length} finding${failing.length === 1 ? '' : 's'} at or above '${failOn}'\n`,
      );
      return 1;
    }
  }
  return 0;
}

/** Writes the GitLab Code Quality report, when asked for. */
export async function writeCodeQuality(
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

/** Serves the viewer for one graph (`symbiote pr`) until the user stops it. */
export async function serve(
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
    files: changeFiles(repo),
    state: fileStateStore(stateDir(defaultCacheDir(ctx.env), repo.id, graph)),
    ...(review ? { review } : {}),
    open: vsCodeOpener(repo, ctx.env),
    intro: introOf(ctx),
    hive: repositoryHive(repo, defaultCacheDir(ctx.env)),
    ...(ctx.log ? { log: ctx.log } : {}),
  });
  ctx.log?.log.info({ version, repo: repo.root, url: server.url }, 'serving one graph');
  ctx.stdout(`${statsLine(graph)}\nSymbiote viewer: ${server.url}  (Ctrl+C to stop)\n`);
  for (const warning of analysis.warnings) ctx.stderr(`warning: ${warning}\n`);

  await showUntilExit(server.url, basename(repo.root), args, ctx);
  await server.close();
  return 0;
}

/** The first-time intro's record (V39), in Symbiote's config folder; `SYMBIOTE_INTRO=off`: none. */
/** A change's files from the repository's git (V60): their lines and one file's diff. */
export function changeFiles(repo: GitRepo): ChangeFiles {
  return {
    lines: (from, to) => listLineCounts(repo, from, to),
    blobs: (from, to) => listChangedBlobs(repo, from, to),
    diff: (from, to, file) => fileDiff(repo, from, to, file),
  };
}

/** Whether a person saw the first-time intro (V39), kept in Symbiote's folder on this system. */
export function introOf(ctx: CliContext): IntroRecord {
  const folder = symbioteConfigDir(ctx.env, process.platform, homedir());
  return introRecord(join(folder, 'intro.json'), { off: ctx.env.SYMBIOTE_INTRO === 'off' });
}

/** A graph in one line: files, symbols changed, findings. */
export function statsLine(graph: Graph): string {
  const { symbols } = graph.stats;
  const changed = symbols.added + symbols.removed + symbols.modified;
  return `${graph.stats.filesChanged} files · ${changed} symbols changed · ${graph.findings.length} findings`;
}

/** `symbiote diff <base> [head]`: the change analyzed and reported; its exit code. */
export async function diff(argv: string[], ctx: CliContext): Promise<number> {
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
  const graph = buildGraph(analysis, {
    generator: { name: 'symbiote', version },
    durationMs,
    plugins,
  });
  return report(analysis, graph, values, ctx);
}

/** The built viewer that ships with the CLI (`SYMBIOTE_VIEWER_DIR` overrides, e.g. for tests). */
export function viewerDir(ctx: CliContext): string {
  const dir =
    ctx.env.SYMBIOTE_VIEWER_DIR ??
    join(dirname(require.resolve('@symbiote/viewer/package.json')), 'dist');
  if (!existsSync(join(dir, 'index.html'))) {
    throw new SymbioteError(`the viewer is not built (${dir}); run pnpm build`);
  }
  return dir;
}
