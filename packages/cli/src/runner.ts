import { spawn } from 'node:child_process';
import type { Graph } from '@symbiote/core';
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
        if (signal.aborted) return reject(new Error('stopped'));
        if (code !== 0) {
          return reject(
            new Error(failure(stderr) || `symbiote diff ended with ${code ?? killedBy}`),
          );
        }
        const label = `${pair.base.slice(0, 7)}..${pair.head.slice(0, 7)}`;
        for (const line of stderr.split('\n')) if (line) options.stderr(`${label}: ${line}\n`);
        try {
          resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as Graph);
        } catch (error) {
          reject(new Error(`symbiote diff printed no graph: ${(error as Error).message}`));
        }
      });
    });
}

/** The CLI's own error lines (`symbiote: …`), else the end of what it printed (a crash). */
function failure(stderr: string): string {
  const lines = stderr.trim().split('\n');
  const own = lines.filter((line) => line.startsWith('symbiote'));
  return (own.length > 0 ? own : lines.slice(-20)).join('\n');
}
