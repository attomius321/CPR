// `symbiote pr` (and `mr`): a pull or merge request analyzed, reported, posted or served.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildGraph,
  SymbioteError,
  fetchRefs,
  listChangedLines,
  openRepo,
  remoteUrl,
  resolveCommit,
  type ChangedLines,
  type Graph,
  type Severity,
} from '@symbiote/core';
import { detectForge, type ChangeRequest, type Forge } from '@symbiote/forge';
import { ciChangeRequestNumber } from './ci.js';
import { postGraphFindings } from './post-findings.js';
import { type CliContext, version } from './command-context.js';
import {
  SEVERITIES,
  UsageError,
  parse,
  ANALYSIS_OPTIONS,
  REPORT_OPTIONS,
  SERVE_OPTIONS,
  checkFailOn,
  checkPort,
} from './command-args.js';
import { analyze, report, writeCodeQuality, serve } from './command-diff.js';

const PR_HELP = `Usage: symbiote pr [<number>] [options]      (alias: symbiote mr)

Reviews a GitHub pull request or GitLab merge request of the \`origin\` remote: reads it
through the forge's API, fetches its head and target branch, and opens the viewer (Symbiote's
window, or the browser), where comments on symbols are submitted as one review (comment,
approve, or request changes).

In a GitHub Actions or GitLab CI job for a pull/merge request, <number> defaults to it.

Tokens: GITHUB_TOKEN / GH_TOKEN (or gh auth login) · GITLAB_TOKEN, sent to github.com,
gitlab.com, the CI job's server or the API address set; GH_ENTERPRISE_TOKEN with GH_HOST.
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
  --browser            Open the browser, not Symbiote's window
  --no-open            Open neither
  --since <sha>        Mark each changed symbol new, updated or the same as in an earlier
                       head of this pull/merge request (fetched if needed)
  --project <path>     tsconfig to load, relative to the repo root (default: tsconfig.json)
  --depth <n>          Hops of unchanged callers/callees to include (default: 1)
  --plugin <name|path> Analyze with a plugin, e.g. angular or qwik (repeatable; also
                       read from "plugins" in symbiote/config.json at the repo root)
  -h, --help           Show this help
`;

/**
 * Reviews a GitHub pull request or GitLab merge request: reads it through the forge's API,
 * fetches its head and target branch, and analyzes the same diff the forge shows.
 */
export async function pr(argv: string[], ctx: CliContext): Promise<number> {
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
  const local = `refs/symbiote/${forge.kind}/${number}`;
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
        throw new SymbioteError(`cannot find or fetch --since ${values.since}`, { cause: error });
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
    generator: { name: 'symbiote', version },
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

/** Posts the findings no earlier run posted (`postGraphFindings`), saying what it did. */
async function postFindings(
  forge: Forge,
  request: ChangeRequest,
  graph: Graph,
  lines: ChangedLines,
  level: Severity,
  ctx: CliContext,
): Promise<void> {
  const result = await postGraphFindings(forge, request, graph, lines, level);
  const already = result.skipped > 0 ? ` (${result.skipped} already posted)` : '';
  if (result.posted === 0) {
    ctx.stderr(`No new findings to post${already}\n`);
    return;
  }
  if (result.inlineRefused) {
    ctx.stderr(
      `warning: inline comments were refused (${result.inlineRefused}); posting the findings in the summary\n`,
    );
  }
  const count = result.posted;
  ctx.stderr(`Posted ${count} finding${count === 1 ? '' : 's'}${already}: ${result.url ?? ''}\n`);
}
