import { createRequire } from 'node:module';
import { SCHEMA_VERSION } from '@cpr/core';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

const HELP = `Usage: cpr <command> [options]

Commands:
  diff <base> <head>   Compare two revisions (not implemented yet)

Options:
  -h, --help           Show this help
  -v, --version        Show version
`;

/** Runs the CLI and returns the process exit code: 0 ok, 1 failure, 2 usage error. */
export function run(argv: readonly string[], io: Io = processIo): number {
  const [command] = argv;

  if (command === undefined || command === 'help' || command === '-h' || command === '--help') {
    io.stdout(HELP);
    return 0;
  }
  if (command === '-v' || command === '--version') {
    io.stdout(`cpr ${version} (graph schema ${SCHEMA_VERSION})\n`);
    return 0;
  }
  if (command === 'diff') {
    io.stderr('cpr diff: not implemented yet\n');
    return 1;
  }

  io.stderr(`cpr: unknown command '${command}'\n\n${HELP}`);
  return 2;
}
