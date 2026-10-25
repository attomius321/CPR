import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CHILD = fileURLToPath(new URL('./crash-child.mjs', import.meta.url));
const HOOKS = fileURLToPath(new URL('./ts-hooks.mjs', import.meta.url));
// The child runs the package's sources with Node's own type stripping (Node 22.18 and later).
const strips = Boolean((process.features as { typescript?: unknown }).typescript);

/** Runs the child, which opens a log and then throws or rejects as `how` says. */
function crash(how: 'throw' | 'reject', log: 'on' | 'off') {
  const dir = mkdtempSync(join(tmpdir(), 'symbiote-crash-'));
  const env = { ...process.env, SYMBIOTE_LOG_DIR: dir, SYMBIOTE_LOG: log === 'off' ? 'off' : '' };
  const run = spawnSync(process.execPath, ['--import', HOOKS, CHILD, how], {
    env,
    encoding: 'utf8',
  });
  const files = readdirSync(dir);
  const written = files.length
    ? readFileSync(join(dir, files[0] ?? ''), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
  return { status: run.status, stderr: run.stderr, written };
}

describe.skipIf(!strips)('watchUncaught', () => {
  it('records an uncaught exception, and the process ends as without it', () => {
    const plain = crash('throw', 'off');
    const logged = crash('throw', 'on');
    expect(plain.status).toBe(1);
    expect(logged.status).toBe(plain.status);
    // Node still prints the stack to stderr.
    expect(logged.stderr).toContain('Error: thrown at start');
    const fatal = logged.written.find((line) => line.level === 'fatal');
    expect(fatal).toMatchObject({ process: 'crash-test', origin: 'uncaughtException' });
    expect((fatal?.err as { stack: string }).stack).toContain('crash-child.mjs');
    expect(logged.written[0]).toMatchObject({ level: 'info', msg: 'started' });
  });

  it('records an unhandled rejection, and the process ends as without it', () => {
    const plain = crash('reject', 'off');
    const logged = crash('reject', 'on');
    expect(plain.status).toBe(1);
    expect(logged.status).toBe(plain.status);
    const fatal = logged.written.find((line) => line.level === 'fatal');
    expect(fatal).toMatchObject({ origin: 'unhandledRejection', msg: 'unhandled rejection' });
    expect((fatal?.err as { message: string }).message).toBe('rejected at start');
  });
});
