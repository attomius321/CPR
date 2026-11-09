// The commands' options: parsed (a usage error names its command's help), the options `diff`,
// `view` and `pr` share, and their values checked.
import { parseArgs, type ParseArgsConfig } from 'node:util';
import type { Severity } from '@symbiote/core';

/** Most severe first. */
export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

export class UsageError extends Error {
  constructor(
    message: string,
    readonly help: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function parse<const T extends ParseArgsConfig>(config: T, help: string) {
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
export const ANALYSIS_OPTIONS = {
  'no-merge-base': { type: 'boolean', default: false },
  since: { type: 'string' },
  project: { type: 'string' },
  depth: { type: 'string', default: '1' },
  plugin: { type: 'string', multiple: true },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

export interface AnalysisArgs {
  positionals: string[];
  values: {
    'no-merge-base': boolean;
    since?: string | undefined;
    project?: string | undefined;
    depth: string;
    plugin?: string[] | undefined;
  };
}

export const REPORT_OPTIONS = {
  json: { type: 'boolean', default: false },
  out: { type: 'string' },
  codequality: { type: 'string' },
  'fail-on': { type: 'string' },
} as const;

export const SERVE_OPTIONS = {
  port: { type: 'string', default: '0' },
  'no-open': { type: 'boolean', default: false },
  browser: { type: 'boolean', default: false },
} as const;

export interface ReportArgs {
  json: boolean;
  out?: string | undefined;
  codequality?: string | undefined;
  'fail-on'?: string | undefined;
}

export interface ServeArgs {
  port: string;
  'no-open': boolean;
  browser: boolean;
}

export function checkFailOn(failOn: string | undefined, help: string): void {
  if (failOn !== undefined && !SEVERITIES.includes(failOn as Severity)) {
    throw new UsageError(`--fail-on must be error, warning or info, got '${failOn}'`, help);
  }
}

export function checkDepth(value: string, help: string): number {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 1) {
    throw new UsageError(`--depth must be a positive integer, got '${value}'`, help);
  }
  return depth;
}

export function checkPort(port: string, help: string): number {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new UsageError(`--port must be a port number, got '${port}'`, help);
  }
  return value;
}
