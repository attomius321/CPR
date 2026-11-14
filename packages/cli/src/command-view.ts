// `symbiote view`: the repository's pages and services, served until Ctrl+C.
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  buildGraph,
  checkout,
  defaultCacheDir,
  commitDetails,
  defaultBranchTips,
  findCommits,
  hasCommitGraph,
  historyState,
  isCommit,
  listRefs,
  openRepo,
  readFileAtRevision,
  streamHistory,
  workingState,
  type MergeEntry,
} from '@symbiote/core';
import { pruneLogs, silentLog, type Logger } from '@symbiote/log';
import { announce, withdraw } from '@symbiote/nexus/registry';
import { codeMaps } from '@symbiote/monitor';
import { Diffs, pairKey } from './diffs.js';
import { Histories, slowListingHint } from './history.js';
import { gitPage } from './git-page.js';
import { hiveLandingService, hiveRequests } from './hive-request.js';
import { issuesService } from './issues.js';
import { viewIssueClassifier } from './issue-classifier.js';
import { hivePacing, hivePacingService } from './hive-pacing.js';
import { childRunner } from './runner.js';
import { startViewServer } from './server.js';
import { symbioteConfigDir } from './intro.js';
import { repositoryHive } from './hive.js';
import { repositoryNucleusStart } from './nucleus-start.js';
import { hiveRunner } from './hive-runner.js';
import { findConfinement, reviewerSettingsService } from './hive-review.js';
import { hiveWorkspace } from './hive-workspace.js';
import { workspaceDay } from './workspace-day.js';
import { repositoryHiddenBranches } from './git-hidden.js';
import { libraryService, type LibraryService } from './library.js';
import { terminals as agentTerminals } from './terminal.js';
import { vsCodeFolder, vsCodeOpener } from './editor.js';
import { fileStateStore, stateDir } from './state.js';
import { branchReviews, reviewPlace } from './reviews.js';
import { merger } from './merges.js';
import { markMerged } from './mark-merged.js';
import { projectCheck } from './merge-config.js';
import { promptSettingsService } from './prompt-settings.js';
import { checkSettingService } from './check-setting.js';
import { nucleus } from './nucleus.js';
import { scribe } from './scribe.js';
import { skillsService } from './skills.js';
import { readClaudeUsage, readCodexUsage, usageService } from './usage.js';
import { workspaces } from './workspaces.js';
import { dueAnswer, hiveAnsweringService } from './issue-answering.js';
import { viewIssueStarter } from './issue-start.js';
import { hiveSandboxService } from './writer-reach.js';
import { symbioteFolder } from './workspace-record.js';
import { findClaude } from './claude-code.js';
import { removeViewRecord, viewFile, writeViewRecord } from './mcp-bridge.js';
import { runKeys } from './server-keys.js';
import { type CliContext, CLI_SCRIPT, version } from './command-context.js';
import {
  UsageError,
  parse,
  ANALYSIS_OPTIONS,
  SERVE_OPTIONS,
  checkDepth,
  checkPort,
} from './command-args.js';
import {
  analyze,
  showUntilExit,
  pageOpener,
  changeFiles,
  introOf,
  statsLine,
  viewerDir,
} from './command-diff.js';
import {
  agentFinder,
  codexFinder,
  mergerFinder,
  levelsFinder,
  modelsFinder,
} from './command-agents.js';

const VIEW_HELP = `Usage: symbiote view [<base> [head]] [options]

Serves the graph viewer on localhost until Ctrl+C, in Symbiote's own window once the
desktop app is set up (pnpm app:setup), else in the browser. It opens on Git (g): every
branch, local and remote, as a graph. Its sidenav lists the workspaces: each a branch
with its own worktree and agent, started from the page. In Compare mode (x), pick two commits to
compare them (the older is the base), or one against its parent; each pair is analyzed
when picked. With <base>, analyzes like \`symbiote diff\` first and opens that
comparison.

Options:
  --port <n>           Port to listen on (default: any free port)
  --browser            Open the browser, not Symbiote's window
  --no-open            Open neither
  --no-merge-base      Compare against base directly
  --since <rev>        Mark each changed symbol new, updated or the same as in an earlier
                       head of this change (before a push or rebase)
  --project <path>     tsconfig to load, relative to the repo root (default: tsconfig.json)
  --depth <n>          Hops of unchanged callers/callees to include (default: 1)
  --plugin <name|path> Analyze with a plugin, e.g. angular or qwik (repeatable; also
                       read from "plugins" in symbiote/config.json at the repo root)
  -h, --help           Show this help
`;

/** The skill library (SK1), kept in Symbiote's config folder for every repository here. */
function libraryOf(ctx: CliContext): LibraryService {
  const folder = symbioteConfigDir(ctx.env, process.platform, homedir());
  return libraryService(join(folder, 'library.json'), { home: homedir() });
}

/** `symbiote view [<base> [head]]`: the repository's pages served until Ctrl+C; its exit code. */
export async function view(argv: string[], given: CliContext): Promise<number> {
  // The run's secrets (SC1): the page's, the bridge's (in the records below), Nucleus's.
  const { keys, env } = runKeys(given.env);
  const ctx: CliContext = { ...given, env };
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
  // With revisions, that pair is analyzed before serving, as `symbiote diff` would.
  const first =
    positionals.length > 0 ? await analyze({ positionals, values }, ctx, VIEW_HELP) : undefined;

  const repo = await openRepo(ctx.cwd);
  const cacheDir = defaultCacheDir(ctx.env);
  const log = ctx.log ?? silentLog();
  // The days past the 14 kept (LG1): removed by each `symbiote view` as it starts.
  if (log.file) {
    void pruneLogs(dirname(log.file), new Date()).then((removed) => {
      if (removed.length > 0) log.log.info({ removed }, 'old logs removed');
    });
  }
  // Pairs picked in the viewer: the same analysis options, in a child process each.
  const analyzePair = childRunner({
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
    log: log.log,
  });
  const diffs = new Diffs(analyzePair);
  let hinted = false;
  // VS Code, for a workspace's worktree (V29d) and the files agents print in terminals (V38).
  const openFolder = vsCodeFolder(ctx.env);
  // Terminals on workspaces' agents (V21): node-pty is loaded only when one is asked for;
  // `SYMBIOTE_TERMINAL=off` turns them off (the panel keeps Talk). Images pasted into them are
  // kept in the cache (V36).
  const terminals = agentTerminals({
    images: join(cacheDir, 'images'),
    openFolder,
    log: log.log,
    ...(ctx.env.SYMBIOTE_TERMINAL === 'off'
      ? {
          pty: () => Promise.resolve({ error: 'terminals are turned off (SYMBIOTE_TERMINAL=off)' }),
        }
      : {}),
  });
  // One Codex for workspaces and usage: one connection to its app server.
  const codexOf = codexFinder(repo.root, ctx.env);
  // The skill library (SK1): the Skills page's and Scribe's.
  const library = libraryOf(ctx);
  // One Claude Code for workspaces, Nucleus (V35) and Scribe (V41): one read of its sessions every 2 s.
  const claudeOf = agentFinder(repo.root, ctx.env, cacheDir);
  // Hive mode (V82): this repository's switch; while it is on, every workspace started is Hive's
  // and its runner drives it (HV2).
  const hive = repositoryHive(repo, cacheDir);
  // Nucleus's start without a Confirm (NU8): the person's setting, kept as Hive mode is.
  const nucleusStartSetting = repositoryNucleusStart(repo, cacheDir);
  // Each subscription's windows (V29c): agents Symbiote can start, signed in to a plan.
  const usage = usageService(
    {
      claude: () =>
        readClaudeUsage({
          installed: async () => (await findClaude(ctx.env)) !== null,
          env: ctx.env,
          home: homedir(),
          // Shared by every `symbiote view` on this machine, and kept for the next run.
          lastFile: join(cacheDir, 'usage', 'claude.json'),
        }),
      codex: () => readCodexUsage({ codex: codexOf, env: ctx.env, home: homedir() }),
    },
    { off: ctx.env.SYMBIOTE_USAGE === 'off' },
  );
  // HV5: one gate before every agent Hive starts, reading Claude's windows through that copy.
  const pacing = hivePacing({ root: repo.root, usage: (maxAgeMs) => usage.claude(maxAgeMs) });
  const repoWorkspaces = workspaces(repo, cacheDir, {
    claude: claudeOf,
    codex: codexOf,
    env: ctx.env,
    openFolder,
    terminals,
    hive: () => hive.on(),
    hivePacing: pacing,
  });
  // The Issues page (IS1) and the classifier (HV9b), shared with the start from an issue (HV10).
  const repoIssues = issuesService(repo, ctx.env);
  const classifier = viewIssueClassifier(repo, cacheDir, {
    env: ctx.env,
    hive: () => hive.on(),
    claude: claudeOf,
  });
  const issueStart = viewIssueStarter(repo, {
    hive: () => hive.on(),
    classifier,
    issues: repoIssues,
    workspaces: repoWorkspaces,
    folder: async () => symbioteFolder(await reviewPlace(repo, cacheDir)),
    // HV11: the take answered on the issue; Hive's runner writes it.
    due: async (number, step, forge, at) =>
      dueAnswer(symbioteFolder(await reviewPlace(repo, cacheDir)), number, step, {
        root: repo.root,
        forge,
        at,
      }),
  });
  // Branch reviews (V15) and the merger (V26): the review pages', and Hive's landings (HV4).
  const repoReviews = branchReviews(repo, cacheDir);
  const repoMerges = merger(repo, cacheDir, {
    onChange: mergeStates(log.log),
    onError: (error) =>
      log.log.warn(
        { repo: repo.root, error: error instanceof Error ? error.message : String(error) },
        'merger stopped: it merges again at the next kick',
      ),
    mergerAgent: mergerFinder(repo.root, ctx.env),
    levels: levelsFinder(claudeOf, codexOf),
    models: modelsFinder(claudeOf, codexOf),
  });
  const hiveRun = hiveRunner(repo, cacheDir, {
    hive,
    workspaces: repoWorkspaces,
    // The running reviewer (HV3): the workspaces' Claude Code, bubblewrap for its reruns.
    reviewer: {
      claude: async () => (await claudeOf())?.command ?? null,
      confine: () => findConfinement(ctx.env),
    },
    // HV4: Hive lands what it checked and reviewed through the branch reviews and the merge queue.
    // HV8: how often an open request is read; 60 s unless set (the viewer's e2e sets it).
    ...(Number(ctx.env.SYMBIOTE_HIVE_REQUEST_MS) > 0
      ? { requestPollMs: Number(ctx.env.SYMBIOTE_HIVE_REQUEST_MS) }
      : {}),
    lander: {
      reviews: repoReviews,
      merges: repoMerges,
      // HV8: by a pull or merge request where `hive.lands` says so; its graph review analyzed as
      // the viewer's diffs are, in a child process.
      requests: hiveRequests(repo, {
        env: ctx.env,
        graphOf: (pair) =>
          analyzePair(pair, { onPhase: () => undefined, signal: new AbortController().signal }),
      }),
    },
    pacing,
    log: log.log,
  });
  // The branches hidden from Git's graph (decision 645): the listing, its search and the status's
  // version all leave them out, so a version read by one fits the others.
  const hidden = repositoryHiddenBranches(repo, cacheDir);
  const opener = pageOpener(ctx, keys);
  const server = await startViewServer({
    keys,
    openAgain: () => opener.again(),
    port,
    viewerDir: viewerDir(ctx),
    repository: {
      name: basename(repo.root),
      history: new Histories(
        {
          state: async () => historyState(repo, await hidden.list()),
          stream: async (scope, onRows) => streamHistory(repo, scope, onRows, await hidden.list()),
          details: (shas) => commitDetails(repo, shas),
          defaultBranch: () => defaultBranchTips(repo),
          find: async (scope, query) => findCommits(repo, scope, query, await hidden.list()),
        },
        {
          onListed: (_scope, rows, ms) => {
            const hint = hinted ? null : slowListingHint(rows, ms, hasCommitGraph(repo));
            if (hint) ctx.stderr(hint);
            hinted ||= hint !== null;
          },
        },
      ),
      status: async () => ({
        ...(await historyState(repo, await hidden.list())),
        ...(await workingState(repo)),
      }),
      refs: () => listRefs(repo),
      checkout: (target) => checkout(repo, target),
      isCommit: (sha) => isCommit(repo, sha),
      diffs,
      readFile: (sha, path) => readFileAtRevision(repo, sha, path),
      files: changeFiles(repo),
      state: (graph) => fileStateStore(stateDir(cacheDir, repo.id, graph)),
      reviews: repoReviews,
      workspaces: repoWorkspaces,
      // Git's page (V66): a workspace's branch is renamed or deleted with its workspace only; a
      // file's diff opens in VS Code with the workspaces' copies (V70).
      git: gitPage(repo, {
        workspaceBranches: async () =>
          (await repoWorkspaces.list()).workspaces.map((w) => w.branch),
        openFolder,
        revisions: join(cacheDir, 'state', repo.id, 'revisions'),
        hidden,
      }),
      terminals,
      merges: repoMerges,
      // MC3 (decision 990): merged work marked in the docs, where the repository says how.
      marks: markMerged(repo, cacheDir),
      hiveWorkspace: hiveWorkspace(repo, cacheDir, { hive }),
      // The Overview's read of the days (V91, decision 852).
      day: workspaceDay(repo, cacheDir),
      // Nucleus is Alpha Ceph while Hive mode is on (decision 682): its prompt's about too.
      settings: promptSettingsService(repo, { hive: () => hive.on() }),
      // One check for both modes: the merger's and Hive's (fix/settings-page).
      checks: checkSettingService(repo, repo.root),
      nucleus: nucleus(repo, cacheDir, {
        claude: claudeOf,
        codex: codexOf,
        env: ctx.env,
        terminals,
        hive: () => hive.on(),
        // Its key, in its bridge's environment alone (SC1, decision 931).
        nucleusKey: keys.nucleus,
      }),
      skills: skillsService(repo, {
        codexInstalled: async () => (await codexOf()) !== null,
        library,
        openFolder,
      }),
      // The Monitor page (RM1): where the checked-out commit's code is.
      monitor: codeMaps(repo.root),
      // The Issues page (IS1): origin's GitHub or GitLab issues, read only.
      issues: repoIssues,
      // The classifier (HV9b): an issue read for Hive, with Hive on; its records in symbiote/issues/.
      issueClassifier: classifier,
      // A Hive workspace from an issue the classifier took (HV10b).
      issueStart,
      scribe: scribe(repo, cacheDir, {
        claude: claudeOf,
        codex: codexOf,
        env: ctx.env,
        terminals,
        library,
      }),
      usage,
      // Changes from outside (V94c): git's refs, and Claude Code's list read anew.
      gitDir: repo.commonDir,
      sessions: async () => (await claudeOf())?.sessions({ fresh: true, keepMs: 6_000 }) ?? null,
      codexStatus: async (onChange) => {
        const server = await (await codexOf())?.server();
        return server ? server.watch(onChange) : null;
      },
      // The records' folders (V94a): `symbiote/` (or the cache's) and the merge queue's.
      recordFolders: async () => [
        ...new Set([
          symbioteFolder(await reviewPlace(repo, cacheDir)),
          join(cacheDir, 'state', repo.id),
        ]),
      ],
    },
    open: vsCodeOpener(repo, ctx.env),
    intro: introOf(ctx),
    hiveReviewer: reviewerSettingsService(repo.root, claudeOf),
    hiveLanding: hiveLandingService(repo, repo.root, ctx.env),
    hiveAnswering: hiveAnsweringService(repo, repo.root, ctx.env),
    hiveSandbox: hiveSandboxService(repo.root),
    hivePacing: hivePacingService(repo.root, pacing, { read: ctx.env.SYMBIOTE_USAGE !== 'off' }),
    // Settings' switch: the runner told at once (HV2), another process's change read at its tick.
    hive: {
      on: () => hive.on(),
      since: () => hive.since(),
      set: async (on) => {
        await hive.set(on);
        hiveRun.switched(on);
      },
    },
    // The check Hive would run (V92): the default checkout's, as the runner finds it.
    hiveCheck: () => projectCheck(repo, repo.root, 'HEAD'),
    nucleusStart: nucleusStartSetting,
    // How long an MCP ask waits before it lapses: 10 minutes unless set (the viewer's e2e sets it).
    ...(Number(ctx.env.SYMBIOTE_ASK_MS) > 0 ? { askMs: Number(ctx.env.SYMBIOTE_ASK_MS) } : {}),
    // The page's stream (V94); `SYMBIOTE_EVENTS=off`: the pages poll as before.
    events: ctx.env.SYMBIOTE_EVENTS !== 'off',
    log,
    version,
  });
  hiveRun.start();
  // Where Symbiote's MCP bridge finds this server (MC1): Nucleus's, and `symbiote mcp`'s.
  const viewRecord = viewFile(cacheDir, repo.commonDir);
  const started = new Date().toISOString();
  await writeViewRecord(viewRecord, {
    url: server.url,
    pid: process.pid,
    root: repo.root,
    started,
    key: keys.bridge,
  });
  // Where Symbiote nexus finds this server (NX1): a record of its own, beside the others'; where
  // agents' hooks find it too (V94c), by the records' folder it serves.
  await announce(cacheDir, {
    url: server.url,
    pid: process.pid,
    root: repo.root,
    name: basename(repo.root),
    started,
    symbiote: symbioteFolder(await reviewPlace(repo, cacheDir)),
    // The nexus asks for a frame's open token with it (SC1): never served by the nexus.
    key: keys.bridge,
  });

  let url = server.url;
  if (first) {
    const { analysis, durationMs, plugins } = first;
    const graph = buildGraph(analysis, {
      generator: { name: 'symbiote', version },
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
  // Written before the address is printed: what waits for that line finds it written.
  log.log.info(
    { version, repo: repo.root, url, node: process.version, platform: process.platform },
    'view started',
  );
  opener.at(url);
  ctx.stdout(`Symbiote viewer: ${opener.address()}  (Ctrl+C to stop)\n`);
  for (const warning of first?.analysis.warnings ?? []) ctx.stderr(`warning: ${warning}\n`);

  try {
    await showUntilExit(opener, basename(repo.root), values, ctx);
  } finally {
    await removeViewRecord(viewRecord, process.pid);
    await withdraw(cacheDir, process.pid);
    // Its checks stop with it; their steps run them again at the next start (decision 655).
    await hiveRun.close();
  }
  diffs.close();
  await server.close();
  log.log.info({ repo: repo.root }, 'view stopped');
  return 0;
}

/** A merge's line each time its state changes (LG1): a failure as a warning, with its words. */
function mergeStates(log: Logger): (entry: MergeEntry) => void {
  const last = new Map<string, string>();
  return (entry) => {
    if (last.get(entry.id) === entry.state) return;
    last.set(entry.id, entry.state);
    const fields = {
      branch: entry.branch,
      into: entry.into,
      state: entry.state,
      ...(entry.message ? { message: entry.message } : {}),
    };
    if (entry.state === 'failed') log.warn(fields, 'merge failed');
    else log.info(fields, `merge ${entry.state}`);
  };
}
