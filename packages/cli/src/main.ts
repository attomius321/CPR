import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import {
  CprError,
  listChangedFiles,
  NoMergeBaseError,
  openRepo,
  resolveRevisions,
  SCHEMA_VERSION,
  type ChangedFile,
  type FileChangeStatus,
  type ResolvedRevisions,
} from '@cpr/core';

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

const HELP = `Usage: cpr <command> [options]

Commands:
  diff <base> [head]   Compare head (default: HEAD) against base

Options:
  -h, --help           Show this help
  -v, --version        Show version
`;

const DIFF_HELP = `Usage: cpr diff <base> [head] [options]

Compares head (default: HEAD) against the merge-base of base and head,
like a GitHub pull request. Lists changed files for now; symbol analysis
comes in later milestones.

Options:
  --no-merge-base      Compare against base directly
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

function parse<T extends Parameters<typeof parseArgs>[0]>(config: T, help: string) {
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
        help: { type: 'boolean', short: 'h', default: false },
      },
    },
    DIFF_HELP,
  );
  if (values.help) {
    ctx.stdout(DIFF_HELP);
    return 0;
  }

  const [baseRef, headRef = 'HEAD', ...extra] = positionals;
  if (baseRef === undefined) throw new UsageError('missing <base>', DIFF_HELP);
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`, DIFF_HELP);

  const repo = await openRepo(ctx.cwd);
  let revisions: ResolvedRevisions;
  try {
    revisions = await resolveRevisions(repo, baseRef, headRef, {
      mergeBase: !values['no-merge-base'],
    });
  } catch (error) {
    if (error instanceof NoMergeBaseError) {
      throw new CprError(`${error.message}; use --no-merge-base to compare them directly`, {
        cause: error,
      });
    }
    throw error;
  }

  const files = await listChangedFiles(repo, revisions.from, revisions.head.sha);
  ctx.stdout(formatDiff(revisions, files));
  return 0;
}

const LETTER: Record<FileChangeStatus, string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
};

const short = (sha: string) => sha.slice(0, 7);

function formatDiff({ base, head }: ResolvedRevisions, files: ChangedFile[]): string {
  const mergeBase = base.mergeBase ? `, merge-base ${short(base.mergeBase)}` : '';
  const lines = [
    `${base.ref} (${short(base.sha)}) → ${head.ref} (${short(head.sha)})${mergeBase}`,
    files.length === 0
      ? 'no files changed'
      : `${files.length} file${files.length === 1 ? '' : 's'} changed`,
    ...files.map(
      ({ status, path, previousPath }) =>
        `  ${LETTER[status]}  ${previousPath === undefined ? path : `${previousPath} → ${path}`}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}
