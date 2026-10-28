import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { announce, isRunning, readRecords, type Running } from '../src/registry.js';
import { starter, type StartAnswer, type StarterOptions } from '../src/start.js';
import type { Status } from '../src/symbiotes.js';

const dir = tempDir();
const folder = join(dir, 'ky');
mkdirSync(folder);

/**
 * A stand-in for `symbiote view --no-open`: by `FAKE` it says it runs (its record, as the CLI
 * writes it, then waits for SIGTERM, which removes it), fails as outside a repository, or hangs.
 */
const fake = join(dir, 'fake-view.mjs');
writeFileSync(
  fake,
  `import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const running = join(process.env.SYMBIOTE_CACHE_DIR, 'running');
const record = join(running, process.pid + '.json');
if (process.env.FAKE === 'fail') {
  console.log('Symbiote is starting');
  console.error('symbiote: not inside a git working tree: ' + process.cwd());
  process.exit(1);
}
process.on('SIGTERM', () => {
  rmSync(record, { force: true });
  process.exit(0);
});
if (process.env.FAKE === 'serve') {
  mkdirSync(running, { recursive: true });
  const url = 'http://127.0.0.1:' + (40000 + (process.pid % 20000)) + '/';
  writeFileSync(record, JSON.stringify({ url, pid: process.pid, root: process.cwd(),
    name: basename(process.cwd()), started: new Date().toISOString(),
    args: process.argv.slice(2) }));
  console.log('Symbiote viewer: ' + url + '  (Ctrl+C to stop)');
}
setInterval(() => {}, 1000);
`,
);

const status: Status = { branch: 'main', head: 'a1b2c3d', changed: 0 };
const started: number[] = [];

afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone already
    }
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let caches = 0;
/** A starter on a cache of the test's own, running the stand-in as `mode` says. */
function make(mode: 'serve' | 'fail' | 'hang', over: Partial<StarterOptions> = {}) {
  const cache = join(dir, `cache-${++caches}`);
  const options: StarterOptions = {
    cache,
    node: process.execPath,
    script: fake,
    env: { ...process.env, SYMBIOTE_CACHE_DIR: cache, FAKE: mode },
    probe: { alive: isRunning, status: () => Promise.resolve(status) },
    repositoryOf: (path) => Promise.resolve(path === folder ? folder : null),
    ...over,
  };
  return { cache, start: starter(options) };
}

/** Remembers a started pid so the test's end kills it, whatever happened. */
function keep(answer: StartAnswer): { symbiote?: Running; error?: string } {
  if ('symbiote' in answer) started.push(answer.symbiote.pid);
  return answer;
}

describe('starter: start', () => {
  it('runs `view --no-open` in the folder, in a session of its own, and answers with its record', async () => {
    const { cache, start } = make('serve');
    const answer = keep(await start.start(folder));
    expect(answer).toMatchObject({ symbiote: { root: folder, name: 'ky' } });
    const pid = answer.symbiote?.pid ?? 0;
    expect(isRunning(pid)).toBe(true);
    const record = JSON.parse(readFileSync(join(cache, 'running', `${pid}.json`), 'utf8')) as {
      args: string[];
    };
    expect(record.args).toEqual(['view', '--no-open']);
    // Detached: the leader of a process group of its own, so the nexus's Ctrl+C does not reach it.
    expect(() => process.kill(-pid, 0)).not.toThrow();
    // Its output is a file of its own, not a pipe that would break when the nexus ends.
    expect(readFileSync(join(cache, 'nexus', `${pid}.log`), 'utf8')).toMatch(
      /^Symbiote viewer: http:\/\/127\.0\.0\.1:\d+\//,
    );
  });

  it('says why it did not start: its last line', async () => {
    const { start } = make('fail');
    expect(await start.start(folder)).toEqual({
      error: `symbiote: not inside a git working tree: ${folder}`,
    });
  });

  it('stops one that does not start in time, and says so', async () => {
    const { cache, start } = make('hang', { timeout: 400 });
    const answer = await start.start(folder);
    expect(answer).toEqual({ error: 'symbiote view did not start within 0.4 s' });
    const logs = readdirSync(join(cache, 'nexus'));
    expect(logs).toHaveLength(1);
    const pid = Number(logs[0]?.replace('.log', ''));
    await expect.poll(() => isRunning(pid)).toBe(false);
  });

  it('starts none for a repository a live Symbiote serves: that one is the answer', async () => {
    const { cache, start } = make('fail');
    const ky: Running = {
      url: 'http://127.0.0.1:4100/',
      pid: process.pid,
      root: folder,
      name: 'ky',
      started: '2026-10-28T10:00:00.000Z',
    };
    await announce(cache, ky);
    expect(await start.start(folder)).toEqual({ symbiote: ky });
    // A record whose server does not answer is not one.
    const { start: unanswered } = make('fail', {
      cache,
      probe: { alive: isRunning, status: () => Promise.resolve(null) },
    });
    expect('error' in (await unanswered.start(folder))).toBe(true);
  });

  it('starts nowhere but a folder', async () => {
    const { start } = make('serve');
    expect(await start.start(join(dir, 'missing'))).toEqual({
      error: `No such folder: ${join(dir, 'missing')}`,
    });
    expect(await start.start('ky')).toEqual({ error: 'Not an absolute path: ky' });
    writeFileSync(join(dir, 'a-file'), '');
    expect(await start.start(join(dir, 'a-file'))).toEqual({
      error: `Not a folder: ${join(dir, 'a-file')}`,
    });
  });

  it('says to build Symbiote when its command is not built', async () => {
    const { start } = make('serve', { script: join(dir, 'cli', 'dist', 'bin.js') });
    expect(await start.start(folder)).toEqual({
      error: `symbiote is not built (${join(dir, 'cli', 'dist', 'bin.js')}): run pnpm build`,
    });
  });

  it('removes the output of Symbiotes whose process is gone, keeps the live ones', async () => {
    const { cache, start } = make('serve');
    mkdirSync(join(cache, 'nexus'), { recursive: true });
    writeFileSync(join(cache, 'nexus', '2147483646.log'), 'gone');
    writeFileSync(join(cache, 'nexus', `${process.pid}.log`), 'live');
    const answer = keep(await start.start(folder));
    expect(readdirSync(join(cache, 'nexus')).sort()).toEqual(
      [`${answer.symbiote?.pid}.log`, `${process.pid}.log`].sort(),
    );
  });
});

describe('starter: stop', () => {
  it('stops the live Symbiotes of a folder, as Ctrl+C does, once their records are gone', async () => {
    const { cache, start } = make('serve');
    const first = keep(await start.start(folder));
    const second = keep(await start.start(join(dir, 'ky', '.')));
    // The second start found the first running: one process.
    expect(second.symbiote?.pid).toBe(first.symbiote?.pid);
    expect(await start.stop(folder)).toBe(true);
    expect(isRunning(first.symbiote?.pid ?? 0)).toBe(false);
    expect(readRecords(cache)).toEqual([]);
    expect(await start.stop(folder)).toBe(false);
  });

  it('signals no process whose server does not answer as a Symbiote', async () => {
    const { cache, start } = make('serve');
    const answer = keep(await start.start(folder));
    const { start: unanswered } = make('serve', {
      cache,
      probe: { alive: isRunning, status: () => Promise.resolve(null) },
    });
    expect(await unanswered.stop(folder)).toBe(false);
    expect(isRunning(answer.symbiote?.pid ?? 0)).toBe(true);
    expect(existsSync(join(cache, 'running', `${answer.symbiote?.pid}.json`))).toBe(true);
  });
});
