// `symbiote activity`: a workspace's or Nucleus's activity taken out (V84).
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultCacheDir, git, openRepo } from '@symbiote/core';
import { nucleus } from './nucleus.js';
import { workspaces } from './workspaces.js';
import { WorkspaceRefused } from './workspace-record.js';
import { EXPORT_FORMATS, type ActivityExport, type ExportFormat } from './activity-export.js';
import type { CliContext } from './command-context.js';
import { UsageError, parse } from './command-args.js';
import { agentFinder, codexFinder } from './command-agents.js';

const ACTIVITY_HELP = `Usage: symbiote activity [<branch>] [options]

Prints a workspace's activity as Symbiote recorded it, as its Activity tab shows it: the
brief, its agent's messages, reports and questions, every call it made (a failed one with
its input and output), its commits and its review's verdict. Markdown, for you or an agent
to read whole; secrets redacted. Without a branch, the checked-out branch's workspace: run
it in a workspace's worktree. No running symbiote view is needed.

Options:
  --nucleus            Nucleus's activity, across its conversations, instead
  --format <format>    markdown (default), or jsonl: every line as recorded, each with
                       the record it came from, for a script
  --out <file>         Write it to a file, and print the file's path
  -h, --help           Show this help
`;

/** `symbiote activity` (V84): a workspace's or Nucleus's activity, exported. */
export async function activityCommand(argv: string[], ctx: CliContext): Promise<number> {
  const { values, positionals } = parse(
    {
      args: argv,
      allowPositionals: true,
      options: {
        nucleus: { type: 'boolean', default: false },
        format: { type: 'string', default: 'markdown' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    },
    ACTIVITY_HELP,
  );
  if (values.help) {
    ctx.stdout(ACTIVITY_HELP);
    return 0;
  }
  const [named, ...extra] = positionals;
  if (extra.length > 0) throw new UsageError('one branch at most', ACTIVITY_HELP);
  if (named && values.nucleus)
    throw new UsageError('a branch or --nucleus, not both', ACTIVITY_HELP);
  const format = values.format as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    throw new UsageError(
      `--format: ${EXPORT_FORMATS.join(' or ')}, got '${String(values.format)}'`,
      ACTIVITY_HELP,
    );
  }
  const repo = await openRepo(ctx.cwd);
  const cacheDir = defaultCacheDir(ctx.env);
  let done: ActivityExport;
  try {
    if (values.nucleus) {
      const own = nucleus(repo, cacheDir, { claude: () => Promise.resolve(null), env: ctx.env });
      done = await (own.exportActivity as NonNullable<typeof own.exportActivity>)(format);
    } else {
      const branch =
        named ??
        (await git(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(
          (out) => out.trim(),
          () => '',
        ));
      if (!branch) {
        ctx.stderr("symbiote activity: no branch is checked out: name a workspace's branch\n");
        return 1;
      }
      const service = workspaces(repo, cacheDir, {
        claude: agentFinder(repo.root, ctx.env, cacheDir),
        codex: codexFinder(repo.root, ctx.env),
        env: ctx.env,
      });
      done = await service.exportActivity(branch, format);
    }
  } catch (error) {
    if (error instanceof WorkspaceRefused) {
      ctx.stderr(`symbiote activity: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  if (values.out === undefined) {
    ctx.stdout(done.text);
    return 0;
  }
  const path = resolve(ctx.cwd, values.out);
  await writeFile(path, done.text);
  ctx.stdout(`${path}\n`);
  return 0;
}
