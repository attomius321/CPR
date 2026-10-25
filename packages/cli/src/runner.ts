import { spawn } from 'node:child_process';
import type { Graph } from '@symbiote/core';
import type { Logger } from '@symbiote/log';
import type { RunDiff } from './diffs.js';

export interface ChildRunnerOptions {
  /** The CLI: node and its script. */
  command: readonly [string, ...string[]];
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  /** Analysis options after the pair: `--plugin`, `--project`, `--depth`. */
  args: readonly string[];
  /** Where the child's hints and warnings go. */
  stderr: (text: string) => void;
  /** Each analysis's start and end (LG1); a child that dies without a word speaks only here. */
  log?: Logger;
}

/** What a phase message from the child looks like (`CliContext.onPhase`). */
export interface PhaseMessage {
  phase: string;
}

/**
 * Analyzes each pair with `symbiote diff <base> <head> --no-merge-base --json` in a child process:
 * the analysis is synchronous, so in the server's process it would stop the server answering; a
 * process also frees its memory when it ends and can be stopped. Phases come over IPC.
 */
export function childRunner(options: ChildRunnerOptions): RunDiff {
  const [command, ...script] = options.command;
  return (pair, { onPhase, signal }) =>
    new Promise<Graph>((resolve, reject) => {
      const args = ['diff', pair.base, pair.head, '--no-merge-base', '--json', ...options.args];
      const child = spawn(command, [...script, ...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const label = `${pair.base.slice(0, 7)}..${pair.head.slice(0, 7)}`;
      const started = Date.now();
      options.log?.info({ pair: label, pid: child.pid }, 'analysis started');
      const stdout: Buffer[] = [];
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('message', (message: Partial<PhaseMessage> | null) => {
        if (typeof message?.phase === 'string') onPhase(message.phase);
      });
      const stop = () => child.kill();
      signal.addEventListener('abort', stop, { once: true });
      child.on('error', (error) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      });
      child.on('close', (code, killedBy) => {
        signal.removeEventListener('abort', stop);
        const ms = Date.now() - started;
        if (signal.aborted) {
          options.log?.info({ pair: label, ms }, 'analysis stopped');
          return reject(new Error('stopped'));
        }
        if (code !== 0) {
          const said = failure(stderr);
          const end = { pair: label, code, signal: killedBy, ms, stderr: lastLines(stderr) };
          // Killed, or out of memory: the child wrote no line of its own.
          if (killedBy) options.log?.error(end, 'analysis ended');
          // Its own `symbiote:` words are a refusal; anything else is a crash's stack.
          else if (said.startsWith('symbiote')) options.log?.warn(end, 'analysis failed');
          else options.log?.error(end, 'analysis failed');
          return reject(new Error(said || `symbiote diff ended with ${code ?? killedBy}`));
        }
        for (const line of stderr.split('\n')) {
          if (!line) continue;
          options.stderr(`${label}: ${line}\n`);
          options.log?.warn({ pair: label }, line);
        }
        try {
          resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as Graph);
          options.log?.info({ pair: label, ms }, 'analysis done');
        } catch (error) {
          options.log?.error({ pair: label, err: error }, 'analysis printed no graph');
          reject(new Error(`symbiote diff printed no graph: ${(error as Error).message}`));
        }
      });
    });
}

/** The end of what a child printed, for its line: 20 lines, 4 KB at most. */
function lastLines(stderr: string): string {
  return stderr.trim().split('\n').slice(-20).join('\n').slice(-4096);
}

/** The CLI's own error lines (`symbiote: …`), else the end of what it printed (a crash). */
function failure(stderr: string): string {
  const lines = stderr.trim().split('\n');
  const own = lines.filter((line) => line.startsWith('symbiote'));
  return (own.length > 0 ? own : lines.slice(-20)).join('\n');
}
